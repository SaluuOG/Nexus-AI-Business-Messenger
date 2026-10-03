-- One reaction per person/message. Clearing keeps an empty row so that Realtime
-- delivers an authorized UPDATE (unfiltered DELETE events expose identifiers).
-- Both RPCs use SECURITY INVOKER: RLS also protects direct Data API requests.

CREATE TABLE public.direct_message_reactions (
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK (emoji IS NULL OR emoji IN ('❤️','👍','😂','😮','😢','🙏')),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX direct_message_reactions_scope_idx ON public.direct_message_reactions (conversation_id, message_id);
CREATE INDEX direct_message_reactions_user_idx ON public.direct_message_reactions (user_id);
ALTER TABLE public.direct_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY direct_message_reactions_read ON public.direct_message_reactions
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.direct_messages m
    WHERE m.id = direct_message_reactions.message_id AND m.conversation_id = direct_message_reactions.conversation_id AND m.deleted_at IS NULL));
CREATE POLICY direct_message_reactions_insert ON public.direct_message_reactions
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.direct_messages m
    WHERE m.id = direct_message_reactions.message_id AND m.conversation_id = direct_message_reactions.conversation_id AND m.deleted_at IS NULL));
CREATE POLICY direct_message_reactions_update ON public.direct_message_reactions
FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.direct_messages m
    WHERE m.id = direct_message_reactions.message_id AND m.conversation_id = direct_message_reactions.conversation_id AND m.deleted_at IS NULL))
WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.direct_messages m
    WHERE m.id = direct_message_reactions.message_id AND m.conversation_id = direct_message_reactions.conversation_id AND m.deleted_at IS NULL));

REVOKE ALL ON public.direct_message_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.direct_message_reactions TO authenticated;
GRANT INSERT (message_id, conversation_id, user_id, emoji) ON public.direct_message_reactions TO authenticated;
-- IDs and ownership cannot be reassigned, even through the REST API.
GRANT UPDATE (emoji) ON public.direct_message_reactions TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_reactions;

CREATE TABLE public.group_message_reactions (
  message_id uuid NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK (emoji IS NULL OR emoji IN ('❤️','👍','😂','😮','😢','🙏')),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX group_message_reactions_scope_idx ON public.group_message_reactions (group_id, message_id);
CREATE INDEX group_message_reactions_user_idx ON public.group_message_reactions (user_id);
ALTER TABLE public.group_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_message_reactions_read ON public.group_message_reactions
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_messages m
    WHERE m.id = group_message_reactions.message_id AND m.group_id = group_message_reactions.group_id AND m.deleted_at IS NULL));
CREATE POLICY group_message_reactions_insert ON public.group_message_reactions
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.group_messages m
    WHERE m.id = group_message_reactions.message_id AND m.group_id = group_message_reactions.group_id AND m.deleted_at IS NULL));
CREATE POLICY group_message_reactions_update ON public.group_message_reactions
FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.group_messages m
    WHERE m.id = group_message_reactions.message_id AND m.group_id = group_message_reactions.group_id AND m.deleted_at IS NULL))
WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.group_messages m
    WHERE m.id = group_message_reactions.message_id AND m.group_id = group_message_reactions.group_id AND m.deleted_at IS NULL));

REVOKE ALL ON public.group_message_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.group_message_reactions TO authenticated;
GRANT INSERT (message_id, group_id, user_id, emoji) ON public.group_message_reactions TO authenticated;
-- IDs and ownership cannot be reassigned, even through the REST API.
GRANT UPDATE (emoji) ON public.group_message_reactions TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_reactions;

CREATE FUNCTION public.set_message_reaction(p_kind text, p_chat_id uuid, p_message_id uuid, p_emoji text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_emoji IS NOT NULL AND p_emoji NOT IN ('❤️','👍','😂','😮','😢','🙏') THEN
    RAISE EXCEPTION 'Ungültige Reaktion.';
  END IF;
  IF p_kind = 'direct' THEN
    IF NOT EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = p_message_id AND m.conversation_id = p_chat_id AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Nachricht nicht verfügbar oder kein Zugriff.';
    END IF;
    INSERT INTO public.direct_message_reactions (message_id, conversation_id, user_id, emoji)
    VALUES (p_message_id, p_chat_id, auth.uid(), p_emoji)
    ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji;
  ELSIF p_kind = 'group' THEN
    IF NOT EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = p_message_id AND m.group_id = p_chat_id AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Nachricht nicht verfügbar oder kein Zugriff.';
    END IF;
    INSERT INTO public.group_message_reactions (message_id, group_id, user_id, emoji)
    VALUES (p_message_id, p_chat_id, auth.uid(), p_emoji)
    ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.';
  END IF;
END;
$$;

CREATE FUNCTION public.get_message_reactions(p_kind text, p_chat_id uuid, p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) > 500 THEN
    RAISE EXCEPTION 'Ungültige Nachrichtenauswahl.';
  END IF;
  IF p_kind = 'direct' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT message_id, emoji, count(*)::integer AS count, bool_or(user_id = (SELECT auth.uid())) AS mine
      FROM public.direct_message_reactions
      WHERE conversation_id = p_chat_id AND message_id = ANY(p_message_ids) AND emoji IS NOT NULL
      GROUP BY message_id, emoji ORDER BY message_id, emoji
    ) r;
  ELSIF p_kind = 'group' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT message_id, emoji, count(*)::integer AS count, bool_or(user_id = (SELECT auth.uid())) AS mine
      FROM public.group_message_reactions
      WHERE group_id = p_chat_id AND message_id = ANY(p_message_ids) AND emoji IS NOT NULL
      GROUP BY message_id, emoji ORDER BY message_id, emoji
    ) r;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_message_reaction(text, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_message_reactions(text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_message_reaction(text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_message_reactions(text, uuid, uuid[]) TO authenticated;
