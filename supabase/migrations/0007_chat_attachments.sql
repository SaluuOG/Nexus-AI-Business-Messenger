-- Nexus Phase 2.3 — private chat attachments (images and documents)
-- Adds private Supabase Storage, attachment metadata and secure participant-only access.

-- Deleted messages and attachment-only messages may have an empty body.
-- Plain text sends remain protected by send_direct_message_v2, which still requires text.
ALTER TABLE public.direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_body_length;

ALTER TABLE public.direct_messages
  ADD CONSTRAINT direct_messages_body_length
  CHECK (char_length(btrim(body)) BETWEEN 0 AND 5000);

CREATE TABLE IF NOT EXISTS public.direct_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_message_attachments_name_length CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
  CONSTRAINT direct_message_attachments_mime_length CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  CONSTRAINT direct_message_attachments_size CHECK (file_size BETWEEN 1 AND 26214400),
  CONSTRAINT direct_message_attachments_mime_allowed CHECK (
    mime_type = ANY (ARRAY[
      'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
      'application/pdf','text/plain','text/csv',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip','application/x-zip-compressed'
    ]::text[])
  )
);

CREATE INDEX IF NOT EXISTS direct_message_attachments_message_idx
  ON public.direct_message_attachments (message_id, created_at);
CREATE INDEX IF NOT EXISTS direct_message_attachments_conversation_idx
  ON public.direct_message_attachments (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_message_attachments_uploader_idx
  ON public.direct_message_attachments (uploader_id, created_at DESC);

ALTER TABLE public.direct_message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS direct_message_attachments_select_participants ON public.direct_message_attachments;
CREATE POLICY direct_message_attachments_select_participants
ON public.direct_message_attachments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_message_attachments.conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  )
);

REVOKE ALL ON public.direct_message_attachments FROM anon, authenticated;

-- Private bucket. Maximum file size: 25 MiB.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'nexus-chat-attachments',
  'nexus-chat-attachments',
  false,
  26214400,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/pdf','text/plain','text/csv',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','application/x-zip-compressed'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage policy helpers deliberately fail closed for malformed paths.
-- Expected object path: <conversation_uuid>/<uploader_uuid>/<random-file-name>
CREATE OR REPLACE FUNCTION public.can_upload_chat_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_uploader_folder text;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_conversation_id := split_part(p_path, '/', 1)::uuid;
  v_uploader_folder := split_part(p_path, '/', 2);

  IF v_uploader_folder <> auth.uid()::text OR split_part(p_path, '/', 3) = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = v_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_chat_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_conversation_id := split_part(p_path, '/', 1)::uuid;

  RETURN EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    JOIN public.direct_message_attachments AS dma
      ON dma.conversation_id = dc.id
     AND dma.storage_path = p_path
    WHERE dc.id = v_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_chat_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_uploader_folder text;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_conversation_id := split_part(p_path, '/', 1)::uuid;
  v_uploader_folder := split_part(p_path, '/', 2);

  IF v_uploader_folder <> auth.uid()::text THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    JOIN public.direct_message_attachments AS dma
      ON dma.conversation_id = dc.id
     AND dma.storage_path = p_path
     AND dma.uploader_id = auth.uid()
    WHERE dc.id = v_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_upload_chat_attachment(text) FROM public;
REVOKE ALL ON FUNCTION public.can_read_chat_attachment(text) FROM public;
REVOKE ALL ON FUNCTION public.can_delete_chat_attachment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_upload_chat_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_chat_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_chat_attachment(text) TO authenticated;

DROP POLICY IF EXISTS nexus_chat_attachments_insert ON storage.objects;
CREATE POLICY nexus_chat_attachments_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_upload_chat_attachment(name)
);

DROP POLICY IF EXISTS nexus_chat_attachments_select ON storage.objects;
CREATE POLICY nexus_chat_attachments_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_read_chat_attachment(name)
);

DROP POLICY IF EXISTS nexus_chat_attachments_delete ON storage.objects;
CREATE POLICY nexus_chat_attachments_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_delete_chat_attachment(name)
);

CREATE OR REPLACE FUNCTION public.send_direct_attachment_message(
  p_conversation_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_body text DEFAULT '',
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text;
  v_file_name text;
  v_message_id uuid;
  v_created_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = p_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  IF p_storage_path IS NULL
     OR p_storage_path NOT LIKE p_conversation_id::text || '/' || auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'Ungültiger Speicherpfad.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS so
    WHERE so.bucket_id = 'nexus-chat-attachments'
      AND so.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Hochgeladene Datei wurde nicht gefunden.';
  END IF;

  v_file_name := btrim(coalesce(p_file_name, ''));
  IF char_length(v_file_name) < 1 OR char_length(v_file_name) > 255 THEN
    RAISE EXCEPTION 'Ungültiger Dateiname.';
  END IF;

  IF p_file_size IS NULL OR p_file_size < 1 OR p_file_size > 26214400 THEN
    RAISE EXCEPTION 'Datei ist leer oder größer als 25 MB.';
  END IF;

  IF p_mime_type IS NULL OR NOT (p_mime_type = ANY (ARRAY[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/pdf','text/plain','text/csv',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','application/x-zip-compressed'
  ]::text[])) THEN
    RAISE EXCEPTION 'Dieser Dateityp wird nicht unterstützt.';
  END IF;

  v_body := btrim(coalesce(p_body, ''));
  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht ist zu lang.';
  END IF;

  IF p_reply_to_message_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.direct_messages AS parent
       WHERE parent.id = p_reply_to_message_id
         AND parent.conversation_id = p_conversation_id
         AND parent.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Antwort-Ziel wurde nicht gefunden.';
  END IF;

  INSERT INTO public.direct_messages AS dm (
    conversation_id,
    sender_id,
    body,
    created_at,
    reply_to_message_id
  )
  VALUES (
    p_conversation_id,
    auth.uid(),
    v_body,
    v_created_at,
    p_reply_to_message_id
  )
  RETURNING dm.id INTO v_message_id;

  INSERT INTO public.direct_message_attachments (
    message_id,
    conversation_id,
    uploader_id,
    storage_path,
    file_name,
    mime_type,
    file_size,
    created_at
  )
  VALUES (
    v_message_id,
    p_conversation_id,
    auth.uid(),
    p_storage_path,
    v_file_name,
    p_mime_type,
    p_file_size,
    v_created_at
  );

  UPDATE public.direct_conversations AS dc
  SET last_message_at = v_created_at,
      updated_at = v_created_at
  WHERE dc.id = p_conversation_id;

  RETURN v_message_id;
END;
$$;

-- Deleting a message also removes its attachment metadata. The client removes the
-- physical Storage object first through the protected Storage DELETE policy.
CREATE OR REPLACE FUNCTION public.delete_direct_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_messages AS dm
    WHERE dm.id = p_message_id
      AND dm.sender_id = auth.uid()
      AND dm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht gelöscht werden.';
  END IF;

  DELETE FROM public.direct_message_attachments AS dma
  WHERE dma.message_id = p_message_id
    AND dma.uploader_id = auth.uid();

  UPDATE public.direct_messages AS dm
  SET body = '',
      deleted_at = now()
  WHERE dm.id = p_message_id
    AND dm.sender_id = auth.uid()
    AND dm.deleted_at IS NULL;
END;
$$;

-- Chat list preview now understands deleted and attachment-only messages.
CREATE OR REPLACE FUNCTION public.get_direct_conversations()
RETURNS TABLE (
  conversation_id uuid,
  contact_user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    p.id,
    p.full_name,
    p.username,
    p.avatar_url,
    CASE
      WHEN lm.id IS NULL THEN NULL
      WHEN lm.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN nullif(btrim(lm.body), '') IS NOT NULL THEN lm.body
      WHEN lm.has_image THEN '📷 Bild'
      WHEN lm.has_attachment THEN '📎 Datei'
      ELSE 'Nachricht'
    END,
    COALESCE(lm.created_at, dc.last_message_at),
    (
      SELECT count(*)
      FROM public.direct_messages AS unread
      WHERE unread.conversation_id = dc.id
        AND unread.sender_id <> auth.uid()
        AND unread.created_at > COALESCE(dcr.last_read_at, 'epoch'::timestamptz)
    )
  FROM public.direct_conversations AS dc
  JOIN public.profiles AS p
    ON p.id = CASE WHEN dc.user_a = auth.uid() THEN dc.user_b ELSE dc.user_a END
  LEFT JOIN public.direct_conversation_reads AS dcr
    ON dcr.conversation_id = dc.id AND dcr.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT
      dm.id,
      dm.body,
      dm.created_at,
      dm.deleted_at,
      EXISTS (
        SELECT 1 FROM public.direct_message_attachments AS dma
        WHERE dma.message_id = dm.id
      ) AS has_attachment,
      EXISTS (
        SELECT 1 FROM public.direct_message_attachments AS dma
        WHERE dma.message_id = dm.id AND dma.mime_type LIKE 'image/%'
      ) AS has_image
    FROM public.direct_messages AS dm
    WHERE dm.conversation_id = dc.id
    ORDER BY dm.created_at DESC
    LIMIT 1
  ) AS lm ON true
  WHERE dc.user_a = auth.uid() OR dc.user_b = auth.uid()
  ORDER BY COALESCE(lm.created_at, dc.last_message_at, dc.created_at) DESC;
END;
$$;

-- Rich message rows now include attachment metadata as JSON.
DROP FUNCTION IF EXISTS public.get_direct_messages(uuid, integer);
CREATE FUNCTION public.get_direct_messages(
  p_conversation_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  reply_to_message_id uuid,
  reply_sender_id uuid,
  reply_body text,
  edited_at timestamptz,
  deleted_at timestamptz,
  read_at timestamptz,
  attachments jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = p_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 200), 500));

  RETURN QUERY
  SELECT
    recent.id,
    recent.sender_id,
    recent.body,
    recent.created_at,
    recent.reply_to_message_id,
    parent.sender_id,
    CASE
      WHEN parent.id IS NULL THEN NULL
      WHEN parent.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN nullif(btrim(parent.body), '') IS NOT NULL THEN parent.body
      WHEN EXISTS (
        SELECT 1 FROM public.direct_message_attachments AS parent_attachment
        WHERE parent_attachment.message_id = parent.id
      ) THEN 'Anhang'
      ELSE NULL
    END,
    recent.edited_at,
    recent.deleted_at,
    CASE
      WHEN recent.sender_id = auth.uid()
       AND peer_read.last_read_at >= recent.created_at
      THEN peer_read.last_read_at
      ELSE NULL
    END,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'attachment_id', dma.id,
          'storage_path', dma.storage_path,
          'file_name', dma.file_name,
          'mime_type', dma.mime_type,
          'file_size', dma.file_size
        ) ORDER BY dma.created_at
      )
      FROM public.direct_message_attachments AS dma
      WHERE dma.message_id = recent.id
    ), '[]'::jsonb)
  FROM (
    SELECT dm.*
    FROM public.direct_messages AS dm
    WHERE dm.conversation_id = p_conversation_id
    ORDER BY dm.created_at DESC
    LIMIT v_limit
  ) AS recent
  LEFT JOIN public.direct_messages AS parent
    ON parent.id = recent.reply_to_message_id
  LEFT JOIN LATERAL (
    SELECT dcr.last_read_at
    FROM public.direct_conversation_reads AS dcr
    WHERE dcr.conversation_id = p_conversation_id
      AND dcr.user_id <> auth.uid()
    LIMIT 1
  ) AS peer_read ON true
  ORDER BY recent.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.send_direct_attachment_message(uuid, text, text, text, bigint, text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.delete_direct_message(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_direct_conversations() FROM public;
REVOKE ALL ON FUNCTION public.get_direct_messages(uuid, integer) FROM public;

GRANT EXECUTE ON FUNCTION public.send_direct_attachment_message(uuid, text, text, text, bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_direct_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid, integer) TO authenticated;