-- Nexus Phase 2.1 — real 1:1 conversations, persistent messages and realtime delivery
-- Applied after 0004_contacts_directory.sql.

CREATE TABLE IF NOT EXISTS public.direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT direct_conversations_distinct_users CHECK (user_a <> user_b),
  CONSTRAINT direct_conversations_stable_order CHECK (user_a::text < user_b::text),
  CONSTRAINT direct_conversations_unique_pair UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_body_length CHECK (
    char_length(btrim(body)) BETWEEN 1 AND 5000
  )
);

CREATE TABLE IF NOT EXISTS public.direct_conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS direct_conversations_user_a_idx
  ON public.direct_conversations (user_a, COALESCE(last_message_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS direct_conversations_user_b_idx
  ON public.direct_conversations (user_b, COALESCE(last_message_at, created_at) DESC);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx
  ON public.direct_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx
  ON public.direct_messages (sender_id, created_at DESC);

ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_conversation_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS direct_conversations_select_participants ON public.direct_conversations;
CREATE POLICY direct_conversations_select_participants
ON public.direct_conversations FOR SELECT TO authenticated
USING (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS direct_messages_select_participants ON public.direct_messages;
CREATE POLICY direct_messages_select_participants
ON public.direct_messages FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.direct_conversations AS dc
    WHERE dc.id = direct_messages.conversation_id
      AND (dc.user_a = auth.uid() OR dc.user_b = auth.uid())
  )
);

DROP POLICY IF EXISTS direct_reads_select_self ON public.direct_conversation_reads;
CREATE POLICY direct_reads_select_self
ON public.direct_conversation_reads FOR SELECT TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON public.direct_conversations FROM anon, authenticated;
REVOKE ALL ON public.direct_messages FROM anon, authenticated;
REVOKE ALL ON public.direct_conversation_reads FROM anon, authenticated;
GRANT SELECT ON public.direct_conversations TO authenticated;
GRANT SELECT ON public.direct_messages TO authenticated;
GRANT SELECT ON public.direct_conversation_reads TO authenticated;

CREATE OR REPLACE FUNCTION public.open_direct_conversation(p_contact_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_contact_user_id IS NULL OR p_contact_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Ungültiger Kontakt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contact_links AS cl
    WHERE (cl.user_a = auth.uid() AND cl.user_b = p_contact_user_id)
       OR (cl.user_b = auth.uid() AND cl.user_a = p_contact_user_id)
  ) THEN
    RAISE EXCEPTION '1:1-Chats können nur mit Nexus-Kontakten gestartet werden.';
  END IF;

  IF auth.uid()::text < p_contact_user_id::text THEN
    v_user_a := auth.uid();
    v_user_b := p_contact_user_id;
  ELSE
    v_user_a := p_contact_user_id;
    v_user_b := auth.uid();
  END IF;

  INSERT INTO public.direct_conversations AS dc (user_a, user_b)
  VALUES (v_user_a, v_user_b)
  ON CONFLICT ON CONSTRAINT direct_conversations_unique_pair
  DO UPDATE SET updated_at = dc.updated_at
  RETURNING dc.id INTO v_conversation_id;

  INSERT INTO public.direct_conversation_reads AS dcr (conversation_id, user_id, last_read_at)
  VALUES
    (v_conversation_id, v_user_a, now()),
    (v_conversation_id, v_user_b, now())
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$$;

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
    dc.id AS result_conversation_id,
    p.id AS result_contact_user_id,
    p.full_name AS result_full_name,
    p.username AS result_username,
    p.avatar_url AS result_avatar_url,
    lm.body AS result_last_message,
    COALESCE(lm.created_at, dc.last_message_at) AS result_last_message_at,
    (
      SELECT count(*)
      FROM public.direct_messages AS unread
      WHERE unread.conversation_id = dc.id
        AND unread.sender_id <> auth.uid()
        AND unread.created_at > COALESCE(dcr.last_read_at, 'epoch'::timestamptz)
    ) AS result_unread_count
  FROM public.direct_conversations AS dc
  JOIN public.profiles AS p
    ON p.id = CASE WHEN dc.user_a = auth.uid() THEN dc.user_b ELSE dc.user_a END
  LEFT JOIN public.direct_conversation_reads AS dcr
    ON dcr.conversation_id = dc.id AND dcr.user_id = auth.uid()
  LEFT JOIN LATERAL (
    SELECT dm.body, dm.created_at
    FROM public.direct_messages AS dm
    WHERE dm.conversation_id = dc.id
    ORDER BY dm.created_at DESC
    LIMIT 1
  ) AS lm ON true
  WHERE dc.user_a = auth.uid() OR dc.user_b = auth.uid()
  ORDER BY COALESCE(lm.created_at, dc.last_message_at, dc.created_at) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_direct_messages(
  p_conversation_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
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
  SELECT recent.id, recent.sender_id, recent.body, recent.created_at
  FROM (
    SELECT dm.id, dm.sender_id, dm.body, dm.created_at
    FROM public.direct_messages AS dm
    WHERE dm.conversation_id = p_conversation_id
    ORDER BY dm.created_at DESC
    LIMIT v_limit
  ) AS recent
  ORDER BY recent.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_direct_message(
  p_conversation_id uuid,
  p_body text
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

  INSERT INTO public.direct_messages AS dm (conversation_id, sender_id, body, created_at)
  VALUES (p_conversation_id, auth.uid(), v_body, v_created_at)
  RETURNING dm.id INTO v_message_id;

  UPDATE public.direct_conversations AS dc
  SET last_message_at = v_created_at,
      updated_at = v_created_at
  WHERE dc.id = p_conversation_id;

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_direct_conversation_read(p_conversation_id uuid)
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

  INSERT INTO public.direct_conversation_reads AS dcr (conversation_id, user_id, last_read_at)
  VALUES (p_conversation_id, auth.uid(), now())
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET last_read_at = excluded.last_read_at;
END;
$$;

REVOKE ALL ON FUNCTION public.open_direct_conversation(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_direct_conversations() FROM public;
REVOKE ALL ON FUNCTION public.get_direct_messages(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.send_direct_message(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.mark_direct_conversation_read(uuid) FROM public;

GRANT EXECUTE ON FUNCTION public.open_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_direct_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_direct_conversation_read(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END
$$;