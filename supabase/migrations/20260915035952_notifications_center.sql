-- Phase 3.5: account-scoped in-app notifications. No message bodies are copied.
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT true,
  contacts boolean NOT NULL DEFAULT true,
  invitations boolean NOT NULL DEFAULT true,
  assignments boolean NOT NULL DEFAULT true,
  deadlines boolean NOT NULL DEFAULT true
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE public.notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('direct_message','group_message','contact_request','workspace_invitation','task_assigned','task_due','task_overdue')),
  source_id uuid NOT NULL,
  event_key text NOT NULL,
  event_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (recipient_id, event_key)
);
CREATE INDEX notifications_recipient_order_idx ON public.notifications(recipient_id, id DESC);
CREATE INDEX notifications_recipient_unread_idx ON public.notifications(recipient_id, id DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_source_idx ON public.notifications(source_id);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- This non-exposed function is the sole metadata resolver. It always binds the
-- recipient to auth.uid() and checks current source access before returning data.
CREATE FUNCTION private.notification_details(p_id bigint)
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
    WHERE m.id = n.source_id AND m.deleted_at IS NULL AND v_user IN (c.user_a,c.user_b);
  ELSIF n.kind = 'group_message' THEN
    SELECT jsonb_build_object('title', 'Neue Nachricht in ' || g.name,
      'detail', coalesce(nullif(p.full_name,''),p.username,'Nexus Nutzer'), 'chat_id', m.group_id)
    INTO result FROM public.group_messages m JOIN public.group_conversations g ON g.id = m.group_id
    JOIN public.group_members member ON member.group_id = m.group_id AND member.user_id = v_user
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.id = n.source_id AND m.deleted_at IS NULL AND m.created_at >= member.joined_at;
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
REVOKE ALL ON FUNCTION private.notification_details(bigint) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.notification_details(bigint) TO authenticated;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth.uid()) AND private.notification_details(id) IS NOT NULL);
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = (SELECT auth.uid()) AND private.notification_details(id) IS NOT NULL)
  WITH CHECK (recipient_id = (SELECT auth.uid()) AND private.notification_details(id) IS NOT NULL);

CREATE FUNCTION private.capture_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := (SELECT auth.uid());
BEGIN
  -- Only trusted source writes can invoke this trigger; it is not a client RPC.
  IF v_user IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'direct_messages' THEN
    INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
    SELECT CASE WHEN c.user_a = NEW.sender_id THEN c.user_b ELSE c.user_a END,
      'direct_message', NEW.id, 'direct:' || NEW.id, NEW.created_at
    FROM public.direct_conversations c WHERE c.id = NEW.conversation_id
    ON CONFLICT (recipient_id,event_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'group_messages' THEN
    INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
    SELECT m.user_id, 'group_message', NEW.id, 'group:' || NEW.id, NEW.created_at
    FROM public.group_members m WHERE m.group_id = NEW.group_id AND m.user_id <> NEW.sender_id AND m.joined_at <= NEW.created_at
    ON CONFLICT (recipient_id,event_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'contact_requests' THEN
    INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
    VALUES (NEW.recipient_id,'contact_request',NEW.id,'contact:' || NEW.id,NEW.created_at)
    ON CONFLICT (recipient_id,event_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'workspace_invitations' THEN
    INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
    SELECT u.id,'workspace_invitation',NEW.id,'invite:' || NEW.id,NEW.created_at
    FROM auth.users u WHERE lower(u.email) = lower(NEW.email) AND u.email_confirmed_at IS NOT NULL AND u.id <> NEW.invited_by
    ON CONFLICT (recipient_id,event_key) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'project_tasks' THEN
    IF TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      -- Reassignment retires the former assignee's event, including read state.
      DELETE FROM public.notifications WHERE source_id = NEW.id AND kind = 'task_assigned';
      IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> v_user THEN
        INSERT INTO public.notifications(recipient_id,kind,source_id,event_key)
        VALUES (NEW.assigned_to,'task_assigned',NEW.id,'assigned:' || NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.capture_notification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notify_direct_message AFTER INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION private.capture_notification();
CREATE TRIGGER notify_group_message AFTER INSERT ON public.group_messages FOR EACH ROW EXECUTE FUNCTION private.capture_notification();
CREATE TRIGGER notify_contact_request AFTER INSERT ON public.contact_requests FOR EACH ROW EXECUTE FUNCTION private.capture_notification();
CREATE TRIGGER notify_workspace_invitation AFTER INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION private.capture_notification();
CREATE TRIGGER notify_task_assignment AFTER INSERT OR UPDATE OF assigned_to ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.capture_notification();

CREATE FUNCTION private.clean_notification_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Physical source deletion also removes the metadata; no payload is retained.
  DELETE FROM public.notifications WHERE source_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.clean_notification_source() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clean_direct_notifications AFTER DELETE ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();
CREATE TRIGGER clean_group_notifications AFTER DELETE ON public.group_messages FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();
CREATE TRIGGER clean_contact_notifications AFTER DELETE ON public.contact_requests FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();
CREATE TRIGGER clean_invite_notifications AFTER DELETE ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();
CREATE TRIGGER clean_task_notifications AFTER DELETE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();

CREATE FUNCTION private.read_chat_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NEW.user_id <> (SELECT auth.uid()) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'direct_conversation_reads' THEN
    UPDATE public.notifications n SET read_at = now() FROM public.direct_messages m
    WHERE n.recipient_id = NEW.user_id AND n.kind = 'direct_message' AND n.source_id = m.id
      AND m.conversation_id = NEW.conversation_id AND m.created_at <= NEW.last_read_at AND n.read_at IS NULL;
  ELSE
    UPDATE public.notifications n SET read_at = now() FROM public.group_messages m
    WHERE n.recipient_id = NEW.user_id AND n.kind = 'group_message' AND n.source_id = m.id
      AND m.group_id = NEW.group_id AND m.created_at <= NEW.last_read_at AND n.read_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.read_chat_notifications() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER read_direct_notifications AFTER INSERT OR UPDATE ON public.direct_conversation_reads FOR EACH ROW EXECUTE FUNCTION private.read_chat_notifications();
CREATE TRIGGER read_group_notifications AFTER INSERT OR UPDATE ON public.group_reads FOR EACH ROW EXECUTE FUNCTION private.read_chat_notifications();

-- Calendar hints are generated only while the app requests them, using a
-- validated IANA timezone. A deadline produces one today and one overdue event.
CREATE FUNCTION private.sync_my_notifications(p_timezone text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := (SELECT auth.uid()); v_today date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Ungültige Zeitzone.';
  END IF;
  v_today := (now() AT TIME ZONE p_timezone)::date;
  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,event_date)
  SELECT v_user,CASE WHEN t.due_date = v_today THEN 'task_due' ELSE 'task_overdue' END,t.id,
    'deadline:' || t.id || ':' || t.due_date || ':' || CASE WHEN t.due_date = v_today THEN 'today' ELSE 'overdue' END,t.due_date
  FROM public.project_tasks t JOIN public.workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = v_user
  WHERE t.assigned_to = v_user AND m.role <> 'guest' AND t.status <> 'done' AND t.due_date <= v_today
  ON CONFLICT (recipient_id,event_key) DO NOTHING;
  -- Pending requests/invites are also found when the recipient registers later.
  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
  SELECT v_user,'contact_request',r.id,'contact:' || r.id,r.created_at FROM public.contact_requests r
  WHERE r.recipient_id = v_user AND r.status = 'pending'
  ON CONFLICT (recipient_id,event_key) DO NOTHING;
  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
  SELECT v_user,'workspace_invitation',i.id,'invite:' || i.id,i.created_at
  FROM public.workspace_invitations i JOIN auth.users u ON u.id = v_user AND lower(u.email) = lower(i.email) AND u.email_confirmed_at IS NOT NULL
  WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND i.invited_by <> v_user
  ON CONFLICT (recipient_id,event_key) DO NOTHING;
  RETURN v_today;
END $$;
REVOKE ALL ON FUNCTION private.sync_my_notifications(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_my_notifications(text) TO authenticated;
CREATE INDEX project_tasks_person_deadline_idx ON public.project_tasks(assigned_to,due_date) WHERE assigned_to IS NOT NULL AND status <> 'done';
CREATE INDEX workspace_invitations_recipient_idx ON public.workspace_invitations(lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION public.get_my_notifications(p_timezone text DEFAULT 'UTC', p_before bigint DEFAULT NULL, p_limit integer DEFAULT 25, p_unread_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_today date; v_preferences jsonb; v_result jsonb;
BEGIN
  v_today := private.sync_my_notifications(p_timezone);
  SELECT to_jsonb(p) - 'user_id' INTO v_preferences FROM public.notification_preferences p WHERE p.user_id = (SELECT auth.uid());
  v_preferences := coalesce(v_preferences,'{"messages":true,"contacts":true,"invitations":true,"assignments":true,"deadlines":true}'::jsonb);
  WITH visible AS MATERIALIZED (
    SELECT n.*,private.notification_details(n.id) AS details FROM public.notifications n
    WHERE n.recipient_id = (SELECT auth.uid())
      AND coalesce((v_preferences->>CASE n.kind WHEN 'direct_message' THEN 'messages' WHEN 'group_message' THEN 'messages'
        WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments' ELSE 'deadlines' END)::boolean,true)
      AND (n.kind <> 'task_due' OR n.event_date = v_today)
      AND (n.kind <> 'task_overdue' OR n.event_date < v_today)
  ), page AS (
    SELECT * FROM visible WHERE (p_before IS NULL OR id < p_before) AND (NOT p_unread_only OR read_at IS NULL)
    ORDER BY id DESC LIMIT greatest(1,least(coalesce(p_limit,25),100))
  ) SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'kind',kind,'created_at',created_at,'read_at',read_at,'details',details) ORDER BY id DESC) FROM page),'[]'::jsonb),
    'unread_count',(SELECT count(*) FROM visible WHERE read_at IS NULL),
    'total_count',(SELECT count(*) FROM visible WHERE NOT p_unread_only OR read_at IS NULL),
    'through_id',coalesce((SELECT max(id)::text FROM visible),'0'),
    'has_more',EXISTS(SELECT 1 FROM visible WHERE id < (SELECT min(id) FROM page) AND (NOT p_unread_only OR read_at IS NULL)),
    'preferences',v_preferences
  ) INTO v_result;
  RETURN v_result;
END $$;

-- Mark only the server snapshot the user actually saw. Events arriving during
-- the request keep their unread state. Chat read receipts remain independent.
CREATE FUNCTION public.mark_notifications_read(p_through bigint, p_id bigint DEFAULT NULL, p_timezone text DEFAULT 'UTC')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_today date; v_preferences jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN RAISE EXCEPTION 'Ungültige Zeitzone.'; END IF;
  v_today := (now() AT TIME ZONE p_timezone)::date;
  SELECT to_jsonb(p) - 'user_id' INTO v_preferences FROM public.notification_preferences p WHERE p.user_id = (SELECT auth.uid());
  UPDATE public.notifications n SET read_at = now()
  WHERE n.recipient_id = (SELECT auth.uid()) AND n.read_at IS NULL AND n.id <= p_through AND (p_id IS NULL OR n.id = p_id)
    AND coalesce((v_preferences->>CASE n.kind WHEN 'direct_message' THEN 'messages' WHEN 'group_message' THEN 'messages'
      WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments' ELSE 'deadlines' END)::boolean,true)
    AND (n.kind <> 'task_due' OR n.event_date = v_today) AND (n.kind <> 'task_overdue' OR n.event_date < v_today);
END $$;

CREATE FUNCTION public.set_notification_preference(p_category text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('messages','contacts','invitations','assignments','deadlines') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Ungültige Benachrichtigungseinstellung.';
  END IF;
  INSERT INTO public.notification_preferences(user_id) VALUES ((SELECT auth.uid())) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.notification_preferences SET
    messages = CASE WHEN p_category = 'messages' THEN p_enabled ELSE messages END,
    contacts = CASE WHEN p_category = 'contacts' THEN p_enabled ELSE contacts END,
    invitations = CASE WHEN p_category = 'invitations' THEN p_enabled ELSE invitations END,
    assignments = CASE WHEN p_category = 'assignments' THEN p_enabled ELSE assignments END,
    deadlines = CASE WHEN p_category = 'deadlines' THEN p_enabled ELSE deadlines END
  WHERE user_id = (SELECT auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.get_my_notifications(text,bigint,integer,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notifications_read(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_notification_preference(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(text,bigint,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(bigint,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_notification_preference(text,boolean) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications, public.notification_preferences;
