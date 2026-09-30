-- Shared chat pins. Removal is an authorized UPDATE, never an unfiltered
-- Realtime DELETE. Random replica identity does not expose message/chat IDs.

CREATE TABLE public.direct_message_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direct_message_pins_scope_idx ON public.direct_message_pins (conversation_id, created_at DESC);
ALTER TABLE public.direct_message_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_pins_read ON public.direct_message_pins FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_pins.message_id AND m.conversation_id = direct_message_pins.conversation_id AND m.deleted_at IS NULL));
CREATE POLICY direct_pins_insert ON public.direct_message_pins FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_pins.message_id AND m.conversation_id = direct_message_pins.conversation_id AND m.deleted_at IS NULL));
CREATE POLICY direct_pins_update ON public.direct_message_pins FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_pins.message_id AND m.conversation_id = direct_message_pins.conversation_id AND m.deleted_at IS NULL)) WITH CHECK (EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = direct_message_pins.message_id AND m.conversation_id = direct_message_pins.conversation_id AND m.deleted_at IS NULL));
REVOKE ALL ON public.direct_message_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.direct_message_pins TO authenticated;
GRANT INSERT (message_id, conversation_id, pinned) ON public.direct_message_pins TO authenticated;
GRANT UPDATE (pinned) ON public.direct_message_pins TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_message_pins;

CREATE TABLE public.group_message_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE REFERENCES public.group_messages(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_message_pins_scope_idx ON public.group_message_pins (group_id, created_at DESC);
ALTER TABLE public.group_message_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_pins_read ON public.group_message_pins FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = group_message_pins.message_id AND m.group_id = group_message_pins.group_id AND m.deleted_at IS NULL));
CREATE POLICY group_pins_insert ON public.group_message_pins FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = group_message_pins.message_id AND m.group_id = group_message_pins.group_id AND m.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_message_pins.group_id AND gm.user_id = (SELECT auth.uid()) AND gm.role IN ('owner','admin')));
CREATE POLICY group_pins_update ON public.group_message_pins FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = group_message_pins.message_id AND m.group_id = group_message_pins.group_id AND m.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_message_pins.group_id AND gm.user_id = (SELECT auth.uid()) AND gm.role IN ('owner','admin'))) WITH CHECK (EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = group_message_pins.message_id AND m.group_id = group_message_pins.group_id AND m.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_message_pins.group_id AND gm.user_id = (SELECT auth.uid()) AND gm.role IN ('owner','admin')));
REVOKE ALL ON public.group_message_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.group_message_pins TO authenticated;
GRANT INSERT (message_id, group_id, pinned) ON public.group_message_pins TO authenticated;
GRANT UPDATE (pinned) ON public.group_message_pins TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_pins;

CREATE FUNCTION public.set_message_pin(p_kind text, p_chat_id uuid, p_message_id uuid, p_pinned boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_pinned IS NULL THEN RAISE EXCEPTION 'Ungültige Anheftung.'; END IF;
  IF p_kind = 'direct' THEN
    IF NOT EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id = p_message_id AND m.conversation_id = p_chat_id AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Nachricht nicht verfügbar oder kein Zugriff.';
    END IF;
    INSERT INTO public.direct_message_pins(message_id, conversation_id, pinned) VALUES (p_message_id,p_chat_id,p_pinned)
      ON CONFLICT (message_id) DO UPDATE SET pinned = EXCLUDED.pinned;
  ELSIF p_kind = 'group' THEN
    IF NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = p_chat_id AND gm.user_id = (SELECT auth.uid()) AND gm.role IN ('owner','admin')) THEN
      RAISE EXCEPTION 'Nur Owner und Admins dürfen Nachrichten anheften oder lösen.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id = p_message_id AND m.group_id = p_chat_id AND m.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Nachricht nicht verfügbar oder kein Zugriff.';
    END IF;
    INSERT INTO public.group_message_pins(message_id, group_id, pinned) VALUES (p_message_id,p_chat_id,p_pinned)
      ON CONFLICT (message_id) DO UPDATE SET pinned = EXCLUDED.pinned;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.';
  END IF;
END;
$$;

CREATE FUNCTION public.get_message_pins(p_kind text, p_chat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_kind = 'direct' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT m.id AS message_id, m.conversation_id AS chat_id, left(m.body,160) AS preview, p.created_at
      FROM public.direct_message_pins p JOIN public.direct_messages m ON m.id = p.message_id AND m.conversation_id = p.conversation_id
      WHERE p.conversation_id = p_chat_id AND p.pinned AND m.deleted_at IS NULL ORDER BY p.created_at DESC, m.id
    ) r;
  ELSIF p_kind = 'group' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT m.id AS message_id, m.group_id AS chat_id, left(m.body,160) AS preview, p.created_at
      FROM public.group_message_pins p JOIN public.group_messages m ON m.id = p.message_id AND m.group_id = p.group_id
      WHERE p.group_id = p_chat_id AND p.pinned AND m.deleted_at IS NULL ORDER BY p.created_at DESC, m.id
    ) r;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_message_pin(text,uuid,uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_message_pins(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_message_pin(text,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_message_pins(text,uuid) TO authenticated;
