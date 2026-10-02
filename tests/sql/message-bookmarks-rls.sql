-- Synthetic accounts only; all messages, sessions and notification side effects
-- roll back. No real recipient or network delivery is used for acceptance.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
CREATE FUNCTION pg_temp.fv(k text) RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('nexus.bookmarks.'||k)::uuid$$;
CREATE FUNCTION pg_temp.fcheck(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',why; END IF; END$$;
CREATE FUNCTION pg_temp.flogin(k text) RETURNS void LANGUAGE sql AS $$SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fv(k),'role','authenticated','session_id',pg_temp.fv(k||'_session'))::text,true)$$;
CREATE FUNCTION pg_temp.fdenied(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'Unexpected acceptance: %',statement; END$$;
SELECT set_config('nexus.bookmarks.'||k,gen_random_uuid()::text,true) FROM unnest(ARRAY[
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
SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_bookmarks(pg_temp.fv('owner'))->'items'='[]'::jsonb,'Initial list not empty');
SELECT pg_temp.fcheck(public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),true),'Direct save failed');
SELECT pg_temp.fcheck(public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),true),'Group save failed');
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('attached_dm'),true);
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('attached_gm'),true);
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('long_dm'),true);
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'))->'items')=5,'Missing accessible messages');
SELECT pg_temp.fcheck(public.get_message_bookmark_status(pg_temp.fv('owner'),'direct',pg_temp.fv('direct'),ARRAY[pg_temp.fv('dm'),pg_temp.fv('gm'),pg_temp.fv('foreign_dm')])=jsonb_build_array(pg_temp.fv('dm')),'Status leaked wrong chat or kind');
SELECT pg_temp.fcheck(public.get_message_bookmarks(pg_temp.fv('owner'),'%')->'items'='[]'::jsonb,'Query treated as SQL wildcard');
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'),'ANGEBOT')->'items')=1,'Text search failed');
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'),'fixture.txt')->'items')=2,'Attachment search failed');
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'),'Forward group')->'items')=2,'Chat search failed');
SELECT pg_temp.fcheck(NOT (public.get_message_bookmarks(pg_temp.fv('owner'))::text ~ '(storage_path|signed_url|uploader_id)'),'Private attachment metadata exposed');
-- Another participant has an independent empty list and cannot claim the owner.
RESET ROLE; SELECT pg_temp.flogin('peer'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_bookmarks(pg_temp.fv('peer'))->'items'='[]'::jsonb,'Participant sees someone else bookmarks');
SELECT public.set_message_bookmark(pg_temp.fv('peer'),'direct',pg_temp.fv('dm'),true);
SELECT public.set_message_bookmark(pg_temp.fv('peer'),'group',pg_temp.fv('gm'),true);
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmark_status(pg_temp.fv('owner'),'direct',pg_temp.fv('direct'),ARRAY[pg_temp.fv('dm')])$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),false)$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT * FROM private.message_bookmarks$q$,'42501');
RESET ROLE; SELECT pg_temp.flogin('owner'); SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('foreign_dm'),true)$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('foreign_gm'),true)$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmark_status(pg_temp.fv('owner'),'group',pg_temp.fv('foreign_group'),ARRAY[pg_temp.fv('foreign_gm')])$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),NULL,pg_temp.fv('dm'),true)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),NULL)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'),repeat('x',101))$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'),'',now(),NULL,30)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'),'',NULL,NULL,51)$q$,'22023');
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmark_status(pg_temp.fv('owner'),'direct',pg_temp.fv('direct'),array_fill(pg_temp.fv('dm'),ARRAY[201]))$q$,'22023');
-- Explicit desired state makes retries stable, including the original ordering.
DO $$DECLARE before jsonb; after jsonb;
BEGIN
  before:=public.get_message_bookmarks(pg_temp.fv('owner'));
  PERFORM public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),true);
  PERFORM public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),true);
  after:=public.get_message_bookmarks(pg_temp.fv('owner'));
  ASSERT before=after,'Retry duplicated/reordered bookmarks';
END $$;
RESET ROLE;
-- Equal timestamps must not skip or repeat entries at a page boundary.
UPDATE private.message_bookmarks SET saved_at='2026-10-01T10:00:00Z' WHERE user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
DO $$DECLARE result jsonb; item jsonb; stamp timestamptz; last uuid; seen uuid[]:=ARRAY[]::uuid[]; loops int:=0;
BEGIN
 LOOP
  result:=public.get_message_bookmarks(pg_temp.fv('owner'),'',stamp,last,2); loops:=loops+1;
  FOR item IN SELECT * FROM jsonb_array_elements(result->'items') LOOP
   ASSERT NOT((item->>'id')::uuid=ANY(seen)),'Duplicate cursor entry'; seen:=array_append(seen,(item->>'id')::uuid);
  END LOOP;
  EXIT WHEN NOT(result->>'has_more')::boolean;
  ASSERT loops<4,'Paging did not advance'; stamp:=(result->'next_cursor'->>'saved_at')::timestamptz; last:=(result->'next_cursor'->>'id')::uuid;
 END LOOP;
 ASSERT cardinality(seen)=5,'Cursor omitted entries';
END $$;
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),false);
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),false);
SELECT pg_temp.fcheck(public.get_message_bookmark_status(pg_temp.fv('owner'),'direct',pg_temp.fv('direct'),ARRAY[pg_temp.fv('dm')])='[]'::jsonb,'Removal did not persist');
RESET ROLE;
SELECT pg_temp.fcheck((SELECT count(*)=1 FROM private.message_bookmarks WHERE user_id=pg_temp.fv('peer') AND direct_message_id=pg_temp.fv('dm')),'Removal affected another account');
UPDATE public.group_messages SET body='Edited bookmark text' WHERE id=pg_temp.fv('gm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'),'Edited bookmark text')->'items')=1,'Edit was not reflected');
SELECT pg_temp.fcheck(public.get_message_bookmarks(pg_temp.fv('owner'),'Team text')->'items'='[]'::jsonb,'Old message copy retained');
RESET ROLE;
UPDATE public.group_messages SET body='',deleted_at=now() WHERE id=pg_temp.fv('gm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(public.get_message_bookmarks(pg_temp.fv('owner'),'Edited bookmark text')->'items'='[]'::jsonb,'Deleted message text retained');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('gm'),true)$q$,'42501');
RESET ROLE;
DELETE FROM public.direct_messages WHERE id=pg_temp.fv('long_dm');
SELECT pg_temp.fcheck(NOT EXISTS(SELECT 1 FROM private.message_bookmarks WHERE direct_message_id=pg_temp.fv('long_dm')),'Message delete did not cascade');
DELETE FROM public.group_members WHERE group_id=pg_temp.fv('group') AND user_id=pg_temp.fv('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fcheck(jsonb_array_length(public.get_message_bookmarks(pg_temp.fv('owner'))->'items')=1,'Revoked group remains visible');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('attached_gm'),true)$q$,'42501');
SELECT public.set_message_bookmark(pg_temp.fv('owner'),'group',pg_temp.fv('attached_gm'),false);
RESET ROLE;
SELECT pg_temp.fcheck((SELECT last_read_at='2020-01-01'::timestamptz FROM public.direct_conversation_reads WHERE conversation_id=pg_temp.fv('direct_target') AND user_id=pg_temp.fv('owner')),'Bookmark marked messages read');
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.fv('owner_session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('attached_dm'),false)$q$,'42501');
RESET ROLE;
DELETE FROM auth.sessions WHERE id=pg_temp.fv('owner_session');
SET LOCAL ROLE authenticated;
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmark_status(pg_temp.fv('owner'),'direct',pg_temp.fv('direct'),ARRAY[pg_temp.fv('attached_dm')])$q$,'42501');
RESET ROLE; SET LOCAL ROLE anon;
SELECT pg_temp.fdenied($q$SELECT public.get_message_bookmarks(pg_temp.fv('owner'))$q$,'42501');
SELECT pg_temp.fdenied($q$SELECT public.set_message_bookmark(pg_temp.fv('owner'),'direct',pg_temp.fv('dm'),true)$q$,'42501');
RESET ROLE;
SELECT pg_temp.fcheck(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_message_bookmarks','get_message_bookmark_status','set_message_bookmark') AND p.prosecdef),'Public security-definer exposed');
SELECT 'PASS: personal direct/group bookmarks, exact ownership, attachments, search, stable pagination, idempotency, edits/deletion, revoked access, active sessions and grants' AS result;
ROLLBACK;
