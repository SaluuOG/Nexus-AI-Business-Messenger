-- Synthetic, scoped acceptance only; no real device is addressed. Always rollback.
BEGIN;
CREATE FUNCTION pg_temp.assert_deadline(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; END $$;
SELECT set_config('nexus.deadline.user',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.other',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.session',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.other_session',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.device',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.workspace',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.project',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.deadline.'||person)::uuid,gen_random_uuid()||'@example.invalid',now(),'{"full_name":"Deadline rollback acceptance"}'
FROM unnest(ARRAY['user','other']) person;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES
(current_setting('nexus.deadline.session')::uuid,current_setting('nexus.deadline.user')::uuid,now(),now()),
(current_setting('nexus.deadline.other_session')::uuid,current_setting('nexus.deadline.other')::uuid,now(),now());
INSERT INTO public.workspaces(id,owner_id,name) VALUES(current_setting('nexus.deadline.workspace')::uuid,current_setting('nexus.deadline.user')::uuid,'Deadline rollback workspace');
INSERT INTO public.projects(id,workspace_id,title) VALUES(current_setting('nexus.deadline.project')::uuid,current_setting('nexus.deadline.workspace')::uuid,'Deadline rollback project');
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.deadline.user'),'role','authenticated','session_id',current_setting('nexus.deadline.session'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE device jsonb; invalid jsonb;
BEGIN
  device:=public.manage_push_device('register',current_setting('nexus.deadline.device')::uuid,
    jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/nexus-deadline-rollback-'||current_setting('nexus.deadline.device'),'keys',jsonb_build_object('p256dh',repeat('A',87),'auth',repeat('B',22))));
  IF device->>'deadlines'<>'false' OR device->>'reminder_time'<>'09:00' THEN RAISE EXCEPTION 'Existing devices opted in or wrong defaults'; END IF;
  FOREACH invalid IN ARRAY ARRAY['{"reminder_time":"24:00"}','{"reminder_timezone":"Invalid/Nexus"}','{"deadlines":"true"}','{"reminder_time":null}','{"unexpected":true}','{"deadlines":true,"reminder_before":false,"reminder_due":false,"reminder_timezone":"UTC"}']::jsonb[] LOOP
    BEGIN
      PERFORM public.manage_push_device('options',current_setting('nexus.deadline.device')::uuid,NULL,invalid);
      RAISE EXCEPTION 'Invalid option accepted: %',invalid;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Invalid option accepted%' THEN RAISE; END IF; END;
  END LOOP;
  device:=public.manage_push_device('options',current_setting('nexus.deadline.device')::uuid,NULL,
    jsonb_build_object('deadlines',true,'reminder_before',true,'reminder_due',true,'reminder_time',to_char(now() AT TIME ZONE 'UTC','HH24:MI'),'reminder_timezone','UTC'));
  IF device->>'deadlines'<>'true' OR device->>'reminder_timezone'<>'UTC' THEN RAISE EXCEPTION 'Schedule not saved'; END IF;
  BEGIN PERFORM private.enqueue_deadline_push(); RAISE EXCEPTION 'Client can run scheduler'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.prepare_push_delivery(gen_random_uuid(),gen_random_uuid()); RAISE EXCEPTION 'Client can read payloads'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('nexus.deadline.sub',(SELECT id::text FROM private.push_subscriptions WHERE user_id=current_setting('nexus.deadline.user')::uuid),true);
INSERT INTO public.project_tasks(workspace_id,project_id,title,assigned_to,due_date,status)
SELECT current_setting('nexus.deadline.workspace')::uuid,current_setting('nexus.deadline.project')::uuid,label,
  CASE WHEN label='Unassigned' THEN NULL ELSE current_setting('nexus.deadline.user')::uuid END,
  (now() AT TIME ZONE 'UTC')::date+days,status::public.task_status
FROM (VALUES ('Today',0,'todo'),('Tomorrow',1,'in_progress'),('Completed',0,'done'),('Unassigned',0,'todo'),('Later',7,'todo')) v(label,days,status);
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now()-interval '1 minute',current_setting('nexus.deadline.sub')::uuid)=0,'Reminder enqueued early');
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=2,'Expected today and day-before only');
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=0,'Duplicate reminder');
SELECT set_config('nexus.deadline.task',(SELECT id::text FROM public.project_tasks WHERE workspace_id=current_setting('nexus.deadline.workspace')::uuid AND title='Today'),true);
-- Lease only these synthetic jobs. Do not claim unrelated live deliveries.
UPDATE private.push_deliveries SET status='sending',lease_token=gen_random_uuid(),next_attempt_at=now()+interval '2 minutes'
WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid;
CREATE FUNCTION pg_temp.deadline_payload() RETURNS jsonb LANGUAGE sql AS $$
SELECT private.prepare_push_delivery(id,lease_token) FROM private.push_deliveries
WHERE reminder_task_id=current_setting('nexus.deadline.task')::uuid AND reminder_offset=0;
$$;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload()->>'kind'='task_reminder_due','Today payload missing');
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload()->>'previews'='false' AND pg_temp.deadline_payload()->>'preview' IS NULL,'Default preview leaked');
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload()->'details'->>'task_id'=current_setting('nexus.deadline.task'),'Wrong task target');
SELECT pg_temp.assert_deadline((SELECT private.prepare_push_delivery(id,lease_token)->>'kind'='task_reminder_before' FROM private.push_deliveries WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid AND reminder_offset=1),'Day-before payload missing');
UPDATE public.project_tasks SET status='done' WHERE id=current_setting('nexus.deadline.task')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Completed task sent');
UPDATE public.project_tasks SET status='todo',due_date=due_date+7 WHERE id=current_setting('nexus.deadline.task')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Changed date sent old reminder');
UPDATE public.project_tasks SET due_date=due_date-7,assigned_to=NULL WHERE id=current_setting('nexus.deadline.task')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Unassigned task sent');
UPDATE public.project_tasks SET assigned_to=current_setting('nexus.deadline.user')::uuid WHERE id=current_setting('nexus.deadline.task')::uuid;
INSERT INTO public.notification_preferences(user_id,deadlines) VALUES(current_setting('nexus.deadline.user')::uuid,false) ON CONFLICT(user_id) DO UPDATE SET deadlines=false;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Muted account sent');
UPDATE public.notification_preferences SET deadlines=true WHERE user_id=current_setting('nexus.deadline.user')::uuid;
UPDATE private.push_subscriptions SET deadlines=false WHERE id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Muted device sent');
UPDATE private.push_subscriptions SET deadlines=true,reminder_time=reminder_time+interval '1 hour' WHERE id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Changed time sent old reminder');
UPDATE private.push_subscriptions SET reminder_time=reminder_time-interval '1 hour',reminder_timezone='Pacific/Honolulu' WHERE id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Changed timezone sent old reminder');
UPDATE private.push_subscriptions SET reminder_timezone='UTC',reminder_due=false WHERE id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Disabled due-day sent');
UPDATE private.push_subscriptions SET reminder_due=true WHERE id=current_setting('nexus.deadline.sub')::uuid;
UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id=current_setting('nexus.deadline.session')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Expired session sent');
UPDATE auth.sessions SET not_after=NULL WHERE id=current_setting('nexus.deadline.session')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NOT NULL,'Restored valid reminder missing');
-- A changed send time can replace an unsent occurrence, never an already sent one.
UPDATE private.push_deliveries SET status='discarded',lease_token=NULL,scheduled_for=scheduled_for-interval '1 hour' WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=2,'Unsent reminders not rescheduled');
UPDATE private.push_deliveries SET status='sent',scheduled_for=scheduled_for-interval '1 hour' WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=0,'Already sent reminders repeated');
DELETE FROM private.push_deliveries WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid;
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now()+interval '16 minutes',current_setting('nexus.deadline.sub')::uuid)=0,'Stale reminder backlog created');
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=2,'Recreated fixture missing');
-- Membership is rechecked for an otherwise valid queued reminder.
SELECT set_config('nexus.deadline.member_ws',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.member_project',gen_random_uuid()::text,true);
SELECT set_config('nexus.deadline.original_task',current_setting('nexus.deadline.task'),true);
SELECT set_config('nexus.deadline.task',gen_random_uuid()::text,true);
INSERT INTO public.workspaces(id,owner_id,name) VALUES(current_setting('nexus.deadline.member_ws')::uuid,current_setting('nexus.deadline.other')::uuid,'Membership rollback workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(current_setting('nexus.deadline.member_ws')::uuid,current_setting('nexus.deadline.user')::uuid,'member');
INSERT INTO public.projects(id,workspace_id,title) VALUES(current_setting('nexus.deadline.member_project')::uuid,current_setting('nexus.deadline.member_ws')::uuid,'Membership rollback project');
INSERT INTO public.project_tasks(id,workspace_id,project_id,title,assigned_to,due_date)
VALUES(current_setting('nexus.deadline.task')::uuid,current_setting('nexus.deadline.member_ws')::uuid,current_setting('nexus.deadline.member_project')::uuid,'Membership task',current_setting('nexus.deadline.user')::uuid,(now() AT TIME ZONE 'UTC')::date);
SELECT pg_temp.assert_deadline(private.enqueue_deadline_push(now(),current_setting('nexus.deadline.sub')::uuid)=1,'Member reminder missing');
UPDATE private.push_deliveries SET status='sending',lease_token=gen_random_uuid(),next_attempt_at=now()+interval '2 minutes' WHERE reminder_task_id=current_setting('nexus.deadline.task')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NOT NULL,'Member payload missing');
UPDATE public.workspace_members SET role='guest' WHERE workspace_id=current_setting('nexus.deadline.member_ws')::uuid AND user_id=current_setting('nexus.deadline.user')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Guest downgrade sent reminder');
UPDATE public.workspace_members SET role='member' WHERE workspace_id=current_setting('nexus.deadline.member_ws')::uuid AND user_id=current_setting('nexus.deadline.user')::uuid;
UPDATE public.project_tasks SET assigned_to=current_setting('nexus.deadline.user')::uuid WHERE id=current_setting('nexus.deadline.task')::uuid;
DELETE FROM public.workspace_members WHERE workspace_id=current_setting('nexus.deadline.member_ws')::uuid AND user_id=current_setting('nexus.deadline.user')::uuid;
SELECT pg_temp.assert_deadline(pg_temp.deadline_payload() IS NULL,'Removed member sent reminder');
DELETE FROM public.workspaces WHERE id=current_setting('nexus.deadline.member_ws')::uuid;
SELECT pg_temp.assert_deadline(NOT EXISTS(SELECT 1 FROM private.push_deliveries WHERE reminder_task_id=current_setting('nexus.deadline.task')::uuid),'Deleted workspace retained queue');
SELECT set_config('nexus.deadline.task',current_setting('nexus.deadline.original_task'),true);
-- Cross-account API isolation.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.deadline.other'),'role','authenticated','session_id',current_setting('nexus.deadline.other_session'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.manage_push_device('options',current_setting('nexus.deadline.device')::uuid,NULL,'{"deadlines":false}')->>'enabled'<>'false' THEN RAISE EXCEPTION 'Other account changed schedule'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.assert_deadline((SELECT deadlines FROM private.push_subscriptions WHERE id=current_setting('nexus.deadline.sub')::uuid),'Cross-account write');
-- Calendar boundaries and DST use local calendar days, not fixed 24-hour offsets.
SELECT pg_temp.assert_deadline(private.deadline_push_at('2026-03-30',1,'09:00','Europe/Berlin')='2026-03-29 07:00+00'::timestamptz,'Spring timezone offset');
SELECT pg_temp.assert_deadline(private.deadline_push_at('2026-10-26',1,'02:30','Europe/Berlin')='2026-10-25 01:30+00'::timestamptz,'Fall repeated hour not deterministic');
SELECT pg_temp.assert_deadline(private.deadline_push_at('2026-03-29',0,'02:30','Europe/Berlin')='2026-03-29 01:30+00'::timestamptz,'Spring missing hour policy');
SELECT pg_temp.assert_deadline(private.deadline_push_at('2027-01-01',1,'09:00','Pacific/Kiritimati')='2026-12-30 19:00+00'::timestamptz,'Year boundary / UTC+14');
SELECT pg_temp.assert_deadline(private.deadline_push_at('2028-03-01',1,'09:00','UTC')='2028-02-29 09:00+00'::timestamptz,'Leap day');
-- Workspace/task deletion and session revocation remove scheduled payloads.
DELETE FROM public.project_tasks WHERE id=current_setting('nexus.deadline.task')::uuid;
SELECT pg_temp.assert_deadline(NOT EXISTS(SELECT 1 FROM private.push_deliveries WHERE reminder_task_id=current_setting('nexus.deadline.task')::uuid),'Deleted task retained queue');
DELETE FROM auth.sessions WHERE id=current_setting('nexus.deadline.session')::uuid;
SELECT pg_temp.assert_deadline(NOT EXISTS(SELECT 1 FROM private.push_deliveries WHERE subscription_id=current_setting('nexus.deadline.sub')::uuid),'Logged-out device retained queue');
SELECT 'Deadline acceptance passed: opt-in, validation, isolation, timing, dedup, cancellation, privacy, timezone/DST and cleanup' AS result;
ROLLBACK;
