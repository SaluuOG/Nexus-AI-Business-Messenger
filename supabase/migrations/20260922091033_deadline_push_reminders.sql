-- Explicit opt-in per device. Existing push devices remain unchanged until saved.
ALTER TABLE private.push_subscriptions
  ADD COLUMN deadlines boolean NOT NULL DEFAULT false,
  ADD COLUMN reminder_before boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_due boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_time time NOT NULL DEFAULT '09:00',
  ADD COLUMN reminder_timezone text,
  ADD CONSTRAINT push_reminder_options CHECK (NOT deadlines OR ((reminder_before OR reminder_due) AND reminder_timezone IS NOT NULL));

ALTER TABLE private.push_deliveries
  ADD COLUMN reminder_task_id uuid REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  ADD COLUMN reminder_date date,
  ADD COLUMN reminder_offset integer,
  ADD COLUMN scheduled_for timestamptz,
  ADD CONSTRAINT push_reminder_shape CHECK (
    (reminder_task_id IS NULL AND reminder_date IS NULL AND reminder_offset IS NULL AND scheduled_for IS NULL)
    OR (reminder_task_id IS NOT NULL AND reminder_date IS NOT NULL AND reminder_offset IS NOT NULL
      AND reminder_offset IN (0,1) AND scheduled_for IS NOT NULL AND notification_id IS NULL)),
  ADD CONSTRAINT push_reminder_once UNIQUE (subscription_id,reminder_task_id,reminder_date,reminder_offset);
CREATE INDEX push_deliveries_reminder_task_idx ON private.push_deliveries(reminder_task_id);

-- Calendar arithmetic precedes zone conversion; a day before is not always 24h.
CREATE FUNCTION private.deadline_push_at(p_due date,p_offset integer,p_time time,p_timezone text)
RETURNS timestamptz LANGUAGE sql STABLE STRICT SET search_path='' AS $$
  SELECT ((p_due-p_offset)+p_time) AT TIME ZONE p_timezone;
$$;
REVOKE ALL ON FUNCTION private.deadline_push_at(date,integer,time,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.manage_push_device(p_action text,p_device_id uuid,p_subscription jsonb,p_options jsonb)
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
      SELECT 1 FROM jsonb_each(p_options) e WHERE CASE
        WHEN e.key IN ('messages','assignments','comments','previews','deadlines','reminder_before','reminder_due') THEN jsonb_typeof(e.value)<>'boolean'
        WHEN e.key IN ('reminder_time','reminder_timezone') THEN jsonb_typeof(e.value)<>'string'
        ELSE true END
    ) THEN RAISE EXCEPTION 'Ungültige Push-Einstellung.'; END IF;
    IF p_options ? 'reminder_time' AND (p_options->>'reminder_time') !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Bitte wähle eine gültige Uhrzeit.';
    END IF;
    IF p_options ? 'reminder_timezone' AND (length(p_options->>'reminder_timezone')>100 OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_options->>'reminder_timezone'
    )) THEN RAISE EXCEPTION 'Bitte wähle eine gültige Zeitzone.'; END IF;
    IF coalesce((p_options->>'deadlines')::boolean,v_sub.deadlines) AND (
      NOT (coalesce((p_options->>'reminder_before')::boolean,v_sub.reminder_before) OR coalesce((p_options->>'reminder_due')::boolean,v_sub.reminder_due))
      OR coalesce(p_options->>'reminder_timezone',v_sub.reminder_timezone) IS NULL
    ) THEN RAISE EXCEPTION 'Bitte wähle mindestens einen Erinnerungstag und eine Zeitzone.'; END IF;
    UPDATE private.push_subscriptions SET messages=coalesce((p_options->>'messages')::boolean,messages),assignments=coalesce((p_options->>'assignments')::boolean,assignments),
      comments=coalesce((p_options->>'comments')::boolean,comments),previews=coalesce((p_options->>'previews')::boolean,previews),
      deadlines=coalesce((p_options->>'deadlines')::boolean,deadlines),
      reminder_before=coalesce((p_options->>'reminder_before')::boolean,reminder_before),
      reminder_due=coalesce((p_options->>'reminder_due')::boolean,reminder_due),
      reminder_time=coalesce((p_options->>'reminder_time')::time,reminder_time),
      reminder_timezone=coalesce(p_options->>'reminder_timezone',reminder_timezone),updated_at=now()
    WHERE id=v_sub.id RETURNING * INTO v_sub;
  ELSIF p_action='test' THEN
    IF v_sub.last_test_at>now()-interval '30 seconds' THEN RAISE EXCEPTION 'Bitte warte 30 Sekunden bis zum nächsten Test.'; END IF;
    UPDATE private.push_subscriptions SET last_test_at=now() WHERE id=v_sub.id;
    INSERT INTO private.push_deliveries(subscription_id) VALUES(v_sub.id);
    PERFORM private.wake_push_worker();
  END IF;
  RETURN jsonb_build_object('enabled',true,'messages',v_sub.messages,'assignments',v_sub.assignments,'comments',v_sub.comments,'previews',v_sub.previews,
    'deadlines',v_sub.deadlines,'reminder_before',v_sub.reminder_before,'reminder_due',v_sub.reminder_due,
    'reminder_time',to_char(v_sub.reminder_time,'HH24:MI'),'reminder_timezone',coalesce(v_sub.reminder_timezone,''));
END $$;

-- Only the internal cron role can enqueue reminders. The optional clock/scope
-- permits deterministic rollback acceptance without touching real subscribers.
CREATE FUNCTION private.enqueue_deadline_push(p_now timestamptz DEFAULT now(),p_subscription uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('nexus-deadline-push',0)) THEN RETURN 0; END IF;
  INSERT INTO private.push_deliveries AS old(subscription_id,reminder_task_id,reminder_date,reminder_offset,scheduled_for)
  SELECT s.id,t.id,t.due_date,day.offset_days,planned.at
  FROM private.push_subscriptions s
  JOIN auth.sessions a ON a.id=s.session_id AND a.user_id=s.user_id
  JOIN public.project_tasks t ON t.assigned_to=s.user_id AND t.status<>'done'
    AND t.due_date BETWEEN (p_now AT TIME ZONE s.reminder_timezone)::date AND (p_now AT TIME ZONE s.reminder_timezone)::date+1
  JOIN public.workspace_members m ON m.workspace_id=t.workspace_id AND m.user_id=s.user_id AND m.role<>'guest'
  LEFT JOIN public.notification_preferences pref ON pref.user_id=s.user_id
  CROSS JOIN (VALUES (0),(1)) AS day(offset_days)
  CROSS JOIN LATERAL (SELECT private.deadline_push_at(t.due_date,day.offset_days,s.reminder_time,s.reminder_timezone) AS at) planned
  WHERE s.deadlines AND coalesce(pref.deadlines,true)
    AND (p_subscription IS NULL OR s.id=p_subscription)
    AND (a.not_after IS NULL OR a.not_after>p_now)
    AND CASE day.offset_days WHEN 0 THEN s.reminder_due ELSE s.reminder_before END
    AND planned.at<=p_now AND planned.at>p_now-interval '15 minutes'
    AND (planned.at AT TIME ZONE s.reminder_timezone)::date=(p_now AT TIME ZONE s.reminder_timezone)::date
  ON CONFLICT (subscription_id,reminder_task_id,reminder_date,reminder_offset) DO UPDATE
    SET scheduled_for=excluded.scheduled_for,status='queued',attempts=0,next_attempt_at=now(),lease_token=NULL,created_at=now()
    WHERE old.status IN ('queued','discarded','failed') AND old.scheduled_for IS DISTINCT FROM excluded.scheduled_for;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_deadline_push(timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;

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
    -- Content remains generic unless previews were explicitly enabled.
  ELSIF d.notification_id IS NULL THEN
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

-- Reuse the existing minute tick. No extra idle Edge requests or paid AI.
SELECT cron.schedule('nexus-push-retry','* * * * *','SELECT private.enqueue_deadline_push(); SELECT private.wake_push_worker();');
