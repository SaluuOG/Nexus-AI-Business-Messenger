-- Phase 2.5 security hardening: only current group members may edit/delete prior messages.

CREATE OR REPLACE FUNCTION public.edit_group_message(p_message_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text := btrim(coalesce(p_body, ''));
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht muss zwischen 1 und 5000 Zeichen lang sein.';
  END IF;

  SELECT gm.group_id
  INTO v_group_id
  FROM public.group_messages gm
  WHERE gm.id = p_message_id
    AND gm.sender_id = auth.uid()
    AND gm.deleted_at IS NULL;

  IF v_group_id IS NULL OR NOT public.is_group_member(v_group_id) THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden, kein Gruppenzugriff oder kann nicht bearbeitet werden.';
  END IF;

  UPDATE public.group_messages
  SET body = v_body,
      edited_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND group_id = v_group_id
    AND deleted_at IS NULL;
END;
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

  SELECT gm.group_id
  INTO v_group_id
  FROM public.group_messages gm
  WHERE gm.id = p_message_id
    AND gm.sender_id = auth.uid()
    AND gm.deleted_at IS NULL;

  IF v_group_id IS NULL OR NOT public.is_group_member(v_group_id) THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden, kein Gruppenzugriff oder kann nicht gelöscht werden.';
  END IF;

  UPDATE public.group_messages
  SET body = '',
      deleted_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND group_id = v_group_id
    AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.edit_group_message(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.delete_group_message(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_group_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_message(uuid) TO authenticated;
