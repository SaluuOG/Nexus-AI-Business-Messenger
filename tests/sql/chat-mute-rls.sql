-- Synthetic accounts only; no notifications are sent. Always rolled back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT set_config('nexus.mute.a',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.b',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.other',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.direct',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.group',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.session',gen_random_uuid()::text,true);
SELECT set_config('nexus.mute.subscription',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.mute.'||person)::uuid,current_setting('nexus.mute.'||person)||'@example.invalid',now(),'{"full_name":"Mute test"}'::jsonb FROM unnest(ARRAY['a','b','other']) person;
INSERT INTO public.direct_conversations(id,user_a,user_b) VALUES(current_setting('nexus.mute.direct')::uuid,least(current_setting('nexus.mute.a')::uuid,current_setting('nexus.mute.b')::uuid),greatest(current_setting('nexus.mute.a')::uuid,current_setting('nexus.mute.b')::uuid));
INSERT INTO public.group_conversations(id,name,created_by) VALUES(current_setting('nexus.mute.group')::uuid,'Mute test',current_setting('nexus.mute.a')::uuid);
INSERT INTO public.group_members(group_id,user_id,role) SELECT current_setting('nexus.mute.group')::uuid,current_setting('nexus.mute.'||person)::uuid,CASE WHEN person='a' THEN 'owner' ELSE 'member' END FROM unnest(ARRAY['a','b']) person;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.a'),'role','authenticated')::text,true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES(current_setting('nexus.mute.direct')::uuid,current_setting('nexus.mute.a')::uuid,'Before mute');
INSERT INTO public.group_messages(group_id,sender_id,body) VALUES(current_setting('nexus.mute.group')::uuid,current_setting('nexus.mute.a')::uuid,'Before mute');
-- Create synthetic queued deliveries without waking a worker or touching real jobs.
INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(current_setting('nexus.mute.session')::uuid,current_setting('nexus.mute.b')::uuid,now(),now());
INSERT INTO private.push_subscriptions(id,user_id,session_id,device_id,endpoint,p256dh,auth_key)
VALUES(current_setting('nexus.mute.subscription')::uuid,current_setting('nexus.mute.b')::uuid,current_setting('nexus.mute.session')::uuid,gen_random_uuid(),'https://example.invalid/'||gen_random_uuid(),repeat('A',87),repeat('B',22));
INSERT INTO private.push_deliveries(subscription_id,notification_id,status,lease_token,next_attempt_at)
SELECT current_setting('nexus.mute.subscription')::uuid,id,'sending',gen_random_uuid(),now()+interval '1 minute' FROM public.notifications WHERE recipient_id=current_setting('nexus.mute.b')::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.b'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE k text; r jsonb;
BEGIN
  ASSERT (public.get_my_notifications()->>'unread_count')::int=2,'Initial direct/group hints';
  FOREACH k IN ARRAY ARRAY['direct','group'] LOOP
    PERFORM public.set_chat_organization(k,current_setting('nexus.mute.'||k)::uuid,'favorite',true);
    PERFORM public.set_chat_organization(k,current_setting('nexus.mute.'||k)::uuid,'archived',true);
    PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'1h');
    r:=public.get_chat_organization(k)->0;
    ASSERT (r->>'muted_until')::timestamptz=now()+interval '1 hour','Server-clock one-hour deadline';
    ASSERT NOT (r->>'muted_forever')::boolean AND (r->>'favorite')::boolean AND (r->>'archived')::boolean,'Independent preferences';
    PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'8h');
    ASSERT (public.get_chat_organization(k)->0->>'muted_until')::timestamptz=now()+interval '8 hours','Eight-hour deadline';
    PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'forever');
    r:=public.get_chat_organization(k)->0;
    ASSERT r->>'muted_until' IS NULL AND (r->>'muted_forever')::boolean,'Permanent mute';
    BEGIN PERFORM public.set_chat_mute(k,gen_random_uuid(),'off'); RAISE EXCEPTION 'Forged chat allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'invalid'); RAISE EXCEPTION 'Invalid mode allowed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,NULL); RAISE EXCEPTION 'Null mode allowed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  ASSERT (public.get_my_notifications()->>'unread_count')::int=0,'Muted hints excluded from count';
  ASSERT jsonb_array_length(public.get_my_notifications()->'items')=0,'Muted hints excluded from feed';
  PERFORM public.mark_notifications_read(9223372036854775807);
  BEGIN UPDATE public.direct_chat_preferences SET muted_until=now(); RAISE EXCEPTION 'Client timestamp allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.chat_is_muted(current_setting('nexus.mute.a')::uuid,'direct',current_setting('nexus.mute.direct')::uuid); RAISE EXCEPTION 'Internal helper callable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE job record; BEGIN
  FOR job IN SELECT id,lease_token FROM private.push_deliveries WHERE subscription_id=current_setting('nexus.mute.subscription')::uuid LOOP
    ASSERT private.prepare_push_delivery(job.id,job.lease_token) IS NULL,'Queued push suppressed before dispatch';
  END LOOP;
  ASSERT NOT EXISTS(SELECT 1 FROM public.notifications WHERE recipient_id=current_setting('nexus.mute.b')::uuid AND read_at IS NOT NULL),'Muting and mark-all do not forge read receipts';
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.a'),'role','authenticated')::text,true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES(current_setting('nexus.mute.direct')::uuid,current_setting('nexus.mute.a')::uuid,'During mute');
INSERT INTO public.group_messages(group_id,sender_id,body) VALUES(current_setting('nexus.mute.group')::uuid,current_setting('nexus.mute.a')::uuid,'During mute');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM private.push_deliveries WHERE subscription_id=current_setting('nexus.mute.subscription')::uuid)=2,'Muted arrivals cannot queue delayed push';
  ASSERT (SELECT count(*) FROM public.notifications WHERE recipient_id=current_setting('nexus.mute.b')::uuid)=4,'Hints retained without copying/deleting messages';
  ASSERT (SELECT muted_forever AND favorite AND NOT archived FROM public.direct_chat_preferences WHERE user_id=current_setting('nexus.mute.b')::uuid),'Incoming message revives archive but preserves mute';
END $$;
-- Remove the synthetic subscription before any unmuted insert; never dispatch.
DELETE FROM private.push_subscriptions WHERE id=current_setting('nexus.mute.subscription')::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.b'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT unread_count FROM public.get_direct_conversations() WHERE conversation_id=current_setting('nexus.mute.direct')::uuid)=2,'Direct unread count preserved';
  ASSERT (SELECT unread_count FROM public.get_my_group_chats() WHERE group_id=current_setting('nexus.mute.group')::uuid)=2,'Group unread count preserved';
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.other'),'role','authenticated')::text,true);
DO $$ DECLARE k text; BEGIN
  FOREACH k IN ARRAY ARRAY['direct','group'] LOOP
    ASSERT public.get_chat_organization(k)='[]'::jsonb,'Other account cannot read mute';
    BEGIN PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'off'); RAISE EXCEPTION 'Outsider can unmute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
-- Simulate expiration in the database; no clock waiting or weakened production limit.
UPDATE public.direct_chat_preferences SET muted_forever=false,muted_until=now()-interval '1 second' WHERE user_id=current_setting('nexus.mute.b')::uuid;
UPDATE public.group_chat_preferences SET muted_forever=false,muted_until=now()-interval '1 second' WHERE user_id=current_setting('nexus.mute.b')::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('nexus.mute.b'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE k text; BEGIN
  ASSERT (public.get_my_notifications()->>'unread_count')::int=4,'Expiry restores hints with original unread state';
  FOREACH k IN ARRAY ARRAY['direct','group'] LOOP
    PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'forever');
    PERFORM public.set_chat_mute(k,current_setting('nexus.mute.'||k)::uuid,'off');
    ASSERT NOT (public.get_chat_organization(k)->0->>'muted_forever')::boolean AND public.get_chat_organization(k)->0->>'muted_until' IS NULL,'Manual unmute clears both fields';
  END LOOP;
  ASSERT (public.get_my_notifications()->>'unread_count')::int=4,'Manual unmute restores hints';
END $$;
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.mute.group')::uuid AND user_id=current_setting('nexus.mute.b')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.get_chat_organization('group')='[]'::jsonb,'Membership removal clears mute';
  BEGIN PERFORM public.set_chat_mute('group',current_setting('nexus.mute.group')::uuid,'forever'); RAISE EXCEPTION 'Former member can mute'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon','public.set_chat_mute(text,uuid,text)','EXECUTE'),'No anonymous writes';
  ASSERT NOT has_table_privilege('authenticated','public.direct_chat_preferences','UPDATE'),'No raw preference updates';
  ASSERT NOT has_function_privilege('authenticated','private.chat_is_muted(uuid,text,uuid)','EXECUTE'),'No private account probing';
END $$;
SELECT 'Chat mute durations, privacy, feed/count/read state, expiry, archive, membership and Web Push suppression passed' AS result;
ROLLBACK;
