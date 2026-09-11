-- Phase 2.5A: secure group-chat foundation

CREATE TABLE IF NOT EXISTS public.group_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT group_conversations_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 80)
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT group_members_role_allowed CHECK (role IN ('owner','admin','member'))
);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reply_to_message_id uuid REFERENCES public.group_messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT group_messages_body_length CHECK (char_length(body) <= 5000)
);

CREATE TABLE IF NOT EXISTS public.group_reads (
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS group_messages_group_created_idx ON public.group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_messages_sender_idx ON public.group_messages(sender_id);
CREATE INDEX IF NOT EXISTS group_reads_user_idx ON public.group_reads(user_id);

ALTER TABLE public.group_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_reads ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.group_members gm
       WHERE gm.group_id = p_group_id
         AND gm.user_id = auth.uid()
     );
$$;

REVOKE ALL ON FUNCTION public.is_group_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;

DROP POLICY IF EXISTS group_conversations_select_member ON public.group_conversations;
CREATE POLICY group_conversations_select_member
ON public.group_conversations
FOR SELECT
TO authenticated
USING (public.is_group_member(id));

DROP POLICY IF EXISTS group_members_select_member ON public.group_members;
CREATE POLICY group_members_select_member
ON public.group_members
FOR SELECT
TO authenticated
USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_messages_select_member ON public.group_messages;
CREATE POLICY group_messages_select_member
ON public.group_messages
FOR SELECT
TO authenticated
USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS group_reads_select_member ON public.group_reads;
CREATE POLICY group_reads_select_member
ON public.group_reads
FOR SELECT
TO authenticated
USING (public.is_group_member(group_id));

CREATE OR REPLACE FUNCTION public.create_group_chat(
  p_name text,
  p_member_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_members uuid[];
  v_member_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Der Gruppenname muss zwischen 2 und 80 Zeichen lang sein.';
  END IF;

  SELECT coalesce(array_agg(DISTINCT u.user_id), '{}'::uuid[])
  INTO v_members
  FROM unnest(coalesce(p_member_ids, '{}'::uuid[])) AS u(user_id)
  WHERE u.user_id IS NOT NULL
    AND u.user_id <> auth.uid();

  v_member_count := coalesce(array_length(v_members, 1), 0);
  IF v_member_count < 1 THEN
    RAISE EXCEPTION 'Wähle mindestens einen Kontakt für die Gruppe aus.';
  END IF;
  IF v_member_count > 49 THEN
    RAISE EXCEPTION 'Eine Gruppe kann aktuell maximal 50 Mitglieder haben.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_members) AS u(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.contact_links cl
      WHERE (cl.user_a = auth.uid() AND cl.user_b = u.user_id)
         OR (cl.user_b = auth.uid() AND cl.user_a = u.user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Gruppen können nur mit bestätigten Nexus-Kontakten erstellt werden.';
  END IF;

  INSERT INTO public.group_conversations(name, created_by)
  VALUES (v_name, auth.uid())
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members(group_id, user_id, role)
  VALUES (v_group_id, auth.uid(), 'owner');

  INSERT INTO public.group_members(group_id, user_id, role)
  SELECT v_group_id, u.user_id, 'member'
  FROM unnest(v_members) AS u(user_id)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  INSERT INTO public.group_reads(group_id, user_id, last_read_at)
  VALUES (v_group_id, auth.uid(), now())
  ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  RETURN v_group_id;
END;
$$;

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
    gc.id AS group_id,
    gc.name,
    gm.role,
    (SELECT count(*) FROM public.group_members gmc WHERE gmc.group_id = gc.id) AS member_count,
    CASE
      WHEN lm.id IS NULL THEN NULL
      WHEN lm.deleted_at IS NOT NULL THEN 'Nachricht gelöscht'
      ELSE lm.body
    END AS last_message,
    gc.last_message_at,
    (
      SELECT count(*)
      FROM public.group_messages um
      WHERE um.group_id = gc.id
        AND um.sender_id <> auth.uid()
        AND um.created_at > coalesce(gr.last_read_at, '-infinity'::timestamptz)
        AND um.deleted_at IS NULL
    ) AS unread_count
  FROM public.group_members gm
  JOIN public.group_conversations gc ON gc.id = gm.group_id
  LEFT JOIN public.group_reads gr ON gr.group_id = gc.id AND gr.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT m.id, m.body, m.deleted_at
    FROM public.group_messages m
    WHERE m.group_id = gc.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  WHERE gm.user_id = auth.uid()
  ORDER BY coalesce(gc.last_message_at, gc.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_group_members(p_group_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  full_name text,
  username text,
  avatar_url text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  RETURN QUERY
  SELECT gm.user_id, gm.role, p.full_name, p.username, p.avatar_url, gm.joined_at
  FROM public.group_members gm
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
           coalesce(p.full_name, p.username, '') ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_messages(
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
  reply_sender_name text
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
      m.id AS message_id,
      m.group_id,
      m.sender_id,
      p.full_name AS sender_full_name,
      p.username AS sender_username,
      p.avatar_url AS sender_avatar_url,
      m.body,
      m.created_at,
      m.edited_at,
      m.deleted_at,
      m.reply_to_message_id,
      parent.body AS reply_body,
      parent.sender_id AS reply_sender_id,
      rp.full_name AS reply_sender_name
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

CREATE OR REPLACE FUNCTION public.send_group_message(
  p_group_id uuid,
  p_body text,
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text := btrim(coalesce(p_body, ''));
  v_message_id uuid;
  v_created_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht muss zwischen 1 und 5000 Zeichen lang sein.';
  END IF;
  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
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

  UPDATE public.group_conversations
  SET updated_at = v_created_at, last_message_at = v_created_at
  WHERE id = p_group_id;

  INSERT INTO public.group_reads(group_id, user_id, last_read_at)
  VALUES (p_group_id, auth.uid(), v_created_at)
  ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_group_read(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  INSERT INTO public.group_reads(group_id, user_id, last_read_at)
  VALUES (p_group_id, auth.uid(), now())
  ON CONFLICT (group_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_group_message(p_message_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text := btrim(coalesce(p_body, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht muss zwischen 1 und 5000 Zeichen lang sein.';
  END IF;

  UPDATE public.group_messages
  SET body = v_body, edited_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht bearbeitet werden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;

  UPDATE public.group_messages
  SET body = '', deleted_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht gelöscht werden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_group_chat(p_group_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Der Gruppenname muss zwischen 2 und 80 Zeichen lang sein.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid() AND gm.role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'Nur Owner oder Admins können die Gruppe umbenennen.';
  END IF;

  UPDATE public.group_conversations SET name = v_name, updated_at = now() WHERE id = p_group_id;
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
  VALUES (p_group_id, p_user_id, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;
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

  DELETE FROM public.group_reads WHERE group_id = p_group_id AND user_id = p_user_id;
  DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_role NOT IN ('admin','member') THEN RAISE EXCEPTION 'Ungültige Gruppenrolle.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid() AND gm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Nur der Gruppen-Owner kann Rollen ändern.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id AND gm.role <> 'owner'
  ) THEN
    RAISE EXCEPTION 'Mitglied nicht gefunden oder Rolle kann nicht geändert werden.';
  END IF;

  UPDATE public.group_members SET role = p_role WHERE group_id = p_group_id AND user_id = p_user_id;
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
  IF v_role = 'owner' THEN RAISE EXCEPTION 'Der Owner muss die Gruppe derzeit behalten oder zuerst die Ownership übertragen.'; END IF;

  DELETE FROM public.group_reads WHERE group_id = p_group_id AND user_id = auth.uid();
  DELETE FROM public.group_members WHERE group_id = p_group_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_chat(text, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.get_my_group_chats() FROM public;
REVOKE ALL ON FUNCTION public.get_group_members(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_group_messages(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.send_group_message(uuid, text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.mark_group_read(uuid) FROM public;
REVOKE ALL ON FUNCTION public.edit_group_message(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.delete_group_message(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rename_group_chat(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.add_group_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.set_group_member_role(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.leave_group_chat(uuid) FROM public;

GRANT EXECUTE ON FUNCTION public.create_group_chat(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_group_chats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_messages(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_group_message(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_group_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_group_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_group_chat(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group_chat(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  END IF;
END $$;