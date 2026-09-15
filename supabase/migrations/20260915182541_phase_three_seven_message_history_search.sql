-- Nexus Phase 3.7 -- complete message history, secure search, deep links and
-- idempotent text sends. The public RPCs are the only new browser entry points.

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_sender_request_unique_idx
  ON public.direct_messages (sender_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS group_messages_sender_request_unique_idx
  ON public.group_messages (sender_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Composite ordering indexes make `(created_at, id)` keyset pagination stable,
-- including when multiple messages share the same timestamp.
CREATE INDEX IF NOT EXISTS direct_messages_history_idx
  ON public.direct_messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS group_messages_history_idx
  ON public.group_messages (group_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS direct_messages_sender_history_idx
  ON public.direct_messages (sender_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND btrim(body) <> '';

CREATE INDEX IF NOT EXISTS group_messages_sender_history_idx
  ON public.group_messages (sender_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND btrim(body) <> '';

-- `simple` keeps names, identifiers and multilingual business vocabulary intact.
CREATE INDEX IF NOT EXISTS direct_messages_body_search_idx
  ON public.direct_messages
  USING gin (to_tsvector('simple'::regconfig, body))
  WHERE deleted_at IS NULL AND btrim(body) <> '';

CREATE INDEX IF NOT EXISTS group_messages_body_search_idx
  ON public.group_messages
  USING gin (to_tsvector('simple'::regconfig, body))
  WHERE deleted_at IS NULL AND btrim(body) <> '';

-- Text-only retries use a caller-generated UUID. The unique indexes make two
-- simultaneous retries converge on the first inserted message.
CREATE OR REPLACE FUNCTION public.send_direct_message_v3(
  p_conversation_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
  v_existing_conversation_id uuid;
  v_existing_body text;
  v_existing_reply_to_message_id uuid;
  v_created_at timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF p_conversation_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = p_conversation_id
      AND (dc.user_a = v_user_id OR dc.user_b = v_user_id)
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;
  IF p_client_request_id IS NULL
     OR p_client_request_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Ungültige Anfrage-ID.';
  END IF;
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'Nachricht darf nicht leer sein.';
  END IF;
  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht ist zu lang.';
  END IF;

  -- A completed retry is returned before checking the reply again. This remains
  -- reliable if the replied-to message was removed after the original send.
  SELECT dm.id, dm.conversation_id, dm.body, dm.reply_to_message_id
    INTO v_message_id, v_existing_conversation_id, v_existing_body, v_existing_reply_to_message_id
  FROM public.direct_messages AS dm
  WHERE dm.sender_id = v_user_id
    AND dm.client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_message_id IS NOT NULL THEN
    IF v_existing_conversation_id IS DISTINCT FROM p_conversation_id
       OR v_existing_body IS DISTINCT FROM v_body
       OR v_existing_reply_to_message_id IS DISTINCT FROM p_reply_to_message_id THEN
      RAISE EXCEPTION 'request_conflict: Die Anfrage-ID wurde bereits für eine andere Nachricht verwendet.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_message_id;
  END IF;

  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.direct_messages AS parent
    WHERE parent.id = p_reply_to_message_id
      AND parent.conversation_id = p_conversation_id
      AND parent.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Antwort-Ziel wurde nicht gefunden.';
  END IF;

  INSERT INTO public.direct_messages AS dm (
    conversation_id, sender_id, body, created_at,
    reply_to_message_id, client_request_id
  )
  VALUES (
    p_conversation_id, v_user_id, v_body, v_created_at,
    p_reply_to_message_id, p_client_request_id
  )
  ON CONFLICT (sender_id, client_request_id)
    WHERE client_request_id IS NOT NULL
  DO NOTHING
  RETURNING dm.id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT dm.id, dm.conversation_id, dm.body, dm.reply_to_message_id
      INTO v_message_id, v_existing_conversation_id, v_existing_body, v_existing_reply_to_message_id
    FROM public.direct_messages AS dm
    WHERE dm.sender_id = v_user_id
      AND dm.client_request_id = p_client_request_id
    FOR UPDATE;

    IF v_message_id IS NULL
       OR v_existing_conversation_id IS DISTINCT FROM p_conversation_id
       OR v_existing_body IS DISTINCT FROM v_body
       OR v_existing_reply_to_message_id IS DISTINCT FROM p_reply_to_message_id THEN
      RAISE EXCEPTION 'request_conflict: Die Anfrage-ID wurde bereits für eine andere Nachricht verwendet.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_message_id;
  END IF;

  UPDATE public.direct_conversations AS dc
  SET last_message_at = v_created_at,
      updated_at = v_created_at
  WHERE dc.id = p_conversation_id;

  RETURN v_message_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_group_message_v2(
  p_group_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
  v_existing_group_id uuid;
  v_existing_body text;
  v_existing_reply_to_message_id uuid;
  v_created_at timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL OR p_group_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.group_members AS gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;
  IF p_client_request_id IS NULL
     OR p_client_request_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Ungültige Anfrage-ID.';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht muss zwischen 1 und 5000 Zeichen lang sein.';
  END IF;

  SELECT gm.id, gm.group_id, gm.body, gm.reply_to_message_id
    INTO v_message_id, v_existing_group_id, v_existing_body, v_existing_reply_to_message_id
  FROM public.group_messages AS gm
  WHERE gm.sender_id = v_user_id
    AND gm.client_request_id = p_client_request_id
  FOR UPDATE;

  IF v_message_id IS NOT NULL THEN
    IF v_existing_group_id IS DISTINCT FROM p_group_id
       OR v_existing_body IS DISTINCT FROM v_body
       OR v_existing_reply_to_message_id IS DISTINCT FROM p_reply_to_message_id THEN
      RAISE EXCEPTION 'request_conflict: Die Anfrage-ID wurde bereits für eine andere Nachricht verwendet.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_message_id;
  END IF;

  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.group_messages AS parent
    WHERE parent.id = p_reply_to_message_id
      AND parent.group_id = p_group_id
      AND parent.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Antwort-Ziel wurde nicht gefunden.';
  END IF;

  INSERT INTO public.group_messages AS gm (
    group_id, sender_id, body, created_at,
    reply_to_message_id, client_request_id
  )
  VALUES (
    p_group_id, v_user_id, v_body, v_created_at,
    p_reply_to_message_id, p_client_request_id
  )
  ON CONFLICT (sender_id, client_request_id)
    WHERE client_request_id IS NOT NULL
  DO NOTHING
  RETURNING gm.id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT gm.id, gm.group_id, gm.body, gm.reply_to_message_id
      INTO v_message_id, v_existing_group_id, v_existing_body, v_existing_reply_to_message_id
    FROM public.group_messages AS gm
    WHERE gm.sender_id = v_user_id
      AND gm.client_request_id = p_client_request_id
    FOR UPDATE;

    IF v_message_id IS NULL
       OR v_existing_group_id IS DISTINCT FROM p_group_id
       OR v_existing_body IS DISTINCT FROM v_body
       OR v_existing_reply_to_message_id IS DISTINCT FROM p_reply_to_message_id THEN
      RAISE EXCEPTION 'request_conflict: Die Anfrage-ID wurde bereits für eine andere Nachricht verwendet.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_message_id;
  END IF;

  UPDATE public.group_conversations AS gc
  SET updated_at = v_created_at,
      last_message_at = v_created_at
  WHERE gc.id = p_group_id;

  INSERT INTO public.group_reads AS gr (group_id, user_id, last_read_at)
  VALUES (p_group_id, v_user_id, v_created_at)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET last_read_at = excluded.last_read_at;

  RETURN v_message_id;
END;
$function$;

-- Private serializers centralize the rich message shape. They are SECURITY
-- INVOKER and callable only from the explicitly guarded public RPCs below.
CREATE SCHEMA IF NOT EXISTS private;

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

CREATE OR REPLACE FUNCTION public.get_direct_message_page(
  p_conversation_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_message_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF p_conversation_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS conversation
    WHERE conversation.id = p_conversation_id
      AND (conversation.user_a = v_user_id OR conversation.user_b = v_user_id)
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_message_id IS NULL) THEN
    RAISE EXCEPTION 'Ungültiger Nachrichten-Cursor.';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.direct_messages AS message
    WHERE message.conversation_id = p_conversation_id
      AND (
        p_before_created_at IS NULL
        OR (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
      )
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT v_limit + 1
  ), page_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'messages', COALESCE((
      SELECT jsonb_agg(
        private.direct_message_json(page_row.id, v_user_id)
        ORDER BY page_row.created_at, page_row.id
      )
      FROM page_rows AS page_row
    ), '[]'::jsonb),
    'has_more', (SELECT count(*) > v_limit FROM candidates),
    'next_cursor', (
      SELECT jsonb_build_object(
        'created_at', page_row.created_at,
        'message_id', page_row.id
      )
      FROM page_rows AS page_row
      ORDER BY page_row.created_at, page_row.id
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_message_page(
  p_group_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_message_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR p_group_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.group_members AS member
    WHERE member.group_id = p_group_id
      AND member.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_message_id IS NULL) THEN
    RAISE EXCEPTION 'Ungültiger Nachrichten-Cursor.';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.group_messages AS message
    WHERE message.group_id = p_group_id
      AND (
        p_before_created_at IS NULL
        OR (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
      )
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT v_limit + 1
  ), page_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'messages', COALESCE((
      SELECT jsonb_agg(
        private.group_message_json(page_row.id)
        ORDER BY page_row.created_at, page_row.id
      )
      FROM page_rows AS page_row
    ), '[]'::jsonb),
    'has_more', (SELECT count(*) > v_limit FROM candidates),
    'next_cursor', (
      SELECT jsonb_build_object(
        'created_at', page_row.created_at,
        'message_id', page_row.id
      )
      FROM page_rows AS page_row
      ORDER BY page_row.created_at, page_row.id
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_direct_message_context(
  p_conversation_id uuid,
  p_message_id uuid,
  p_radius integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_radius integer := greatest(1, least(coalesce(p_radius, 30), 50));
  v_target_created_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF p_conversation_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS conversation
    WHERE conversation.id = p_conversation_id
      AND (conversation.user_a = v_user_id OR conversation.user_b = v_user_id)
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT message.created_at INTO v_target_created_at
  FROM public.direct_messages AS message
  WHERE message.id = p_message_id
    AND message.conversation_id = p_conversation_id;

  IF v_target_created_at IS NULL THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kein Zugriff.';
  END IF;

  WITH older_candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.direct_messages AS message
    WHERE message.conversation_id = p_conversation_id
      AND (message.created_at, message.id) < (v_target_created_at, p_message_id)
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT v_radius + 1
  ), older_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM older_candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT v_radius
  ), newer_candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.direct_messages AS message
    WHERE message.conversation_id = p_conversation_id
      AND (message.created_at, message.id) > (v_target_created_at, p_message_id)
    ORDER BY message.created_at, message.id
    LIMIT v_radius + 1
  ), newer_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM newer_candidates AS candidate
    ORDER BY candidate.created_at, candidate.id
    LIMIT v_radius
  ), context_rows AS MATERIALIZED (
    SELECT older.id, older.created_at FROM older_rows AS older
    UNION ALL
    SELECT p_message_id, v_target_created_at
    UNION ALL
    SELECT newer.id, newer.created_at FROM newer_rows AS newer
  )
  SELECT jsonb_build_object(
    'messages', (
      SELECT jsonb_agg(
        private.direct_message_json(context.id, v_user_id)
        ORDER BY context.created_at, context.id
      )
      FROM context_rows AS context
    ),
    'anchor_message_id', p_message_id,
    'has_older', (SELECT count(*) > v_radius FROM older_candidates),
    'has_newer', (SELECT count(*) > v_radius FROM newer_candidates),
    'oldest_cursor', (
      SELECT jsonb_build_object('created_at', context.created_at, 'message_id', context.id)
      FROM context_rows AS context
      ORDER BY context.created_at, context.id
      LIMIT 1
    ),
    'newest_cursor', (
      SELECT jsonb_build_object('created_at', context.created_at, 'message_id', context.id)
      FROM context_rows AS context
      ORDER BY context.created_at DESC, context.id DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_message_context(
  p_group_id uuid,
  p_message_id uuid,
  p_radius integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_radius integer := greatest(1, least(coalesce(p_radius, 30), 50));
  v_target_created_at timestamptz;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR p_group_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.group_members AS member
    WHERE member.group_id = p_group_id
      AND member.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  SELECT message.created_at INTO v_target_created_at
  FROM public.group_messages AS message
  WHERE message.id = p_message_id
    AND message.group_id = p_group_id;

  IF v_target_created_at IS NULL THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kein Zugriff.';
  END IF;

  WITH older_candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.group_messages AS message
    WHERE message.group_id = p_group_id
      AND (message.created_at, message.id) < (v_target_created_at, p_message_id)
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT v_radius + 1
  ), older_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM older_candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT v_radius
  ), newer_candidates AS MATERIALIZED (
    SELECT message.id, message.created_at
    FROM public.group_messages AS message
    WHERE message.group_id = p_group_id
      AND (message.created_at, message.id) > (v_target_created_at, p_message_id)
    ORDER BY message.created_at, message.id
    LIMIT v_radius + 1
  ), newer_rows AS MATERIALIZED (
    SELECT candidate.id, candidate.created_at
    FROM newer_candidates AS candidate
    ORDER BY candidate.created_at, candidate.id
    LIMIT v_radius
  ), context_rows AS MATERIALIZED (
    SELECT older.id, older.created_at FROM older_rows AS older
    UNION ALL
    SELECT p_message_id, v_target_created_at
    UNION ALL
    SELECT newer.id, newer.created_at FROM newer_rows AS newer
  )
  SELECT jsonb_build_object(
    'messages', (
      SELECT jsonb_agg(
        private.group_message_json(context.id)
        ORDER BY context.created_at, context.id
      )
      FROM context_rows AS context
    ),
    'anchor_message_id', p_message_id,
    'has_older', (SELECT count(*) > v_radius FROM older_candidates),
    'has_newer', (SELECT count(*) > v_radius FROM newer_candidates),
    'oldest_cursor', (
      SELECT jsonb_build_object('created_at', context.created_at, 'message_id', context.id)
      FROM context_rows AS context
      ORDER BY context.created_at, context.id
      LIMIT 1
    ),
    'newest_cursor', (
      SELECT jsonb_build_object('created_at', context.created_at, 'message_id', context.id)
      FROM context_rows AS context
      ORDER BY context.created_at DESC, context.id DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_accessible_messages(
  p_query text,
  p_kind text DEFAULT NULL,
  p_chat_id uuid DEFAULT NULL,
  p_sender_id uuid DEFAULT NULL,
  p_sender_query text DEFAULT NULL,
  p_scope_query text DEFAULT NULL,
  p_from_date timestamptz DEFAULT NULL,
  p_to_date timestamptz DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_message_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_query_text text := btrim(coalesce(p_query, ''));
  v_kind text := nullif(lower(btrim(coalesce(p_kind, ''))), '');
  v_sender_query text := nullif(btrim(coalesce(p_sender_query, '')), '');
  v_scope_query text := nullif(btrim(coalesce(p_scope_query, '')), '');
  v_search_query tsquery;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 50));
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF char_length(v_query_text) < 2 OR char_length(v_query_text) > 100 THEN
    RAISE EXCEPTION 'Der Suchbegriff muss zwischen 2 und 100 Zeichen lang sein.';
  END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('direct', 'group') THEN
    RAISE EXCEPTION 'Ungültige Chat-Art.';
  END IF;
  IF v_sender_query IS NOT NULL AND char_length(v_sender_query) > 100 THEN
    RAISE EXCEPTION 'Der Absenderfilter ist zu lang.';
  END IF;
  IF v_scope_query IS NOT NULL AND char_length(v_scope_query) > 100 THEN
    RAISE EXCEPTION 'Der Gesprächs- oder Personenfilter ist zu lang.';
  END IF;
  IF p_chat_id IS NOT NULL AND v_kind IS NULL THEN
    RAISE EXCEPTION 'Ein Gesprächsfilter benötigt eine Chat-Art.';
  END IF;
  IF p_from_date IS NOT NULL AND p_to_date IS NOT NULL AND p_from_date >= p_to_date THEN
    RAISE EXCEPTION 'Der Datumsbereich ist ungültig.';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_message_id IS NULL) THEN
    RAISE EXCEPTION 'Ungültiger Such-Cursor.';
  END IF;

  -- Turn normalized lexemes into literal prefix terms. No user-supplied tsquery
  -- syntax is evaluated, while partial final words such as "ange" still find
  -- "Angebot". Multiple words use AND semantics.
  SELECT to_tsquery(
    'simple'::regconfig,
    string_agg(quote_literal(lexeme) || ':*', ' & ' ORDER BY lexeme)
  ) INTO v_search_query
  FROM unnest(tsvector_to_array(to_tsvector('simple'::regconfig, v_query_text))) AS lexeme;

  IF v_search_query IS NULL THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb,
      'has_more', false,
      'next_cursor', NULL
    );
  END IF;
  IF numnode(v_search_query) = 0 THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb,
      'has_more', false,
      'next_cursor', NULL
    );
  END IF;

  WITH accessible AS MATERIALIZED (
    SELECT
      'direct'::text AS kind,
      message.conversation_id AS chat_id,
      COALESCE(
        nullif(btrim(peer.full_name), ''),
        CASE WHEN nullif(btrim(peer.username), '') IS NOT NULL THEN '@' || peer.username END,
        'Direktchat'
      ) AS chat_name,
      message.id AS message_id,
      message.sender_id,
      sender.full_name AS sender_name,
      sender.username AS sender_username,
      message.body,
      message.created_at,
      message.edited_at
    FROM public.direct_messages AS message
    JOIN public.direct_conversations AS conversation
      ON conversation.id = message.conversation_id
    LEFT JOIN public.profiles AS sender ON sender.id = message.sender_id
    LEFT JOIN public.profiles AS peer
      ON peer.id = CASE
        WHEN conversation.user_a = v_user_id THEN conversation.user_b
        ELSE conversation.user_a
      END
    WHERE (v_kind IS NULL OR v_kind = 'direct')
      AND (conversation.user_a = v_user_id OR conversation.user_b = v_user_id)
      AND message.deleted_at IS NULL
      AND btrim(message.body) <> ''
      AND to_tsvector('simple'::regconfig, message.body) @@ v_search_query
      AND (p_chat_id IS NULL OR message.conversation_id = p_chat_id)
      AND (p_sender_id IS NULL OR message.sender_id = p_sender_id)
      AND (
        v_sender_query IS NULL
        OR strpos(lower(coalesce(sender.full_name, '')), lower(v_sender_query)) > 0
        OR strpos(lower(coalesce(sender.username, '')), lower(v_sender_query)) > 0
      )
      AND (
        v_scope_query IS NULL
        OR strpos(lower(coalesce(sender.full_name, '')), lower(v_scope_query)) > 0
        OR strpos(lower(coalesce(sender.username, '')), lower(v_scope_query)) > 0
        OR strpos(lower(coalesce(peer.full_name, '')), lower(v_scope_query)) > 0
        OR strpos(lower(coalesce(peer.username, '')), lower(v_scope_query)) > 0
      )
      AND (p_from_date IS NULL OR message.created_at >= p_from_date)
      AND (p_to_date IS NULL OR message.created_at < p_to_date)
      AND (
        p_before_created_at IS NULL
        OR (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
      )

    UNION ALL

    SELECT
      'group'::text AS kind,
      message.group_id AS chat_id,
      conversation.name AS chat_name,
      message.id AS message_id,
      message.sender_id,
      sender.full_name AS sender_name,
      sender.username AS sender_username,
      message.body,
      message.created_at,
      message.edited_at
    FROM public.group_messages AS message
    JOIN public.group_conversations AS conversation
      ON conversation.id = message.group_id
    JOIN public.group_members AS membership
      ON membership.group_id = message.group_id
     AND membership.user_id = v_user_id
    LEFT JOIN public.profiles AS sender ON sender.id = message.sender_id
    WHERE (v_kind IS NULL OR v_kind = 'group')
      AND message.deleted_at IS NULL
      AND btrim(message.body) <> ''
      AND to_tsvector('simple'::regconfig, message.body) @@ v_search_query
      AND (p_chat_id IS NULL OR message.group_id = p_chat_id)
      AND (p_sender_id IS NULL OR message.sender_id = p_sender_id)
      AND (
        v_sender_query IS NULL
        OR strpos(lower(coalesce(sender.full_name, '')), lower(v_sender_query)) > 0
        OR strpos(lower(coalesce(sender.username, '')), lower(v_sender_query)) > 0
      )
      AND (
        v_scope_query IS NULL
        OR strpos(lower(coalesce(sender.full_name, '')), lower(v_scope_query)) > 0
        OR strpos(lower(coalesce(sender.username, '')), lower(v_scope_query)) > 0
        OR strpos(lower(conversation.name), lower(v_scope_query)) > 0
      )
      AND (p_from_date IS NULL OR message.created_at >= p_from_date)
      AND (p_to_date IS NULL OR message.created_at < p_to_date)
      AND (
        p_before_created_at IS NULL
        OR (message.created_at, message.id) < (p_before_created_at, p_before_message_id)
      )
  ), candidates AS MATERIALIZED (
    SELECT accessible.*
    FROM accessible
    ORDER BY accessible.created_at DESC, accessible.message_id DESC
    LIMIT v_limit + 1
  ), page_rows AS MATERIALIZED (
    SELECT candidate.*
    FROM candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.message_id DESC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'results', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', page_row.kind,
          'chat_id', page_row.chat_id,
          'chat_name', page_row.chat_name,
          'message_id', page_row.message_id,
          'sender_id', page_row.sender_id,
          'sender_name', page_row.sender_name,
          'sender_username', page_row.sender_username,
          'body', page_row.body,
          'created_at', page_row.created_at,
          'edited_at', page_row.edited_at
        )
        ORDER BY page_row.created_at DESC, page_row.message_id DESC
      )
      FROM page_rows AS page_row
    ), '[]'::jsonb),
    'has_more', (SELECT count(*) > v_limit FROM candidates),
    'next_cursor', (
      SELECT jsonb_build_object(
        'created_at', page_row.created_at,
        'message_id', page_row.message_id
      )
      FROM page_rows AS page_row
      ORDER BY page_row.created_at, page_row.message_id
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION private.direct_message_json(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION private.group_message_json(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.send_direct_message_v3(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.send_group_message_v2(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_direct_message_page(uuid, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_group_message_page(uuid, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_direct_message_context(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_group_message_context(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.search_accessible_messages(
  text, text, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.send_direct_message_v3(uuid, text, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_group_message_v2(uuid, text, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_message_page(uuid, timestamptz, uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_message_page(uuid, timestamptz, uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_message_context(uuid, uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_message_context(uuid, uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_accessible_messages(
  text, text, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) TO authenticated;
