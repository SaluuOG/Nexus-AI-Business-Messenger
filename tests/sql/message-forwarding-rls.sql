-- Synthetic accounts only; all messages, sessions and notification side effects
-- roll back. No real recipient or network delivery is used for acceptance.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
CREATE FUNCTION pg_temp.fv(k text) RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('nexus.forward.'||k)::uuid$$;
CREATE FUNCTION pg_temp.fcheck(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',why; END IF; END$$;
CREATE FUNCTION pg_temp.flogin(k text) RETURNS void LANGUAGE sql AS $$SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fv(k),'role','authenticated','session_id',pg_temp.fv(k||'_session'))::text,true)$$;
CREATE FUNCTION pg_temp.fdenied(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Unexpected acceptance: %',statement; END$$;
SELECT set_config('nexus.forward.'||k,gen_random_uuid()::text,true) FROM unnest(ARRAY[
  'owner','peer','target','outsider','owner_session','peer_session','target_session','outsider_session',
  'direct','direct_target','foreign_direct','group','group_target','foreign_group','dm','gm','foreign_dm','foreign_gm','long_dm','attached_dm','attached_gm'
]) k;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT pg_temp.fv(k),gen_random_uuid()||'@example.invalid',now(),'{"full_name":"Forward rollback"}' FROM unnest(ARRAY['owner','peer','target','outsider']) k;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
SELECT pg_temp.fv(k||'_session'),pg_temp.fv(k),now(),now() FROM unnest(ARRAY['owner','peer','target','outsider']) k;
INSERT INTO public.profiles(id,full_name,username)
SELECT pg_temp.fv(k),'Forward '||k,'fwd'||left(replace(pg_temp.fv(k)::text,'-',''),16) FROM unnest(ARRAY['owner','peer','target','outsider']) k
ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name;
INSERT INTO public.direct_conversations(id,user_a,user_b)
SELECT pg_temp.fv(chat),least(pg_temp.fv(a),pg_temp.fv(b)),greatest(pg_temp.fv(a),pg_temp.fv(b))
FROM (VALUES('direct','owner','peer'),('direct_target','owner','target'),('foreign_direct','peer','outsider')) pair(chat,a,b);
INSERT INTO public.group_conversations(id,name,created_by)
SELECT pg_temp.fv(k),'Forward '||k,pg_temp.fv(CASE WHEN k='foreign_group' THEN 'outsider' ELSE 'owner' END) FROM unnest(ARRAY['group','group_target','foreign_group']) k;
INSERT INTO public.group_members(group_id,user_id,role)
SELECT pg_temp.fv(chat),pg_temp.fv(person),role FROM (VALUES('group','owner','owner'),('group','peer','member'),('group_target','owner','owner'),('group_target','target','member'),('foreign_group','outsider','owner')) members(chat,person,role);
INSERT INTO public.direct_messages(id,conversation_id,sender_id,body)
SELECT pg_temp.fv(msg),pg_temp.fv(chat),pg_temp.fv(sender),body FROM (VALUES
 ('dm','direct','peer',E'  Angebot 👨‍👩‍👧‍👦\nhttps://example.invalid/?a=1&b=2\nGrüße <b>Team</b>  '),
 ('foreign_dm','foreign_direct','outsider','Secret'),('long_dm','direct','peer',repeat('😀',5000)),('attached_dm','direct','peer','Caption')) v(msg,chat,sender,body);
INSERT INTO public.group_messages(id,group_id,sender_id,body)
SELECT pg_temp.fv(msg),pg_temp.fv(chat),pg_temp.fv(sender),body FROM (VALUES('gm','group','peer','Team text'),('foreign_gm','foreign_group','outsider','Secret'),('attached_gm','group','peer','Caption')) v(msg,chat,sender,body);
INSERT INTO public.direct_message_attachments(message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,file_size)
VALUES(pg_temp.fv('attached_dm'),pg_temp.fv('direct'),pg_temp.fv('peer'),pg_temp.fv('direct')||'/'||pg_temp.fv('peer')||'/fixture.txt','fixture.txt','text/plain',5);
INSERT INTO public.group_message_attachments(message_id,group_id,uploader_id,storage_path,file_name,mime_type,file_size)
VALUES(pg_temp.fv('attached_gm'),pg_temp.fv('group'),pg_temp.fv('peer'),'groups/'||pg_temp.fv('group')||'/'||pg_temp.fv('peer')||'/fixture.txt','fixture.txt','text/plain',5);
INSERT INTO public.direct_conversation_reads VALUES(pg_temp.fv('direct_target'),pg_temp.fv('owner'),'2020-01-01');
INSERT INTO public.group_reads VALUES(pg_temp.fv('group_target'),pg_temp.fv('owner'),'2020-01-01');
SELECT pg_temp.flogin('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_forward_targets()->'items')=4,'Targets leaked a foreign conversation');
SELECT pg_temp.fcheck(public.get_message_forward_targets('%')->'items'='[]'::jsonb,'Search interprets SQL wildcards');
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_forward_targets('GROUP_TARGET')->'items')=1,'Literal case-insensitive search');
SELECT pg_temp.fdenied($q$SELECT public.get_message_forward_targets(repeat('x',101))$q$,'22023');
DO $$DECLARE source text; target text; src uuid; dest uuid; original text; req uuid; result uuid; retry uuid; payload jsonb;
BEGIN
  FOREACH source IN ARRAY ARRAY['direct','group'] LOOP
    src:=pg_temp.fv(CASE source WHEN 'direct' THEN 'dm' ELSE 'gm' END);
    original:=CASE source WHEN 'direct' THEN E'  Angebot 👨‍👩‍👧‍👦\nhttps://example.invalid/?a=1&b=2\nGrüße <b>Team</b>  ' ELSE 'Team text' END;
    FOREACH target IN ARRAY ARRAY['direct','group'] LOOP
      dest:=pg_temp.fv(target||'_target'); req:=gen_random_uuid();
      result:=public.forward_text_message(pg_temp.fv('owner'),source,src,target,dest,original,req);
      retry:=public.forward_text_message(pg_temp.fv('owner'),source,src,target,dest,original,req);
      ASSERT result=retry,'Retry duplicated a forward';
      IF target='direct' THEN payload:=public.get_direct_message_context(dest,result)->'messages';
      ELSE payload:=public.get_group_message_context(dest,result)->'messages'; END IF;
      SELECT row INTO payload FROM jsonb_array_elements(payload) row WHERE row->>'message_id'=result::text;
      ASSERT payload->>'body'=original AND payload->>'is_forwarded'='true','Text/flag lost';
      ASSERT payload->>'sender_id'=pg_temp.fv('owner')::text AND payload->>'reply_to_message_id' IS NULL AND payload->'attachments'='[]'::jsonb,'Forward copied reply or attachment';
      ASSERT NOT(payload?'source_id' OR payload?'source_chat_id' OR payload?'source_sender_id'),'Source metadata disclosed';
      PERFORM set_config('nexus.forward.result_'||source||'_'||target,result::text,true);
      PERFORM set_config('nexus.forward.request_'||source||'_'||target,req::text,true);
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.fcheck((SELECT last_read_at='2020-01-01'::timestamptz FROM public.direct_conversation_reads WHERE conversation_id=pg_temp.fv('direct_target') AND user_id=pg_temp.fv('owner')),'Direct forward marked unseen messages read');
SELECT pg_temp.fcheck((SELECT last_read_at='2020-01-01'::timestamptz FROM public.group_reads WHERE group_id=pg_temp.fv('group_target') AND user_id=pg_temp.fv('owner')),'Group forward marked unseen messages read');
SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('long_dm'),'group',pg_temp.fv('group_target'),repeat('😀',5000),gen_random_uuid());
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),'group',pg_temp.fv('group_target'),'Changed text',gen_random_uuid())$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('peer'),'direct',pg_temp.fv('dm'),'group',pg_temp.fv('group_target'),'Team text',gen_random_uuid())$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('foreign_dm'),'group',pg_temp.fv('group_target'),'Secret',gen_random_uuid())$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('foreign_gm'),'group',pg_temp.fv('group_target'),'Secret',gen_random_uuid())$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'direct',pg_temp.fv('foreign_direct'),'Team text',gen_random_uuid())$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('foreign_group'),'Team text',gen_random_uuid())$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('attached_dm'),'group',pg_temp.fv('group_target'),'Caption',gen_random_uuid())$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('attached_gm'),'group',pg_temp.fv('group_target'),'Caption',gen_random_uuid())$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),NULL,pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text',gen_random_uuid())$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text','00000000-0000-0000-0000-000000000000')$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Altered retry',pg_temp.fv('request_group_group'))$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'direct',pg_temp.fv('direct_target'),'Team text',pg_temp.fv('request_group_group'))$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT * FROM private.message_forward_requests$q$,'42501');
SELECT pg_temp.fdenied($q$UPDATE public.direct_messages SET is_forwarded=false$q$,'42501');
SELECT pg_temp.fdenied($q$UPDATE public.group_messages SET is_forwarded=false$q$,'42501');
RESET ROLE;
-- Other recipients can read the copy without gaining access to its source.
SELECT pg_temp.flogin('target'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_group_message_context(pg_temp.fv('group_target'),pg_temp.fv('result_direct_group'))->'messages' @> jsonb_build_array(jsonb_build_object('message_id',pg_temp.fv('result_direct_group'),'is_forwarded',true)),'Recipient could not read copy');
SELECT pg_temp.fdenied($q$SELECT public.get_direct_message_context(pg_temp.fv('direct'),pg_temp.fv('dm'))$q$,'P0001');
RESET ROLE;
UPDATE public.group_messages SET body='Edited source',edited_at=now() WHERE id=pg_temp.fv('gm');
UPDATE public.direct_messages SET body='',deleted_at=now() WHERE id=pg_temp.fv('dm');
-- Direct message bodies allow empty tombstones in the live attachment schema.
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text',pg_temp.fv('request_group_group'))=pg_temp.fv('result_group_group'),'Completed retry depends on later source edits');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text',gen_random_uuid())$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),'group',pg_temp.fv('group_target'),'Deleted source',gen_random_uuid())$q$,'42501');
RESET ROLE;
UPDATE public.group_messages SET body='',deleted_at=now() WHERE id=pg_temp.fv('result_group_group');
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text',pg_temp.fv('request_group_group'))=pg_temp.fv('result_group_group'),'Retry restored a deleted copy');
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=pg_temp.fv('group') AND user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Edited source',gen_random_uuid())$q$,'42501');
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=pg_temp.fv('group_target') AND user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),'group',pg_temp.fv('group_target'),'Team text',pg_temp.fv('request_group_group'))$q$,'42501');
RESET ROLE;
DELETE FROM auth.sessions WHERE id=pg_temp.fv('owner_session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.get_message_forward_targets()$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(pg_temp.fv('owner'),'direct',pg_temp.fv('long_dm'),'direct',pg_temp.fv('direct_target'),repeat('😀',5000),gen_random_uuid())$q$,'42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.fdenied($q$SELECT public.get_message_forward_targets()$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.forward_text_message(gen_random_uuid(),'direct',gen_random_uuid(),'group',gen_random_uuid(),'Text',gen_random_uuid())$q$,'42501');
RESET ROLE;
SELECT pg_temp.fcheck(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_message_forward_targets','forward_text_message') AND p.prosecdef),'Public definer RPC exposed');
SELECT 'PASS: four directions, exact text, receipts, source/target access, stale previews, source privacy, unread state, session revocation and grants' AS result;
ROLLBACK;
