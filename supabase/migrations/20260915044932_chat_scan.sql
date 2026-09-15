-- Whole-chat scan reads preserve the existing live participant/member RLS.
-- Only bounded metadata lookups and a per-user quota need elevated privileges;
-- both live in the unexposed private schema and check the authenticated caller.
CREATE FUNCTION private.chat_scan_metadata(p_kind text, p_chat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  IF p_kind = 'direct' AND EXISTS (
    SELECT 1 FROM public.direct_conversations c WHERE c.id=p_chat_id AND auth.uid() IN(c.user_a,c.user_b)
  ) THEN
    SELECT coalesce(jsonb_object_agg(m.id::text,jsonb_build_object(
      'sender',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Kontakt'),
      'attachmentCount',(SELECT count(*) FROM public.direct_message_attachments a WHERE a.message_id=m.id AND a.conversation_id=p_chat_id)
    )),'{}'::jsonb) INTO v_result FROM (
      SELECT id,sender_id FROM public.direct_messages WHERE conversation_id=p_chat_id AND deleted_at IS NULL ORDER BY created_at,id LIMIT 5001
    ) m LEFT JOIN public.profiles p ON p.id=m.sender_id;
  ELSIF p_kind = 'group' AND EXISTS (
    SELECT 1 FROM public.group_members gm WHERE gm.group_id=p_chat_id AND gm.user_id=auth.uid()
  ) THEN
    SELECT coalesce(jsonb_object_agg(m.id::text,jsonb_build_object(
      'sender',coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'Gruppenmitglied'),
      'attachmentCount',(SELECT count(*) FROM public.group_message_attachments a WHERE a.message_id=m.id AND a.group_id=p_chat_id)
    )),'{}'::jsonb) INTO v_result FROM (
      SELECT id,sender_id FROM public.group_messages WHERE group_id=p_chat_id AND deleted_at IS NULL ORDER BY created_at,id LIMIT 5001
    ) m LEFT JOIN public.profiles p ON p.id=m.sender_id;
  ELSE RAISE EXCEPTION 'no_access'; END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION private.chat_scan_metadata(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.chat_scan_metadata(text,uuid) TO authenticated;

CREATE FUNCTION public.get_chat_scan_page(
  p_kind text,p_chat_id uuid,p_after_created_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,p_snapshot text DEFAULT NULL,p_limit integer DEFAULT 250
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_rows jsonb; v_meta jsonb; v_page jsonb; v_snapshot text; v_total int; v_attachment_count int;
  v_last jsonb; v_limit int := greatest(1,least(coalesce(p_limit,250),250)); v_more boolean;
BEGIN
  IF auth.uid() IS NULL OR p_kind IS NULL OR p_kind NOT IN('direct','group') OR p_chat_id IS NULL
    OR ((p_after_created_at IS NULL) <> (p_after_id IS NULL)) THEN RAISE EXCEPTION 'no_access'; END IF;
  IF (p_kind='direct' AND NOT EXISTS(SELECT 1 FROM public.direct_conversations WHERE id=p_chat_id))
    OR (p_kind='group' AND NOT EXISTS(SELECT 1 FROM public.group_conversations WHERE id=p_chat_id)) THEN
    RAISE EXCEPTION 'no_access';
  END IF;
  -- Metadata helper applies the same chat boundary; no storage paths, signed
  -- URLs, profile emails or attachment bytes are returned or sent to the model.
  v_meta := private.chat_scan_metadata(p_kind,p_chat_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'senderId',m.sender_id,'sender',v_meta->m.id::text->>'sender',
    'body',m.body,'createdAt',m.created_at,'editedAt',m.edited_at,
    'attachmentCount',coalesce((v_meta->m.id::text->>'attachmentCount')::int,0)
  ) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO v_rows FROM (
    SELECT d.id,d.sender_id,d.body,d.created_at,d.edited_at FROM public.direct_messages d
      WHERE p_kind='direct' AND d.conversation_id=p_chat_id AND d.deleted_at IS NULL
    UNION ALL
    SELECT g.id,g.sender_id,g.body,g.created_at,g.edited_at FROM public.group_messages g
      WHERE p_kind='group' AND g.group_id=p_chat_id AND g.deleted_at IS NULL
    ORDER BY created_at,id LIMIT 5001
  ) m;
  v_total := jsonb_array_length(v_rows);
  IF v_total > 5000 OR octet_length(v_rows::text) > 1500000 THEN RAISE EXCEPTION 'history_too_large'; END IF;
  -- Optimistic consistency token covers text edits, insertions, physical/soft
  -- deletions, sender labels and excluded attachment counts. Every page checks it.
  v_snapshot := md5(v_rows::text);
  IF p_snapshot IS NOT NULL AND p_snapshot <> v_snapshot THEN RAISE EXCEPTION 'history_changed'; END IF;
  SELECT coalesce(sum((r->>'attachmentCount')::int),0)::int INTO v_attachment_count FROM jsonb_array_elements(v_rows) r;
  SELECT coalesce(jsonb_agg(q.r ORDER BY (q.r->>'createdAt')::timestamptz,(q.r->>'id')::uuid),'[]'::jsonb)
  INTO v_page FROM (
    SELECT r FROM jsonb_array_elements(v_rows) r
    WHERE p_after_created_at IS NULL OR ((r->>'createdAt')::timestamptz,(r->>'id')::uuid)>(p_after_created_at,p_after_id)
    ORDER BY (r->>'createdAt')::timestamptz,(r->>'id')::uuid LIMIT v_limit
  ) q;
  v_last := v_page->(jsonb_array_length(v_page)-1);
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) r
    WHERE ((r->>'createdAt')::timestamptz,(r->>'id')::uuid)>((v_last->>'createdAt')::timestamptz,(v_last->>'id')::uuid)) INTO v_more;
  RETURN jsonb_build_object('items',v_page,'snapshot',v_snapshot,'total_count',v_total,
    'attachment_count',v_attachment_count,'has_more',v_more,
    'next_cursor',CASE WHEN v_more THEN jsonb_build_object('created_at',v_last->>'createdAt','id',v_last->>'id') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.get_chat_scan_page(text,uuid,timestamptz,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_scan_page(text,uuid,timestamptz,uuid,text,integer) TO authenticated;

CREATE TABLE private.chat_scan_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_start timestamptz NOT NULL DEFAULT now(),hour_count int NOT NULL DEFAULT 0,
  day_start timestamptz NOT NULL DEFAULT now(),day_count int NOT NULL DEFAULT 0,
  active_id uuid,active_until timestamptz
);
ALTER TABLE private.chat_scan_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chat_scan_limits FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.chat_scan_lease(p_finish uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v private.chat_scan_limits; v_id uuid; v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
  IF p_finish IS NOT NULL THEN
    UPDATE private.chat_scan_limits SET active_id=NULL,active_until=NULL WHERE user_id=auth.uid() AND active_id=p_finish;
    RETURN NULL;
  END IF;
  INSERT INTO private.chat_scan_limits(user_id) VALUES(auth.uid()) ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO v FROM private.chat_scan_limits WHERE user_id=auth.uid() FOR UPDATE;
  IF v.active_until > v_now THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF v.hour_start + interval '1 hour' <= v_now THEN v.hour_start:=v_now; v.hour_count:=0; END IF;
  IF v.day_start + interval '1 day' <= v_now THEN v.day_start:=v_now; v.day_count:=0; END IF;
  IF v.hour_count >= 6 OR v.day_count >= 20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  v_id := gen_random_uuid();
  UPDATE private.chat_scan_limits SET hour_start=v.hour_start,hour_count=v.hour_count+1,
    day_start=v.day_start,day_count=v.day_count+1,active_id=v_id,active_until=v_now+interval '130 seconds'
    WHERE user_id=auth.uid();
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.chat_scan_lease(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.chat_scan_lease(uuid) TO authenticated;
CREATE FUNCTION public.begin_chat_scan() RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.chat_scan_lease(NULL);
$$;
CREATE FUNCTION public.finish_chat_scan(p_scan_id uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF p_scan_id IS NOT NULL THEN PERFORM private.chat_scan_lease(p_scan_id); END IF; END $$;
REVOKE ALL ON FUNCTION public.begin_chat_scan() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_chat_scan(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_chat_scan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_chat_scan(uuid) TO authenticated;
