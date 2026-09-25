-- Synthetic participants only. Every identity, message and reaction rolls back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SELECT set_config('nexus.reaction.owner', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.member', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.outsider', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.direct', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.group', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.dm', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.gm', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.dm2', gen_random_uuid()::text, true);
SELECT set_config('nexus.reaction.gm2', gen_random_uuid()::text, true);

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT current_setting('nexus.reaction.' || person)::uuid,
  current_setting('nexus.reaction.' || person) || '@example.invalid', now(), '{"full_name":"Reaction Test"}'::jsonb
FROM unnest(ARRAY['owner','member','outsider']) person;
INSERT INTO public.direct_conversations(id, user_a, user_b) VALUES (
  current_setting('nexus.reaction.direct')::uuid,
  least(current_setting('nexus.reaction.owner')::uuid, current_setting('nexus.reaction.member')::uuid),
  greatest(current_setting('nexus.reaction.owner')::uuid, current_setting('nexus.reaction.member')::uuid));
INSERT INTO public.group_conversations(id, name, created_by) VALUES (current_setting('nexus.reaction.group')::uuid, 'Reaction Test', current_setting('nexus.reaction.owner')::uuid);
INSERT INTO public.group_members(group_id, user_id, role)
SELECT current_setting('nexus.reaction.group')::uuid, current_setting('nexus.reaction.' || person)::uuid, CASE WHEN person='owner' THEN 'owner' ELSE 'member' END FROM unnest(ARRAY['owner','member']) person;
INSERT INTO public.direct_messages(id, conversation_id, sender_id, body)
SELECT current_setting('nexus.reaction.' || message)::uuid, current_setting('nexus.reaction.direct')::uuid, current_setting('nexus.reaction.owner')::uuid, 'Reaction Test'
FROM unnest(ARRAY['dm','dm2']) message;
INSERT INTO public.group_messages(id, group_id, sender_id, body)
SELECT current_setting('nexus.reaction.' || message)::uuid, current_setting('nexus.reaction.group')::uuid, current_setting('nexus.reaction.owner')::uuid, 'Reaction Test'
FROM unnest(ARRAY['gm','gm2']) message;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('nexus.reaction.owner'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; rows jsonb;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.reaction.' || kind)::uuid;
    msg := current_setting('nexus.reaction.' || CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    PERFORM public.set_message_reaction(kind,chat,msg,'❤️');
    PERFORM public.set_message_reaction(kind,chat,msg,'❤️');
    rows := public.get_message_reactions(kind,chat,ARRAY[msg]);
    ASSERT jsonb_array_length(rows)=1 AND (rows->0->>'count')::integer=1 AND (rows->0->>'mine')::boolean, 'Idempotent own reaction';
    PERFORM public.set_message_reaction(kind,chat,msg,'👍');
    rows := public.get_message_reactions(kind,chat,ARRAY[msg]);
    ASSERT jsonb_array_length(rows)=1 AND rows->0->>'emoji'='👍', 'Replace reaction';
    PERFORM public.set_message_reaction(kind,chat,msg,NULL);
    ASSERT public.get_message_reactions(kind,chat,ARRAY[msg])='[]'::jsonb, 'Remove reaction';
    PERFORM public.set_message_reaction(kind,chat,msg,'❤️');
  END LOOP;
END $$;

SELECT set_config('request.jwt.claim.sub', current_setting('nexus.reaction.member'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; second_msg uuid; rows jsonb; changed integer; denied boolean; statement text; scope_column text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.reaction.' || kind)::uuid;
    msg := current_setting('nexus.reaction.' || CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    second_msg := current_setting('nexus.reaction.' || CASE WHEN kind='direct' THEN 'dm2' ELSE 'gm2' END)::uuid;
    scope_column := CASE WHEN kind='direct' THEN 'conversation_id' ELSE 'group_id' END;
    rows := public.get_message_reactions(kind,chat,ARRAY[msg]);
    ASSERT NOT (rows->0->>'mine')::boolean, 'Other participant reaction is visible';
    PERFORM public.set_message_reaction(kind,chat,msg,'❤️');
    rows := public.get_message_reactions(kind,chat,ARRAY[msg]);
    ASSERT (rows->0->>'count')::integer=2 AND (rows->0->>'mine')::boolean, 'Aggregate both participants';
    EXECUTE format('UPDATE public.%I SET emoji=NULL WHERE user_id=%L',kind||'_message_reactions',current_setting('nexus.reaction.owner'));
    GET DIAGNOSTICS changed=ROW_COUNT;
    ASSERT changed=0, 'Cannot edit another participant reaction';
    FOREACH statement IN ARRAY ARRAY[
      format('INSERT INTO public.%I (message_id,%I,user_id,emoji) VALUES (%L,%L,%L,''👍'')',kind||'_message_reactions',scope_column,second_msg,chat,current_setting('nexus.reaction.owner')),
      format('UPDATE public.%I SET user_id=%L WHERE user_id=auth.uid()',kind||'_message_reactions',current_setting('nexus.reaction.owner')),
      format('UPDATE public.%I SET emoji=''unsupported'' WHERE user_id=auth.uid()',kind||'_message_reactions'),
      format('INSERT INTO public.%I (message_id,%I,user_id,emoji) VALUES (%L,%L,auth.uid(),''👍'')',kind||'_message_reactions',scope_column,second_msg,gen_random_uuid()),
      format('SELECT public.set_message_reaction(%L,%L,%L,''❤️'')',kind,gen_random_uuid(),msg)
    ] LOOP
      denied := false;
      BEGIN EXECUTE statement;
      EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN denied := true; END;
      ASSERT denied, 'Forged ownership/scope/emoji must fail';
    END LOOP;
  END LOOP;
END $$;

SELECT set_config('request.jwt.claim.sub', current_setting('nexus.reaction.outsider'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; denied boolean; visible integer;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.reaction.' || kind)::uuid;
    msg := current_setting('nexus.reaction.' || CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    ASSERT public.get_message_reactions(kind,chat,ARRAY[msg])='[]'::jsonb, 'Outsider RPC must reveal nothing';
    EXECUTE format('SELECT count(*) FROM public.%I',kind||'_message_reactions') INTO visible;
    ASSERT visible=0, 'Outsider direct reads must reveal nothing';
    denied := false;
    BEGIN PERFORM public.set_message_reaction(kind,chat,msg,'❤️'); EXCEPTION WHEN raise_exception THEN denied := true; END;
    ASSERT denied, 'Outsider write denied';
  END LOOP;
END $$;

RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.reaction.group')::uuid AND user_id=current_setting('nexus.reaction.member')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('nexus.reaction.member'), true);
DO $$
DECLARE chat uuid:=current_setting('nexus.reaction.group')::uuid; msg uuid:=current_setting('nexus.reaction.gm')::uuid; denied boolean:=false;
BEGIN
  ASSERT public.get_message_reactions('group',chat,ARRAY[msg])='[]'::jsonb, 'Removed group member loses access';
  BEGIN PERFORM public.set_message_reaction('group',chat,msg,NULL); EXCEPTION WHEN raise_exception THEN denied:=true; END;
  ASSERT denied, 'Removed member cannot mutate';
END $$;

RESET ROLE;
UPDATE public.direct_messages SET deleted_at=now() WHERE id=current_setting('nexus.reaction.dm')::uuid;
UPDATE public.group_messages SET deleted_at=now() WHERE id=current_setting('nexus.reaction.gm')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('nexus.reaction.owner'), true);
DO $$
DECLARE kind text; chat uuid; msg uuid; denied boolean;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.reaction.' || kind)::uuid;
    msg := current_setting('nexus.reaction.' || CASE WHEN kind='direct' THEN 'dm' ELSE 'gm' END)::uuid;
    ASSERT public.get_message_reactions(kind,chat,ARRAY[msg])='[]'::jsonb, 'Deleted message reactions are hidden';
    denied := false;
    BEGIN PERFORM public.set_message_reaction(kind,chat,msg,'❤️'); EXCEPTION WHEN raise_exception THEN denied:=true; END;
    ASSERT denied, 'Deleted message cannot receive reactions';
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon','public.get_message_reactions(text,uuid,uuid[])','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.set_message_reaction(text,uuid,uuid,text)','EXECUTE');
  ASSERT NOT has_table_privilege('anon','public.direct_message_reactions','SELECT');
  ASSERT NOT has_table_privilege('anon','public.group_message_reactions','SELECT');
END $$;
RESET ROLE;
DO $$
DECLARE table_name text; identity_columns text[];
BEGIN
  FOREACH table_name IN ARRAY ARRAY['direct_message_reactions','group_message_reactions'] LOOP
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO identity_columns
    FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid=('public.'||table_name)::regclass AND i.indisprimary;
    ASSERT identity_columns=ARRAY['id'], 'Cascade deletes must not broadcast user/message identifiers';
    ASSERT (SELECT relreplident='d' AND relrowsecurity FROM pg_class WHERE oid=('public.'||table_name)::regclass);
  END LOOP;
END $$;
SELECT 'PASS: reaction persistence, replacement, removal, idempotency, counts, permissions, revoked membership and deleted messages' AS result;
ROLLBACK;
