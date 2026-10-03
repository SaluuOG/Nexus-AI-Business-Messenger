-- Only the fact of forwarding is public. Original chat, author and message IDs
-- never travel into a recipient's message payload.
ALTER TABLE public.direct_messages ADD COLUMN is_forwarded boolean NOT NULL DEFAULT false;
ALTER TABLE public.group_messages ADD COLUMN is_forwarded boolean NOT NULL DEFAULT false;

-- Private, content-free receipts retain request identity even after a message
-- is edited/deleted. A lost response can be retried without sending a second copy.
CREATE TABLE private.message_forward_requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('direct','group')),
  source_id uuid NOT NULL,
  target_kind text NOT NULL CHECK(target_kind IN ('direct','group')),
  target_id uuid NOT NULL,
  body_hash bytea NOT NULL,
  message_id uuid NOT NULL,
  PRIMARY KEY(user_id,request_id)
);
ALTER TABLE private.message_forward_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_forward_requests_deny ON private.message_forward_requests
  AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON private.message_forward_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.get_message_forward_targets(p_query text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid:=private.project_template_user(); q text:=btrim(coalesce(p_query,'')); result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
  IF char_length(q)>100 THEN RAISE EXCEPTION 'Suchtext zu lang.' USING ERRCODE='22023'; END IF;
  WITH targets AS (
    SELECT 'direct'::text AS kind,c.id AS chat_id,coalesce(nullif(p.full_name,''),nullif(p.username,''),'Nexus-Kontakt') AS name
    FROM public.direct_conversations c JOIN public.profiles p ON p.id=CASE WHEN c.user_a=uid THEN c.user_b ELSE c.user_a END
    WHERE uid IN(c.user_a,c.user_b)
    UNION ALL
    SELECT 'group',g.id,g.name FROM public.group_conversations g
    JOIN public.group_members m ON m.group_id=g.id AND m.user_id=uid
  ), candidates AS MATERIALIZED (
    SELECT * FROM targets WHERE q='' OR strpos(lower(name),lower(q))>0
    ORDER BY lower(name),kind,chat_id LIMIT 51
  ), page AS (SELECT * FROM candidates ORDER BY lower(name),kind,chat_id LIMIT 50)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY lower(name),kind,chat_id) FROM page p),'[]'::jsonb),
    'has_more',(SELECT count(*)>50 FROM candidates)) INTO result;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.get_message_forward_targets(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_message_forward_targets(text) TO authenticated;
CREATE FUNCTION public.get_message_forward_targets(p_query text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.get_message_forward_targets(p_query);
$fn$;
REVOKE ALL ON FUNCTION public.get_message_forward_targets(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_message_forward_targets(text) TO authenticated;

-- The existing tables intentionally deny client INSERT. A private guarded writer
-- checks the live Auth session and current participation in source AND destination.
CREATE FUNCTION private.forward_text_message(
  p_user_id uuid,p_source_kind text,p_source_id uuid,p_target_kind text,p_target_id uuid,
  p_expected_body text,p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid:=private.project_template_user(); receipt private.message_forward_requests%ROWTYPE;
  source_chat uuid; body text; message_id uuid; sent_at timestamptz:=clock_timestamp();
BEGIN
  IF uid IS NULL OR uid IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
  IF p_source_kind IS NULL OR p_source_kind NOT IN('direct','group') OR p_target_kind IS NULL OR p_target_kind NOT IN('direct','group')
    OR p_source_id IS NULL OR p_target_id IS NULL OR p_request_id IS NULL OR p_request_id='00000000-0000-0000-0000-000000000000'::uuid
    OR p_expected_body IS NULL OR btrim(p_expected_body)='' OR char_length(p_expected_body)>5000 THEN
    RAISE EXCEPTION 'Ungültige Weiterleitung.' USING ERRCODE='22023';
  END IF;
  -- Keep the validated Auth session and destination rights valid until commit.
  PERFORM 1 FROM auth.sessions s WHERE s.id=(auth.jwt()->>'session_id')::uuid AND s.user_id=uid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bitte melde dich erneut an.' USING ERRCODE='42501'; END IF;
  IF p_target_kind='direct' THEN
    PERFORM 1 FROM public.direct_conversations c WHERE c.id=p_target_id AND uid IN(c.user_a,c.user_b) FOR SHARE;
  ELSE
    PERFORM 1 FROM public.group_members m WHERE m.group_id=p_target_id AND m.user_id=uid FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zielchat nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||p_request_id::text,0));
  SELECT * INTO receipt FROM private.message_forward_requests r WHERE r.user_id=uid AND r.request_id=p_request_id;
  IF FOUND THEN
    IF receipt.source_kind IS DISTINCT FROM p_source_kind OR receipt.source_id IS DISTINCT FROM p_source_id
      OR receipt.target_kind IS DISTINCT FROM p_target_kind OR receipt.target_id IS DISTINCT FROM p_target_id
      OR receipt.body_hash IS DISTINCT FROM sha256(convert_to(p_expected_body,'UTF8')) THEN
      RAISE EXCEPTION 'Die Anfrage gehört zu einer anderen Weiterleitung.' USING ERRCODE='22023';
    END IF;
    RETURN receipt.message_id;
  END IF;

  IF p_source_kind='direct' THEN
    SELECT m.conversation_id,m.body INTO source_chat,body FROM public.direct_messages m
      WHERE m.id=p_source_id AND m.deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ursprungsnachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.direct_conversations c WHERE c.id=source_chat AND uid IN(c.user_a,c.user_b) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ursprungsnachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.direct_message_attachments a WHERE a.message_id=p_source_id) THEN
      RAISE EXCEPTION 'Derzeit können nur reine Textnachrichten weitergeleitet werden.' USING ERRCODE='22023';
    END IF;
  ELSE
    SELECT m.group_id,m.body INTO source_chat,body FROM public.group_messages m
      WHERE m.id=p_source_id AND m.deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ursprungsnachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.group_members m WHERE m.group_id=source_chat AND m.user_id=uid FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ursprungsnachricht nicht mehr verfügbar.' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.group_message_attachments a WHERE a.message_id=p_source_id) THEN
      RAISE EXCEPTION 'Derzeit können nur reine Textnachrichten weitergeleitet werden.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF body IS DISTINCT FROM p_expected_body THEN
    RAISE EXCEPTION 'Die Nachricht wurde geändert. Schließe die Vorschau und öffne sie erneut.' USING ERRCODE='22023';
  END IF;

  IF p_target_kind='direct' THEN
    INSERT INTO public.direct_messages AS m(conversation_id,sender_id,body,created_at,client_request_id,is_forwarded)
      VALUES(p_target_id,uid,body,sent_at,p_request_id,true)
      ON CONFLICT(sender_id,client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING RETURNING m.id INTO message_id;
    IF message_id IS NULL THEN RAISE EXCEPTION 'Die Anfrage gehört zu einer anderen Nachricht.' USING ERRCODE='22023'; END IF;
    UPDATE public.direct_conversations SET last_message_at=sent_at,updated_at=sent_at WHERE id=p_target_id;
  ELSE
    INSERT INTO public.group_messages AS m(group_id,sender_id,body,created_at,client_request_id,is_forwarded)
      VALUES(p_target_id,uid,body,sent_at,p_request_id,true)
      ON CONFLICT(sender_id,client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING RETURNING m.id INTO message_id;
    IF message_id IS NULL THEN RAISE EXCEPTION 'Die Anfrage gehört zu einer anderen Nachricht.' USING ERRCODE='22023'; END IF;
    UPDATE public.group_conversations SET last_message_at=sent_at,updated_at=sent_at WHERE id=p_target_id;
  END IF;
  -- Forwarding is not opening a conversation: never mark unseen messages read.
  INSERT INTO private.message_forward_requests VALUES(uid,p_request_id,p_source_kind,p_source_id,p_target_kind,p_target_id,
    sha256(convert_to(body,'UTF8')),message_id);
  RETURN message_id;
END $fn$;
REVOKE ALL ON FUNCTION private.forward_text_message(uuid,text,uuid,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.forward_text_message(uuid,text,uuid,text,uuid,text,uuid) TO authenticated;
CREATE FUNCTION public.forward_text_message(p_user_id uuid,p_source_kind text,p_source_id uuid,p_target_kind text,p_target_id uuid,p_expected_body text,p_request_id uuid)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.forward_text_message(p_user_id,p_source_kind,p_source_id,p_target_kind,p_target_id,p_expected_body,p_request_id);
$fn$;
REVOKE ALL ON FUNCTION public.forward_text_message(uuid,text,uuid,text,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.forward_text_message(uuid,text,uuid,text,uuid,text,uuid) TO authenticated;

-- Preserve the existing rich payload, with one non-identifying flag.
CREATE OR REPLACE FUNCTION private.direct_message_json(
  p_message_id uuid,
  p_viewer_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'message_id', message.id,
    'is_forwarded', message.is_forwarded AND message.deleted_at IS NULL,
    'sender_id', message.sender_id,
    'body', CASE WHEN message.deleted_at IS NULL THEN message.body ELSE '' END,
    'created_at', message.created_at,
    'reply_to_message_id', message.reply_to_message_id,
    'reply_sender_id', parent.sender_id,
    'reply_body', CASE
      WHEN parent.id IS NULL THEN NULL
      WHEN parent.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN nullif(btrim(parent.body), '') IS NOT NULL THEN parent.body
      WHEN EXISTS (
        SELECT 1
        FROM public.direct_message_attachments AS parent_attachment
        WHERE parent_attachment.message_id = parent.id
      ) THEN 'Anhang'
      ELSE NULL
    END,
    'edited_at', message.edited_at,
    'deleted_at', message.deleted_at,
    'read_at', CASE
      WHEN message.sender_id = p_viewer_id
       AND peer_read.last_read_at >= message.created_at
      THEN peer_read.last_read_at
      ELSE NULL
    END,
    'attachments', CASE WHEN message.deleted_at IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'attachment_id', attachment.id,
            'storage_path', attachment.storage_path,
            'file_name', attachment.file_name,
            'mime_type', attachment.mime_type,
            'file_size', attachment.file_size
          )
          ORDER BY attachment.created_at, attachment.id
        )
        FROM public.direct_message_attachments AS attachment
        WHERE attachment.message_id = message.id
      ), '[]'::jsonb)
    END
  )
  FROM public.direct_messages AS message
  LEFT JOIN public.direct_messages AS parent
    ON parent.id = message.reply_to_message_id
   AND parent.conversation_id = message.conversation_id
  LEFT JOIN LATERAL (
    SELECT reads.last_read_at
    FROM public.direct_conversation_reads AS reads
    WHERE reads.conversation_id = message.conversation_id
      AND reads.user_id <> p_viewer_id
    LIMIT 1
  ) AS peer_read ON true
  WHERE message.id = p_message_id;
$function$;

CREATE OR REPLACE FUNCTION private.group_message_json(
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'message_id', message.id,
    'is_forwarded', message.is_forwarded AND message.deleted_at IS NULL,
    'group_id', message.group_id,
    'sender_id', message.sender_id,
    'sender_full_name', sender.full_name,
    'sender_username', sender.username,
    'sender_avatar_url', sender.avatar_url,
    'body', CASE WHEN message.deleted_at IS NULL THEN message.body ELSE '' END,
    'created_at', message.created_at,
    'edited_at', message.edited_at,
    'deleted_at', message.deleted_at,
    'reply_to_message_id', message.reply_to_message_id,
    'reply_body', CASE
      WHEN parent.id IS NULL THEN NULL
      WHEN parent.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN nullif(btrim(parent.body), '') IS NOT NULL THEN parent.body
      WHEN EXISTS (
        SELECT 1
        FROM public.group_message_attachments AS parent_attachment
        WHERE parent_attachment.message_id = parent.id
      ) THEN 'Anhang'
      ELSE NULL
    END,
    'reply_sender_id', parent.sender_id,
    'reply_sender_name', reply_sender.full_name,
    'attachments', CASE WHEN message.deleted_at IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'attachment_id', attachment.id,
            'storage_path', attachment.storage_path,
            'file_name', attachment.file_name,
            'mime_type', attachment.mime_type,
            'file_size', attachment.file_size
          )
          ORDER BY attachment.created_at, attachment.id
        )
        FROM public.group_message_attachments AS attachment
        WHERE attachment.message_id = message.id
      ), '[]'::jsonb)
    END,
    'read_count', (
      SELECT count(*)
      FROM public.group_reads AS reads
      JOIN public.group_members AS reader
        ON reader.group_id = reads.group_id
       AND reader.user_id = reads.user_id
      WHERE reads.group_id = message.group_id
        AND reads.user_id <> message.sender_id
        AND reader.joined_at <= message.created_at
        AND reads.last_read_at >= message.created_at
    ),
    'recipient_count', (
      SELECT count(*)
      FROM public.group_members AS recipient
      WHERE recipient.group_id = message.group_id
        AND recipient.user_id <> message.sender_id
        AND recipient.joined_at <= message.created_at
    )
  )
  FROM public.group_messages AS message
  LEFT JOIN public.profiles AS sender ON sender.id = message.sender_id
  LEFT JOIN public.group_messages AS parent
    ON parent.id = message.reply_to_message_id
   AND parent.group_id = message.group_id
  LEFT JOIN public.profiles AS reply_sender ON reply_sender.id = parent.sender_id
  WHERE message.id = p_message_id;
$function$;
