-- Nexus Phase 1B.6 — real Nexus contacts, requests and privacy-safe username directory
-- Run ONCE in Supabase SQL Editor after 0003_fix_invitation_ambiguity.sql.

DO $$
BEGIN
  CREATE TYPE public.contact_request_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.contact_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_links_distinct_users CHECK (user_a <> user_b),
  CONSTRAINT contact_links_stable_order CHECK (user_a::text < user_b::text),
  CONSTRAINT contact_links_unique_pair UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.contact_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT contact_requests_distinct_users CHECK (sender_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_pending_pair_idx
ON public.contact_requests (
  (least(sender_id::text, recipient_id::text)),
  (greatest(sender_id::text, recipient_id::text))
)
WHERE status = 'pending'::public.contact_request_status;

CREATE INDEX IF NOT EXISTS contact_requests_sender_idx
ON public.contact_requests (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS contact_requests_recipient_idx
ON public.contact_requests (recipient_id, created_at DESC);

ALTER TABLE public.contact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;

-- Contact data is only accessed through the security-definer RPC functions below.
-- That keeps profile discovery limited to an exact Nexus username and prevents
-- arbitrary table reads from exposing other users' relationships.
REVOKE ALL ON public.contact_links FROM anon, authenticated;
REVOKE ALL ON public.contact_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_nexus_user(p_username text)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  relationship text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  v_username := lower(trim(coalesce(p_username, '')));
  IF left(v_username, 1) = '@' THEN
    v_username := substring(v_username FROM 2);
  END IF;

  IF length(v_username) < 2 THEN
    RAISE EXCEPTION 'Bitte einen vollständigen Nexus-Username eingeben.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS result_user_id,
    p.full_name AS result_full_name,
    p.username AS result_username,
    p.avatar_url AS result_avatar_url,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.contact_links AS cl
        WHERE (cl.user_a = auth.uid() AND cl.user_b = p.id)
           OR (cl.user_b = auth.uid() AND cl.user_a = p.id)
      ) THEN 'contact'
      WHEN EXISTS (
        SELECT 1
        FROM public.contact_requests AS cr
        WHERE cr.sender_id = auth.uid()
          AND cr.recipient_id = p.id
          AND cr.status = 'pending'::public.contact_request_status
      ) THEN 'outgoing'
      WHEN EXISTS (
        SELECT 1
        FROM public.contact_requests AS cr
        WHERE cr.sender_id = p.id
          AND cr.recipient_id = auth.uid()
          AND cr.status = 'pending'::public.contact_request_status
      ) THEN 'incoming'
      ELSE 'none'
    END AS result_relationship
  FROM public.profiles AS p
  WHERE p.id <> auth.uid()
    AND p.username IS NOT NULL
    AND lower(p.username) = v_username
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_contacts()
RETURNS TABLE (
  contact_user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  connected_at timestamptz
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
    p.id AS result_contact_user_id,
    p.full_name AS result_full_name,
    p.username AS result_username,
    p.avatar_url AS result_avatar_url,
    cl.created_at AS result_connected_at
  FROM public.contact_links AS cl
  JOIN public.profiles AS p
    ON p.id = CASE
      WHEN cl.user_a = auth.uid() THEN cl.user_b
      ELSE cl.user_a
    END
  WHERE cl.user_a = auth.uid() OR cl.user_b = auth.uid()
  ORDER BY lower(coalesce(p.full_name, p.username, '')) ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_contact_requests()
RETURNS TABLE (
  request_id uuid,
  direction text,
  other_user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz
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
    cr.id AS result_request_id,
    CASE WHEN cr.sender_id = auth.uid() THEN 'outgoing' ELSE 'incoming' END AS result_direction,
    p.id AS result_other_user_id,
    p.full_name AS result_full_name,
    p.username AS result_username,
    p.avatar_url AS result_avatar_url,
    cr.created_at AS result_created_at
  FROM public.contact_requests AS cr
  JOIN public.profiles AS p
    ON p.id = CASE
      WHEN cr.sender_id = auth.uid() THEN cr.recipient_id
      ELSE cr.sender_id
    END
  WHERE cr.status = 'pending'::public.contact_request_status
    AND (cr.sender_id = auth.uid() OR cr.recipient_id = auth.uid())
  ORDER BY cr.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_contact_request(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Du kannst dich nicht selbst als Kontakt hinzufügen.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = p_user_id AND p.username IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Nexus-Nutzer nicht gefunden.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contact_links AS cl
    WHERE (cl.user_a = auth.uid() AND cl.user_b = p_user_id)
       OR (cl.user_b = auth.uid() AND cl.user_a = p_user_id)
  ) THEN
    RAISE EXCEPTION 'Ihr seid bereits Kontakte.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contact_requests AS cr
    WHERE cr.sender_id = auth.uid()
      AND cr.recipient_id = p_user_id
      AND cr.status = 'pending'::public.contact_request_status
  ) THEN
    RAISE EXCEPTION 'Kontaktanfrage wurde bereits gesendet.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.contact_requests AS cr
    WHERE cr.sender_id = p_user_id
      AND cr.recipient_id = auth.uid()
      AND cr.status = 'pending'::public.contact_request_status
  ) THEN
    RAISE EXCEPTION 'Diese Person hat dir bereits eine Kontaktanfrage geschickt.';
  END IF;

  INSERT INTO public.contact_requests AS cr (sender_id, recipient_id)
  VALUES (auth.uid(), p_user_id)
  RETURNING cr.id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_contact_request(
  p_request_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.contact_requests%rowtype;
  v_user_a uuid;
  v_user_b uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  SELECT cr.* INTO v_request
  FROM public.contact_requests AS cr
  WHERE cr.id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Kontaktanfrage nicht gefunden.';
  END IF;

  IF v_request.recipient_id <> auth.uid() THEN
    RAISE EXCEPTION 'Du kannst diese Kontaktanfrage nicht beantworten.';
  END IF;

  IF v_request.status <> 'pending'::public.contact_request_status THEN
    RAISE EXCEPTION 'Diese Kontaktanfrage ist nicht mehr offen.';
  END IF;

  IF p_accept THEN
    IF v_request.sender_id::text < v_request.recipient_id::text THEN
      v_user_a := v_request.sender_id;
      v_user_b := v_request.recipient_id;
    ELSE
      v_user_a := v_request.recipient_id;
      v_user_b := v_request.sender_id;
    END IF;

    INSERT INTO public.contact_links AS cl (user_a, user_b)
    VALUES (v_user_a, v_user_b)
    ON CONFLICT ON CONSTRAINT contact_links_unique_pair DO NOTHING;

    UPDATE public.contact_requests AS cr
    SET status = 'accepted'::public.contact_request_status,
        responded_at = now()
    WHERE cr.id = v_request.id;
  ELSE
    UPDATE public.contact_requests AS cr
    SET status = 'declined'::public.contact_request_status,
        responded_at = now()
    WHERE cr.id = v_request.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_contact_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  UPDATE public.contact_requests AS cr
  SET status = 'cancelled'::public.contact_request_status,
      responded_at = now()
  WHERE cr.id = p_request_id
    AND cr.sender_id = auth.uid()
    AND cr.status = 'pending'::public.contact_request_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offene Kontaktanfrage nicht gefunden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_contact(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_a uuid;
  v_user_b uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Ungültiger Kontakt.';
  END IF;

  IF auth.uid()::text < p_user_id::text THEN
    v_user_a := auth.uid();
    v_user_b := p_user_id;
  ELSE
    v_user_a := p_user_id;
    v_user_b := auth.uid();
  END IF;

  DELETE FROM public.contact_links AS cl
  WHERE cl.user_a = v_user_a AND cl.user_b = v_user_b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kontakt nicht gefunden.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_nexus_user(text) FROM public;
REVOKE ALL ON FUNCTION public.get_my_contacts() FROM public;
REVOKE ALL ON FUNCTION public.get_my_contact_requests() FROM public;
REVOKE ALL ON FUNCTION public.send_contact_request(uuid) FROM public;
REVOKE ALL ON FUNCTION public.respond_contact_request(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.cancel_contact_request(uuid) FROM public;
REVOKE ALL ON FUNCTION public.remove_contact(uuid) FROM public;

GRANT EXECUTE ON FUNCTION public.search_nexus_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_contact_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_contact_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_contact_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_contact_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_contact(uuid) TO authenticated;
