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
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.owner'),'role','authenticated')::text,true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body)
SELECT current_setting('nexus.test.chat')::uuid,current_setting('nexus.test.owner')::uuid,'Private rollback message body ' || n FROM generate_series(1,30) n;
INSERT INTO public.group_messages(group_id,sender_id,body) VALUES
  (current_setting('nexus.test.group')::uuid,current_setting('nexus.test.owner')::uuid,'Private rollback group body');
INSERT INTO public.contact_requests(id,sender_id,recipient_id) VALUES
  (current_setting('nexus.test.contact')::uuid,current_setting('nexus.test.outsider')::uuid,current_setting('nexus.test.member')::uuid);
INSERT INTO public.workspace_invitations(id,workspace_id,email,invited_by) VALUES
  (current_setting('nexus.test.invite')::uuid,current_setting('nexus.test.invite_ws')::uuid,current_setting('nexus.test.member') || '@example.invalid',current_setting('nexus.test.owner')::uuid);
INSERT INTO public.project_tasks(id,workspace_id,project_id,title,assigned_to,due_date) VALUES
  (current_setting('nexus.test.task')::uuid,current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.project')::uuid,'Today task rollback',current_setting('nexus.test.member')::uuid,(now() AT TIME ZONE 'UTC')::date),
  (current_setting('nexus.test.past_task')::uuid,current_setting('nexus.test.ws')::uuid,current_setting('nexus.test.project')::uuid,'Past task rollback',current_setting('nexus.test.member')::uuid,(now() AT TIME ZONE 'UTC')::date - 1);

SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f jsonb; again jsonb; page2 jsonb;
BEGIN
  f := public.get_my_notifications('UTC',NULL,5,false);
  IF (f->>'unread_count')::int <> 37 OR jsonb_array_length(f->'items') <> 5 OR NOT (f->>'has_more')::boolean THEN RAISE EXCEPTION 'Global count or page size incorrect: %',f; END IF;
  IF f::text LIKE '%Private rollback%' THEN RAISE EXCEPTION 'Message body was copied into notification'; END IF;
  PERFORM set_config('nexus.test.through',f->>'through_id',true);
  page2 := public.get_my_notifications('UTC',(f->'items'->4->>'id')::bigint,5,false);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(f->'items') a JOIN jsonb_array_elements(page2->'items') b ON a->>'id'=b->>'id') THEN RAISE EXCEPTION 'Pagination duplicate'; END IF;
  again := public.get_my_notifications('UTC',NULL,100,false);
  IF (again->>'unread_count')::int <> 37 THEN RAISE EXCEPTION 'Repeated deadline sync duplicated events'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(again->'items') item WHERE item->>'kind'='workspace_invitation' AND item->'details'->>'invite_token' IS NOT NULL) THEN RAISE EXCEPTION 'Recipient cannot resolve invitation'; END IF;
  BEGIN
    INSERT INTO public.notifications(recipient_id,kind,source_id,event_key) VALUES (auth.uid(),'task_assigned',gen_random_uuid(),'forged');
    RAISE EXCEPTION 'Client forged notification';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.notifications SET recipient_id=current_setting('nexus.test.outsider')::uuid;
    RAISE EXCEPTION 'Client changed recipient';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.notifications;
    RAISE EXCEPTION 'Client deleted notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- An event arriving after the snapshot must survive mark-all.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.owner'),'role','authenticated')::text,true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES
  (current_setting('nexus.test.chat')::uuid,current_setting('nexus.test.owner')::uuid,'Concurrent rollback event');
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT public.mark_notifications_read(current_setting('nexus.test.through')::bigint,NULL,'UTC');
DO $$ DECLARE f jsonb;
BEGIN
  f := public.get_my_notifications('UTC');
  IF (f->>'unread_count')::int <> 1 THEN RAISE EXCEPTION 'Mark-all consumed concurrent event'; END IF;
  PERFORM public.set_notification_preference('messages',false);
  f := public.get_my_notifications('UTC');
  IF (f->>'unread_count')::int <> 0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(f->'items') item WHERE item->>'kind' IN ('direct_message','group_message')) THEN RAISE EXCEPTION 'Disabled category still visible'; END IF;
  PERFORM public.set_notification_preference('messages',true);
  IF (public.get_my_notifications('UTC')->>'unread_count')::int <> 1 THEN RAISE EXCEPTION 'Preference reset read state'; END IF;
  PERFORM public.set_notification_preference('deadlines',false);
  IF NOT (SELECT messages FROM public.notification_preferences WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'Preference overwrote another category'; END IF;
  PERFORM public.set_notification_preference('deadlines',true);
  BEGIN
    PERFORM public.set_notification_preference('admin',true);
    RAISE EXCEPTION 'Unknown category accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Ungültige Benachrichtigungseinstellung.' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.get_my_notifications('invalid/timezone');
    RAISE EXCEPTION 'Invalid timezone accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Ungültige Zeitzone.' THEN RAISE; END IF; END;
END $$;

-- Foreign accounts cannot read, mark or recover details for another recipient.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.outsider'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notifications) OR private.notification_details(current_setting('nexus.test.through')::bigint) IS NOT NULL THEN RAISE EXCEPTION 'Foreign notifications exposed'; END IF;
  PERFORM public.mark_notifications_read(9223372036854775807,NULL,'UTC');
  IF EXISTS(SELECT 1 FROM public.notification_preferences WHERE user_id=current_setting('nexus.test.member')::uuid) THEN RAISE EXCEPTION 'Foreign preferences exposed'; END IF;
  BEGIN
    INSERT INTO public.notification_preferences(user_id) VALUES(current_setting('nexus.test.member')::uuid);
    RAISE EXCEPTION 'Foreign preference insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (public.get_my_notifications('UTC')->>'unread_count')::int <> 0 THEN RAISE EXCEPTION 'Foreign feed not empty'; END IF;
END $$;

-- A real chat read updates its hints, without mark-all forging chat receipts.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.test.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT public.mark_direct_conversation_read(current_setting('nexus.test.chat')::uuid);
DO $$ BEGIN
  IF (public.get_my_notifications('UTC')->>'unread_count')::int <> 0 THEN RAISE EXCEPTION 'Chat read did not update hints'; END IF;
END $$;

-- Resolve metadata against current access and lifecycle, including revoked
-- invitations, answered requests, soft deletion, deadlines and removed members.
RESET ROLE;
UPDATE public.workspace_invitations SET revoked_at=now() WHERE id=current_setting('nexus.test.invite')::uuid;
UPDATE public.contact_requests SET status='declined',responded_at=now() WHERE id=current_setting('nexus.test.contact')::uuid;
UPDATE public.direct_messages SET deleted_at=now(),body='' WHERE conversation_id=current_setting('nexus.test.chat')::uuid;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.test.group')::uuid AND user_id=current_setting('nexus.test.member')::uuid;
UPDATE public.project_tasks SET status='done' WHERE id=current_setting('nexus.test.task')::uuid;
UPDATE public.project_tasks SET due_date=(now() AT TIME ZONE 'UTC')::date + 5 WHERE id=current_setting('nexus.test.past_task')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f jsonb;
BEGIN
  f := public.get_my_notifications('UTC');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(f->'items') item WHERE item->>'kind' <> 'task_assigned') THEN RAISE EXCEPTION 'Inaccessible or obsolete hint returned: %',f; END IF;
END $$;
RESET ROLE;
DELETE FROM public.workspace_members WHERE workspace_id=current_setting('nexus.test.ws')::uuid AND user_id=current_setting('nexus.test.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.notifications) THEN RAISE EXCEPTION 'Workspace data leaked after membership removal'; END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.notifications; RAISE EXCEPTION 'Anonymous table read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_my_notifications(); RAISE EXCEPTION 'Anonymous RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Notification triggers, 37-event counts, pagination, deduplication, snapshot marking, preferences, chat reads, source revocation and account isolation passed' AS result;
ROLLBACK;
