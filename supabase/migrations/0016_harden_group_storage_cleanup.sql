-- Phase 2.5F: include orphaned group files in owner-only cleanup.

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

  -- The owner may remove every object in the group's namespace when the
  -- complete group is deleted. Other members remain limited to files that
  -- are both theirs and referenced by an attachment row.
  RETURN EXISTS (
    SELECT 1
    FROM public.group_members owner_member
    WHERE owner_member.group_id = v_group_id
      AND owner_member.user_id = auth.uid()
      AND owner_member.role = 'owner'
  ) OR (
    public.is_group_member(v_group_id)
    AND v_uploader = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.group_message_attachments gma
      WHERE gma.group_id = v_group_id
        AND gma.storage_path = p_path
        AND gma.uploader_id = auth.uid()
    )
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
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
  SELECT so.bucket_id::text, so.name::text
  FROM storage.objects so
  WHERE (so.bucket_id = 'nexus-group-avatars'
         AND so.name LIKE p_group_id::text || '/%')
     OR (so.bucket_id = 'nexus-chat-attachments'
         AND so.name LIKE 'groups/' || p_group_id::text || '/%');
END;
$$;

REVOKE ALL ON FUNCTION public.can_delete_group_attachment(text) FROM public;
REVOKE ALL ON FUNCTION public.get_group_storage_paths_for_deletion(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_delete_group_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_storage_paths_for_deletion(uuid) TO authenticated;
