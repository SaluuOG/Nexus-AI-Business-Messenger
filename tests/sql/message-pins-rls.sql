-- Synthetic participants only. Every identity, message and pin rolls back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SELECT set_config('nexus.pin.owner', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.member', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.outsider', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.direct', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.group', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.dm', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.gm', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.dm2', gen_random_uuid()::text, true);
SELECT set_config('nexus.pin.gm2', gen_random_uuid()::text, true);

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT current_setting('nexus.pin.' || person)::uuid,
  current_setting('nexus.pin.' || person) || '@example.invalid', now(), '{"full_name":"Pin Test"}'::jsonb
FROM unnest(ARRAY['owner','member','outsider']) person;
INSERT INTO public.direct_conversations(id, user_a, user_b) VALUES (
  current_setting('nexus.pin.direct')::uuid,
  least(current_setting('nexus.pin.owner')::uuid, current_setting('nexus.pin.member')::uuid),
  greatest(current_setting('nexus.pin.owner')::uuid, current_setting('nexus.pin.member')::uuid));
INSERT INTO public.group_conversations(id, name, created_by) VALUES (current_setting('nexus.pin.group')::uuid, 'Pin Test', current_setting('nexus.pin.owner')::uuid);
INSERT INTO public.group_members(group_id, user_id, role)
SELECT current_setting('nexus.pin.group')::uuid, current_setting('nexus.pin.' || person)::uuid, CASE WHEN person='owner' THEN 'owner' ELSE 'member' END FROM unnest(ARRAY['owner','member']) person;
INSERT INTO public.direct_messages(id, conversation_id, sender_id, body)
SELECT current_setting('nexus.pin.' || message)::uuid, current_setting('nexus.pin.direct')::uuid, current_setting('nexus.pin.owner')::uuid, 'Pin Test'
FROM unnest(ARRAY['dm','dm2']) message;
INSERT INTO public.group_messages(id, group_id, sender_id, body)
SELECT current_setting('nexus.pin.' || message)::uuid, current_setting('nexus.pin.group')::uuid, current_setting('nexus.pin.owner')::uuid, 'Pin Test'
FROM unnest(ARRAY['gm','gm2']) message;

SET LOCAL ROLE authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('nexus.pin.owner'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; rows jsonb; denied boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.pin.' || kind)::uuid;
    msg := current_setting('nexus.pin.' || CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    PERFORM public.set_message_pin(kind,chat,msg,true);
    PERFORM public.set_message_pin(kind,chat,msg,true);
    rows := public.get_message_pins(kind,chat);
    ASSERT jsonb_array_length(rows)=1 AND rows->0->>'message_id'=msg::text, 'Idempotent pin';
    PERFORM public.set_message_pin(kind,chat,msg,false);
    ASSERT public.get_message_pins(kind,chat)='[]'::jsonb, 'Unpin';
    PERFORM public.set_message_pin(kind,chat,msg,true);
    denied:=false;
    BEGIN PERFORM public.set_message_pin(kind,gen_random_uuid(),msg,true); EXCEPTION WHEN OTHERS THEN denied:=true; END;
    ASSERT denied,'Forged scope denied';
  END LOOP;
END $$;

SELECT set_config('request.jwt.claim.sub', current_setting('nexus.pin.member'), true);
DO $$
DECLARE denied boolean:=false; changed integer;
BEGIN
  ASSERT jsonb_array_length(public.get_message_pins('group',current_setting('nexus.pin.group')::uuid))=1, 'Member sees group pin';
  BEGIN
    PERFORM public.set_message_pin('group',current_setting('nexus.pin.group')::uuid,current_setting('nexus.pin.gm')::uuid,false);
  EXCEPTION WHEN OTHERS THEN denied:=true; END;
  ASSERT denied,'Member cannot unpin via RPC';
  denied:=false;
  BEGIN
    INSERT INTO public.group_message_pins(message_id,group_id,pinned) VALUES (current_setting('nexus.pin.gm2')::uuid,current_setting('nexus.pin.group')::uuid,true);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  ASSERT denied,'Member direct INSERT blocked';
  UPDATE public.group_message_pins SET pinned=false;
  GET DIAGNOSTICS changed=ROW_COUNT;
  ASSERT changed=0,'Member direct UPDATE blocked';
  PERFORM public.set_message_pin('direct',current_setting('nexus.pin.direct')::uuid,current_setting('nexus.pin.dm')::uuid,false);
  ASSERT public.get_message_pins('direct',current_setting('nexus.pin.direct')::uuid)='[]'::jsonb,'Other direct participant can unpin';
  PERFORM public.set_message_pin('direct',current_setting('nexus.pin.direct')::uuid,current_setting('nexus.pin.dm')::uuid,true);
END $$;
RESET ROLE;
UPDATE public.group_members SET role='admin' WHERE user_id=current_setting('nexus.pin.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.set_message_pin('group',current_setting('nexus.pin.group')::uuid,current_setting('nexus.pin.gm')::uuid,false);
  PERFORM public.set_message_pin('group',current_setting('nexus.pin.group')::uuid,current_setting('nexus.pin.gm2')::uuid,true);
  ASSERT jsonb_array_length(public.get_message_pins('group',current_setting('nexus.pin.group')::uuid))=1, 'Admin can manage';
END $$;
RESET ROLE;
UPDATE public.group_members SET role='member' WHERE user_id=current_setting('nexus.pin.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;
BEGIN
  BEGIN PERFORM public.set_message_pin('group',current_setting('nexus.pin.group')::uuid,current_setting('nexus.pin.gm2')::uuid,false); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  ASSERT denied,'Demoted admin immediately blocked';
END $$;

SELECT set_config('request.jwt.claim.sub', current_setting('nexus.pin.outsider'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; denied boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.pin.'||kind)::uuid;
    msg := current_setting('nexus.pin.'||CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    ASSERT public.get_message_pins(kind,chat)='[]'::jsonb,'Outsider reads empty';
    denied:=false;
    BEGIN PERFORM public.set_message_pin(kind,chat,msg,true); EXCEPTION WHEN OTHERS THEN denied:=true; END;
    ASSERT denied,'Outsider writes denied';
  END LOOP;
END $$;
RESET ROLE;
UPDATE public.direct_messages SET body='',deleted_at=now() WHERE id=current_setting('nexus.pin.dm')::uuid;
UPDATE public.group_messages SET body='',deleted_at=now() WHERE id=current_setting('nexus.pin.gm2')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('nexus.pin.owner'), true);
DO $$ BEGIN
  ASSERT public.get_message_pins('direct',current_setting('nexus.pin.direct')::uuid)='[]'::jsonb,'Deleted direct text not exposed';
  ASSERT public.get_message_pins('group',current_setting('nexus.pin.group')::uuid)='[]'::jsonb,'Deleted group text not exposed';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_table_privilege('anon','public.direct_message_pins','SELECT'), 'No anonymous access';
  ASSERT NOT has_column_privilege('authenticated','public.group_message_pins','group_id','UPDATE'), 'Cannot reassign scope';
  ASSERT NOT has_function_privilege('anon','public.set_message_pin(text,uuid,uuid,boolean)','EXECUTE'),'No anonymous RPC';
END $$;
ROLLBACK;
