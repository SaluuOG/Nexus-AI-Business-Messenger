-- Entirely synthetic identities and records. Everything is rolled back, so no
-- real account receives a message, invitation, task or notification from this test.
BEGIN;
SELECT set_config('nexus.test.owner',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.member',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.outsider',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.ws',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.invite_ws',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.project',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.group',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.chat',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.contact',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.invite',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.task',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.past_task',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.test.' || person)::uuid,current_setting('nexus.test.' || person) || '@example.invalid',now(),'{"full_name":"Notification rollback test"}'::jsonb
FROM unnest(ARRAY['owner','member','outsider']) person;
INSERT INTO public.workspaces(id,owner_id,name) VALUES
  (current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.owner')::uuid,'Notification rollback workspace'),
  (current_setting('nexus.test.invite_ws')::uuid,current_setting('nexus.test.owner')::uuid,'Invitation rollback workspace');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
  (current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.member')::uuid,'member');
INSERT INTO public.projects(id,workspace_id,title) VALUES
  (current_setting('nexus.test.project')::uuid,current_setting('nexus.test.ws')::uuid,'Notification rollback project');
INSERT INTO public.group_conversations(id,name,created_by) VALUES
  (current_setting('nexus.test.group')::uuid,'Notification rollback group',current_setting('nexus.test.owner')::uuid);
INSERT INTO public.group_members(group_id,user_id,role) VALUES
  (current_setting('nexus.test.group')::uuid,current_setting('nexus.test.owner')::uuid,'owner'),
  (current_setting('nexus.test.group')::uuid,current_setting('nexus.test.member')::uuid,'member');
INSERT INTO public.direct_conversations(id,user_a,user_b) VALUES
  (current_setting('nexus.test.chat')::uuid,least(current_setting('nexus.test.owner')::uuid,current_setting('nexus.test.member')::uuid),greatest(current_setting('nexus.test.owner')::uuid,current_setting('nexus.test.member')::uuid));

SELECT set_config('nexus.test.session',gen_random_uuid()::text,true);
SELECT set_config('nexus.test.device',gen_random_uuid()::text,true);
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
VALUES(current_setting('nexus.test.session')::uuid,current_setting('nexus.test.member')::uuid,now(),now());
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated','session_id',current_setting('nexus.test.session'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;
BEGIN
  result := public.manage_push_device('register',current_setting('nexus.test.device')::uuid,
    jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/nexus-rollback-' || current_setting('nexus.test.device'),'keys',jsonb_build_object('p256dh',repeat('A',87),'auth',repeat('B',22))));
  IF result->>'enabled'<>'true' OR result->>'previews'<>'false' OR result::text LIKE '%endpoint%' THEN RAISE EXCEPTION 'Unsafe device registration response'; END IF;
  BEGIN
    PERFORM public.manage_push_device('register',gen_random_uuid(),'{"endpoint":"https://127.0.0.1/private","keys":{"p256dh":"x","auth":"y"}}');
    RAISE EXCEPTION 'SSRF accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Ungültiges Push-Abonnement.' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.get_push_server_keys();
    RAISE EXCEPTION 'Client read server keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.claim_push_deliveries();
    RAISE EXCEPTION 'Client claimed deliveries';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM private.push_subscriptions;
    RAISE EXCEPTION 'Client read subscriptions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.owner'),'role','authenticated')::text,true);
INSERT INTO public.project_tasks(id,workspace_id,project_id,title,assigned_to) VALUES
(current_setting('nexus.test.task')::uuid,current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.project')::uuid,'Push rollback task',current_setting('nexus.test.member')::uuid);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES(current_setting('nexus.test.chat')::uuid,current_setting('nexus.test.owner')::uuid,'Secret direct body');
INSERT INTO public.group_messages(group_id,sender_id,body) VALUES(current_setting('nexus.test.group')::uuid,current_setting('nexus.test.owner')::uuid,'Secret group body');
INSERT INTO public.task_comments(workspace_id,task_id,body) VALUES(current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.task')::uuid,'Secret comment body');
DO $$ BEGIN
  IF (SELECT count(*) FROM private.push_deliveries)<>4 THEN RAISE EXCEPTION 'Missing/duplicate push event'; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE kind='task_comment' AND recipient_id=current_setting('nexus.test.member')::uuid)<>1 THEN RAISE EXCEPTION 'Comment recipient missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.notifications WHERE kind='task_comment' AND recipient_id=current_setting('nexus.test.owner')::uuid) THEN RAISE EXCEPTION 'Self comment notified'; END IF;
END $$;
INSERT INTO private.push_wakes(token_hash) VALUES(encode(extensions.digest(repeat('a',64),'sha256'),'hex'));
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.consume_push_wake(repeat('b',64)) OR NOT public.consume_push_wake(repeat('a',64)) OR public.consume_push_wake(repeat('a',64)) THEN RAISE EXCEPTION 'Wake token is not single-use'; END IF;
END $$;
DO $$ DECLARE jobs jsonb; j jsonb; item jsonb;
BEGIN
  jobs := public.claim_push_deliveries();
  IF jsonb_array_length(jobs)<>4 OR jsonb_array_length(public.claim_push_deliveries())<>0 THEN RAISE EXCEPTION 'Lease duplicated'; END IF;
  FOR j IN SELECT * FROM jsonb_array_elements(jobs) LOOP
    item := public.prepare_push_delivery((j->>'id')::uuid,(j->>'lease_token')::uuid);
    IF item IS NULL OR item->>'user_id'<>current_setting('nexus.test.member') OR item->>'preview' IS NOT NULL THEN RAISE EXCEPTION 'Private/default preview or recipient failed'; END IF;
    IF public.prepare_push_delivery((j->>'id')::uuid,gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'Stale lease accepted'; END IF;
  END LOOP;
  PERFORM set_config('nexus.test.jobs',jobs::text,true);
  IF (SELECT auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'Worker leaked impersonation claims'; END IF;
END $$;
RESET ROLE;
-- Queued source access is always rechecked, as are preference/read changes.
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.test.group')::uuid AND user_id=current_setting('nexus.test.member')::uuid;
UPDATE public.direct_messages SET deleted_at=now(),body='' WHERE conversation_id=current_setting('nexus.test.chat')::uuid;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated','session_id',current_setting('nexus.test.session'))::text,true);
SET LOCAL ROLE authenticated;
SELECT public.set_notification_preference('comments',false);
SELECT public.manage_push_device('options',current_setting('nexus.test.device')::uuid,NULL,'{"assignments":false}');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_notifications('UTC')->'items') x WHERE x->>'kind'='task_comment') THEN RAISE EXCEPTION 'Comment mute ignored in app'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE j jsonb;
BEGIN
 FOR j IN SELECT * FROM jsonb_array_elements(current_setting('nexus.test.jobs')::jsonb) LOOP
   IF public.prepare_push_delivery((j->>'id')::uuid,(j->>'lease_token')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Revocation/mute ignored'; END IF;
   PERFORM public.finish_push_delivery((j->>'id')::uuid,gen_random_uuid(),'sent');
   PERFORM public.finish_push_delivery((j->>'id')::uuid,(j->>'lease_token')::uuid,'retry');
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM private.push_deliveries WHERE status='queued' AND attempts=1 AND next_attempt_at>now())<>4 THEN RAISE EXCEPTION 'Retry or lease fencing failed'; END IF;
END $$;
-- Foreign identity, even with the known device ID, cannot use another session.
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.outsider'),'role','authenticated','session_id',current_setting('nexus.test.session'))::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.manage_push_device('remove',current_setting('nexus.test.device')::uuid);
   RAISE EXCEPTION 'Foreign device removed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Bitte melde dich erneut an.' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Test only addresses the current device and is rate limited.
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated','session_id',current_setting('nexus.test.session'))::text,true);
SET LOCAL ROLE authenticated;
SELECT public.manage_push_device('test',current_setting('nexus.test.device')::uuid);
DO $$ BEGIN
 BEGIN
   PERFORM public.manage_push_device('test',current_setting('nexus.test.device')::uuid);
   RAISE EXCEPTION 'Test rate limit missing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Bitte warte 30 Sekunden bis zum nächsten Test.' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE id=current_setting('nexus.test.session')::uuid;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM private.push_subscriptions) OR EXISTS(SELECT 1 FROM private.push_deliveries) THEN RAISE EXCEPTION 'Logout/session deletion retained push'; END IF;
END $$;
SELECT 'Push RLS, recipients, leases, retry, privacy, revocation, mute, rate limit and sign-out passed' AS result;
ROLLBACK;
