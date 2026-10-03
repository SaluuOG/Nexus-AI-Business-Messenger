-- Personal references, never copies of message bodies or attachment URLs.
CREATE TABLE private.message_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direct_message_id uuid REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  group_message_id uuid REFERENCES public.group_messages(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(direct_message_id,group_message_id)=1),
  UNIQUE(user_id,direct_message_id), UNIQUE(user_id,group_message_id)
);
CREATE INDEX message_bookmarks_user_page ON private.message_bookmarks(user_id,saved_at DESC,id DESC);
CREATE INDEX message_bookmarks_direct ON private.message_bookmarks(direct_message_id) WHERE direct_message_id IS NOT NULL;
CREATE INDEX message_bookmarks_group ON private.message_bookmarks(group_message_id) WHERE group_message_id IS NOT NULL;
ALTER TABLE private.message_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_bookmarks_deny ON private.message_bookmarks AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON private.message_bookmarks FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.set_message_bookmark(p_user_id uuid,p_kind text,p_message_id uuid,p_saved boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); chat uuid;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN('direct','group') OR p_message_id IS NULL OR p_saved IS NULL THEN RAISE EXCEPTION 'Ungültige Markierung.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid AND s.user_id=uid AND (s.not_after IS NULL OR s.not_after>now()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  -- Removing one's own reference remains possible after loss of source access.
  IF NOT p_saved THEN
    DELETE FROM private.message_bookmarks WHERE user_id=uid AND CASE p_kind WHEN 'direct' THEN direct_message_id=p_message_id ELSE group_message_id=p_message_id END;
    RETURN false;
  END IF;
  IF p_kind='direct' THEN
    SELECT conversation_id INTO chat FROM public.direct_messages WHERE id=p_message_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.direct_conversations WHERE id=chat AND uid IN(user_a,user_b) FOR SHARE;
  ELSE
    SELECT group_id INTO chat FROM public.group_messages WHERE id=p_message_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.group_members WHERE group_id=chat AND user_id=uid FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
  IF p_kind='direct' THEN
    INSERT INTO private.message_bookmarks(user_id,direct_message_id) VALUES(uid,p_message_id) ON CONFLICT(user_id,direct_message_id) DO NOTHING;
  ELSE
    INSERT INTO private.message_bookmarks(user_id,group_message_id) VALUES(uid,p_message_id) ON CONFLICT(user_id,group_message_id) DO NOTHING;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION private.get_message_bookmark_status(p_user_id uuid,p_kind text,p_chat_id uuid,p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); result jsonb;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN('direct','group') OR p_chat_id IS NULL OR p_message_ids IS NULL OR cardinality(p_message_ids)>200 THEN
    RAISE EXCEPTION 'Ungültige Nachrichtenabfrage.' USING ERRCODE='22023';
  END IF;
  IF p_kind='direct' THEN
    IF NOT EXISTS(SELECT 1 FROM public.direct_conversations WHERE id=p_chat_id AND uid IN(user_a,user_b)) THEN RAISE EXCEPTION 'Kein Chat-Zugriff.' USING ERRCODE='42501'; END IF;
    SELECT coalesce(jsonb_agg(m.id ORDER BY m.id),'[]'::jsonb) INTO result FROM private.message_bookmarks b
      JOIN public.direct_messages m ON m.id=b.direct_message_id WHERE b.user_id=uid AND m.conversation_id=p_chat_id AND m.deleted_at IS NULL AND m.id=ANY(p_message_ids);
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_chat_id AND user_id=uid) THEN RAISE EXCEPTION 'Kein Chat-Zugriff.' USING ERRCODE='42501'; END IF;
    SELECT coalesce(jsonb_agg(m.id ORDER BY m.id),'[]'::jsonb) INTO result FROM private.message_bookmarks b
      JOIN public.group_messages m ON m.id=b.group_message_id WHERE b.user_id=uid AND m.group_id=p_chat_id AND m.deleted_at IS NULL AND m.id=ANY(p_message_ids);
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION private.get_message_bookmarks(p_user_id uuid,p_query text DEFAULT '',p_before_saved_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=private.project_template_user(); q text:=btrim(coalesce(p_query,'')); result jsonb;
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte erneut anmelden.' USING ERRCODE='42501'; END IF;
  IF char_length(q)>100 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_before_saved_at IS NULL)<>(p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Ungültige Suche.' USING ERRCODE='22023';
  END IF;
  WITH accessible AS (
    SELECT b.id,b.saved_at,'direct'::text AS kind,m.id AS message_id,m.conversation_id AS chat_id,
      coalesce(nullif(peer.full_name,''),nullif(peer.username,''),'Nexus-Kontakt') AS chat_name,
      coalesce(nullif(sender.full_name,''),nullif(sender.username,''),'Nexus Nutzer') AS sender_name,
      m.body,m.created_at,attachment.file_name AS attachment_name
    FROM private.message_bookmarks b JOIN public.direct_messages m ON m.id=b.direct_message_id AND m.deleted_at IS NULL
    JOIN public.direct_conversations c ON c.id=m.conversation_id AND uid IN(c.user_a,c.user_b)
    LEFT JOIN public.profiles peer ON peer.id=CASE WHEN c.user_a=uid THEN c.user_b ELSE c.user_a END
    LEFT JOIN public.profiles sender ON sender.id=m.sender_id
    LEFT JOIN LATERAL (SELECT file_name FROM public.direct_message_attachments a WHERE a.message_id=m.id ORDER BY a.created_at,a.id LIMIT 1) attachment ON true
    WHERE b.user_id=uid
    UNION ALL
    SELECT b.id,b.saved_at,'group',m.id,m.group_id,g.name,
      coalesce(nullif(sender.full_name,''),nullif(sender.username,''),'Nexus Nutzer'),m.body,m.created_at,attachment.file_name
    FROM private.message_bookmarks b JOIN public.group_messages m ON m.id=b.group_message_id AND m.deleted_at IS NULL
    JOIN public.group_conversations g ON g.id=m.group_id
    JOIN public.group_members membership ON membership.group_id=g.id AND membership.user_id=uid
    LEFT JOIN public.profiles sender ON sender.id=m.sender_id
    LEFT JOIN LATERAL (SELECT file_name FROM public.group_message_attachments a WHERE a.message_id=m.id ORDER BY a.created_at,a.id LIMIT 1) attachment ON true
    WHERE b.user_id=uid
  ), candidates AS MATERIALIZED (
    SELECT * FROM accessible WHERE (p_before_saved_at IS NULL OR (saved_at,id)<(p_before_saved_at,p_before_id))
      AND (q='' OR strpos(lower(body||' '||chat_name||' '||sender_name||' '||coalesce(attachment_name,'')),lower(q))>0)
    ORDER BY saved_at DESC,id DESC LIMIT p_limit+1
  ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY saved_at DESC,id DESC LIMIT p_limit)
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'saved_at',p.saved_at,'kind',p.kind,'message_id',p.message_id,
      'chat_id',p.chat_id,'chat_name',p.chat_name,'sender_name',p.sender_name,'preview',left(p.body,500),'created_at',p.created_at,'attachment_name',p.attachment_name)
      ORDER BY p.saved_at DESC,p.id DESC) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>p_limit FROM candidates),
    'next_cursor',CASE WHEN (SELECT count(*)>p_limit FROM candidates) THEN (SELECT jsonb_build_object('saved_at',saved_at,'id',id) FROM page ORDER BY saved_at,id LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION private.set_message_bookmark(uuid,text,uuid,boolean),private.get_message_bookmark_status(uuid,text,uuid,uuid[]),private.get_message_bookmarks(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.set_message_bookmark(uuid,text,uuid,boolean),private.get_message_bookmark_status(uuid,text,uuid,uuid[]),private.get_message_bookmarks(uuid,text,timestamptz,uuid,integer) TO authenticated;
CREATE FUNCTION public.set_message_bookmark(p_user_id uuid,p_kind text,p_message_id uuid,p_saved boolean)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.set_message_bookmark(p_user_id,p_kind,p_message_id,p_saved)$$;
CREATE FUNCTION public.get_message_bookmark_status(p_user_id uuid,p_kind text,p_chat_id uuid,p_message_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.get_message_bookmark_status(p_user_id,p_kind,p_chat_id,p_message_ids)$$;
CREATE FUNCTION public.get_message_bookmarks(p_user_id uuid,p_query text DEFAULT '',p_before_saved_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.get_message_bookmarks(p_user_id,p_query,p_before_saved_at,p_before_id,p_limit)$$;
REVOKE ALL ON FUNCTION public.set_message_bookmark(uuid,text,uuid,boolean),public.get_message_bookmark_status(uuid,text,uuid,uuid[]),public.get_message_bookmarks(uuid,text,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_message_bookmark(uuid,text,uuid,boolean),public.get_message_bookmark_status(uuid,text,uuid,uuid[]),public.get_message_bookmarks(uuid,text,timestamptz,uuid,integer) TO authenticated;
