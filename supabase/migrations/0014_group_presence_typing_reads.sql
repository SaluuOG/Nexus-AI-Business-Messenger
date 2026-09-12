-- Phase 2.5D: group presence, typing and read-state polish

CREATE TABLE IF NOT EXISTS public.group_typing (
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE public.group_typing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_typing REPLICA IDENTITY FULL;
ALTER TABLE public.group_reads REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS group_typing_select_member ON public.group_typing;
CREATE POLICY group_typing_select_member
ON public.group_typing
FOR SELECT TO authenticated
USING (public.is_group_member(group_id));

REVOKE ALL ON public.group_typing FROM anon, authenticated;
GRANT SELECT ON public.group_typing TO authenticated;

CREATE OR REPLACE FUNCTION public.set_group_typing(
  p_group_id uuid,
  p_is_typing boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'Gruppe nicht gefunden oder kein Zugriff.';
  END IF;

  IF p_is_typing THEN
    INSERT INTO public.group_typing AS gt (group_id, user_id, updated_at)
    VALUES (p_group_id, auth.uid(), now())
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET updated_at = excluded.updated_at;
  ELSE
    DELETE FROM public.group_typing
    WHERE group_id = p_group_id
      AND user_id = auth.uid();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_group_activity(p_group_id uuid)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  username text,
  last_seen_at timestamptz,
  online boolean,
  typing boolean
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
  SELECT
    gm.user_id,
    p.full_name,
    p.username,
    up.last_seen_at,
    (up.last_seen_at IS NOT NULL AND up.last_seen_at > now() - interval '75 seconds') AS online,
    EXISTS (
      SELECT 1
      FROM public.group_typing gt
      WHERE gt.group_id = p_group_id
        AND gt.user_id = gm.user_id
        AND gt.user_id <> auth.uid()
        AND gt.updated_at > now() - interval '6 seconds'
    ) AS typing
  FROM public.group_members gm
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  LEFT JOIN public.user_presence up ON up.user_id = gm.user_id
  WHERE gm.group_id = p_group_id
  ORDER BY coalesce(p.full_name, p.username, gm.user_id::text);
END;
$$;

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
  attachments jsonb,
  read_count bigint,
  recipient_count bigint
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
      ), '[]'::jsonb),
      (
        SELECT count(*)
        FROM public.group_reads gr
        JOIN public.group_members gm_read
          ON gm_read.group_id = gr.group_id
         AND gm_read.user_id = gr.user_id
        WHERE gr.group_id = m.group_id
          AND gr.user_id <> m.sender_id
          AND gm_read.joined_at <= m.created_at
          AND gr.last_read_at >= m.created_at
      ) AS read_count,
      (
        SELECT count(*)
        FROM public.group_members gm_target
        WHERE gm_target.group_id = m.group_id
          AND gm_target.user_id <> m.sender_id
          AND gm_target.joined_at <= m.created_at
      ) AS recipient_count
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

REVOKE ALL ON FUNCTION public.set_group_typing(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.get_group_activity(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_group_messages(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.set_group_typing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_activity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_messages(uuid, integer) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_typing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_typing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'group_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_reads;
  END IF;
END
$$;
