-- Parse text only; no HTTP requests, previews, or new copies of private messages.
CREATE FUNCTION private.chat_shared_links(p_body text)
RETURNS TABLE(url text) LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE hit text[]; candidate text; closer text; opener text;
BEGIN
  FOR hit IN SELECT regexp_matches(coalesce(p_body,''), $re$(?:https?://|www\.)[^[:space:]<>"'`]+$re$, 'gi') LOOP
    candidate := rtrim(hit[1], '.,;:!?');
    LOOP
      closer := right(candidate,1);
      opener := CASE closer WHEN ')' THEN '(' WHEN ']' THEN '[' WHEN '}' THEN '{' ELSE NULL END;
      EXIT WHEN opener IS NULL OR length(candidate)-length(replace(candidate,closer,'')) <= length(candidate)-length(replace(candidate,opener,''));
      candidate := rtrim(left(candidate,-1), '.,;:!?');
    END LOOP;
    IF candidate ~* '^www\.' THEN candidate := 'https://' || candidate; END IF;
    IF candidate ~* '^https?://[^/[:space:]@]+([/?#]|$)' AND position(chr(92) IN candidate)=0 THEN
      url := candidate; RETURN NEXT;
    END IF;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.chat_shared_links(text) FROM PUBLIC,anon,authenticated,service_role;

-- Attachment tables deliberately remain RPC-only. The private reader derives
-- identity from Auth and checks current chat membership before accessing them.
CREATE FUNCTION private.get_chat_shared_content(
  p_kind text,p_chat_id uuid,p_category text,p_query text DEFAULT '',
  p_before_created_at timestamptz DEFAULT NULL,p_before_message_id uuid DEFAULT NULL,
  p_before_item_id text DEFAULT NULL,p_limit integer DEFAULT 24
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid := auth.uid(); result jsonb; q text := btrim(coalesce(p_query,'')); lim integer := greatest(1,least(coalesce(p_limit,24),50));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE='42501'; END IF;
  IF p_kind='direct' THEN
    IF NOT EXISTS (SELECT 1 FROM public.direct_conversations c WHERE c.id=p_chat_id AND uid IN(c.user_a,c.user_b)) THEN
      RAISE EXCEPTION 'Chat nicht verfügbar.' USING ERRCODE='42501';
    END IF;
  ELSIF p_kind='group' THEN
    IF NOT EXISTS (SELECT 1 FROM public.group_members m WHERE m.group_id=p_chat_id AND m.user_id=uid) THEN
      RAISE EXCEPTION 'Gruppe nicht verfügbar.' USING ERRCODE='42501';
    END IF;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.' USING ERRCODE='22023'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('images','files','links') OR char_length(q)>100 THEN
    RAISE EXCEPTION 'Ungültiger Filter.' USING ERRCODE='22023';
  END IF;
  IF num_nonnulls(p_before_created_at,p_before_message_id,p_before_item_id) NOT IN (0,3) OR char_length(p_before_item_id)>100 THEN
    RAISE EXCEPTION 'Ungültiger Cursor.' USING ERRCODE='22023';
  END IF;
  WITH messages AS NOT MATERIALIZED (
    SELECT id,created_at,body FROM public.direct_messages WHERE p_kind='direct' AND conversation_id=p_chat_id AND deleted_at IS NULL
    UNION ALL
    SELECT id,created_at,body FROM public.group_messages WHERE p_kind='group' AND group_id=p_chat_id AND deleted_at IS NULL
  ), attachments AS NOT MATERIALIZED (
    SELECT a.id,a.message_id,a.storage_path,a.file_name,a.mime_type,a.file_size FROM public.direct_message_attachments a WHERE p_kind='direct' AND a.conversation_id=p_chat_id
    UNION ALL
    SELECT a.id,a.message_id,a.storage_path,a.file_name,a.mime_type,a.file_size FROM public.group_message_attachments a WHERE p_kind='group' AND a.group_id=p_chat_id
  ), items AS (
    SELECT 'a:'||a.id AS item_id,m.id AS message_id,m.created_at,a.file_name AS title,NULL::text AS url,a.storage_path,a.mime_type,a.file_size
    FROM messages m JOIN attachments a ON a.message_id=m.id
    WHERE (p_category='images' AND a.mime_type LIKE 'image/%') OR (p_category='files' AND a.mime_type NOT LIKE 'image/%')
    UNION ALL
    SELECT DISTINCT 'l:'||md5(l.url),m.id,m.created_at,l.url,l.url,NULL::text,NULL::text,NULL::bigint
    FROM messages m CROSS JOIN LATERAL private.chat_shared_links(m.body) l WHERE p_category='links'
  ), candidates AS MATERIALIZED (
    SELECT * FROM items i
    WHERE (q='' OR strpos(lower(i.title),lower(q))>0)
      AND (p_before_created_at IS NULL OR (i.created_at,i.message_id,i.item_id COLLATE "C") < (p_before_created_at,p_before_message_id,p_before_item_id COLLATE "C"))
    ORDER BY i.created_at DESC,i.message_id DESC,i.item_id COLLATE "C" DESC LIMIT lim+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY created_at DESC,message_id DESC,item_id COLLATE "C" DESC LIMIT lim
  ) SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('kind',p_kind,'chat_id',p_chat_id) ORDER BY p.created_at DESC,p.message_id DESC,p.item_id COLLATE "C" DESC) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>lim FROM candidates),
    'next_cursor',(SELECT jsonb_build_object('created_at',p.created_at,'message_id',p.message_id,'item_id',p.item_id) FROM page p ORDER BY p.created_at,p.message_id,p.item_id COLLATE "C" LIMIT 1)
  ) INTO result;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.get_chat_shared_content(text,uuid,text,text,timestamptz,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_chat_shared_content(text,uuid,text,text,timestamptz,uuid,text,integer) TO authenticated;

CREATE FUNCTION public.get_chat_shared_content(
  p_kind text,p_chat_id uuid,p_category text,p_query text DEFAULT '',
  p_before_created_at timestamptz DEFAULT NULL,p_before_message_id uuid DEFAULT NULL,
  p_before_item_id text DEFAULT NULL,p_limit integer DEFAULT 24
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.get_chat_shared_content(p_kind,p_chat_id,p_category,p_query,p_before_created_at,p_before_message_id,p_before_item_id,p_limit);
$fn$;
REVOKE ALL ON FUNCTION public.get_chat_shared_content(text,uuid,text,text,timestamptz,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_chat_shared_content(text,uuid,text,text,timestamptz,uuid,text,integer) TO authenticated;
