-- Personal muting shares the existing account/membership RLS and realtime scope.
ALTER TABLE public.direct_chat_preferences
  ADD COLUMN muted_until timestamptz,
  ADD COLUMN muted_forever boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT direct_chat_mute_valid CHECK (NOT muted_forever OR muted_until IS NULL);
ALTER TABLE public.group_chat_preferences
  ADD COLUMN muted_until timestamptz,
  ADD COLUMN muted_forever boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT group_chat_mute_valid CHECK (NOT muted_forever OR muted_until IS NULL);

CREATE OR REPLACE FUNCTION public.get_chat_organization(p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE='42501'; END IF;
  IF p_kind = 'direct' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT conversation_id AS chat_id, favorite, archived, muted_until, muted_forever
      FROM public.direct_chat_preferences WHERE user_id = (SELECT auth.uid())
    ) r;
  ELSIF p_kind = 'group' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO result FROM (
      SELECT group_id AS chat_id, favorite, archived, muted_until, muted_forever
      FROM public.group_chat_preferences WHERE user_id = (SELECT auth.uid())
    ) r;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.' USING ERRCODE='22023';
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION private.set_chat_mute(p_kind text,p_chat_id uuid,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid := auth.uid(); until_at timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE='42501'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off','1h','8h','forever') THEN
    RAISE EXCEPTION 'Ungültige Stummschaltung.' USING ERRCODE='22023';
  END IF;
  until_at := CASE p_mode WHEN '1h' THEN now()+interval '1 hour' WHEN '8h' THEN now()+interval '8 hours' ELSE NULL END;
  IF p_kind = 'direct' THEN
    PERFORM 1 FROM public.direct_conversations c WHERE c.id=p_chat_id AND uid IN (c.user_a,c.user_b) FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Chat nicht verfügbar.' USING ERRCODE='42501'; END IF;
    INSERT INTO public.direct_chat_preferences AS p(user_id,conversation_id,muted_until,muted_forever)
    VALUES(uid,p_chat_id,until_at,p_mode='forever')
    ON CONFLICT(user_id,conversation_id) DO UPDATE SET muted_until=excluded.muted_until,muted_forever=excluded.muted_forever;
  ELSIF p_kind = 'group' THEN
    PERFORM 1 FROM public.group_conversations c WHERE c.id=p_chat_id AND EXISTS (
      SELECT 1 FROM public.group_members m WHERE m.group_id=c.id AND m.user_id=uid
    ) FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Gruppe nicht verfügbar.' USING ERRCODE='42501'; END IF;
    INSERT INTO public.group_chat_preferences AS p(user_id,group_id,muted_until,muted_forever)
    VALUES(uid,p_chat_id,until_at,p_mode='forever')
    ON CONFLICT(user_id,group_id) DO UPDATE SET muted_until=excluded.muted_until,muted_forever=excluded.muted_forever;
  ELSE RAISE EXCEPTION 'Ungültiger Chat-Typ.' USING ERRCODE='22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.set_chat_mute(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.set_chat_mute(text,uuid,text) TO authenticated;
CREATE FUNCTION public.set_chat_mute(p_kind text,p_chat_id uuid,p_mode text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.set_chat_mute(p_kind,p_chat_id,p_mode);
$$;
REVOKE ALL ON FUNCTION public.set_chat_mute(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_chat_mute(text,uuid,text) TO authenticated;

-- Internal only: callers are existing, recipient-checked metadata/queue functions.
-- Expiry uses the database clock without cron jobs or client-written timestamps.
CREATE FUNCTION private.chat_is_muted(p_user uuid,p_kind text,p_chat uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'direct' THEN EXISTS (SELECT 1 FROM public.direct_chat_preferences p WHERE p.user_id=p_user AND p.conversation_id=p_chat AND (p.muted_forever OR p.muted_until>now()))
    WHEN 'group' THEN EXISTS (SELECT 1 FROM public.group_chat_preferences p WHERE p.user_id=p_user AND p.group_id=p_chat AND (p.muted_forever OR p.muted_until>now()))
    ELSE false END;
$$;
REVOKE ALL ON FUNCTION private.chat_is_muted(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Existing RLS and feed/count/mark-all queries use this recipient-checked resolver.
-- Hidden hints keep their stored read state and reappear when unmuted.
-- prepare_push_delivery also calls it just before sending queued Web Push.
CREATE OR REPLACE FUNCTION private.notification_details(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  n public.notifications%rowtype;
  result jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO n FROM public.notifications WHERE id = p_id AND recipient_id = v_user;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF n.kind = 'direct_message' THEN
    SELECT jsonb_build_object('title', 'Neue Nachricht von ' || coalesce(nullif(p.full_name,''),p.username,'Nexus Nutzer'),
      'detail', 'Direktnachricht', 'chat_id', m.conversation_id)
    INTO result FROM public.direct_messages m
    JOIN public.direct_conversations c ON c.id = m.conversation_id
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.id = n.source_id AND m.deleted_at IS NULL AND v_user IN (c.user_a,c.user_b) AND NOT private.chat_is_muted(v_user,'direct',c.id);
  ELSIF n.kind = 'group_message' THEN
    SELECT jsonb_build_object('title', 'Neue Nachricht in ' || g.name,
      'detail', coalesce(nullif(p.full_name,''),p.username,'Nexus Nutzer'), 'chat_id', m.group_id)
    INTO result FROM public.group_messages m JOIN public.group_conversations g ON g.id = m.group_id
    JOIN public.group_members member ON member.group_id = m.group_id AND member.user_id = v_user
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.id = n.source_id AND m.deleted_at IS NULL AND m.created_at >= member.joined_at AND NOT private.chat_is_muted(v_user,'group',m.group_id);
  ELSIF n.kind = 'contact_request' THEN
    SELECT jsonb_build_object('title', 'Kontaktanfrage von ' || coalesce(nullif(p.full_name,''),p.username,'Nexus Nutzer'),
      'detail', 'Anfrage ansehen und beantworten')
    INTO result FROM public.contact_requests r LEFT JOIN public.profiles p ON p.id = r.sender_id
    WHERE r.id = n.source_id AND r.recipient_id = v_user AND r.status = 'pending';
  ELSIF n.kind = 'workspace_invitation' THEN
    SELECT jsonb_build_object('title', 'Einladung zu ' || w.name, 'detail', 'Workspace-Einladung ansehen', 'invite_token', i.token)
    INTO result FROM public.workspace_invitations i JOIN public.workspaces w ON w.id = i.workspace_id
    JOIN auth.users u ON u.id = v_user AND lower(u.email) = lower(i.email) AND u.email_confirmed_at IS NOT NULL
    WHERE i.id = n.source_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now();
  ELSIF n.kind IN ('task_comment','task_mention') THEN
    SELECT jsonb_build_object(
      'title', CASE WHEN n.kind = 'task_mention' THEN 'Erwähnung bei ' ELSE 'Kommentar zu ' END || t.title,
      'detail', coalesce(nullif(author.full_name,''),author.username,'Nexus Nutzer') || ' · ' || project.title || ' · ' || workspace.name,
      'workspace_id',t.workspace_id,'project_id',t.project_id,'task_id',t.id,'comment_id',comment.id)
    INTO result FROM public.task_comments comment
    JOIN public.project_tasks t ON t.id = comment.task_id AND t.workspace_id = comment.workspace_id
    JOIN public.projects project ON project.id = t.project_id AND project.workspace_id = t.workspace_id
    JOIN public.workspaces workspace ON workspace.id = t.workspace_id
    JOIN public.workspace_members member ON member.workspace_id = t.workspace_id AND member.user_id = v_user
    LEFT JOIN public.profiles author ON author.id = comment.created_by
    WHERE comment.id = n.source_id AND (n.kind = 'task_comment' OR v_user = ANY(comment.mentioned_user_ids));
  ELSE
    SELECT jsonb_build_object('title', t.title, 'detail', p.title || ' · ' || w.name,
      'workspace_id', t.workspace_id, 'project_id', t.project_id, 'task_id', t.id, 'due_date', t.due_date)
    INTO result FROM public.project_tasks t JOIN public.projects p ON p.id = t.project_id
    JOIN public.workspaces w ON w.id = t.workspace_id
    JOIN public.workspace_members member ON member.workspace_id = t.workspace_id AND member.user_id = v_user
    WHERE t.id = n.source_id AND t.assigned_to = v_user AND member.role <> 'guest'
      AND (n.kind = 'task_assigned' OR (t.status <> 'done' AND t.due_date = n.event_date));
  END IF;
  RETURN result;
END $$;


-- Messages received while muted must not queue a later burst of pushes.
CREATE OR REPLACE FUNCTION private.enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind NOT IN ('direct_message','group_message','task_assigned','task_comment','task_mention') THEN RETURN NEW; END IF;
  IF NEW.kind='direct_message' AND EXISTS (SELECT 1 FROM public.direct_messages m WHERE m.id=NEW.source_id AND private.chat_is_muted(NEW.recipient_id,'direct',m.conversation_id)) THEN RETURN NEW; END IF;
  IF NEW.kind='group_message' AND EXISTS (SELECT 1 FROM public.group_messages m WHERE m.id=NEW.source_id AND private.chat_is_muted(NEW.recipient_id,'group',m.group_id)) THEN RETURN NEW; END IF;
  INSERT INTO private.push_deliveries(subscription_id,notification_id)
  SELECT s.id,NEW.id FROM private.push_subscriptions s JOIN auth.sessions a ON a.id=s.session_id
  LEFT JOIN public.notification_preferences p ON p.user_id=s.user_id
  WHERE s.user_id=NEW.recipient_id AND (a.not_after IS NULL OR a.not_after>now()) AND CASE
    WHEN NEW.kind IN ('direct_message','group_message') THEN s.messages AND coalesce(p.messages,true)
    WHEN NEW.kind='task_assigned' THEN s.assignments AND coalesce(p.assignments,true)
    ELSE s.comments AND coalesce(p.comments,true) END
  ON CONFLICT DO NOTHING;
  IF FOUND THEN PERFORM private.wake_push_worker(); END IF;
  RETURN NEW;
END $$;

