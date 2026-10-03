-- Synthetic accounts only; all messages, sessions and notification side effects
-- roll back. No real recipient or network delivery is used for acceptance.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
CREATE FUNCTION pg_temp.fv(k text) RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('nexus.reminders.'||k)::uuid$$;
CREATE FUNCTION pg_temp.fcheck(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',why; END IF; END$$;
CREATE FUNCTION pg_temp.flogin(k text) RETURNS void LANGUAGE sql AS $$SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fv(k),'role','authenticated','session_id',pg_temp.fv(k||'_session'))::text,true)$$;
CREATE FUNCTION pg_temp.fdenied(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Unexpected acceptance: %',statement; END$$;
SELECT set_config('nexus.reminders.'||k,gen_random_uuid()::text,true) FROM unnest(ARRAY[
  'owner','peer','target','outsider','owner_session','peer_session','target_session','outsider_session',
  'direct','direct_target','foreign_direct','group','group_target','foreign_group','dm','gm','foreign_dm','foreign_gm','long_dm','attached_dm','attached_gm'
]) k;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT pg_temp.fv(k),gen_random_uuid()||'@example.invalid',now(),'{"full_name":"Reminder rollback"}' FROM unnest(ARRAY['owner','peer','target','outsider']) k;
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
CREATE FUNCTION pg_temp.rchange(k text,msg text,stamp timestamptz) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE uid uuid:=auth.uid(); old jsonb;
BEGIN old:=public.get_message_reminder(uid,k,pg_temp.fv(msg));
RETURN public.change_message_reminder(uid,k,pg_temp.fv(msg),(old->>'version')::uuid,gen_random_uuid(),stamp); END $$;
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm')) IS NULL,'Unexpected initial state');
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('owner'))->'items'='[]'::jsonb,'Unexpected initial list');
DO $$DECLARE first jsonb; done jsonb; newer jsonb; stamp timestamptz:=now()+interval '2 hours'; req uuid:=gen_random_uuid();
BEGIN
 first:=public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,req,stamp);
 ASSERT first=public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,req,stamp),'Retry changed result';
 BEGIN PERFORM public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,req,stamp+interval '1 hour'); RAISE EXCEPTION 'Payload mismatch accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,gen_random_uuid(),stamp); RAISE EXCEPTION 'Stale version accepted'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 done:=public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),req,gen_random_uuid(),NULL);
 ASSERT done->'due_at'='null'::jsonb,'Completion failed';
 ASSERT public.get_message_reminders(pg_temp.fv('owner'),'all')->'items'='[]'::jsonb,'Completed reminder still visible';
 ASSERT done=public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),req,(done->>'version')::uuid,NULL),'Completion retry failed';
 BEGIN PERFORM public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,req,stamp); RAISE EXCEPTION 'Old schedule resurrected'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 newer:=public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),(done->>'version')::uuid,gen_random_uuid(),stamp+interval '1 day');
 BEGIN PERFORM public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),req,(done->>'version')::uuid,NULL); RAISE EXCEPTION 'Old completion erased new schedule'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
 ASSERT newer=public.get_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm')),'Latest version lost';
END $$;
SELECT pg_temp.rchange('group','gm',now()+interval '1 hour');
SELECT pg_temp.rchange('group','attached_gm',now()+interval '1 hour');
SELECT pg_temp.rchange('direct','attached_dm',now()+interval '1 hour');
SELECT pg_temp.rchange('direct','long_dm',now()+interval '1 hour');
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('owner'))->>'due_count'='0','Future reminder already due');
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_reminders(pg_temp.fv('owner'),'all')->'items')=5,'Pending entries missing');
SELECT pg_temp.fcheck(NOT (public.get_message_reminders(pg_temp.fv('owner'),'all')::text ~ '(storage_path|signed_url|uploader_id)'),'Private attachment metadata exposed');
SELECT pg_temp.fdenied($q$SELECT pg_temp.rchange('group','gm',now()-interval '1 second')$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT pg_temp.rchange('group','gm','infinity')$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT pg_temp.rchange('group','gm',now()+interval '6 years')$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('foreign_dm'),NULL,gen_random_uuid(),now()+interval '1 hour')$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminder(pg_temp.fv('owner'),'group',pg_temp.fv('foreign_gm'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminders(pg_temp.fv('owner'),'all',now(),NULL)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminders(pg_temp.fv('owner'),'all',NULL,NULL,51)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT * FROM private.message_reminders$q$,'42501');
RESET ROLE; SELECT pg_temp.flogin('peer'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('peer'),'all')->'items'='[]'::jsonb,'Peer sees private reminders');
SELECT pg_temp.rchange('group','gm',now()+interval '1 day');
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminders(pg_temp.fv('owner'),'all')$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,gen_random_uuid(),NULL)$q$,'42501');
RESET ROLE; SELECT pg_temp.flogin('owner');
-- Simulate time passing; identical due times exercise the secondary cursor.
UPDATE private.message_reminders SET due_at=now()-interval '2 hours' WHERE user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
DO $$DECLARE result jsonb; item jsonb; stamp timestamptz; last uuid; seen uuid[]:=ARRAY[]::uuid[]; loops int:=0;
BEGIN LOOP
 result:=public.get_message_reminders(pg_temp.fv('owner'),'due',stamp,last,2); loops:=loops+1;
 ASSERT (result->>'due_count')::int=5,'Due count was limited to page';
 FOR item IN SELECT * FROM jsonb_array_elements(result->'items') LOOP
 ASSERT NOT((item->>'id')::uuid=ANY(seen)),'Duplicate cursor entry'; seen:=array_append(seen,(item->>'id')::uuid);
 END LOOP;
 EXIT WHEN NOT(result->>'has_more')::boolean;
 ASSERT loops<4,'Cursor did not advance'; stamp:=(result->'next_cursor'->>'due_at')::timestamptz; last:=(result->'next_cursor'->>'id')::uuid;
 END LOOP; ASSERT cardinality(seen)=5,'Cursor omitted reminders';
END $$;
RESET ROLE;
UPDATE public.group_messages SET body='Changed reminder source' WHERE id=pg_temp.fv('gm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('owner'))::text LIKE '%Changed reminder source%','Edit not reflected');
RESET ROLE;
UPDATE public.group_messages SET body='',deleted_at=now() WHERE id=pg_temp.fv('gm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('owner'))->>'due_count'='4','Deleted message retained');
SELECT pg_temp.fdenied($q$SELECT pg_temp.rchange('group','gm',now()+interval '1 hour')$q$,'42501');
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=pg_temp.fv('group') AND user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_reminders(pg_temp.fv('owner'))->>'due_count'='3','Revoked group retained');
SELECT pg_temp.fdenied($q$SELECT pg_temp.rchange('group','attached_gm',now()+interval '1 hour')$q$,'42501');
RESET ROLE;
DELETE FROM public.direct_messages WHERE id=pg_temp.fv('long_dm');
SELECT pg_temp.fcheck(NOT EXISTS(SELECT 1 FROM private.message_reminders WHERE direct_message_id=pg_temp.fv('long_dm')),'Hard deletion did not cascade');
SELECT pg_temp.fcheck((SELECT count(*)=1 FROM private.message_reminders WHERE user_id=pg_temp.fv('peer')),'Another account was modified');
SELECT pg_temp.fcheck((SELECT last_read_at='2020-01-01'::timestamptz FROM public.direct_conversation_reads WHERE conversation_id=pg_temp.fv('direct_target') AND user_id=pg_temp.fv('owner')),'Reminder sent read receipts');
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.fv('owner_session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminders(pg_temp.fv('owner'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.change_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL,gen_random_uuid(),NULL)$q$,'42501');
RESET ROLE;
DELETE FROM auth.sessions WHERE id=pg_temp.fv('owner_session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminder(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'))$q$,'42501');
RESET ROLE; SET LOCAL ROLE anon;
SELECT pg_temp.fdenied($q$SELECT public.get_message_reminders(pg_temp.fv('owner'))$q$,'42501');
RESET ROLE;
SELECT pg_temp.fcheck(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_message_reminder','get_message_reminders','change_message_reminder') AND p.prosecdef),'Public security definer introduced');
SELECT 'PASS: private reminders, time filters, cursors, CAS/replay, source rights, sessions and cleanup' AS result;
ROLLBACK;
