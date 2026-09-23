-- Phase 3.9: stable, account-bound @mentions in task comments.
-- The readable token stays in the comment body; immutable user IDs determine
-- the recipients so duplicate names and later profile changes stay safe.
ALTER TABLE public.task_comments
  ADD COLUMN mentioned_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_mention_limit CHECK (cardinality(mentioned_user_ids) <= 20);
GRANT INSERT (mentioned_user_ids) ON public.task_comments TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_task_collaboration()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_changed boolean;
  v_mentions uuid[] := '{}'::uuid[];
BEGIN
  IF TG_TABLE_NAME = 'task_comments' THEN
    NEW.body := btrim(NEW.body);
  ELSE
    NEW.label := btrim(NEW.label);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    IF NEW.created_by IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
    IF TG_TABLE_NAME = 'task_comments' THEN
      IF cardinality(coalesce(NEW.mentioned_user_ids, '{}'::uuid[])) > 20 OR EXISTS (
        SELECT 1 FROM unnest(coalesce(NEW.mentioned_user_ids, '{}'::uuid[])) AS selected(user_id) WHERE selected.user_id IS NULL
      ) THEN RAISE EXCEPTION 'Invalid task mentions' USING ERRCODE = '23514'; END IF;
      SELECT coalesce(array_agg(selected.user_id ORDER BY selected.user_id), '{}'::uuid[]) INTO v_mentions
      FROM (SELECT DISTINCT user_id FROM unnest(coalesce(NEW.mentioned_user_ids, '{}'::uuid[])) AS requested(user_id)) selected;
      IF NEW.created_by = ANY(v_mentions) THEN RAISE EXCEPTION 'Self mentions are not allowed' USING ERRCODE = '23514'; END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(v_mentions) AS selected(user_id)
        LEFT JOIN public.workspace_members member ON member.workspace_id = NEW.workspace_id AND member.user_id = selected.user_id
        WHERE member.user_id IS NULL
      ) THEN RAISE EXCEPTION 'Mentioned user has no task access' USING ERRCODE = '42501'; END IF;
      NEW.mentioned_user_ids := v_mentions;
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    NEW.revision := 1;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'Task collaboration scope is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'task_comments' THEN
      IF NEW.mentioned_user_ids IS DISTINCT FROM OLD.mentioned_user_ids THEN
        RAISE EXCEPTION 'Task mentions are immutable' USING ERRCODE = '23514';
      END IF;
      v_changed := NEW.body IS DISTINCT FROM OLD.body;
    ELSE
      v_changed := NEW.label IS DISTINCT FROM OLD.label OR NEW.is_completed IS DISTINCT FROM OLD.is_completed;
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := CASE WHEN v_changed THEN clock_timestamp() ELSE OLD.updated_at END;
    NEW.revision := OLD.revision + CASE WHEN v_changed THEN 1 ELSE 0 END;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('direct_message','group_message','contact_request','workspace_invitation','task_assigned','task_due','task_overdue','task_comment','task_mention'));

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

CREATE OR REPLACE FUNCTION public.get_my_notifications(p_timezone text DEFAULT 'UTC', p_before bigint DEFAULT NULL, p_limit integer DEFAULT 25, p_unread_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_today date; v_preferences jsonb; v_result jsonb;
BEGIN
  v_today := private.sync_my_notifications(p_timezone);
  SELECT to_jsonb(p) - 'user_id' INTO v_preferences FROM public.notification_preferences p WHERE p.user_id = (SELECT auth.uid());
  v_preferences := coalesce(v_preferences,'{"messages":true,"contacts":true,"invitations":true,"assignments":true,"deadlines":true,"comments":true}'::jsonb);
  WITH visible AS MATERIALIZED (
    SELECT n.*,private.notification_details(n.id) AS details FROM public.notifications n
    WHERE n.recipient_id = (SELECT auth.uid())
      AND coalesce((v_preferences->>CASE n.kind WHEN 'direct_message' THEN 'messages' WHEN 'group_message' THEN 'messages'
        WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments'
        WHEN 'task_comment' THEN 'comments' WHEN 'task_mention' THEN 'comments' ELSE 'deadlines' END)::boolean,true)
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

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_through bigint, p_id bigint DEFAULT NULL, p_timezone text DEFAULT 'UTC')
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
      WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments'
      WHEN 'task_comment' THEN 'comments' WHEN 'task_mention' THEN 'comments' ELSE 'deadlines' END)::boolean,true)
    AND (n.kind <> 'task_due' OR n.event_date = v_today) AND (n.kind <> 'task_overdue' OR n.event_date < v_today);
END $$;

CREATE OR REPLACE FUNCTION private.capture_task_comment_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
  SELECT member.user_id,'task_mention',NEW.id,'mention:' || NEW.id,NEW.created_at
  FROM unnest(NEW.mentioned_user_ids) AS selected(user_id)
  JOIN public.workspace_members member ON member.workspace_id=NEW.workspace_id AND member.user_id=selected.user_id
  WHERE member.user_id<>NEW.created_by
  ON CONFLICT (recipient_id,event_key) DO NOTHING;

  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
  SELECT DISTINCT member.user_id,'task_comment',NEW.id,'comment:' || NEW.id,NEW.created_at
  FROM public.project_tasks task JOIN public.workspace_members member ON member.workspace_id=task.workspace_id
  WHERE task.id=NEW.task_id AND member.user_id<>NEW.created_by
    AND NOT (member.user_id = ANY(NEW.mentioned_user_ids)) AND (
      member.user_id=task.assigned_to OR member.user_id=task.created_by OR EXISTS (
        SELECT 1 FROM public.task_comments previous WHERE previous.task_id=task.id AND previous.workspace_id=task.workspace_id AND previous.created_by=member.user_id
      ))
  ON CONFLICT (recipient_id,event_key) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind NOT IN ('direct_message','group_message','task_assigned','task_comment','task_mention') THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION private.prepare_push_delivery(p_id uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  d private.push_deliveries%rowtype; s private.push_subscriptions%rowtype; n public.notifications%rowtype;
  pref public.notification_preferences%rowtype; details jsonb; preview text; kind text;
  previous_claims text := current_setting('request.jwt.claims',true);
BEGIN
  SELECT * INTO d FROM private.push_deliveries WHERE id=p_id AND lease_token=p_lease AND status='sending' AND next_attempt_at>now();
  IF NOT FOUND OR d.created_at<now()-interval '15 minutes' THEN RETURN NULL; END IF;
  SELECT s0.* INTO s FROM private.push_subscriptions s0 JOIN auth.sessions a ON a.id=s0.session_id AND a.user_id=s0.user_id
  WHERE s0.id=d.subscription_id AND (a.not_after IS NULL OR a.not_after>now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF d.reminder_task_id IS NOT NULL THEN
    SELECT * INTO pref FROM public.notification_preferences WHERE user_id=s.user_id;
    IF NOT s.deadlines OR NOT coalesce(pref.deadlines,true)
      OR NOT (CASE d.reminder_offset WHEN 0 THEN s.reminder_due ELSE s.reminder_before END)
      OR d.scheduled_for IS DISTINCT FROM private.deadline_push_at(d.reminder_date,d.reminder_offset,s.reminder_time,s.reminder_timezone)
      OR d.scheduled_for>now() OR d.scheduled_for<=now()-interval '15 minutes'
      OR (d.scheduled_for AT TIME ZONE s.reminder_timezone)::date<>(now() AT TIME ZONE s.reminder_timezone)::date THEN RETURN NULL; END IF;
    SELECT jsonb_build_object('title',t.title,'workspace_id',t.workspace_id,'project_id',t.project_id,'task_id',t.id)
    INTO details FROM public.project_tasks t
    JOIN public.workspace_members m ON m.workspace_id=t.workspace_id AND m.user_id=s.user_id AND m.role<>'guest'
    WHERE t.id=d.reminder_task_id AND t.assigned_to=s.user_id AND t.status<>'done' AND t.due_date=d.reminder_date;
    IF details IS NULL THEN RETURN NULL; END IF;
    kind := CASE d.reminder_offset WHEN 0 THEN 'task_reminder_due' ELSE 'task_reminder_before' END;
    -- Reminder content stays generic unless previews were explicitly enabled.
  ELSIF d.notification_id IS NULL THEN
    kind := 'test'; details := jsonb_build_object('title','Nexus Push-Test');
  ELSE
    SELECT * INTO n FROM public.notifications WHERE id=d.notification_id AND recipient_id=s.user_id AND read_at IS NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO pref FROM public.notification_preferences WHERE user_id=s.user_id;
    IF NOT (CASE WHEN n.kind IN ('direct_message','group_message') THEN s.messages AND coalesce(pref.messages,true)
      WHEN n.kind='task_assigned' THEN s.assignments AND coalesce(pref.assignments,true)
      WHEN n.kind IN ('task_comment','task_mention') THEN s.comments AND coalesce(pref.comments,true) ELSE false END) THEN RETURN NULL; END IF;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'role','authenticated')::text,true);
    details := private.notification_details(n.id);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    IF details IS NULL THEN RETURN NULL; END IF;
    kind := n.kind;
    IF s.previews THEN
      IF kind='direct_message' THEN SELECT left(body,160) INTO preview FROM public.direct_messages WHERE id=n.source_id;
      ELSIF kind='group_message' THEN SELECT left(body,160) INTO preview FROM public.group_messages WHERE id=n.source_id;
      ELSIF kind IN ('task_comment','task_mention') THEN SELECT left(body,160) INTO preview FROM public.task_comments WHERE id=n.source_id;
      ELSE preview := details->>'detail'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('delivery_id',d.id,'user_id',s.user_id,'device_id',s.device_id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth_key',s.auth_key,
    'kind',kind,'details',details,'preview',nullif(preview,''),'previews',s.previews);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RAISE;
END $$;
