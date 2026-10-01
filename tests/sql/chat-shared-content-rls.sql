-- Synthetic users/messages only. No real account or Storage object is changed.
BEGIN;
SELECT set_config('nexus.media.a',gen_random_uuid()::text,true),set_config('nexus.media.b',gen_random_uuid()::text,true),set_config('nexus.media.other',gen_random_uuid()::text,true),set_config('nexus.media.chat',gen_random_uuid()::text,true),set_config('nexus.media.group',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
SELECT current_setting('nexus.media.'||person)::uuid,current_setting('nexus.media.'||person)||'@example.invalid',now(),'{"full_name":"Shared content rollback test"}'::jsonb FROM unnest(ARRAY['a','b','other']) person;
INSERT INTO public.direct_conversations(id,user_a,user_b) VALUES(current_setting('nexus.media.chat')::uuid,least(current_setting('nexus.media.a')::uuid,current_setting('nexus.media.b')::uuid),greatest(current_setting('nexus.media.a')::uuid,current_setting('nexus.media.b')::uuid));
INSERT INTO public.group_conversations(id,name,created_by) VALUES(current_setting('nexus.media.group')::uuid,'Shared content rollback group',current_setting('nexus.media.a')::uuid);
INSERT INTO public.group_members(group_id,user_id,role) VALUES(current_setting('nexus.media.group')::uuid,current_setting('nexus.media.a')::uuid,'owner'),(current_setting('nexus.media.group')::uuid,current_setting('nexus.media.b')::uuid,'member');
-- Same timestamps force the composite cursor to distinguish both messages and
-- multiple items in one message. Older history is available to current members,
-- matching the existing authorized group history RPC.
INSERT INTO public.direct_messages(conversation_id,sender_id,body,created_at)
SELECT current_setting('nexus.media.chat')::uuid,current_setting('nexus.media.a')::uuid,'media-fixture-'||n,'2026-01-01T10:00:00Z' FROM generate_series(1,31) n;
INSERT INTO public.group_messages(group_id,sender_id,body,created_at)
SELECT current_setting('nexus.media.group')::uuid,current_setting('nexus.media.a')::uuid,'media-fixture-'||n,'2026-01-01T10:00:00Z' FROM generate_series(1,31) n;
INSERT INTO public.direct_message_attachments(message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT m.id,m.conversation_id,m.sender_id,m.conversation_id||'/'||m.sender_id||'/'||m.id||'.jpg','Bild-'||m.body||'.jpg','image/jpeg',512 FROM public.direct_messages m WHERE m.conversation_id=current_setting('nexus.media.chat')::uuid;
INSERT INTO public.group_message_attachments(message_id,group_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT m.id,m.group_id,m.sender_id,'groups/'||m.group_id||'/'||m.sender_id||'/'||m.id||'.jpg','Bild-'||m.body||'.jpg','image/jpeg',512 FROM public.group_messages m WHERE m.group_id=current_setting('nexus.media.group')::uuid;
INSERT INTO public.direct_message_attachments(message_id,conversation_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT m.id,m.conversation_id,m.sender_id,m.conversation_id||'/'||m.sender_id||'/'||m.id||'.pdf','Angebot_100%.pdf','application/pdf',1000 FROM public.direct_messages m WHERE m.conversation_id=current_setting('nexus.media.chat')::uuid AND m.body='media-fixture-1';
INSERT INTO public.group_message_attachments(message_id,group_id,uploader_id,storage_path,file_name,mime_type,file_size)
SELECT m.id,m.group_id,m.sender_id,'groups/'||m.group_id||'/'||m.sender_id||'/'||m.id||'.pdf','Angebot_100%.pdf','application/pdf',1000 FROM public.group_messages m WHERE m.group_id=current_setting('nexus.media.group')::uuid AND m.body='media-fixture-1';
UPDATE public.direct_messages SET body='Siehe (https://example.invalid/angebot). https://example.invalid/angebot https://example.invalid/plan_(neu) www.team.invalid/projekt?x=1&y=2 javascript:alert(1) https://user:pass@evil.invalid' WHERE conversation_id=current_setting('nexus.media.chat')::uuid AND body='media-fixture-1';
UPDATE public.group_messages SET body='Siehe (https://example.invalid/angebot). https://example.invalid/angebot https://example.invalid/plan_(neu) www.team.invalid/projekt?x=1&y=2 javascript:alert(1) https://user:pass@evil.invalid' WHERE group_id=current_setting('nexus.media.group')::uuid AND body='media-fixture-1';
-- Deleted text and attachments must not be returned even if old metadata remains.
UPDATE public.direct_messages SET deleted_at=now(),body='' WHERE conversation_id=current_setting('nexus.media.chat')::uuid AND body='media-fixture-31';
UPDATE public.group_messages SET deleted_at=now(),body='' WHERE group_id=current_setting('nexus.media.group')::uuid AND body='media-fixture-31';

SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.media.b'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE kind text; chat uuid; page jsonb; cursor jsonb; ids text[]; before_reads integer; item jsonb;
BEGIN
  SELECT count(*) INTO before_reads FROM public.direct_conversation_reads WHERE user_id=auth.uid();
  FOREACH kind IN ARRAY ARRAY['direct','group'] LOOP
    chat:=current_setting('nexus.media.'||CASE kind WHEN 'direct' THEN 'chat' ELSE 'group' END)::uuid;
    ids:=ARRAY[]::text[];cursor:=NULL;
    LOOP
      page:=public.get_chat_shared_content(kind,chat,'images','',(cursor->>'created_at')::timestamptz,(cursor->>'message_id')::uuid,cursor->>'item_id',7);
      IF jsonb_array_length(page->'items')>7 THEN RAISE EXCEPTION 'Page limit ignored'; END IF;
      FOR item IN SELECT * FROM jsonb_array_elements(page->'items') LOOP
        IF item->>'kind'<>kind OR item->>'chat_id'<>chat::text OR item->>'mime_type'<>'image/jpeg' OR item->>'message_id'||':'||(item->>'item_id')=ANY(ids) THEN RAISE EXCEPTION 'Foreign/category/duplicate result'; END IF;
        ids:=array_append(ids,item->>'message_id'||':'||(item->>'item_id'));
      END LOOP;
      EXIT WHEN NOT (page->>'has_more')::boolean;
      IF cursor=page->'next_cursor' THEN RAISE EXCEPTION 'Cursor did not advance'; END IF;
      cursor:=page->'next_cursor';
    END LOOP;
    IF cardinality(ids)<>30 THEN RAISE EXCEPTION 'Lost or deleted images: %',cardinality(ids); END IF;
    page:=public.get_chat_shared_content(kind,chat,'files','angebot_100%');
    IF jsonb_array_length(page->'items')<>1 OR page->'items'->0->>'mime_type'<>'application/pdf' THEN RAISE EXCEPTION 'Literal filename search failed'; END IF;
    page:=public.get_chat_shared_content(kind,chat,'files','100_');
    IF jsonb_array_length(page->'items')<>0 OR page->'next_cursor'<>'null'::jsonb THEN RAISE EXCEPTION 'Wildcard search or empty cursor wrong'; END IF;
    page:=public.get_chat_shared_content(kind,chat,'links');
    IF jsonb_array_length(page->'items')<>3 OR page::text LIKE '%evil.invalid%' OR page::text LIKE '%javascript:%' THEN RAISE EXCEPTION 'Link parsing/duplicates/unsafe scheme: %',page; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') i WHERE i->>'url'='https://example.invalid/plan_(neu)') THEN RAISE EXCEPTION 'Balanced URL punctuation lost'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page->'items') i WHERE i->>'url'='https://example.invalid/angebot') THEN RAISE EXCEPTION 'Sentence punctuation included'; END IF;
    -- Several URLs in the same message share both timestamp and message ID.
    -- A page boundary must advance by item ID without skipping or repeating one.
    ids:=ARRAY[]::text[];cursor:=NULL;
    LOOP
      page:=public.get_chat_shared_content(kind,chat,'links','',(cursor->>'created_at')::timestamptz,(cursor->>'message_id')::uuid,cursor->>'item_id',1);
      item:=page->'items'->0;
      IF item IS NULL OR item->>'item_id'=ANY(ids) THEN RAISE EXCEPTION 'Same-message link cursor repeated or lost'; END IF;
      ids:=array_append(ids,item->>'item_id');
      EXIT WHEN NOT (page->>'has_more')::boolean;
      cursor:=page->'next_cursor';
    END LOOP;
    IF cardinality(ids)<>3 THEN RAISE EXCEPTION 'Same-message link cursor skipped an item'; END IF;
    page:=public.get_chat_shared_content(kind,chat,'links','TEAM.INVALID');
    IF jsonb_array_length(page->'items')<>1 THEN RAISE EXCEPTION 'Link search failed'; END IF;
    BEGIN PERFORM public.get_chat_shared_content(kind,chat,'unknown'); RAISE EXCEPTION 'Invalid category accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN PERFORM public.get_chat_shared_content(kind,chat,'files',repeat('x',101)); RAISE EXCEPTION 'Long search accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN PERFORM public.get_chat_shared_content(kind,chat,'files','',now(),NULL,NULL); RAISE EXCEPTION 'Partial cursor accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  IF (SELECT count(*) FROM public.direct_conversation_reads WHERE user_id=auth.uid())<>before_reads THEN RAISE EXCEPTION 'Browsing marked messages read'; END IF;
  BEGIN PERFORM public.get_chat_shared_content('direct',gen_random_uuid(),'files'); RAISE EXCEPTION 'Foreign chat accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_chat_shared_content('group',gen_random_uuid(),'links'); RAISE EXCEPTION 'Foreign group accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.chat_shared_links('https://example.invalid'); RAISE EXCEPTION 'Private parser executable by client'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
-- A foreign account cannot invoke the private reader to bypass the public wrapper.
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.media.other'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  BEGIN PERFORM public.get_chat_shared_content('direct',current_setting('nexus.media.chat')::uuid,'images'); RAISE EXCEPTION 'Foreign account read direct files'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.get_chat_shared_content('group',current_setting('nexus.media.group')::uuid,'links'); RAISE EXCEPTION 'Foreign account read group links'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DELETE FROM public.group_members WHERE group_id=current_setting('nexus.media.group')::uuid AND user_id=current_setting('nexus.media.b')::uuid;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('nexus.media.b'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  BEGIN PERFORM public.get_chat_shared_content('group',current_setting('nexus.media.group')::uuid,'images'); RAISE EXCEPTION 'Former member retained files'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $test$ BEGIN
  BEGIN PERFORM public.get_chat_shared_content('direct',current_setting('nexus.media.chat')::uuid,'files'); RAISE EXCEPTION 'Anonymous access accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'Shared content privacy, old history, tied cursors, filename/link search, URL parsing, deleted messages, read state and membership revocation passed' AS result;
ROLLBACK;
