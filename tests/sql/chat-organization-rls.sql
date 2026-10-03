-- Synthetic test only. No real account/message/preferences are changed.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT set_config('nexus.org.a',gen_random_uuid()::text,true);
SELECT set_config('nexus.org.b',gen_random_uuid()::text,true);
SELECT set_config('nexus.org.outsider',gen_random_uuid()::text,true);
SELECT set_config('nexus.org.direct',gen_random_uuid()::text,true);
SELECT set_config('nexus.org.group',gen_random_uuid()::text,true);
SELECT set_config('nexus.org.request',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.org.'||person)::uuid,current_setting('nexus.org.'||person)||'@example.invalid',now(),'{"full_name":"Organization Test"}'::jsonb FROM unnest(ARRAY['a','b','outsider']) person;
INSERT INTO public.direct_conversations(id,user_a,user_b) VALUES(current_setting('nexus.org.direct')::uuid,least(current_setting('nexus.org.a')::uuid,current_setting('nexus.org.b')::uuid),greatest(current_setting('nexus.org.a')::uuid,current_setting('nexus.org.b')::uuid));
INSERT INTO public.group_conversations(id,name,created_by) VALUES(current_setting('nexus.org.group')::uuid,'Organization Test',current_setting('nexus.org.a')::uuid);
INSERT INTO public.group_members(group_id,user_id,role) SELECT current_setting('nexus.org.group')::uuid,current_setting('nexus.org.'||person)::uuid,CASE WHEN person='a' THEN 'owner' ELSE 'member' END FROM unnest(ARRAY['a','b']) person;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('nexus.org.a'),true);
DO $$ DECLARE kind text; chat uuid; rows jsonb; denied boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.org.'||kind)::uuid;
    PERFORM public.set_chat_organization(kind,chat,'favorite',true);
    PERFORM public.set_chat_organization(kind,chat,'archived',true);
    PERFORM public.set_chat_organization(kind,chat,'favorite',true);
    rows:=public.get_chat_organization(kind);
    ASSERT jsonb_array_length(rows)=1 AND (rows->0->>'favorite')::boolean AND (rows->0->>'archived')::boolean,'Independent idempotent fields';
    PERFORM public.set_chat_organization(kind,chat,'favorite',false);
    ASSERT (public.get_chat_organization(kind)->0->>'archived')::boolean,'Favorite removal preserves archive';
    PERFORM public.set_chat_organization(kind,chat,'favorite',true);
    denied:=false;
    BEGIN PERFORM public.set_chat_organization(kind,gen_random_uuid(),'archived',true); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    ASSERT denied,'Forged chat denied';
  END LOOP;
  denied:=false;
  BEGIN UPDATE public.direct_chat_preferences SET user_id=current_setting('nexus.org.b')::uuid; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  ASSERT denied,'Direct table writes blocked';
  denied:=false;
  BEGIN PERFORM public.set_chat_organization('direct',current_setting('nexus.org.direct')::uuid,'user_id',true); EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
  ASSERT denied,'Unknown fields denied';
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('nexus.org.b'),true);
DO $$ DECLARE kind text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    ASSERT public.get_chat_organization(kind)='[]'::jsonb,'Other participant cannot read preferences';
    PERFORM public.set_chat_organization(kind,current_setting('nexus.org.'||kind)::uuid,'archived',true);
    ASSERT NOT (public.get_chat_organization(kind)->0->>'favorite')::boolean,'Member manages only own preferences';
  END LOOP;
  ASSERT (SELECT count(*) FROM public.direct_chat_preferences)=1,'RLS hides other participant row';
  ASSERT (SELECT count(*) FROM public.group_chat_preferences)=1,'Group RLS hides other member row';
END $$;
SELECT set_config('request.jwt.claim.sub',current_setting('nexus.org.outsider'),true);
DO $$ DECLARE kind text; denied boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    ASSERT public.get_chat_organization(kind)='[]'::jsonb,'Outsider reads nothing';
    denied:=false;
    BEGIN PERFORM public.set_chat_organization(kind,current_setting('nexus.org.'||kind)::uuid,'favorite',true); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    ASSERT denied,'Outsider cannot change preferences';
  END LOOP;
END $$;
RESET ROLE;
-- Deliberately backdated messages: revival uses INSERT, never client/server clocks.
INSERT INTO public.direct_messages(conversation_id,sender_id,body,created_at) VALUES(current_setting('nexus.org.direct')::uuid,current_setting('nexus.org.b')::uuid,'Incoming','2020-01-01');
INSERT INTO public.group_messages(group_id,sender_id,body,created_at) VALUES(current_setting('nexus.org.group')::uuid,current_setting('nexus.org.b')::uuid,'Incoming','2020-01-01');
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.direct_chat_preferences WHERE conversation_id=current_setting('nexus.org.direct')::uuid AND archived),'Incoming direct message revives both personal archives';
  ASSERT NOT EXISTS(SELECT 1 FROM public.group_chat_preferences WHERE group_id=current_setting('nexus.org.group')::uuid AND archived),'Incoming group message revives all personal archives';
  ASSERT (SELECT favorite FROM public.direct_chat_preferences WHERE conversation_id=current_setting('nexus.org.direct')::uuid AND user_id=current_setting('nexus.org.a')::uuid),'Favorite survives revival';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('nexus.org.a'),true);
SELECT public.set_chat_organization('direct',current_setting('nexus.org.direct')::uuid,'archived',true);
SELECT public.set_chat_organization('group',current_setting('nexus.org.group')::uuid,'archived',true);
RESET ROLE;
UPDATE public.direct_messages SET body='Edited',edited_at=now() WHERE conversation_id=current_setting('nexus.org.direct')::uuid;
UPDATE public.group_messages SET body='',deleted_at=now() WHERE group_id=current_setting('nexus.org.group')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (public.get_chat_organization('direct')->0->>'archived')::boolean,'Edit preserves archive';
  ASSERT (public.get_chat_organization('group')->0->>'archived')::boolean,'Deletion preserves archive';
  PERFORM public.send_direct_message_v3(current_setting('nexus.org.direct')::uuid,'Retry test',current_setting('nexus.org.request')::uuid,NULL);
  ASSERT NOT (public.get_chat_organization('direct')->0->>'archived')::boolean,'Own new message also revives';
  PERFORM public.set_chat_organization('direct',current_setting('nexus.org.direct')::uuid,'archived',true);
  PERFORM public.send_direct_message_v3(current_setting('nexus.org.direct')::uuid,'Retry test',current_setting('nexus.org.request')::uuid,NULL);
  ASSERT (public.get_chat_organization('direct')->0->>'archived')::boolean,'Repeated send request does not revive again';
END $$;
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.org.group')::uuid AND user_id=current_setting('nexus.org.b')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('nexus.org.b'),true);
DO $$ DECLARE denied boolean:=false;
BEGIN
  ASSERT public.get_chat_organization('group')='[]'::jsonb,'Membership removal revokes access';
  BEGIN PERFORM public.set_chat_organization('group',current_setting('nexus.org.group')::uuid,'favorite',true); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  ASSERT denied,'Former member cannot write';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.group_chat_preferences WHERE group_id=current_setting('nexus.org.group')::uuid AND user_id=current_setting('nexus.org.b')::uuid),'Membership deletion removes preferences';
  ASSERT NOT has_table_privilege('anon','public.direct_chat_preferences','SELECT'),'No anon reads';
  ASSERT NOT has_table_privilege('authenticated','public.group_chat_preferences','UPDATE'),'No client table writes';
  ASSERT NOT has_function_privilege('anon','public.set_chat_organization(text,uuid,text,boolean)','EXECUTE'),'No anon RPC';
  ASSERT NOT has_function_privilege('authenticated','private.unarchive_chat_on_message()','EXECUTE'),'Trigger not directly callable';
END $$;
ROLLBACK;
