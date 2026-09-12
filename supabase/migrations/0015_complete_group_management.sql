-- Phase 2.5E: complete and harden group management.

ALTER TABLE public.group_conversations
  ADD COLUMN IF NOT EXISTS avatar_path text,
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'group_conversations_avatar_path_length'
      AND conrelid = 'public.group_conversations'::regclass
  ) THEN
    ALTER TABLE public.group_conversations
      ADD CONSTRAINT group_conversations_avatar_path_length
      CHECK (avatar_path IS NULL OR char_length(avatar_path) BETWEEN 3 AND 512);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS group_conversations_created_by_idx
  ON public.group_conversations(created_by);
CREATE INDEX IF NOT EXISTS group_messages_reply_idx
  ON public.group_messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_message_attachments_uploader_idx
  ON public.group_message_attachments(uploader_id);
CREATE INDEX IF NOT EXISTS group_typing_user_idx
  ON public.group_typing(user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nexus-group-avatars',
  'nexus-group-avatars',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_upload_group_avatar(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 1)::uuid;
  IF split_part(p_path, '/', 2) <> auth.uid()::text
     OR split_part(p_path, '/', 3) = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = v_group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_group_avatar(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 1)::uuid;
  RETURN public.is_group_member(v_group_id)
     AND EXISTS (
       SELECT 1
       FROM public.group_conversations gc
       WHERE gc.id = v_group_id
         AND gc.avatar_path = p_path
     );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_delete_group_avatar(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  v_group_id := split_part(p_path, '/', 1)::uuid;
  RETURN split_part(p_path, '/', 3) <> ''
     AND EXISTS (
       SELECT 1
       FROM public.group_members gm
       WHERE gm.group_id = v_group_id
         AND gm.user_id = auth.uid()
         AND gm.role IN ('owner', 'admin')
     );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

-- Group owners need to remove every attachment before the cascading database
-- delete. Regular members can still only remove files they uploaded themselves.
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

  RETURN public.is_group_member(v_group_id)
     AND EXISTS (
       SELECT 1
       FROM public.group_message_attachments gma
       WHERE gma.group_id = v_group_id
         AND gma.storage_path = p_path
         AND (
           (v_uploader = auth.uid()::text AND gma.uploader_id = auth.uid())
           OR EXISTS (
             SELECT 1
             FROM public.group_members owner_member
             WHERE owner_member.group_id = v_group_id
               AND owner_member.user_id = auth.uid()
               AND owner_member.role = 'owner'
           )
         )
     );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_upload_group_avatar(text) FROM public;
REVOKE ALL ON FUNCTION public.can_read_group_avatar(text) FROM public;
REVOKE ALL ON FUNCTION public.can_delete_group_avatar(text) FROM public;
REVOKE ALL ON FUNCTION public.can_delete_group_attachment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_upload_group_avatar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_group_avatar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_group_avatar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_group_attachment(text) TO authenticated;

DROP POLICY IF EXISTS nexus_group_avatars_insert ON storage.objects;
CREATE POLICY nexus_group_avatars_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'nexus-group-avatars'
  AND public.can_upload_group_avatar(name)
);

DROP POLICY IF EXISTS nexus_group_avatars_select ON storage.objects;
CREATE POLICY nexus_group_avatars_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'nexus-group-avatars'
  AND public.can_read_group_avatar(name)
);

DROP POLICY IF EXISTS nexus_group_avatars_delete ON storage.objects;
CREATE POLICY nexus_group_avatars_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'nexus-group-avatars'
  AND public.can_delete_group_avatar(name)
);

DROP FUNCTION IF EXISTS public.get_my_group_chats();
CREATE FUNCTION public.get_my_group_chats()
RETURNS TABLE (
  group_id uuid,
  name text,
  avatar_path text,
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
    gc.id AS group_id,
    gc.name,
    gc.avatar_path,
    gm.role,
    (SELECT count(*) FROM public.group_members gmc WHERE gmc.group_id = gc.id) AS member_count,
    CASE
      WHEN lm.id IS NULL THEN NULL
      WHEN lm.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      WHEN btrim(lm.body) <> '' THEN lm.body
      WHEN lm.mime_type LIKE 'image/%' THEN 'Bild'
      WHEN lm.mime_type LIKE 'audio/%' THEN 'Sprachnachricht'
      WHEN lm.file_name IS NOT NULL THEN lm.file_name
      ELSE 'Nachricht'
    END AS last_message,
    gc.last_message_at,
    (
      SELECT count(*)
      FROM public.group_messages um
      WHERE um.group_id = gc.id
        AND um.sender_id <> auth.uid()
        AND um.created_at >= gm.joined_at
        AND um.created_at > coalesce(gr.last_read_at, '-infinity'::timestamptz)
        AND um.deleted_at IS NULL
    ) AS unread_count
  FROM public.group_members gm
  JOIN public.group_conversations gc ON gc.id = gm.group_id
  LEFT JOIN public.group_reads gr ON gr.group_id = gc.id AND gr.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT m.id, m.body, m.deleted_at, attachment.file_name, attachment.mime_type
    FROM public.group_messages m
    LEFT JOIN LATERAL (
      SELECT gma.file_name, gma.mime_type
      FROM public.group_message_attachments gma
      WHERE gma.message_id = m.id
      ORDER BY gma.created_at
      LIMIT 1
    ) attachment ON true
    WHERE m.group_id = gc.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  WHERE gm.user_id = auth.uid()
  ORDER BY coalesce(gc.last_message_at, gc.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.update_group_avatar(
  p_group_id uuid,
  p_storage_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Nur Owner oder Admins können das Gruppenbild ändern.';
  END IF;
  IF p_storage_path IS NULL
     OR p_storage_path NOT LIKE p_group_id::text || '/' || auth.uid()::text || '/%'
     OR char_length(p_storage_path) > 512 THEN
    RAISE EXCEPTION 'Ungültiger Speicherpfad für das Gruppenbild.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects so
    WHERE so.bucket_id = 'nexus-group-avatars'
      AND so.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Hochgeladenes Gruppenbild wurde nicht gefunden.';
  END IF;

  SELECT gc.avatar_path INTO v_previous_path
  FROM public.group_conversations gc
  WHERE gc.id = p_group_id
  FOR UPDATE;

  UPDATE public.group_conversations
  SET avatar_path = p_storage_path,
      avatar_updated_at = now(),
      updated_at = now()
  WHERE id = p_group_id;

  RETURN v_previous_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_avatar(p_group_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Nur Owner oder Admins können das Gruppenbild entfernen.';
  END IF;

  SELECT gc.avatar_path INTO v_previous_path
  FROM public.group_conversations gc
  WHERE gc.id = p_group_id
  FOR UPDATE;

  UPDATE public.group_conversations
  SET avatar_path = NULL,
      avatar_updated_at = now(),
      updated_at = now()
  WHERE id = p_group_id;

  RETURN v_previous_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership(
  p_group_id uuid,
  p_new_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;
  IF p_new_owner_id IS NULL OR p_new_owner_id = auth.uid() THEN
    RAISE EXCEPTION 'Wähle ein anderes Gruppenmitglied als neuen Owner.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Nur der aktuelle Owner kann die Ownership übertragen.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_new_owner_id
  ) THEN
    RAISE EXCEPTION 'Der neue Owner muss bereits Gruppenmitglied sein.';
  END IF;

  UPDATE public.group_members
  SET role = CASE
    WHEN user_id = auth.uid() THEN 'admin'
    WHEN user_id = p_new_owner_id THEN 'owner'
    ELSE role
  END
  WHERE group_id = p_group_id
    AND user_id IN (auth.uid(), p_new_owner_id);

  UPDATE public.group_conversations
  SET created_by = p_new_owner_id,
      updated_at = now()
  WHERE id = p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_storage_paths_for_deletion(p_group_id uuid)
RETURNS TABLE (bucket_id text, storage_path text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Nur der Gruppen-Owner kann die Gruppe löschen.';
  END IF;

  RETURN QUERY
  SELECT 'nexus-group-avatars'::text, gc.avatar_path
  FROM public.group_conversations gc
  WHERE gc.id = p_group_id
    AND gc.avatar_path IS NOT NULL
  UNION ALL
  SELECT 'nexus-chat-attachments'::text, gma.storage_path
  FROM public.group_message_attachments gma
  WHERE gma.group_id = p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_chat(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Nur der Gruppen-Owner kann die Gruppe löschen.';
  END IF;

  DELETE FROM public.group_conversations
  WHERE id = p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_group_member(p_group_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid() AND gm.role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'Nur Owner oder Admins können Mitglieder hinzufügen.';
  END IF;
  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Ungültiges Mitglied.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id
  ) THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.group_members gm WHERE gm.group_id = p_group_id) >= 50 THEN
    RAISE EXCEPTION 'Die Gruppe hat bereits 50 Mitglieder.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contact_links cl
    WHERE (cl.user_a = auth.uid() AND cl.user_b = p_user_id)
       OR (cl.user_b = auth.uid() AND cl.user_a = p_user_id)
  ) THEN
    RAISE EXCEPTION 'Es können nur bestätigte Nexus-Kontakte hinzugefügt werden.';
  END IF;

  INSERT INTO public.group_members(group_id, user_id, role)
  VALUES (p_group_id, p_user_id, 'member');

  INSERT INTO public.group_reads(group_id, user_id, last_read_at)
  VALUES (p_group_id, p_user_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  UPDATE public.group_conversations SET updated_at = now() WHERE id = p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_group_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  SELECT role INTO v_actor_role FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid();
  SELECT role INTO v_target_role FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Nur Owner oder Admins können Mitglieder entfernen.';
  END IF;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Mitglied nicht gefunden.'; END IF;
  IF v_target_role = 'owner' THEN RAISE EXCEPTION 'Der Gruppen-Owner kann nicht entfernt werden.'; END IF;
  IF v_actor_role = 'admin' AND v_target_role <> 'member' THEN
    RAISE EXCEPTION 'Admins können keine anderen Admins entfernen.';
  END IF;

  DELETE FROM public.group_typing WHERE group_id = p_group_id AND user_id = p_user_id;
  DELETE FROM public.group_reads WHERE group_id = p_group_id AND user_id = p_user_id;
  DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  UPDATE public.group_conversations SET updated_at = now() WHERE id = p_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_group_chat(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  SELECT role INTO v_role FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid();
  IF v_role IS NULL THEN RAISE EXCEPTION 'Du bist kein Mitglied dieser Gruppe.'; END IF;
  IF v_role = 'owner' THEN RAISE EXCEPTION 'Übertrage zuerst die Ownership oder lösche die Gruppe.'; END IF;

  DELETE FROM public.group_typing WHERE group_id = p_group_id AND user_id = auth.uid();
  DELETE FROM public.group_reads WHERE group_id = p_group_id AND user_id = auth.uid();
  DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid();
  UPDATE public.group_conversations SET updated_at = now() WHERE id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_group_chats() FROM public;
REVOKE ALL ON FUNCTION public.update_group_avatar(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.remove_group_avatar(uuid) FROM public;
REVOKE ALL ON FUNCTION public.transfer_group_ownership(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_group_storage_paths_for_deletion(uuid) FROM public;
REVOKE ALL ON FUNCTION public.delete_group_chat(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_group_chats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_group_avatar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_group_avatar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_storage_paths_for_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_chat(uuid) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.group_conversations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.group_members FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.group_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.group_reads FROM anon, authenticated;
GRANT SELECT ON public.group_conversations TO authenticated;
GRANT SELECT ON public.group_members TO authenticated;
GRANT SELECT ON public.group_messages TO authenticated;
GRANT SELECT ON public.group_reads TO authenticated;

ALTER TABLE public.group_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.group_members REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
  END IF;
END
$$;
