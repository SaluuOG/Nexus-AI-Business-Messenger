-- Private references only. A completed row retains its version so delayed
-- retries cannot recreate a reminder or overwrite a newer schedule.
CREATE TABLE private.message_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direct_message_id uuid REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  group_message_id uuid REFERENCES public.group_messages(id) ON DELETE CASCADE,
  due_at timestamptz,
  version uuid NOT NULL,
  CHECK (num_nonnulls(direct_message_id,group_message_id)=1),
  CHECK (due_at IS NULL OR isfinite(due_at)),
  UNIQUE(user_id,direct_message_id), UNIQUE(user_id,group_message_id)
);
CREATE INDEX message_reminders_pending ON private.message_reminders(user_id,due_at,id) WHERE due_at IS NOT NULL;
CREATE INDEX message_reminders_direct ON private.message_reminders(direct_message_id) WHERE direct_message_id IS NOT NULL;
CREATE INDEX message_reminders_group ON private.message_reminders(group_message_id) WHERE group_message_id IS NOT NULL;
ALTER TABLE private.message_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_reminders_deny ON private.message_reminders AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON private.message_reminders FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.get_message_reminder(p_user_id uuid,p_kind text,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); result jsonb;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN('direct','group') OR p_message_id IS NULL THEN RAISE EXCEPTION 'Ungültige Nachricht.' USING ERRCODE='22023'; END IF;
  IF p_kind='direct' THEN
    IF NOT EXISTS(SELECT 1 FROM public.direct_messages m JOIN public.direct_conversations c ON c.id=m.conversation_id
      WHERE m.id=p_message_id AND m.deleted_at IS NULL AND uid IN(c.user_a,c.user_b)) THEN RAISE EXCEPTION 'Nachricht nicht verfügbar.' USING ERRCODE='42501'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.group_messages m JOIN public.group_members g ON g.group_id=m.group_id AND g.user_id=uid
      WHERE m.id=p_message_id AND m.deleted_at IS NULL) THEN RAISE EXCEPTION 'Nachricht nicht verfügbar.' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT jsonb_build_object('id',id,'version',version,'due_at',due_at) INTO result FROM private.message_reminders
    WHERE user_id=uid AND CASE p_kind WHEN 'direct' THEN direct_message_id=p_message_id ELSE group_message_id=p_message_id END;
  RETURN result;
END $$;

CREATE FUNCTION private.change_message_reminder(p_user_id uuid,p_kind text,p_message_id uuid,p_expected_version uuid,p_request_id uuid,p_due_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); chat uuid; existing private.message_reminders%ROWTYPE; result jsonb;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN('direct','group') OR p_message_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Ungültige Wiedervorlage.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid AND s.user_id=uid AND (s.not_after IS NULL OR s.not_after>now()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  -- Serializes creation as well as updates; collisions only serialize unrelated keys.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_kind||':'||p_message_id::text,0));
  SELECT * INTO existing FROM private.message_reminders WHERE user_id=uid
    AND CASE p_kind WHEN 'direct' THEN direct_message_id=p_message_id ELSE group_message_id=p_message_id END FOR UPDATE;
  IF existing.version=p_request_id THEN
    IF existing.due_at IS DISTINCT FROM p_due_at THEN RAISE EXCEPTION 'Widersprüchlicher Speicherversuch.' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('id',existing.id,'version',existing.version,'due_at',existing.due_at);
  END IF;
  IF existing.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Wiedervorlage wurde inzwischen geändert. Bitte neu laden.' USING ERRCODE='40001'; END IF;
  IF p_due_at IS NOT NULL THEN
    IF NOT isfinite(p_due_at) OR p_due_at<=clock_timestamp() OR p_due_at>clock_timestamp()+interval '5 years' THEN
      RAISE EXCEPTION 'Wähle einen zukünftigen Termin innerhalb der nächsten fünf Jahre.' USING ERRCODE='22023';
    END IF;
    IF p_kind='direct' THEN
      SELECT conversation_id INTO chat FROM public.direct_messages WHERE id=p_message_id AND deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht verfügbar.' USING ERRCODE='42501'; END IF;
      PERFORM 1 FROM public.direct_conversations WHERE id=chat AND uid IN(user_a,user_b) FOR SHARE;
    ELSE
      SELECT group_id INTO chat FROM public.group_messages WHERE id=p_message_id AND deleted_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht verfügbar.' USING ERRCODE='42501'; END IF;
      PERFORM 1 FROM public.group_members WHERE group_id=chat AND user_id=uid FOR SHARE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht verfügbar.' USING ERRCODE='42501'; END IF;
  ELSIF existing.id IS NULL THEN
    RAISE EXCEPTION 'Wiedervorlage nicht verfügbar.' USING ERRCODE='42501';
  END IF;
  IF existing.id IS NULL THEN
    INSERT INTO private.message_reminders(user_id,direct_message_id,group_message_id,due_at,version)
    VALUES(uid,CASE WHEN p_kind='direct' THEN p_message_id END,CASE WHEN p_kind='group' THEN p_message_id END,p_due_at,p_request_id)
    RETURNING * INTO existing;
  ELSE
    UPDATE private.message_reminders SET due_at=p_due_at,version=p_request_id WHERE id=existing.id RETURNING * INTO existing;
  END IF;
  RETURN jsonb_build_object('id',existing.id,'version',existing.version,'due_at',existing.due_at);
END $$;

CREATE FUNCTION private.get_message_reminders(p_user_id uuid,p_mode text DEFAULT 'due',p_after_due_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); result jsonb;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN('due','all') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_after_due_at IS NULL)<>(p_after_id IS NULL) THEN RAISE EXCEPTION 'Ungültige Abfrage.' USING ERRCODE='22023'; END IF;
  WITH accessible AS MATERIALIZED (
    SELECT r.id,r.version,r.due_at,'direct'::text AS kind,m.id AS message_id,m.conversation_id AS chat_id,
      coalesce(nullif(peer.full_name,''),nullif(peer.username,''),'Nexus-Kontakt') AS chat_name,
      coalesce(nullif(sender.full_name,''),nullif(sender.username,''),'Nexus Nutzer') AS sender_name,
      left(m.body,500) AS preview,m.created_at,attachment.file_name AS attachment_name
    FROM private.message_reminders r JOIN public.direct_messages m ON m.id=r.direct_message_id AND m.deleted_at IS NULL
    JOIN public.direct_conversations c ON c.id=m.conversation_id AND uid IN(c.user_a,c.user_b)
    LEFT JOIN public.profiles peer ON peer.id=CASE WHEN c.user_a=uid THEN c.user_b ELSE c.user_a END
    LEFT JOIN public.profiles sender ON sender.id=m.sender_id
    LEFT JOIN LATERAL (SELECT file_name FROM public.direct_message_attachments a WHERE a.message_id=m.id ORDER BY a.created_at,a.id LIMIT 1) attachment ON true
    WHERE r.user_id=uid AND r.due_at IS NOT NULL
    UNION ALL
    SELECT r.id,r.version,r.due_at,'group',m.id,m.group_id,g.name,
      coalesce(nullif(sender.full_name,''),nullif(sender.username,''),'Nexus Nutzer'),left(m.body,500),m.created_at,attachment.file_name
    FROM private.message_reminders r JOIN public.group_messages m ON m.id=r.group_message_id AND m.deleted_at IS NULL
    JOIN public.group_conversations g ON g.id=m.group_id
    JOIN public.group_members membership ON membership.group_id=g.id AND membership.user_id=uid
    LEFT JOIN public.profiles sender ON sender.id=m.sender_id
    LEFT JOIN LATERAL (SELECT file_name FROM public.group_message_attachments a WHERE a.message_id=m.id ORDER BY a.created_at,a.id LIMIT 1) attachment ON true
    WHERE r.user_id=uid AND r.due_at IS NOT NULL
  ), candidates AS MATERIALIZED (
    SELECT * FROM accessible WHERE (p_mode='all' OR due_at<=now())
      AND (p_after_due_at IS NULL OR (due_at,id)>(p_after_due_at,p_after_id))
    ORDER BY due_at,id LIMIT p_limit+1
  ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY due_at,id LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY due_at,id) FROM page p),'[]'::jsonb),
    'server_now',now(),'due_count',(SELECT count(*) FROM accessible WHERE due_at<=now()),
    'has_more',(SELECT count(*)>p_limit FROM candidates),
    'next_cursor',CASE WHEN (SELECT count(*)>p_limit FROM candidates) THEN (SELECT jsonb_build_object('due_at',due_at,'id',id) FROM page ORDER BY due_at DESC,id DESC LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION private.get_message_reminder(uuid,text,uuid),private.change_message_reminder(uuid,text,uuid,uuid,uuid,timestamptz),private.get_message_reminders(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_message_reminder(uuid,text,uuid),private.change_message_reminder(uuid,text,uuid,uuid,uuid,timestamptz),private.get_message_reminders(uuid,text,timestamptz,uuid,integer) TO authenticated;
CREATE FUNCTION public.get_message_reminder(p_user_id uuid,p_kind text,p_message_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.get_message_reminder(p_user_id,p_kind,p_message_id)$$;
CREATE FUNCTION public.change_message_reminder(p_user_id uuid,p_kind text,p_message_id uuid,p_expected_version uuid,p_request_id uuid,p_due_at timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.change_message_reminder(p_user_id,p_kind,p_message_id,p_expected_version,p_request_id,p_due_at)$$;
CREATE FUNCTION public.get_message_reminders(p_user_id uuid,p_mode text DEFAULT 'due',p_after_due_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.get_message_reminders(p_user_id,p_mode,p_after_due_at,p_after_id,p_limit)$$;
REVOKE ALL ON FUNCTION public.get_message_reminder(uuid,text,uuid),public.change_message_reminder(uuid,text,uuid,uuid,uuid,timestamptz),public.get_message_reminders(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_message_reminder(uuid,text,uuid),public.change_message_reminder(uuid,text,uuid,uuid,uuid,timestamptz),public.get_message_reminders(uuid,text,timestamptz,uuid,integer) TO authenticated;
