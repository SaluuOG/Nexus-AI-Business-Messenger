-- Personal scan workflow, not a shared chat completion flag. Only the latest
-- derived result is retained; every read rechecks live access and all inputs.
CREATE TABLE private.chat_scan_states (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN('direct','group')),
  chat_id uuid NOT NULL,
  done boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 0,
  last_fingerprint text,
  last_scanned_at timestamptz,
  cached_result jsonb,
  PRIMARY KEY(user_id,kind,chat_id),
  CHECK(cached_result IS NULL OR octet_length(cached_result::text) <= 1500000)
);
CREATE INDEX chat_scan_states_chat_idx ON private.chat_scan_states(kind,chat_id);
ALTER TABLE private.chat_scan_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chat_scan_states FROM PUBLIC,anon,authenticated;

-- Hash fixed-size per-message digests instead of constructing a transcript.
-- This covers exactly the scan inputs (including old edits, names and counts)
-- and keeps status/mark-done available above the provider's history size limit.
CREATE FUNCTION private.chat_scan_fingerprint(p_kind text,p_chat_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_fingerprint text;
BEGIN
  IF auth.uid() IS NULL OR p_chat_id IS NULL OR p_kind IS NULL OR p_kind NOT IN('direct','group') THEN
    RAISE EXCEPTION 'no_access';
  END IF;
  IF p_kind='direct' THEN
    IF NOT EXISTS(SELECT 1 FROM public.direct_conversations c WHERE c.id=p_chat_id AND auth.uid() IN(c.user_a,c.user_b)) THEN
      RAISE EXCEPTION 'no_access';
    END IF;
    SELECT md5(coalesce(string_agg(md5(jsonb_build_array(m.id,m.sender_id,m.body,m.created_at,m.edited_at,
      coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Kontakt'),
      (SELECT count(*) FROM public.direct_message_attachments a WHERE a.message_id=m.id AND a.conversation_id=p_chat_id)
    )::text),'' ORDER BY m.created_at,m.id),'')) INTO v_fingerprint
    FROM public.direct_messages m LEFT JOIN public.profiles p ON p.id=m.sender_id
    WHERE m.conversation_id=p_chat_id AND m.deleted_at IS NULL;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.group_members gm WHERE gm.group_id=p_chat_id AND gm.user_id=auth.uid()) THEN
      RAISE EXCEPTION 'no_access';
    END IF;
    SELECT md5(coalesce(string_agg(md5(jsonb_build_array(m.id,m.sender_id,m.body,m.created_at,m.edited_at,
      coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Gruppenmitglied'),
      (SELECT count(*) FROM public.group_message_attachments a WHERE a.message_id=m.id AND a.group_id=p_chat_id)
    )::text),'' ORDER BY m.created_at,m.id),'')) INTO v_fingerprint
    FROM public.group_messages m LEFT JOIN public.profiles p ON p.id=m.sender_id
    WHERE m.group_id=p_chat_id AND m.deleted_at IS NULL;
  END IF;
  RETURN v_fingerprint;
END $$;

CREATE FUNCTION private.my_chat_scan_state(p_kind text,p_chat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v private.chat_scan_states; v_fingerprint text; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  v_fingerprint := private.chat_scan_fingerprint(p_kind,p_chat_id);
  SELECT * INTO v FROM private.chat_scan_states WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id;
  v_status := CASE WHEN v.done THEN 'done' WHEN v.last_fingerprint IS NULL THEN 'open'
    WHEN v.last_fingerprint=v_fingerprint AND v.cached_result IS NOT NULL THEN 'processed' ELSE 'updated' END;
  RETURN jsonb_build_object('chat_id',p_chat_id,'status',v_status,'last_scanned_at',v.last_scanned_at,
    'revision',md5(v_fingerprint || ':' || coalesce(v.generation,0)::text),
    'can_scan',v_status IN('open','updated'));
END $$;

CREATE FUNCTION public.get_my_chat_scan_state(p_kind text,p_chat_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.my_chat_scan_state(p_kind,p_chat_id);
$$;
CREATE FUNCTION public.get_my_chat_scan_states(p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_kind IS NULL OR p_kind NOT IN('direct','group') THEN RAISE EXCEPTION 'no_access'; END IF;
  SELECT coalesce(jsonb_agg(private.my_chat_scan_state(p_kind,c.id) ORDER BY c.id),'[]'::jsonb) INTO v_result
  FROM (SELECT id FROM public.direct_conversations WHERE p_kind='direct'
    UNION ALL SELECT id FROM public.group_conversations WHERE p_kind='group') c;
  RETURN v_result;
END $$;

CREATE FUNCTION private.set_my_chat_scan_done(p_kind text,p_chat_id uuid,p_done boolean,p_expected_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  IF p_done IS NULL THEN RAISE EXCEPTION 'invalid_response'; END IF;
  PERFORM private.chat_scan_fingerprint(p_kind,p_chat_id);
  INSERT INTO private.chat_scan_states(user_id,kind,chat_id) VALUES(auth.uid(),p_kind,p_chat_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM private.chat_scan_states WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id FOR UPDATE;
  v_state := private.my_chat_scan_state(p_kind,p_chat_id);
  IF p_expected_revision IS DISTINCT FROM v_state->>'revision' THEN RAISE EXCEPTION 'status_changed'; END IF;
  UPDATE private.chat_scan_states SET done=p_done,generation=generation+1
    WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id AND done IS DISTINCT FROM p_done;
  RETURN private.my_chat_scan_state(p_kind,p_chat_id);
END $$;
CREATE FUNCTION public.set_my_chat_scan_done(p_kind text,p_chat_id uuid,p_done boolean,p_expected_revision text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.set_my_chat_scan_done(p_kind,p_chat_id,p_done,p_expected_revision);
$$;

-- The Edge handler supplies this only after validating the complete result.
-- This is user-owned workflow metadata, not an unforgeable AI audit record.
CREATE FUNCTION private.complete_my_chat_scan(p_kind text,p_chat_id uuid,p_snapshot text,p_scan_id uuid,p_expected_revision text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb; v_fingerprint text; v_page jsonb; v_lease private.chat_scan_limits;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  PERFORM private.chat_scan_fingerprint(p_kind,p_chat_id);
  SELECT * INTO v_lease FROM private.chat_scan_limits WHERE user_id=auth.uid() FOR UPDATE;
  IF p_scan_id IS NULL OR v_lease.active_id IS DISTINCT FROM p_scan_id OR v_lease.active_until IS NULL
    OR v_lease.active_until <= clock_timestamp() THEN RAISE EXCEPTION 'scan_expired'; END IF;
  INSERT INTO private.chat_scan_states(user_id,kind,chat_id) VALUES(auth.uid(),p_kind,p_chat_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM private.chat_scan_states WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id FOR UPDATE;
  -- STABLE helpers in one SQL statement use the same MVCC snapshot. A message
  -- arriving afterward leaves the saved fingerprint old and therefore updated.
  SELECT private.my_chat_scan_state(p_kind,p_chat_id),private.chat_scan_fingerprint(p_kind,p_chat_id),
    public.get_chat_scan_page(p_kind,p_chat_id,NULL,NULL,p_snapshot,1)
    INTO v_state,v_fingerprint,v_page;
  IF v_state->>'status'='done' THEN RAISE EXCEPTION 'chat_done'; END IF;
  IF v_state->>'status'='processed' THEN RAISE EXCEPTION 'already_processed'; END IF;
  IF p_expected_revision IS DISTINCT FROM v_state->>'revision' THEN RAISE EXCEPTION 'status_changed'; END IF;
  IF p_snapshot IS NULL OR p_snapshot IS DISTINCT FROM v_page->>'snapshot' THEN RAISE EXCEPTION 'history_changed'; END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>1500000
    OR p_result->>'scanId' IS DISTINCT FROM p_scan_id::text OR p_result->>'chatKind' IS DISTINCT FROM p_kind
    OR p_result->>'chatId' IS DISTINCT FROM p_chat_id::text OR jsonb_typeof(p_result->'summary') IS DISTINCT FROM 'string'
    OR length(btrim(p_result->>'summary'))=0 OR length(p_result->>'summary')>10000
    OR jsonb_typeof(p_result->'facts') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'decisions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_result->'tasks') IS DISTINCT FROM 'array' OR jsonb_typeof(p_result->'questions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_result->'sources') IS DISTINCT FROM 'array'
    OR p_result->'coverage'->'complete' IS DISTINCT FROM 'true'::jsonb
    OR p_result->'coverage'->'messageCount' IS DISTINCT FROM v_page->'total_count'
    OR p_result->'coverage'->'attachmentsExcluded' IS DISTINCT FROM v_page->'attachment_count'
    THEN RAISE EXCEPTION 'invalid_response'; END IF;
  UPDATE private.chat_scan_states SET last_fingerprint=v_fingerprint,last_scanned_at=clock_timestamp(),
    cached_result=p_result,generation=generation+1 WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id;
  RETURN private.my_chat_scan_state(p_kind,p_chat_id);
END $$;
CREATE FUNCTION public.complete_my_chat_scan(p_kind text,p_chat_id uuid,p_snapshot text,p_scan_id uuid,p_expected_revision text,p_result jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.complete_my_chat_scan(p_kind,p_chat_id,p_snapshot,p_scan_id,p_expected_revision,p_result);
$$;

CREATE FUNCTION private.my_chat_scan_result(p_kind text,p_chat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  v_state := private.my_chat_scan_state(p_kind,p_chat_id);
  IF v_state->>'status'<>'processed' THEN RETURN NULL; END IF;
  SELECT cached_result INTO v_result FROM private.chat_scan_states WHERE user_id=auth.uid() AND kind=p_kind AND chat_id=p_chat_id;
  RETURN v_result;
END $$;
CREATE FUNCTION public.get_my_chat_scan_result(p_kind text,p_chat_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.my_chat_scan_result(p_kind,p_chat_id);
$$;

-- Internal lifecycle trigger only, with no client EXECUTE grant. It must also
-- run for administrator cleanup/cascades without an authenticated JWT. Copies
-- are cleared eagerly; fingerprint validation remains the final read boundary.
CREATE FUNCTION private.invalidate_chat_scan_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_kind text; v_old_chat uuid; v_new_chat uuid; v_old_label text; v_new_label text;
  v_old jsonb; v_new jsonb;
BEGIN
  IF TG_TABLE_NAME='group_members' THEN
    DELETE FROM private.chat_scan_states WHERE user_id=OLD.user_id AND kind='group' AND chat_id=OLD.group_id;
  ELSIF TG_TABLE_NAME IN('direct_conversations','group_conversations') THEN
    DELETE FROM private.chat_scan_states WHERE kind=CASE WHEN TG_TABLE_NAME='direct_conversations' THEN 'direct' ELSE 'group' END AND chat_id=OLD.id;
  ELSIF TG_TABLE_NAME='profiles' THEN
    v_old_label := coalesce(nullif(btrim(OLD.full_name),''),nullif(btrim(OLD.username),''));
    IF TG_OP<>'DELETE' THEN v_new_label := coalesce(nullif(btrim(NEW.full_name),''),nullif(btrim(NEW.username),'')); END IF;
    UPDATE private.chat_scan_states s SET cached_result=NULL,generation=generation+1 WHERE cached_result IS NOT NULL AND (
      (s.kind='direct' AND coalesce(v_old_label,'Kontakt') IS DISTINCT FROM coalesce(v_new_label,'Kontakt')
        AND s.chat_id IN(SELECT conversation_id FROM public.direct_messages WHERE sender_id=OLD.id AND deleted_at IS NULL)) OR
      (s.kind='group' AND coalesce(v_old_label,'Gruppenmitglied') IS DISTINCT FROM coalesce(v_new_label,'Gruppenmitglied')
        AND s.chat_id IN(SELECT group_id FROM public.group_messages WHERE sender_id=OLD.id AND deleted_at IS NULL)));
  ELSE
    v_kind := CASE WHEN TG_TABLE_NAME IN('direct_messages','direct_message_attachments') THEN 'direct' ELSE 'group' END;
    IF TG_OP<>'INSERT' THEN v_old := to_jsonb(OLD); v_old_chat := coalesce(v_old->>'conversation_id',v_old->>'group_id')::uuid; END IF;
    IF TG_OP<>'DELETE' THEN v_new := to_jsonb(NEW); v_new_chat := coalesce(v_new->>'conversation_id',v_new->>'group_id')::uuid; END IF;
    IF TG_TABLE_NAME IN('direct_messages','group_messages') THEN
      -- Reply links and other display-only metadata are not model inputs.
      -- Already deleted messages contribute neither text nor attachment counts.
      IF (v_old IS NULL OR v_old->>'deleted_at' IS NOT NULL) AND (v_new IS NULL OR v_new->>'deleted_at' IS NOT NULL) THEN RETURN NULL; END IF;
      IF TG_OP='UPDATE' AND v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NULL
        AND jsonb_build_array(v_old_chat,v_old->'id',v_old->'sender_id',v_old->'body',v_old->'created_at',v_old->'edited_at')
          IS NOT DISTINCT FROM jsonb_build_array(v_new_chat,v_new->'id',v_new->'sender_id',v_new->'body',v_new->'created_at',v_new->'edited_at') THEN RETURN NULL; END IF;
      IF v_old->>'deleted_at' IS NOT NULL THEN v_old_chat := NULL; END IF;
      IF v_new->>'deleted_at' IS NOT NULL THEN v_new_chat := NULL; END IF;
    ELSE
      -- Only attachment counts are scanned. Renames, size, MIME type, storage
      -- metadata and timestamps leave those counts and the analysis unchanged.
      IF TG_OP='UPDATE' AND v_old_chat IS NOT DISTINCT FROM v_new_chat
        AND v_old->'message_id' IS NOT DISTINCT FROM v_new->'message_id' THEN RETURN NULL; END IF;
      IF v_kind='direct' THEN
        IF NOT EXISTS(SELECT 1 FROM public.direct_messages WHERE id=(v_old->>'message_id')::uuid AND conversation_id=v_old_chat AND deleted_at IS NULL) THEN v_old_chat:=NULL; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.direct_messages WHERE id=(v_new->>'message_id')::uuid AND conversation_id=v_new_chat AND deleted_at IS NULL) THEN v_new_chat:=NULL; END IF;
      ELSE
        IF NOT EXISTS(SELECT 1 FROM public.group_messages WHERE id=(v_old->>'message_id')::uuid AND group_id=v_old_chat AND deleted_at IS NULL) THEN v_old_chat:=NULL; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.group_messages WHERE id=(v_new->>'message_id')::uuid AND group_id=v_new_chat AND deleted_at IS NULL) THEN v_new_chat:=NULL; END IF;
      END IF;
    END IF;
    UPDATE private.chat_scan_states SET cached_result=NULL,generation=generation+1 WHERE kind=v_kind AND chat_id IN(v_old_chat,v_new_chat) AND cached_result IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.invalidate_chat_scan_result() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invalidate_direct_scan AFTER INSERT OR UPDATE OR DELETE ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_group_scan AFTER INSERT OR UPDATE OR DELETE ON public.group_messages FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_direct_scan_attachments AFTER INSERT OR UPDATE OR DELETE ON public.direct_message_attachments FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_group_scan_attachments AFTER INSERT OR UPDATE OR DELETE ON public.group_message_attachments FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_member_scan AFTER DELETE ON public.group_members FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER delete_direct_scan_state AFTER DELETE ON public.direct_conversations FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER delete_group_scan_state AFTER DELETE ON public.group_conversations FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_scan_sender_label AFTER UPDATE OF full_name,username ON public.profiles FOR EACH ROW
  WHEN(OLD.full_name IS DISTINCT FROM NEW.full_name OR OLD.username IS DISTINCT FROM NEW.username) EXECUTE FUNCTION private.invalidate_chat_scan_result();
CREATE TRIGGER invalidate_deleted_scan_sender AFTER DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.invalidate_chat_scan_result();

REVOKE ALL ON FUNCTION private.chat_scan_fingerprint(text,uuid),private.my_chat_scan_state(text,uuid),
  private.set_my_chat_scan_done(text,uuid,boolean,text),private.complete_my_chat_scan(text,uuid,text,uuid,text,jsonb),
  private.my_chat_scan_result(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.chat_scan_fingerprint(text,uuid),private.my_chat_scan_state(text,uuid),
  private.set_my_chat_scan_done(text,uuid,boolean,text),private.complete_my_chat_scan(text,uuid,text,uuid,text,jsonb),
  private.my_chat_scan_result(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_chat_scan_state(text,uuid),public.get_my_chat_scan_states(text),
  public.set_my_chat_scan_done(text,uuid,boolean,text),public.complete_my_chat_scan(text,uuid,text,uuid,text,jsonb),
  public.get_my_chat_scan_result(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_chat_scan_state(text,uuid),public.get_my_chat_scan_states(text),
  public.set_my_chat_scan_done(text,uuid,boolean,text),public.complete_my_chat_scan(text,uuid,text,uuid,text,jsonb),
  public.get_my_chat_scan_result(text,uuid) TO authenticated;
