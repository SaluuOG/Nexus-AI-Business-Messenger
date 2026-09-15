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

SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text; chat uuid; page jsonb; seen jsonb; snapshot text;
  after_time timestamptz; after_id uuid; pages integer;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat := current_setting('nexus.scan.' || kind)::uuid;
    seen := '[]'::jsonb; snapshot := NULL; after_time := NULL; after_id := NULL; pages := 0;
    LOOP
      page := public.get_chat_scan_page(kind,chat,after_time,after_id,snapshot,73);
      pages := pages + 1;
      IF pages > 4 THEN RAISE EXCEPTION 'Pagination did not terminate for %',kind; END IF;
      IF (page->>'total_count')::int <> 251 OR (page->>'attachment_count')::int <> 2 THEN
        RAISE EXCEPTION 'Incorrect live-message or attachment total for %: %',kind,page;
      END IF;
      IF page::text LIKE '%SENTINEL%' OR page::text LIKE '%storage_path%' OR page::text LIKE '%file_name%' THEN
        RAISE EXCEPTION 'Deleted content or attachment metadata exposed for %',kind;
      END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') item
        WHERE item->>'senderId'=current_setting('nexus.scan.owner') AND item->>'sender' IS DISTINCT FROM 'Scan owner') THEN
        RAISE EXCEPTION 'Authorized other-sender name missing for %',kind;
      END IF;
      IF jsonb_array_length(page->'items') > 73 OR page->>'snapshot' IS NULL THEN
        RAISE EXCEPTION 'Invalid page shape for %',kind;
      END IF;
      snapshot := coalesce(snapshot,page->>'snapshot');
      IF page->>'snapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Stable history changed snapshot'; END IF;
      seen := seen || (SELECT coalesce(jsonb_agg(item->>'id'),'[]'::jsonb) FROM jsonb_array_elements(page->'items') item);
      EXIT WHEN NOT (page->>'has_more')::boolean;
      IF page->'next_cursor' IS NULL OR page->'next_cursor'='null'::jsonb THEN RAISE EXCEPTION 'Missing cursor'; END IF;
      after_time := (page->'next_cursor'->>'created_at')::timestamptz;
      after_id := (page->'next_cursor'->>'id')::uuid;
    END LOOP;
    IF pages <> 4 OR seen IS DISTINCT FROM current_setting('nexus.scan.' || kind || '_expected')::jsonb THEN
      RAISE EXCEPTION 'History was truncated, duplicated, or out of order for %',kind;
    END IF;
    IF page->'next_cursor' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Terminal page retained cursor'; END IF;
    PERFORM set_config('nexus.scan.' || kind || '_snapshot',snapshot,true);
    page := public.get_chat_scan_page(kind,chat);
    IF jsonb_array_length(page->'items') <> 250 OR NOT (page->>'has_more')::boolean THEN RAISE EXCEPTION 'Default page limit changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') item
       WHERE (item->>'id')::uuid=md5(chat::text || '1')::uuid AND item->>'body'='' AND (item->>'attachmentCount')::int=2) THEN
      RAISE EXCEPTION 'Attachment-only message was lost for %',kind;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=current_setting('nexus.scan.owner')::uuid) THEN
    RAISE EXCEPTION 'Scanner widened direct profile access';
  END IF;
  BEGIN PERFORM * FROM private.chat_scan_limits; RAISE EXCEPTION 'Client read private scan quotas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE private.chat_scan_limits SET hour_count=0; RAISE EXCEPTION 'Client reset private scan quotas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_chat_scan_page('workspace',chat); RAISE EXCEPTION 'Unknown chat kind accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_chat_scan_page('direct',NULL); RAISE EXCEPTION 'Null chat accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid,now(),NULL); RAISE EXCEPTION 'Incomplete cursor accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('get_chat_scan_page','begin_chat_scan','finish_chat_scan') AND p.prosecdef) THEN
    RAISE EXCEPTION 'Public scanner RPC unexpectedly bypasses RLS';
  END IF;
END $$;

-- A body edit, deletion and new message each invalidate the previous snapshot.
RESET ROLE;
UPDATE public.direct_messages SET body='Edited rollback text',edited_at=now()
WHERE id=md5(current_setting('nexus.scan.direct') || '2')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid,NULL,NULL,current_setting('nexus.scan.direct_snapshot'));
    RAISE EXCEPTION 'Edited history accepted stale snapshot';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'history_changed' THEN RAISE; END IF; END;
  PERFORM set_config('nexus.scan.direct_snapshot',public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid)->>'snapshot',true);
END $$;
RESET ROLE;
UPDATE public.direct_messages SET deleted_at=now(),body='' WHERE id=md5(current_setting('nexus.scan.direct') || '3')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid,NULL,NULL,current_setting('nexus.scan.direct_snapshot'));
    RAISE EXCEPTION 'Deleted history accepted stale snapshot';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'history_changed' THEN RAISE; END IF; END;
  PERFORM set_config('nexus.scan.direct_snapshot',public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid)->>'snapshot',true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body) VALUES
  (current_setting('nexus.scan.direct')::uuid,current_setting('nexus.scan.owner')::uuid,'Concurrent rollback message');
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid,NULL,NULL,current_setting('nexus.scan.direct_snapshot'));
    RAISE EXCEPTION 'New message accepted stale snapshot';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'history_changed' THEN RAISE; END IF; END;
END $$;

-- Foreign users cannot resolve any content or continue another chat snapshot.
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.outsider'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE kind text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    BEGIN
      PERFORM public.get_chat_scan_page(kind,current_setting('nexus.scan.' || kind)::uuid,NULL,NULL,current_setting('nexus.scan.' || kind || '_snapshot'));
      RAISE EXCEPTION 'Outsider read % history',kind;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
    BEGIN
      PERFORM private.chat_scan_metadata(kind,current_setting('nexus.scan.' || kind)::uuid);
      RAISE EXCEPTION 'Outsider read private % metadata',kind;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
  END LOOP;
END $$;

-- Revocation must be effective immediately, including a previously valid cursor.
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.scan.group')::uuid AND user_id=current_setting('nexus.scan.member')::uuid;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.member'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('group',current_setting('nexus.scan.group')::uuid,NULL,NULL,current_setting('nexus.scan.group_snapshot'));
    RAISE EXCEPTION 'Removed member scanned group';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'no_access' THEN RAISE; END IF; END;
END $$;

-- Explicit hard limit: the API never presents only part of an oversized history
-- as a complete conversation. Generate no messages for real recipients.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body)
SELECT current_setting('nexus.scan.large')::uuid,current_setting('nexus.scan.owner')::uuid,'Large rollback ' || n
FROM generate_series(1,5001) n;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.large')::uuid);
    RAISE EXCEPTION 'Oversized history silently truncated';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'history_too_large' THEN RAISE; END IF; END;
END $$;

-- The byte limit also rejects a long-text conversation below the row limit.
RESET ROLE;
DELETE FROM public.direct_messages WHERE conversation_id=current_setting('nexus.scan.large')::uuid;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.direct_messages(conversation_id,sender_id,body)
SELECT current_setting('nexus.scan.large')::uuid,current_setting('nexus.scan.owner')::uuid,repeat('x',5000)
FROM generate_series(1,301) n;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.large')::uuid);
    RAISE EXCEPTION 'Oversized text history silently truncated';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'history_too_large' THEN RAISE; END IF; END;
END $$;

-- Scan leases are user-bound. A second active request is rejected, and neither
-- guessed nor another account's token may release the active request.
SELECT set_config('nexus.scan.owner_lease',public.begin_chat_scan()::text,true);
DO $$ BEGIN
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Parallel scan was admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
  PERFORM public.finish_chat_scan(gen_random_uuid());
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Guessed token released active scan';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.outsider'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT public.finish_chat_scan(current_setting('nexus.scan.owner_lease')::uuid);
SELECT set_config('nexus.scan.outsider_lease',public.begin_chat_scan()::text,true);
SELECT public.finish_chat_scan(current_setting('nexus.scan.outsider_lease')::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.scan.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE token uuid;
BEGIN
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Outsider released owner scan';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
  PERFORM public.finish_chat_scan(current_setting('nexus.scan.owner_lease')::uuid);
  token := public.begin_chat_scan();
  IF token IS NULL OR token=current_setting('nexus.scan.owner_lease')::uuid THEN RAISE EXCEPTION 'New scan did not receive fresh token'; END IF;
  PERFORM public.finish_chat_scan(current_setting('nexus.scan.owner_lease')::uuid);
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Stale token released newer scan';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
  PERFORM public.finish_chat_scan(token);
END $$;

-- Quota and expiry transitions use only the synthetic owner's private row.
-- Move timestamps instead of waiting for a real hour/day or lease timeout.
RESET ROLE;
UPDATE private.chat_scan_limits SET active_id=gen_random_uuid(),active_until=now() - interval '1 second',
  hour_start=now(),hour_count=6,day_start=now(),day_count=6
WHERE user_id=current_setting('nexus.scan.owner')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Hourly quota bypassed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE private.chat_scan_limits SET hour_start=now() - interval '2 hours',day_count=20
WHERE user_id=current_setting('nexus.scan.owner')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Daily quota bypassed after hour reset';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'rate_limited' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE private.chat_scan_limits SET day_start=now() - interval '2 days'
WHERE user_id=current_setting('nexus.scan.owner')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE token uuid;
BEGIN
  token := public.begin_chat_scan();
  IF token IS NULL THEN RAISE EXCEPTION 'Expired lease and quota windows did not reset'; END IF;
  PERFORM public.finish_chat_scan(token);
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM private.chat_scan_limits WHERE user_id=current_setting('nexus.scan.owner')::uuid
    AND hour_count=1 AND day_count=1 AND active_id IS NULL AND active_until IS NULL) THEN
    RAISE EXCEPTION 'Lease reset state incorrect';
  END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_chat_scan_page('direct',current_setting('nexus.scan.direct')::uuid); RAISE EXCEPTION 'Anonymous history read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.begin_chat_scan(); RAISE EXCEPTION 'Anonymous lease accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.finish_chat_scan(current_setting('nexus.scan.owner_lease')::uuid); RAISE EXCEPTION 'Anonymous lease release accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM private.chat_scan_limits; RAISE EXCEPTION 'Anonymous private quota read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.chat_scan_metadata('direct',current_setting('nexus.scan.direct')::uuid); RAISE EXCEPTION 'Anonymous metadata read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Chat scan full-history pagination, tied cursors, source metadata, snapshots, revoked access, message limits and lease isolation passed' AS result;
ROLLBACK;
