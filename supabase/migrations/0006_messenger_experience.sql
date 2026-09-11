-- Phase 2.2: richer 1:1 messenger experience
-- Adds replies, edit/delete, read receipts, typing state and contact presence.

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS direct_messages_reply_idx
  ON public.direct_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_typing (
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_typing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_typing REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS user_presence_select_contacts ON public.user_presence;
CREATE POLICY user_presence_select_contacts
ON public.user_presence
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.contact_links AS cl
    WHERE (cl.user_a = auth.uid() AND cl.user_b = user_presence.user_id)
       OR (cl.user_b = auth.uid() AND cl.user_a = user_presence.user_id)
  )
);

DROP POLICY IF EXISTS conversation_typing_select_participants ON public.conversation_typing;
CREATE POLICY conversation_typing_select_participants
ON public.conversation_typing
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = conversation_typing.conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  )
);

-- Realtime read receipts need both participants to be able to read the read markers.
DROP POLICY IF EXISTS direct_reads_select_self ON public.direct_conversation_reads;
DROP POLICY IF EXISTS direct_reads_select_participants ON public.direct_conversation_reads;
CREATE POLICY direct_reads_select_participants
ON public.direct_conversation_reads
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_conversation_reads.conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  )
);

REVOKE ALL ON public.user_presence FROM anon, authenticated;
REVOKE ALL ON public.conversation_typing FROM anon, authenticated;
GRANT SELECT ON public.user_presence TO authenticated;
GRANT SELECT ON public.conversation_typing TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_user_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  INSERT INTO public.user_presence AS up (user_id, last_seen_at)
  VALUES (auth.uid(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_presence(p_conversation_id uuid)
RETURNS TABLE (
  contact_user_id uuid,
  last_seen_at timestamptz,
  online boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  SELECT CASE WHEN dc.user_a = auth.uid() THEN dc.user_b ELSE dc.user_a END
  INTO v_contact_user_id
  FROM public.direct_conversations AS dc
  WHERE dc.id = p_conversation_id
    AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid());

  IF v_contact_user_id IS NULL THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  RETURN QUERY
  SELECT
    v_contact_user_id,
    up.last_seen_at,
    (up.last_seen_at IS NOT NULL AND up.last_seen_at > now() - interval '75 seconds')
  FROM (SELECT 1) AS one
  LEFT JOIN public.user_presence AS up ON up.user_id = v_contact_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_conversation_typing(
  p_conversation_id uuid,
  p_is_typing boolean
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = p_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  IF p_is_typing THEN
    INSERT INTO public.conversation_typing AS ct (conversation_id, user_id, updated_at)
    VALUES (p_conversation_id, auth.uid(), now())
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET updated_at = excluded.updated_at;
  ELSE
    DELETE FROM public.conversation_typing
    WHERE conversation_id = p_conversation_id
      AND user_id = auth.uid();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_conversation_typing(p_conversation_id uuid)
RETURNS TABLE (
  user_id uuid,
  updated_at timestamptz
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = p_conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Chat nicht gefunden oder kein Zugriff.';
  END IF;

  RETURN QUERY
  SELECT ct.user_id, ct.updated_at
  FROM public.conversation_typing AS ct
  WHERE ct.conversation_id = p_conversation_id
    AND ct.user_id <> auth.uid()
    AND ct.updated_at > now() - interval '6 seconds';
END;
$$;

CREATE OR REPLACE FUNCTION public.send_direct_message_v2(
  p_conversation_id uuid,
  p_body text,
  p_reply_to_message_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text;
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

  v_body := btrim(coalesce(p_body, ''));
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'Nachricht darf nicht leer sein.';
  END IF;
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

  UPDATE public.direct_conversations AS dc
  SET last_message_at = v_created_at,
      updated_at = v_created_at
  WHERE dc.id = p_conversation_id;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_direct_message(
  p_message_id uuid,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_body text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  v_body := btrim(coalesce(p_body, ''));
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'Nachricht darf nicht leer sein.';
  END IF;
  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'Nachricht ist zu lang.';
  END IF;

  UPDATE public.direct_messages AS dm
  SET body = v_body,
      edited_at = now()
  WHERE dm.id = p_message_id
    AND dm.sender_id = auth.uid()
    AND dm.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht bearbeitet werden.';
  END IF;
END;
$$;

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

  UPDATE public.direct_messages AS dm
  SET body = '',
      deleted_at = now()
  WHERE dm.id = p_message_id
    AND dm.sender_id = auth.uid()
    AND dm.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nachricht nicht gefunden oder kann nicht gelöscht werden.';
  END IF;
END;
$$;

-- Return richer message rows including reply previews and recipient read state.
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
  read_at timestamptz
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
      ELSE parent.body
    END,
    recent.edited_at,
    recent.deleted_at,
    CASE
      WHEN recent.sender_id = auth.uid()
       AND peer_read.last_read_at >= recent.created_at
      THEN peer_read.last_read_at
      ELSE NULL
    END
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

REVOKE ALL ON FUNCTION public.touch_user_presence() FROM public;
REVOKE ALL ON FUNCTION public.get_contact_presence(uuid) FROM public;
REVOKE ALL ON FUNCTION public.set_conversation_typing(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.get_conversation_typing(uuid) FROM public;
REVOKE ALL ON FUNCTION public.send_direct_message_v2(uuid, text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.edit_direct_message(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.delete_direct_message(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_direct_messages(uuid, integer) FROM public;

GRANT EXECUTE ON FUNCTION public.touch_user_presence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_presence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_typing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_typing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_direct_message_v2(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_direct_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_direct_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid, integer) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_typing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_typing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'direct_conversation_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_conversation_reads;
  END IF;
END
$$;
