-- Mobile push: explicit device opt-in, current-session binding, private outbox.
-- No notification bodies are stored in the outbox; access is checked at dispatch.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notification_preferences ADD COLUMN comments boolean NOT NULL DEFAULT true;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('direct_message','group_message','contact_request','workspace_invitation','task_assigned','task_due','task_overdue','task_comment'));

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
  ELSIF n.kind = 'task_comment' THEN
    SELECT jsonb_build_object('title', 'Kommentar zu ' || t.title,
      'detail', coalesce(nullif(p.full_name,''),p.username,'Nexus Nutzer'),
      'workspace_id',t.workspace_id,'project_id',t.project_id,'task_id',t.id)
    INTO result FROM public.task_comments c
    JOIN public.project_tasks t ON t.id=c.task_id AND t.workspace_id=c.workspace_id
    JOIN public.workspace_members member ON member.workspace_id=t.workspace_id AND member.user_id=v_user
    LEFT JOIN public.profiles p ON p.id=c.created_by
    WHERE c.id=n.source_id;
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
        WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments' WHEN 'task_comment' THEN 'comments' ELSE 'deadlines' END)::boolean,true)
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
      WHEN 'contact_request' THEN 'contacts' WHEN 'workspace_invitation' THEN 'invitations' WHEN 'task_assigned' THEN 'assignments' WHEN 'task_comment' THEN 'comments' ELSE 'deadlines' END)::boolean,true)
    AND (n.kind <> 'task_due' OR n.event_date = v_today) AND (n.kind <> 'task_overdue' OR n.event_date < v_today);
END $$;

CREATE OR REPLACE FUNCTION public.set_notification_preference(p_category text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet.'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('messages','contacts','invitations','assignments','deadlines','comments') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Ungültige Benachrichtigungseinstellung.';
  END IF;
  INSERT INTO public.notification_preferences(user_id) VALUES ((SELECT auth.uid())) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.notification_preferences SET
    messages = CASE WHEN p_category = 'messages' THEN p_enabled ELSE messages END,
    contacts = CASE WHEN p_category = 'contacts' THEN p_enabled ELSE contacts END,
    invitations = CASE WHEN p_category = 'invitations' THEN p_enabled ELSE invitations END,
    assignments = CASE WHEN p_category = 'assignments' THEN p_enabled ELSE assignments END,
    comments = CASE WHEN p_category = 'comments' THEN p_enabled ELSE comments END,
    deadlines = CASE WHEN p_category = 'deadlines' THEN p_enabled ELSE deadlines END
  WHERE user_id = (SELECT auth.uid());
END $$;

CREATE FUNCTION private.capture_task_comment_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(recipient_id,kind,source_id,event_key,created_at)
  SELECT DISTINCT m.user_id,'task_comment',NEW.id,'comment:' || NEW.id,NEW.created_at
  FROM public.project_tasks t JOIN public.workspace_members m ON m.workspace_id=t.workspace_id
  WHERE t.id=NEW.task_id AND m.user_id<>NEW.created_by AND (
    m.user_id=t.assigned_to OR m.user_id=t.created_by OR EXISTS (
      SELECT 1 FROM public.task_comments c WHERE c.task_id=t.id AND c.workspace_id=t.workspace_id AND c.created_by=m.user_id
    )) ON CONFLICT (recipient_id,event_key) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.capture_task_comment_notification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER notify_task_comment AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION private.capture_task_comment_notification();
CREATE TRIGGER clean_comment_notifications AFTER DELETE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION private.clean_notification_source();

CREATE TABLE private.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint)<=2048),
  p256dh text NOT NULL, auth_key text NOT NULL,
  messages boolean NOT NULL DEFAULT true,
  assignments boolean NOT NULL DEFAULT true,
  comments boolean NOT NULL DEFAULT true,
  previews boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_test_at timestamptz,
  UNIQUE (user_id,device_id)
);
CREATE INDEX push_subscriptions_session_idx ON private.push_subscriptions(session_id);
ALTER TABLE private.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_no_client_access ON private.push_subscriptions FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON private.push_subscriptions FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES private.push_subscriptions(id) ON DELETE CASCADE,
  notification_id bigint REFERENCES public.notifications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','discarded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id,notification_id)
);
CREATE INDEX push_deliveries_due_idx ON private.push_deliveries(next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX push_deliveries_notification_idx ON private.push_deliveries(notification_id);
ALTER TABLE private.push_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_deliveries_no_client_access ON private.push_deliveries FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON private.push_deliveries FROM PUBLIC,anon,authenticated,service_role;

-- Configuration secrets never appear in migration source, browser responses or logs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='nexus_push_dispatch_token') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'nexus_push_dispatch_token','Nexus database-to-push dispatcher');
  END IF;
END $$;

CREATE FUNCTION private.push_server_keys(p_seed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_keys jsonb; v_token text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nexus-push-vapid',0));
  SELECT decrypted_secret::jsonb INTO v_keys FROM vault.decrypted_secrets WHERE name='nexus_push_vapid';
  IF v_keys IS NULL AND p_seed IS NOT NULL THEN
    IF coalesce(p_seed->>'publicKey','') !~ '^[A-Za-z0-9_-]{87}$' OR coalesce(p_seed->>'privateKey','') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'Invalid key format'; END IF;
    PERFORM vault.create_secret(p_seed::text,'nexus_push_vapid','Nexus stable Web Push signing keys');
    v_keys := p_seed;
  END IF;
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name='nexus_push_dispatch_token';
  RETURN jsonb_build_object('public_key',v_keys->>'publicKey','private_key',v_keys->>'privateKey','dispatch_token',v_token);
END $$;
REVOKE ALL ON FUNCTION private.push_server_keys(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.push_server_keys(jsonb) TO service_role;
CREATE FUNCTION public.get_push_server_keys(p_seed jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.push_server_keys(p_seed); $$;
REVOKE ALL ON FUNCTION public.get_push_server_keys(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_server_keys(jsonb) TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE FUNCTION private.wake_push_worker(p_force boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_url text; v_token text;
BEGIN
  IF NOT p_force AND NOT EXISTS (SELECT 1 FROM private.push_deliveries WHERE status IN ('queued','sending') AND next_attempt_at<=now() AND attempts<5) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='nexus_push_dispatch_url';
  IF v_url IS NULL THEN RETURN; END IF; -- Configured once after deploying the worker.
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name='nexus_push_dispatch_token';
  PERFORM net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-nexus-push-token',v_token),body:='{}'::jsonb,timeout_milliseconds:=10000);
EXCEPTION WHEN OTHERS THEN
  -- Push infrastructure must never roll back a message or task. Cron retries.
  RETURN;
END $$;
REVOKE ALL ON FUNCTION private.wake_push_worker(boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.manage_push_device(p_action text,p_device_id uuid,p_subscription jsonb,p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_session uuid := nullif((SELECT auth.jwt())->>'session_id','')::uuid;
  v_sub private.push_subscriptions%rowtype;
  v_endpoint text := p_subscription->>'endpoint';
BEGIN
  IF v_user IS NULL OR p_device_id IS NULL THEN RAISE EXCEPTION 'Bitte melde dich an.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id=v_session AND user_id=v_user AND (not_after IS NULL OR not_after>now())) THEN RAISE EXCEPTION 'Bitte melde dich erneut an.'; END IF;
  -- Serialize per account to make the device cap and concurrent registration exact.
  PERFORM pg_advisory_xact_lock(hashtextextended('push-device:' || v_user,0));
  SELECT * INTO v_sub FROM private.push_subscriptions WHERE user_id=v_user AND device_id=p_device_id;
  IF p_action='remove' THEN
    DELETE FROM private.push_subscriptions WHERE user_id=v_user AND device_id=p_device_id;
    RETURN jsonb_build_object('enabled',false);
  ELSIF p_action='register' THEN
    IF v_endpoint IS NULL OR length(v_endpoint)>2048 OR v_endpoint !~ '^https://(fcm[.]googleapis[.]com|([a-z0-9-]+[.])*push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])*push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)/[^#]*$'
      OR coalesce(p_subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$'
      OR coalesce(p_subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}$' THEN RAISE EXCEPTION 'Ungültiges Push-Abonnement.'; END IF;
    IF EXISTS (SELECT 1 FROM private.push_subscriptions WHERE endpoint=v_endpoint AND (user_id<>v_user OR device_id<>p_device_id)) THEN RAISE EXCEPTION 'Bitte Push auf diesem Gerät aus- und wieder einschalten.'; END IF;
    IF v_sub.id IS NULL AND (SELECT count(*) FROM private.push_subscriptions WHERE user_id=v_user)>=10 THEN RAISE EXCEPTION 'Maximal zehn Push-Geräte pro Konto.'; END IF;
    INSERT INTO private.push_subscriptions(user_id,session_id,device_id,endpoint,p256dh,auth_key)
    VALUES(v_user,v_session,p_device_id,v_endpoint,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
    ON CONFLICT (user_id,device_id) DO UPDATE SET session_id=excluded.session_id,endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_key=excluded.auth_key,updated_at=now()
    RETURNING * INTO v_sub;
  ELSIF p_action NOT IN ('status','options','test') THEN RAISE EXCEPTION 'Ungültige Push-Aktion.';
  END IF;
  IF v_sub.id IS NULL OR v_sub.session_id<>v_session THEN RETURN jsonb_build_object('enabled',false); END IF;
  IF p_action='options' THEN
    IF p_options IS NULL OR jsonb_typeof(p_options)<>'object' OR EXISTS (
      SELECT 1 FROM jsonb_each(p_options) e WHERE e.key NOT IN ('messages','assignments','comments','previews') OR jsonb_typeof(e.value)<>'boolean'
    ) THEN RAISE EXCEPTION 'Ungültige Push-Einstellung.'; END IF;
    UPDATE private.push_subscriptions SET messages=coalesce((p_options->>'messages')::boolean,messages),assignments=coalesce((p_options->>'assignments')::boolean,assignments),
      comments=coalesce((p_options->>'comments')::boolean,comments),previews=coalesce((p_options->>'previews')::boolean,previews),updated_at=now()
    WHERE id=v_sub.id RETURNING * INTO v_sub;
  ELSIF p_action='test' THEN
    IF v_sub.last_test_at>now()-interval '30 seconds' THEN RAISE EXCEPTION 'Bitte warte 30 Sekunden bis zum nächsten Test.'; END IF;
    UPDATE private.push_subscriptions SET last_test_at=now() WHERE id=v_sub.id;
    INSERT INTO private.push_deliveries(subscription_id) VALUES(v_sub.id);
    PERFORM private.wake_push_worker();
  END IF;
  RETURN jsonb_build_object('enabled',true,'messages',v_sub.messages,'assignments',v_sub.assignments,'comments',v_sub.comments,'previews',v_sub.previews);
END $$;
REVOKE ALL ON FUNCTION private.manage_push_device(text,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.manage_push_device(text,uuid,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.manage_push_device(p_action text,p_device_id uuid,p_subscription jsonb DEFAULT NULL,p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.manage_push_device(p_action,p_device_id,p_subscription,p_options); $$;
REVOKE ALL ON FUNCTION public.manage_push_device(text,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_push_device(text,uuid,jsonb,jsonb) TO authenticated;

CREATE FUNCTION private.enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind NOT IN ('direct_message','group_message','task_assigned','task_comment') THEN RETURN NEW; END IF;
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
REVOKE ALL ON FUNCTION private.enqueue_notification_push() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_notification_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.enqueue_notification_push();

CREATE FUNCTION private.claim_push_deliveries()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  DELETE FROM private.push_deliveries WHERE created_at<now()-interval '2 days';
  UPDATE private.push_deliveries SET status='failed',lease_token=NULL WHERE status IN ('queued','sending') AND attempts>=5 AND next_attempt_at<=now();
  WITH candidates AS (
    SELECT id FROM private.push_deliveries WHERE status IN ('queued','sending') AND attempts<5 AND next_attempt_at<=now()
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 25
  ), claimed AS (
    UPDATE private.push_deliveries d SET status='sending',attempts=d.attempts+1,next_attempt_at=now()+interval '2 minutes',lease_token=gen_random_uuid()
    FROM candidates c WHERE d.id=c.id RETURNING d.id,d.lease_token
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_result FROM claimed;
  RETURN v_result;
END $$;

CREATE FUNCTION private.prepare_push_delivery(p_id uuid,p_lease uuid)
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
  IF d.notification_id IS NULL THEN
    kind := 'test'; details := jsonb_build_object('title','Nexus Push-Test');
  ELSE
    SELECT * INTO n FROM public.notifications WHERE id=d.notification_id AND recipient_id=s.user_id AND read_at IS NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO pref FROM public.notification_preferences WHERE user_id=s.user_id;
    IF NOT (CASE WHEN n.kind IN ('direct_message','group_message') THEN s.messages AND coalesce(pref.messages,true)
      WHEN n.kind='task_assigned' THEN s.assignments AND coalesce(pref.assignments,true)
      WHEN n.kind='task_comment' THEN s.comments AND coalesce(pref.comments,true) ELSE false END) THEN RETURN NULL; END IF;
    -- Reuse the source-access resolver as this recipient, then restore claims.
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',s.user_id,'role','authenticated')::text,true);
    details := private.notification_details(n.id);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    IF details IS NULL THEN RETURN NULL; END IF;
    kind := n.kind;
    IF s.previews THEN
      IF kind='direct_message' THEN SELECT left(body,160) INTO preview FROM public.direct_messages WHERE id=n.source_id;
      ELSIF kind='group_message' THEN SELECT left(body,160) INTO preview FROM public.group_messages WHERE id=n.source_id;
      ELSIF kind='task_comment' THEN SELECT left(body,160) INTO preview FROM public.task_comments WHERE id=n.source_id;
      ELSE preview := details->>'detail'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('delivery_id',d.id,'user_id',s.user_id,'device_id',s.device_id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth_key',s.auth_key,
    'kind',kind,'details',details,'preview',nullif(preview,''),'previews',s.previews);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  RAISE;
END $$;

CREATE FUNCTION private.finish_push_delivery(p_id uuid,p_lease uuid,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.push_deliveries%rowtype;
BEGIN
  SELECT * INTO d FROM private.push_deliveries WHERE id=p_id AND lease_token=p_lease AND status='sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_outcome='expired' THEN DELETE FROM private.push_subscriptions WHERE id=d.subscription_id; RETURN; END IF;
  IF p_outcome NOT IN ('sent','discarded','retry','failed') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  UPDATE private.push_deliveries SET status=CASE WHEN p_outcome='retry' AND attempts<5 THEN 'queued' WHEN p_outcome='retry' THEN 'failed' ELSE p_outcome END,
    next_attempt_at=now()+make_interval(secs:=least(300,30*power(2,attempts)::int)),lease_token=NULL WHERE id=d.id;
END $$;

-- Only the server can claim jobs, obtain current payloads and settle leases.
REVOKE ALL ON FUNCTION private.claim_push_deliveries(),private.prepare_push_delivery(uuid,uuid),private.finish_push_delivery(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.claim_push_deliveries(),private.prepare_push_delivery(uuid,uuid),private.finish_push_delivery(uuid,uuid,text) TO service_role;
CREATE FUNCTION public.claim_push_deliveries() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.claim_push_deliveries(); $$;
CREATE FUNCTION public.prepare_push_delivery(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.prepare_push_delivery(p_id,p_lease); $$;
CREATE FUNCTION public.finish_push_delivery(p_id uuid,p_lease uuid,p_outcome text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.finish_push_delivery(p_id,p_lease,p_outcome); $$;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(),public.prepare_push_delivery(uuid,uuid),public.finish_push_delivery(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(),public.prepare_push_delivery(uuid,uuid),public.finish_push_delivery(uuid,uuid,text) TO service_role;

-- The minute tick stays inside Postgres when there are no due jobs: no idle
-- Edge invocations. The normal path wakes immediately after the source commit.
SELECT cron.schedule('nexus-push-retry','* * * * *','SELECT private.wake_push_worker();');
