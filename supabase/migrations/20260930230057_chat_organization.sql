-- Personal list organization. No message content is copied or removed.
CREATE TABLE public.direct_chat_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  favorite boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, conversation_id)
);
CREATE INDEX direct_chat_preferences_chat_idx ON public.direct_chat_preferences(conversation_id);
ALTER TABLE public.direct_chat_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_chat_preferences_read ON public.direct_chat_preferences FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.direct_conversations c WHERE c.id = conversation_id AND (SELECT auth.uid()) IN (c.user_a,c.user_b)
));
REVOKE ALL ON public.direct_chat_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.direct_chat_preferences TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_chat_preferences;

CREATE TABLE public.group_chat_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  group_id uuid NOT NULL,
  favorite boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, group_id),
  FOREIGN KEY (group_id, user_id) REFERENCES public.group_members(group_id,user_id) ON DELETE CASCADE
);
CREATE INDEX group_chat_preferences_chat_idx ON public.group_chat_preferences(group_id,user_id);
ALTER TABLE public.group_chat_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_chat_preferences_read ON public.group_chat_preferences FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.group_members m WHERE m.group_id = group_chat_preferences.group_id AND m.user_id = (SELECT auth.uid())
));
REVOKE ALL ON public.group_chat_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.group_chat_preferences TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_preferences;

CREATE FUNCTION public.get_chat_organization(p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE='42501'; END IF;
  IF p_kind = 'direct' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT conversation_id AS chat_id, favorite, archived FROM public.direct_chat_preferences WHERE user_id = (SELECT auth.uid())
    ) r;
  ELSIF p_kind = 'group' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT group_id AS chat_id, favorite, archived FROM public.group_chat_preferences WHERE user_id = (SELECT auth.uid())
    ) r;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.' USING ERRCODE='22023';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_chat_organization(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_chat_organization(text) TO authenticated;

-- Private elevated writer is needed to serialize archive requests with incoming
-- messages on the parent row. Clients get no direct table write privileges.
-- Lock order is parent -> preference. NO KEY UPDATE remains compatible with FK
-- KEY SHARE locks from concurrent message inserts (avoids lock-upgrade deadlocks).
CREATE FUNCTION private.set_chat_organization(p_kind text,p_chat_id uuid,p_field text,p_value boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE='42501'; END IF;
  IF p_value IS NULL OR p_field IS NULL OR p_field NOT IN ('favorite','archived') THEN
    RAISE EXCEPTION 'Ungültige Chat-Einstellung.' USING ERRCODE='22023';
  END IF;
  IF p_kind = 'direct' THEN
    PERFORM 1 FROM public.direct_conversations c WHERE c.id=p_chat_id AND uid IN (c.user_a,c.user_b) FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chat nicht verfügbar.' USING ERRCODE='42501'; END IF;
    INSERT INTO public.direct_chat_preferences AS p(user_id,conversation_id,favorite,archived)
    VALUES(uid,p_chat_id,p_field='favorite' AND p_value,p_field='archived' AND p_value)
    ON CONFLICT(user_id,conversation_id) DO UPDATE SET
      favorite=CASE WHEN p_field='favorite' THEN p_value ELSE p.favorite END,
      archived=CASE WHEN p_field='archived' THEN p_value ELSE p.archived END;
  ELSIF p_kind = 'group' THEN
    PERFORM 1 FROM public.group_conversations c WHERE c.id=p_chat_id AND EXISTS (
      SELECT 1 FROM public.group_members m WHERE m.group_id=c.id AND m.user_id=uid
    ) FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Gruppe nicht verfügbar.' USING ERRCODE='42501'; END IF;
    INSERT INTO public.group_chat_preferences AS p(user_id,group_id,favorite,archived)
    VALUES(uid,p_chat_id,p_field='favorite' AND p_value,p_field='archived' AND p_value)
    ON CONFLICT(user_id,group_id) DO UPDATE SET
      favorite=CASE WHEN p_field='favorite' THEN p_value ELSE p.favorite END,
      archived=CASE WHEN p_field='archived' THEN p_value ELSE p.archived END;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.' USING ERRCODE='22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.set_chat_organization(text,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.set_chat_organization(text,uuid,text,boolean) TO authenticated;
CREATE FUNCTION public.set_chat_organization(p_kind text,p_chat_id uuid,p_field text,p_value boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.set_chat_organization(p_kind,p_chat_id,p_field,p_value);
$$;
REVOKE ALL ON FUNCTION public.set_chat_organization(text,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_chat_organization(text,uuid,text,boolean) TO authenticated;

-- Only genuine new messages revive an archive. Edits, reactions, read receipts,
-- soft deletes and idempotent send retries do not invoke an AFTER INSERT trigger.
-- Random primary keys keep physical DELETE replica identities free of user/chat IDs.
CREATE FUNCTION private.unarchive_chat_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'public' THEN RAISE EXCEPTION 'Invalid trigger'; END IF;
  IF TG_TABLE_NAME='direct_messages' THEN
    PERFORM 1 FROM public.direct_conversations WHERE id=NEW.conversation_id FOR NO KEY UPDATE;
    UPDATE public.direct_chat_preferences SET archived=false WHERE conversation_id=NEW.conversation_id AND archived;
  ELSIF TG_TABLE_NAME='group_messages' THEN
    PERFORM 1 FROM public.group_conversations WHERE id=NEW.group_id FOR NO KEY UPDATE;
    UPDATE public.group_chat_preferences SET archived=false WHERE group_id=NEW.group_id AND archived;
  ELSE RAISE EXCEPTION 'Invalid trigger';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.unarchive_chat_on_message() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER unarchive_direct_on_message AFTER INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION private.unarchive_chat_on_message();
CREATE TRIGGER unarchive_group_on_message AFTER INSERT ON public.group_messages FOR EACH ROW EXECUTE FUNCTION private.unarchive_chat_on_message();
