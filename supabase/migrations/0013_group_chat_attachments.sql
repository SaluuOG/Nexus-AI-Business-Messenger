-- Phase 2.5B: secure group chat attachments

CREATE TABLE IF NOT EXISTS public.group_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_message_attachments_name_length CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
  CONSTRAINT group_message_attachments_size CHECK (file_size BETWEEN 1 AND 26214400)
);

CREATE INDEX IF NOT EXISTS group_message_attachments_message_idx
  ON public.group_message_attachments(message_id, created_at);
CREATE INDEX IF NOT EXISTS group_message_attachments_group_idx
  ON public.group_message_attachments(group_id, created_at DESC);

ALTER TABLE public.group_message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_message_attachments_select_member ON public.group_message_attachments;
CREATE POLICY group_message_attachments_select_member
ON public.group_message_attachments
FOR SELECT TO authenticated
USING (public.is_group_member(group_id));

REVOKE ALL ON public.group_message_attachments FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_upload_group_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_uploader text;
BEGIN
  IF auth.uid() IS NULL OR split_part(p_path, '/', 1) <> 'groups' THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 2)::uuid;
  v_uploader := split_part(p_path, '/', 3);

  IF v_uploader <> auth.uid()::text OR split_part(p_path, '/', 4) = '' THEN
    RETURN false;
  END IF;

  RETURN public.is_group_member(v_group_id);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_group_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL OR split_part(p_path, '/', 1) <> 'groups' THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 2)::uuid;

  RETURN public.is_group_member(v_group_id)
     AND EXISTS (
       SELECT 1
       FROM public.group_message_attachments gma
       WHERE gma.group_id = v_group_id
         AND gma.storage_path = p_path
     );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_group_attachment(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_uploader text;
BEGIN
  IF auth.uid() IS NULL OR split_part(p_path, '/', 1) <> 'groups' THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 2)::uuid;
  v_uploader := split_part(p_path, '/', 3);

  IF v_uploader <> auth.uid()::text THEN
    RETURN false;
  END IF;

  RETURN public.is_group_member(v_group_id)
     AND EXISTS (
       SELECT 1
       FROM public.group_message_attachments gma
       WHERE gma.group_id = v_group_id
         AND gma.storage_path = p_path
         AND gma.uploader_id = auth.uid()
     );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_upload_group_attachment(text) FROM public;
REVOKE ALL ON FUNCTION public.can_read_group_attachment(text) FROM public;
REVOKE ALL ON FUNCTION public.can_delete_group_attachment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_upload_group_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_group_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_group_attachment(text) TO authenticated;

DROP POLICY IF EXISTS nexus_group_attachments_insert ON storage.objects;
CREATE POLICY nexus_group_attachments_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_upload_group_attachment(name)
);

DROP POLICY IF EXISTS nexus_group_attachments_select ON storage.objects;
CREATE POLICY nexus_group_attachments_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_read_group_attachment(name)
);

DROP POLICY IF EXISTS nexus_group_attachments_delete ON storage.objects;
CREATE POLICY nexus_group_attachments_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'nexus-chat-attachments'
  AND public.can_delete_group_attachment(name)
);

CREATE OR REPLACE FUNCTION public.send_group_attachment_message(
  p_group_id uuid,
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
  v_body text := btrim(coalesce(p_body, ''));
  v_name text := btrim(coalesce(p_file_name, ''));
  v_message_id uuid;
  v_created_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  IF p_storage_path IS NULL
     OR p_storage_path NOT LIKE 'groups/' || p_group_id::text || '/' || auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'Ungültiger Speicherpfad.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects so
    WHERE so.bucket_id = 'nexus-chat-attachments'
      AND so.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Hochgeladene Datei wurde nicht gefunden.';
  END IF;

  IF char_length(v_name) < 1 OR char_length(v_name) > 255 THEN
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
    'application/zip','application/x-zip-compressed',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a'
  ]::text[])) THEN
    RAISE EXCEPTION 'Dieser Dateityp wird nicht unterstützt.';
  END IF;

  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht ist zu lang.';
  END IF;

  IF p_reply_to_message_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.group_messages pm
       WHERE pm.id = p_reply_to_message_id
         AND pm.group_id = p_group_id
         AND pm.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Antwort-Ziel wurde nicht gefunden.';
  END IF;

  INSERT INTO public.group_messages(group_id, sender_id, body, created_at, reply_to_message_id)
  VALUES (p_group_id, auth.uid(), v_body, v_created_at, p_reply_to_message_id)
  RETURNING id INTO v_message_id;

  INSERT INTO public.group_message_attachments(
    message_id, group_id, uploader_id, storage_path, file_name, mime_type, file_size, created_at
  )
  VALUES (
    v_message_id, p_group_id, auth.uid(), p_storage_path, v_name, p_mime_type, p_file_size, v_created_at
  );

  UPDATE public.group_conversations
  SET updated_at = v_created_at, last_message_at = v_created_at
  WHERE id = p_group_id;

  INSERT INTO public.group_reads(group_id, user_id, last_read_at)
  VALUES (p_group_id, auth.uid(), v_created_at)
  ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_group_attachment_message(uuid,text,text,text,bigint,text,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_group_attachment_message(uuid,text,text,text,bigint,text,uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_group_messages(uuid, integer);
CREATE FUNCTION public.get_group_messages(
  p_group_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  message_id uuid,
  group_id uuid,
  sender_id uuid,
  sender_full_name text,
  sender_username text,
  sender_avatar_url text,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  reply_to_message_id uuid,
  reply_body text,
  reply_sender_id uuid,
  reply_sender_name text,
  attachments jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      m.id,
      m.group_id,
      m.sender_id,
      p.full_name,
      p.username,
      p.avatar_url,
      m.body,
      m.created_at,
      m.edited_at,
      m.deleted_at,
      m.reply_to_message_id,
      parent.body,
      parent.sender_id,
      rp.full_name,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'attachment_id', gma.id,
            'storage_path', gma.storage_path,
            'file_name', gma.file_name,
            'mime_type', gma.mime_type,
            'file_size', gma.file_size
          )
          ORDER BY gma.created_at
        )
        FROM public.group_message_attachments gma
        WHERE gma.message_id = m.id
      ), '[]'::jsonb)
    FROM public.group_messages m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    LEFT JOIN public.group_messages parent ON parent.id = m.reply_to_message_id
    LEFT JOIN public.profiles rp ON rp.id = parent.sender_id
    WHERE m.group_id = p_group_id
    ORDER BY m.created_at DESC
    LIMIT v_limit
  ) recent
  ORDER BY recent.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_messages(uuid,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_messages(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_group_chats()
RETURNS TABLE (
  group_id uuid,
  name text,
  role text,
  member_count bigint,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gc.id,
    gc.name,
    gm.role,
    (SELECT count(*) FROM public.group_members gmc WHERE gmc.group_id = gc.id),
    CASE
      WHEN lm.id IS NULL THEN NULL
      WHEN lm.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN nullif(btrim(lm.body), '') IS NOT NULL THEN lm.body
      WHEN lm.has_image THEN '📷 Bild'
      WHEN lm.has_audio THEN '🎤 Sprachnachricht'
      WHEN lm.has_attachment THEN '📎 Datei'
      ELSE 'Nachricht'
    END,
    gc.last_message_at,
    (
      SELECT count(*)
      FROM public.group_messages um
      WHERE um.group_id = gc.id
        AND um.sender_id <> auth.uid()
        AND um.created_at > coalesce(gr.last_read_at, '-infinity'::timestamptz)
        AND um.deleted_at IS NULL
    )
  FROM public.group_members gm
  JOIN public.group_conversations gc ON gc.id = gm.group_id
  LEFT JOIN public.group_reads gr ON gr.group_id = gc.id AND gr.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT
      m.id,
      m.body,
      m.deleted_at,
      EXISTS(SELECT 1 FROM public.group_message_attachments a WHERE a.message_id = m.id) AS has_attachment,
      EXISTS(SELECT 1 FROM public.group_message_attachments a WHERE a.message_id = m.id AND a.mime_type LIKE 'image/%') AS has_image,
      EXISTS(SELECT 1 FROM public.group_message_attachments a WHERE a.message_id = m.id AND a.mime_type LIKE 'audio/%') AS has_audio
    FROM public.group_messages m
    WHERE m.group_id = gc.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  WHERE gm.user_id = auth.uid()
  ORDER BY coalesce(gc.last_message_at, gc.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  SELECT group_id
  INTO v_group_id
  FROM public.group_messages
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;

  IF v_group_id IS NULL OR NOT public.is_group_member(v_group_id) THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht gelöscht werden.';
  END IF;

  DELETE FROM public.group_message_attachments
  WHERE message_id = p_message_id
    AND uploader_id = auth.uid();

  UPDATE public.group_messages
  SET body = '', deleted_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;
