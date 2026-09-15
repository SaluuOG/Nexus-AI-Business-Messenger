-- Synthetic accounts and messages only. No real recipient, storage object or AI
-- provider is touched; every fixture and assertion is inside this rollback.
BEGIN;
SELECT set_config('nexus.scan.owner',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.member',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.outsider',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.direct',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.group',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.large',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.deleted_direct',gen_random_uuid()::text,true);
SELECT set_config('nexus.scan.deleted_group',gen_random_uuid()::text,true);

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.scan.' || person)::uuid,
       current_setting('nexus.scan.' || person) || '@example.invalid',now(),
       jsonb_build_object('full_name','Scan ' || person)
FROM unnest(ARRAY['owner','member','outsider']) person;
UPDATE public.profiles SET full_name='Scan owner' WHERE id=current_setting('nexus.scan.owner')::uuid;
UPDATE public.profiles SET full_name='Scan member' WHERE id=current_setting('nexus.scan.member')::uuid;
UPDATE public.profiles SET full_name='Scan outsider' WHERE id=current_setting('nexus.scan.outsider')::uuid;
INSERT INTO public.direct_conversations(id,user_a,user_b) VALUES
  (current_setting('nexus.scan.direct')::uuid,
   least(current_setting('nexus.scan.owner')::uuid,current_setting('nexus.scan.member')::uuid),
   greatest(current_setting('nexus.scan.owner')::uuid,current_setting('nexus.scan.member')::uuid)),
  (current_setting('nexus.scan.large')::uuid,
   least(current_setting('nexus.scan.owner')::uuid,current_setting('nexus.scan.outsider')::uuid),
   greatest(current_setting('nexus.scan.owner')::uuid,current_setting('nexus.scan.outsider')::uuid));
INSERT INTO public.group_conversations(id,name,created_by) VALUES
  (current_setting('nexus.scan.group')::uuid,'Scan rollback group',current_setting('nexus.scan.owner')::uuid);
INSERT INTO public.group_members(group_id,user_id,role,joined_at) VALUES
  (current_setting('nexus.scan.group')::uuid,current_setting('nexus.scan.owner')::uuid,'owner',now() - interval '3 days'),
  (current_setting('nexus.scan.group')::uuid,current_setting('nexus.scan.member')::uuid,'member',now());

-- No JWT while inserting fixtures: existing notification triggers cannot send
-- even synthetic notifications. Rows deliberately share timestamps.
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(id,conversation_id,sender_id,body,created_at)
SELECT md5(current_setting('nexus.scan.direct') || n)::uuid,current_setting('nexus.scan.direct')::uuid,
       current_setting('nexus.scan.' || CASE WHEN n % 2=0 THEN 'member' ELSE 'owner' END)::uuid,
       CASE WHEN n=1 THEN '' ELSE 'Direct rollback message ' || n END,
       now() - interval '2 days' + (n / 40) * interval '1 second'
FROM generate_series(1,251) n;
INSERT INTO public.group_messages(id,group_id,sender_id,body,created_at)
SELECT md5(current_setting('nexus.scan.group') || n)::uuid,current_setting('nexus.scan.group')::uuid,
       current_setting('nexus.scan.owner')::uuid,
       CASE WHEN n=1 THEN '' ELSE 'Group rollback message ' || n END,
       now() - interval '2 days' + (n / 40) * interval '1 second'
FROM generate_series(1,251) n;
INSERT INTO public.direct_messages(id,conversation_id,sender_id,body,deleted_at) VALUES
  (current_setting('nexus.scan.deleted_direct')::uuid,current_setting('nexus.scan.direct')::uuid,
   current_setting('nexus.scan.owner')::uuid,'DELETED_DIRECT_SENTINEL',now());
INSERT INTO public.group_messages(id,group_id,sender_id,body,deleted_at) VALUES
  (current_setting('nexus.scan.deleted_group')::uuid,current_setting('nexus.scan.group')::uuid,
   current_setting('nexus.scan.owner')::uuid,'DELETED_GROUP_SENTINEL',now());

-- Metadata has no storage-object FK. Creating it directly as the test database
-- owner avoids uploading files; the API must expose counts, never file details.
INSERT INTO public.direct_message_attachments(message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT CASE WHEN n=3 THEN current_setting('nexus.scan.deleted_direct')::uuid ELSE md5(current_setting('nexus.scan.direct') || '1')::uuid END,
       current_setting('nexus.scan.direct')::uuid,current_setting('nexus.scan.owner')::uuid,
       current_setting('nexus.scan.direct') || '/PRIVATE_STORAGE_SENTINEL/' || n,
       'PRIVATE_FILENAME_SENTINEL.pdf','application/pdf',123
FROM generate_series(1,3) n;
INSERT INTO public.group_message_attachments(message_id,group_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT CASE WHEN n=3 THEN current_setting('nexus.scan.deleted_group')::uuid ELSE md5(current_setting('nexus.scan.group') || '1')::uuid END,
       current_setting('nexus.scan.group')::uuid,current_setting('nexus.scan.owner')::uuid,
       current_setting('nexus.scan.group') || '/PRIVATE_STORAGE_SENTINEL/' || n,
       'PRIVATE_FILENAME_SENTINEL.pdf','application/pdf',123
FROM generate_series(1,3) n;
SELECT set_config('nexus.scan.direct_expected',
  (SELECT jsonb_agg(id::text ORDER BY created_at,id)::text FROM public.direct_messages
   WHERE conversation_id=current_setting('nexus.scan.direct')::uuid AND deleted_at IS NULL),true);
SELECT set_config('nexus.scan.group_expected',
  (SELECT jsonb_agg(id::text ORDER BY created_at,id)::text FROM public.group_messages
   WHERE group_id=current_setting('nexus.scan.group')::uuid AND deleted_at IS NULL),true);

-- The assertions below use only the synthetic fixture identifiers above.
CREATE FUNCTION pg_temp.scan_result(p_kind text,p_chat uuid,p_lease uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER AS $test$
  SELECT jsonb_build_object('scanId',p_lease,'chatKind',p_kind,'chatId',p_chat,
    'summary','Synthetic current result','facts','[]'::jsonb,'decisions','[]'::jsonb,
    'tasks','[]'::jsonb,'questions','[]'::jsonb,'sources','[]'::jsonb,
    'coverage',jsonb_build_object('messageCount',p->'total_count','attachmentsExcluded',p->'attachment_count',
      'complete',true,'from',NULL,'to',NULL)) FROM (SELECT public.get_chat_scan_page(p_kind,p_chat) p) q;
$test$;
CREATE FUNCTION pg_temp.complete_scan(p_kind text,p_chat uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $test$
DECLARE lease uuid; state jsonb; result jsonb;
BEGIN
  state := public.get_my_chat_scan_state(p_kind,p_chat);
  lease := public.begin_chat_scan();
  result := public.complete_my_chat_scan(p_kind,p_chat,public.get_chat_scan_page(p_kind,p_chat)->>'snapshot',
    lease,state->>'revision',pg_temp.scan_result(p_kind,p_chat,lease));
  PERFORM public.finish_chat_scan(lease);
  RETURN result;
END $test$;

SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid; state jsonb; after_state jsonb; result jsonb; lease uuid;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.scan.' || kind)::uuid;
    state := public.get_my_chat_scan_state(kind,chat);
    IF state->>'status'<>'open' OR NOT (state->>'can_scan')::boolean OR state->>'last_scanned_at' IS NOT NULL
      OR state->>'revision' IS NULL OR public.get_my_chat_scan_result(kind,chat) IS NOT NULL THEN
      RAISE EXCEPTION 'Unprocessed default state or result incorrect'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_chat_scan_states(kind)) x WHERE x->>'chat_id'=chat::text) THEN
      RAISE EXCEPTION 'Accessible chat missing from list'; END IF;
    -- Failed/cancelled scans acquire and release quota without completing.
    lease := public.begin_chat_scan(); PERFORM public.finish_chat_scan(lease);
    IF public.get_my_chat_scan_state(kind,chat) IS DISTINCT FROM state THEN RAISE EXCEPTION 'Failed scan marked processed'; END IF;
    BEGIN
      PERFORM public.complete_my_chat_scan(kind,chat,public.get_chat_scan_page(kind,chat)->>'snapshot',lease,state->>'revision',pg_temp.scan_result(kind,chat,lease));
      RAISE EXCEPTION 'Released lease accepted completion';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'scan_expired' THEN RAISE; END IF; END;
    -- Neither a foreign result scope nor a fabricated scan ID can be persisted.
    lease := public.begin_chat_scan();
    BEGIN
      PERFORM public.complete_my_chat_scan(kind,chat,public.get_chat_scan_page(kind,chat)->>'snapshot',lease,state->>'revision',
        pg_temp.scan_result(kind,chat,lease) || jsonb_build_object('chatId',gen_random_uuid()));
      RAISE EXCEPTION 'Foreign cached result accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_response' THEN RAISE; END IF; END;
    after_state := public.complete_my_chat_scan(kind,chat,public.get_chat_scan_page(kind,chat)->>'snapshot',lease,state->>'revision',pg_temp.scan_result(kind,chat,lease));
    IF after_state->>'status'<>'processed' OR (after_state->>'can_scan')::boolean OR after_state->>'last_scanned_at' IS NULL
      OR after_state->>'revision'=state->>'revision' THEN RAISE EXCEPTION 'Successful completion state incorrect'; END IF;
    result := public.get_my_chat_scan_result(kind,chat);
    IF result->>'scanId' IS DISTINCT FROM lease::text OR result->>'chatId' IS DISTINCT FROM chat::text THEN RAISE EXCEPTION 'Current result unavailable'; END IF;
    BEGIN
      PERFORM public.complete_my_chat_scan(kind,chat,public.get_chat_scan_page(kind,chat)->>'snapshot',lease,after_state->>'revision',result);
      RAISE EXCEPTION 'Processed history completed twice';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'already_processed' THEN RAISE; END IF; END;
    PERFORM public.finish_chat_scan(lease);
    state := public.set_my_chat_scan_done(kind,chat,true,after_state->>'revision');
    IF state->>'status'<>'done' OR (state->>'can_scan')::boolean OR public.get_my_chat_scan_result(kind,chat) IS NOT NULL THEN
      RAISE EXCEPTION 'Finished chat still eligible'; END IF;
    BEGIN
      PERFORM public.set_my_chat_scan_done(kind,chat,false,after_state->>'revision');
      RAISE EXCEPTION 'Stale status write accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'status_changed' THEN RAISE; END IF; END;
    state := public.set_my_chat_scan_done(kind,chat,false,state->>'revision');
    IF state->>'status'<>'processed' OR public.get_my_chat_scan_result(kind,chat) IS DISTINCT FROM result THEN
      RAISE EXCEPTION 'Reopen lost unchanged successful result'; END IF;
  END LOOP;
  BEGIN PERFORM * FROM private.chat_scan_states; RAISE EXCEPTION 'Client directly read private workflow table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE private.chat_scan_states SET done=false; RAISE EXCEPTION 'Client directly edited private workflow table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN('get_my_chat_scan_state','get_my_chat_scan_states','get_my_chat_scan_result','set_my_chat_scan_done','complete_my_chat_scan') AND p.prosecdef) THEN
    RAISE EXCEPTION 'Exposed workflow RPC bypasses RLS'; END IF;
END $$;

-- Updates outside the model input must preserve the paid analysis and revision.
SELECT set_config('nexus.scan.direct_state',public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid)::text,true);
SELECT set_config('nexus.scan.group_state',public.get_my_chat_scan_state('group',current_setting('nexus.scan.group')::uuid)::text,true);
SELECT set_config('nexus.scan.direct_result',public.get_my_chat_scan_result('direct',current_setting('nexus.scan.direct')::uuid)::text,true);
SELECT set_config('nexus.scan.group_result',public.get_my_chat_scan_result('group',current_setting('nexus.scan.group')::uuid)::text,true);
SELECT set_config('nexus.scan.direct_snapshot',public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid)->>'snapshot',true);
SELECT set_config('nexus.scan.group_snapshot',public.get_chat_scan_page('group',current_setting('nexus.scan.group')::uuid)->>'snapshot',true);
RESET ROLE;
UPDATE public.profiles SET username='scan_' || replace(id::text,'-',''),full_name='  Scan owner  ' WHERE id=current_setting('nexus.scan.owner')::uuid;
UPDATE public.direct_message_attachments SET file_name='Renamed attachment.pdf',file_size=456,created_at=clock_timestamp() WHERE conversation_id=current_setting('nexus.scan.direct')::uuid;
UPDATE public.group_message_attachments SET file_name='Renamed group attachment.pdf',file_size=456,created_at=clock_timestamp() WHERE group_id=current_setting('nexus.scan.group')::uuid;
UPDATE public.direct_messages SET reply_to_message_id=md5(current_setting('nexus.scan.direct') || '1')::uuid WHERE id=md5(current_setting('nexus.scan.direct') || '2')::uuid;
UPDATE public.group_messages SET reply_to_message_id=md5(current_setting('nexus.scan.group') || '1')::uuid WHERE id=md5(current_setting('nexus.scan.group') || '2')::uuid;
UPDATE public.direct_messages SET body='Changed deleted text',deleted_at=clock_timestamp() WHERE id=current_setting('nexus.scan.deleted_direct')::uuid;
UPDATE public.group_messages SET body='Changed deleted group text',deleted_at=clock_timestamp() WHERE id=current_setting('nexus.scan.deleted_group')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.scan.' || kind)::uuid;
    IF public.get_my_chat_scan_state(kind,chat) IS DISTINCT FROM current_setting('nexus.scan.' || kind || '_state')::jsonb
      OR public.get_my_chat_scan_result(kind,chat) IS DISTINCT FROM current_setting('nexus.scan.' || kind || '_result')::jsonb
      OR public.get_chat_scan_page(kind,chat)->>'snapshot' IS DISTINCT FROM current_setting('nexus.scan.' || kind || '_snapshot') THEN
      RAISE EXCEPTION 'Non-input metadata update invalidated paid % analysis',kind; END IF;
  END LOOP;
END $$;

-- Reassigning an attachment changes per-message counts and must invalidate.
-- Roll back just these fixture changes to preserve the later workflow scenarios.
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE public.direct_message_attachments SET message_id=md5(current_setting('nexus.scan.direct') || '2')::uuid
      WHERE message_id=md5(current_setting('nexus.scan.direct') || '1')::uuid;
    UPDATE public.group_message_attachments SET message_id=md5(current_setting('nexus.scan.group') || '2')::uuid
      WHERE message_id=md5(current_setting('nexus.scan.group') || '1')::uuid;
    IF public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid)->>'status'<>'updated'
      OR public.get_my_chat_scan_state('group',current_setting('nexus.scan.group')::uuid)->>'status'<>'updated' THEN
      RAISE EXCEPTION 'Attachment count reassignment did not invalidate analysis'; END IF;
    RAISE EXCEPTION 'rollback_attachment_fixture';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'rollback_attachment_fixture' THEN RAISE; END IF; END;
END $$;

-- A different participant keeps independent open/processed/done state.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid; state jsonb;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.scan.' || kind)::uuid;
    state:=public.get_my_chat_scan_state(kind,chat);
    IF state->>'status'<>'open' OR public.get_my_chat_scan_result(kind,chat) IS NOT NULL THEN RAISE EXCEPTION 'Another user inherited processed state or result'; END IF;
    PERFORM public.set_my_chat_scan_done(kind,chat,true,state->>'revision');
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid)->>'status'<>'processed' THEN
    RAISE EXCEPTION 'Other participant closed caller chat'; END IF;
END $$;

-- Changes older than the visible 200 messages invalidate full-history analysis.
RESET ROLE;
UPDATE public.direct_messages SET body='Oldest requirement changed',edited_at=now() WHERE id=md5(current_setting('nexus.scan.direct') || '1')::uuid;
UPDATE public.group_messages SET body='Oldest group requirement changed',edited_at=now() WHERE id=md5(current_setting('nexus.scan.group') || '1')::uuid;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM private.chat_scan_states WHERE user_id=current_setting('nexus.scan.member')::uuid AND cached_result IS NOT NULL) THEN
    RAISE EXCEPTION 'Source changes retained stale cached text'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid; state jsonb;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.scan.' || kind)::uuid; state:=public.get_my_chat_scan_state(kind,chat);
    IF state->>'status'<>'updated' OR NOT (state->>'can_scan')::boolean OR public.get_my_chat_scan_result(kind,chat) IS NOT NULL THEN
      RAISE EXCEPTION 'Old message changes did not reopen eligibility'; END IF;
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid; state jsonb;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.scan.' || kind)::uuid; state:=public.get_my_chat_scan_state(kind,chat);
    IF state->>'status'<>'done' OR (state->>'can_scan')::boolean THEN RAISE EXCEPTION 'Source changes reopened manually finished chat'; END IF;
    state:=public.set_my_chat_scan_done(kind,chat,false,state->>'revision');
    IF state->>'status'<>'open' THEN RAISE EXCEPTION 'Never-scanned reopened chat should be open'; END IF;
  END LOOP;
END $$;

-- Finishing on another tab while a scan is in flight wins, even after reopening.
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid; state jsonb; done_state jsonb; lease uuid; snapshot text;
BEGIN
  state:=public.get_my_chat_scan_state('direct',chat); snapshot:=public.get_chat_scan_page('direct',chat)->>'snapshot';
  lease:=public.begin_chat_scan();
  done_state:=public.set_my_chat_scan_done('direct',chat,true,state->>'revision');
  BEGIN PERFORM public.complete_my_chat_scan('direct',chat,snapshot,lease,state->>'revision',pg_temp.scan_result('direct',chat,lease));
    RAISE EXCEPTION 'In-flight completion overrode manual done';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'chat_done' THEN RAISE; END IF; END;
  PERFORM public.set_my_chat_scan_done('direct',chat,false,done_state->>'revision');
  BEGIN PERFORM public.complete_my_chat_scan('direct',chat,snapshot,lease,state->>'revision',pg_temp.scan_result('direct',chat,lease));
    RAISE EXCEPTION 'Done-to-reopen cycle accepted stale in-flight completion';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'status_changed' THEN RAISE; END IF; END;
  PERFORM public.finish_chat_scan(lease);
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'open' THEN RAISE EXCEPTION 'Rejected completion marked processed'; END IF;
  PERFORM pg_temp.complete_scan('direct',chat);
END $$;

-- All source-affecting changes retire cached results; no transcript archive.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES(current_setting('nexus.scan.direct')::uuid,current_setting('nexus.scan.owner')::uuid,'New requirement');
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid;
BEGIN
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'updated' OR public.get_my_chat_scan_result('direct',chat) IS NOT NULL THEN
    RAISE EXCEPTION 'New message kept old result current'; END IF;
  PERFORM pg_temp.complete_scan('direct',chat);
END $$;
RESET ROLE;
UPDATE public.direct_messages SET deleted_at=now(),body='' WHERE id=md5(current_setting('nexus.scan.direct') || '2')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid;
BEGIN
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'updated' OR public.get_my_chat_scan_result('direct',chat) IS NOT NULL THEN RAISE EXCEPTION 'Soft deletion leaked derived result'; END IF;
  PERFORM pg_temp.complete_scan('direct',chat);
END $$;
RESET ROLE;
DELETE FROM public.direct_message_attachments WHERE message_id=md5(current_setting('nexus.scan.direct') || '1')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid;
BEGIN
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'updated' THEN RAISE EXCEPTION 'Attachment-count change ignored'; END IF;
  PERFORM pg_temp.complete_scan('direct',chat);
END $$;
RESET ROLE;
UPDATE public.profiles SET full_name='Renamed rollback sender' WHERE id=current_setting('nexus.scan.member')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid;
BEGIN
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'updated' OR public.get_my_chat_scan_result('direct',chat) IS NOT NULL THEN RAISE EXCEPTION 'Sender label change ignored'; END IF;
  PERFORM pg_temp.complete_scan('direct',chat);
  PERFORM public.set_my_chat_scan_done('direct',chat,true,public.get_my_chat_scan_state('direct',chat)->>'revision');
END $$;
RESET ROLE;
DELETE FROM public.direct_messages WHERE id=md5(current_setting('nexus.scan.direct') || '3')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid; state jsonb;
BEGIN
  state:=public.get_my_chat_scan_state('direct',chat);
  IF state->>'status'<>'done' OR public.get_my_chat_scan_result('direct',chat) IS NOT NULL THEN RAISE EXCEPTION 'Physical deletion reopened finished chat or leaked result'; END IF;
  state:=public.set_my_chat_scan_done('direct',chat,false,state->>'revision');
  IF state->>'status'<>'updated' OR state->>'last_scanned_at' IS NULL THEN RAISE EXCEPTION 'Reopened changed chat lost scan history or eligibility'; END IF;
END $$;

-- Old completion snapshots are rejected after a source edit during a scan.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT set_config('nexus.scan.inflight_revision',public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid)->>'revision',true);
SELECT set_config('nexus.scan.inflight_snapshot',public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid)->>'snapshot',true);
SELECT set_config('nexus.scan.inflight_lease',public.begin_chat_scan()::text,true);
RESET ROLE;
UPDATE public.direct_messages SET body='Changed during scan',edited_at=clock_timestamp() WHERE id=md5(current_setting('nexus.scan.direct') || '1')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.direct')::uuid; lease uuid:=current_setting('nexus.scan.inflight_lease')::uuid;
BEGIN
  BEGIN PERFORM public.complete_my_chat_scan('direct',chat,current_setting('nexus.scan.inflight_snapshot'),lease,
    current_setting('nexus.scan.inflight_revision'),pg_temp.scan_result('direct',chat,lease));
    RAISE EXCEPTION 'Changed history was saved as processed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'history_changed' THEN RAISE; END IF; END;
  PERFORM public.finish_chat_scan(lease);
  IF public.get_my_chat_scan_state('direct',chat)->>'status'<>'updated' OR public.get_my_chat_scan_result('direct',chat) IS NOT NULL THEN
    RAISE EXCEPTION 'Rejected changed-history result retained'; END IF;
END $$;

-- Oversized histories can still be marked finished and reopened without scanning.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body)
SELECT current_setting('nexus.scan.large')::uuid,current_setting('nexus.scan.owner')::uuid,'Large workflow fixture ' || n FROM generate_series(1,5001) n;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE chat uuid:=current_setting('nexus.scan.large')::uuid; state jsonb;
BEGIN
  state:=public.get_my_chat_scan_state('direct',chat);
  state:=public.set_my_chat_scan_done('direct',chat,true,state->>'revision');
  IF state->>'status'<>'done' THEN RAISE EXCEPTION 'Large history cannot be marked done'; END IF;
  state:=public.set_my_chat_scan_done('direct',chat,false,state->>'revision');
  IF state->>'status'<>'open' THEN RAISE EXCEPTION 'Large history cannot be reopened'; END IF;
END $$;

-- Foreign users, revoked members, anonymous callers and null JWTs have no access.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.outsider'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.scan.' || kind)::uuid;
    BEGIN PERFORM public.get_my_chat_scan_state(kind,chat); RAISE EXCEPTION 'Outsider read workflow';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
    BEGIN PERFORM public.get_my_chat_scan_result(kind,chat); RAISE EXCEPTION 'Outsider read cached result';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
    BEGIN PERFORM public.set_my_chat_scan_done(kind,chat,true,'x'); RAISE EXCEPTION 'Outsider changed workflow';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
    BEGIN PERFORM public.complete_my_chat_scan(kind,chat,'x',gen_random_uuid(),'x','{}'); RAISE EXCEPTION 'Outsider completed workflow';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_my_chat_scan_states(kind)) x WHERE x->>'chat_id'=chat::text) THEN
      RAISE EXCEPTION 'Outsider listed inaccessible workflow'; END IF;
  END LOOP;
END $$;
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.scan.group')::uuid AND user_id=current_setting('nexus.scan.member')::uuid;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM private.chat_scan_states WHERE kind='group' AND chat_id=current_setting('nexus.scan.group')::uuid AND user_id=current_setting('nexus.scan.member')::uuid) THEN
    RAISE EXCEPTION 'Removed member retained derived copy'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.get_my_chat_scan_result('group',current_setting('nexus.scan.group')::uuid); RAISE EXCEPTION 'Revoked member read result';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid); RAISE EXCEPTION 'Null JWT read state';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'no_access' THEN RAISE; END IF; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_my_chat_scan_state('direct',current_setting('nexus.scan.direct')::uuid); RAISE EXCEPTION 'Anonymous read state';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_my_chat_scan_states('direct'); RAISE EXCEPTION 'Anonymous listed states';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_my_chat_scan_result('direct',current_setting('nexus.scan.direct')::uuid); RAISE EXCEPTION 'Anonymous read result';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_my_chat_scan_done('direct',current_setting('nexus.scan.direct')::uuid,true,'x'); RAISE EXCEPTION 'Anonymous changed state';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.complete_my_chat_scan('direct',current_setting('nexus.scan.direct')::uuid,'x',gen_random_uuid(),'x','{}'); RAISE EXCEPTION 'Anonymous completed scan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Chat scan workflow: personal statuses, whole-history changes, saved results, completion races, oversized chats and access isolation passed' AS result;
ROLLBACK;
