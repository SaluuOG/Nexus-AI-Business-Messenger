-- Phase 2.3 hotfix: allow an uploader to remove an orphaned upload from their own
-- conversation/user folder when attachment metadata creation fails.
-- Read access still requires a valid attachment metadata row.

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

REVOKE ALL ON FUNCTION public.can_delete_chat_attachment(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_delete_chat_attachment(text) TO authenticated;