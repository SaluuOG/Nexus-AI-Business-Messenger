-- Phase 3.7 acceptance: complete keyset history, deep-link context, secure
-- cross-chat search and idempotent text retries. All identities/messages are
-- synthetic and every change is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

SELECT set_config('nexus.history.owner', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.member', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.outsider', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.stranger', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_alt', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_private', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_alt', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_private', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_request', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_request', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_foreign_parent', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_foreign_parent', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_cross_reply', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_cross_reply', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.direct_deleted', gen_random_uuid()::text, true);
SELECT set_config('nexus.history.group_deleted', gen_random_uuid()::text, true);

INSERT INTO auth.users(id, email, email_confirmed_at, raw_user_meta_data)
SELECT current_setting('nexus.history.' || person)::uuid,
       current_setting('nexus.history.' || person) || '@example.invalid',
       now(), jsonb_build_object('full_name', initcap(person) || ' History')
FROM unnest(ARRAY['owner', 'member', 'outsider', 'stranger']) AS person;

UPDATE public.profiles
SET full_name = CASE id
      WHEN current_setting('nexus.history.owner')::uuid THEN 'Owner Filter'
      WHEN current_setting('nexus.history.member')::uuid THEN 'Member Filter'
      WHEN current_setting('nexus.history.outsider')::uuid THEN 'Outsider Secret'
      ELSE 'Stranger Private'
    END,
    username = CASE id
      WHEN current_setting('nexus.history.owner')::uuid THEN 'history_owner_' || left(replace(id::text, '-', ''), 8)
      WHEN current_setting('nexus.history.member')::uuid THEN 'history_member_' || left(replace(id::text, '-', ''), 8)
      WHEN current_setting('nexus.history.outsider')::uuid THEN 'history_outsider_' || left(replace(id::text, '-', ''), 8)
      ELSE 'history_stranger_' || left(replace(id::text, '-', ''), 8)
    END
WHERE id IN (
  current_setting('nexus.history.owner')::uuid,
  current_setting('nexus.history.member')::uuid,
  current_setting('nexus.history.outsider')::uuid,
  current_setting('nexus.history.stranger')::uuid
);

INSERT INTO public.direct_conversations(id, user_a, user_b) VALUES
  (current_setting('nexus.history.direct')::uuid,
   least(current_setting('nexus.history.owner')::uuid, current_setting('nexus.history.member')::uuid),
   greatest(current_setting('nexus.history.owner')::uuid, current_setting('nexus.history.member')::uuid)),
  (current_setting('nexus.history.direct_alt')::uuid,
   least(current_setting('nexus.history.member')::uuid, current_setting('nexus.history.outsider')::uuid),
   greatest(current_setting('nexus.history.member')::uuid, current_setting('nexus.history.outsider')::uuid)),
  (current_setting('nexus.history.direct_private')::uuid,
   least(current_setting('nexus.history.outsider')::uuid, current_setting('nexus.history.stranger')::uuid),
   greatest(current_setting('nexus.history.outsider')::uuid, current_setting('nexus.history.stranger')::uuid));

INSERT INTO public.group_conversations(id, name, created_by) VALUES
  (current_setting('nexus.history.group')::uuid, 'Project Alpha', current_setting('nexus.history.owner')::uuid),
  (current_setting('nexus.history.group_alt')::uuid, 'Alternate Group', current_setting('nexus.history.member')::uuid),
  (current_setting('nexus.history.group_private')::uuid, 'Private Vault', current_setting('nexus.history.outsider')::uuid);

INSERT INTO public.group_members(group_id, user_id, role, joined_at) VALUES
  (current_setting('nexus.history.group')::uuid, current_setting('nexus.history.owner')::uuid, 'owner', '2025-01-01T00:00:00Z'),
  (current_setting('nexus.history.group')::uuid, current_setting('nexus.history.member')::uuid, 'member', '2025-01-01T00:00:00Z'),
  (current_setting('nexus.history.group_alt')::uuid, current_setting('nexus.history.member')::uuid, 'owner', '2025-01-01T00:00:00Z'),
  (current_setting('nexus.history.group_alt')::uuid, current_setting('nexus.history.outsider')::uuid, 'member', '2025-01-01T00:00:00Z'),
  (current_setting('nexus.history.group_private')::uuid, current_setting('nexus.history.outsider')::uuid, 'owner', '2025-01-01T00:00:00Z'),
  (current_setting('nexus.history.group_private')::uuid, current_setting('nexus.history.stranger')::uuid, 'member', '2025-01-01T00:00:00Z');

-- Disable caller-derived notification recipients while fixtures are inserted.
SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.direct_messages(id, conversation_id, sender_id, body, created_at)
SELECT md5(current_setting('nexus.history.direct') || ':' || n)::uuid,
       current_setting('nexus.history.direct')::uuid,
       CASE WHEN n % 2 = 0
         THEN current_setting('nexus.history.member')::uuid
         ELSE current_setting('nexus.history.owner')::uuid END,
       'HistoryMarker direct message ' || n,
       '2026-01-10T10:00:00Z'::timestamptz + ((n - 1) / 7) * interval '1 second'
FROM generate_series(1, 211) AS n;

INSERT INTO public.group_messages(id, group_id, sender_id, body, created_at)
SELECT md5(current_setting('nexus.history.group') || ':' || n)::uuid,
       current_setting('nexus.history.group')::uuid,
       CASE WHEN n % 2 = 0
         THEN current_setting('nexus.history.member')::uuid
         ELSE current_setting('nexus.history.owner')::uuid END,
       'HistoryMarker group message ' || n,
       '2026-01-10T10:00:00Z'::timestamptz + ((n - 1) / 7) * interval '1 second'
FROM generate_series(1, 211) AS n;

INSERT INTO public.direct_messages(id, conversation_id, sender_id, body, created_at) VALUES
  (current_setting('nexus.history.direct_foreign_parent')::uuid,
   current_setting('nexus.history.direct_private')::uuid,
   current_setting('nexus.history.outsider')::uuid,
   'HistoryMarker PRIVATE_DIRECT_SENTINEL', '2026-02-01T10:00:00Z'),
  (current_setting('nexus.history.direct_cross_reply')::uuid,
   current_setting('nexus.history.direct')::uuid,
   current_setting('nexus.history.owner')::uuid,
   'HistoryMarker accessible cross reply', '2026-02-02T10:00:00Z');

UPDATE public.direct_messages
SET reply_to_message_id = current_setting('nexus.history.direct_foreign_parent')::uuid
WHERE id = current_setting('nexus.history.direct_cross_reply')::uuid;

INSERT INTO public.group_messages(id, group_id, sender_id, body, created_at) VALUES
  (current_setting('nexus.history.group_foreign_parent')::uuid,
   current_setting('nexus.history.group_private')::uuid,
   current_setting('nexus.history.outsider')::uuid,
   'HistoryMarker PRIVATE_GROUP_SENTINEL', '2026-02-01T10:00:00Z'),
  (current_setting('nexus.history.group_cross_reply')::uuid,
   current_setting('nexus.history.group')::uuid,
   current_setting('nexus.history.owner')::uuid,
   'HistoryMarker accessible group cross reply', '2026-02-02T10:00:00Z');

UPDATE public.group_messages
SET reply_to_message_id = current_setting('nexus.history.group_foreign_parent')::uuid
WHERE id = current_setting('nexus.history.group_cross_reply')::uuid;

INSERT INTO public.direct_messages(id, conversation_id, sender_id, body, created_at, deleted_at) VALUES
  (current_setting('nexus.history.direct_deleted')::uuid,
   current_setting('nexus.history.direct')::uuid,
   current_setting('nexus.history.owner')::uuid,
   'HistoryMarker DELETED_DIRECT_SENTINEL', '2026-02-03T10:00:00Z', '2026-02-03T10:01:00Z');

INSERT INTO public.group_messages(id, group_id, sender_id, body, created_at, deleted_at) VALUES
  (current_setting('nexus.history.group_deleted')::uuid,
   current_setting('nexus.history.group')::uuid,
   current_setting('nexus.history.owner')::uuid,
   'HistoryMarker DELETED_GROUP_SENTINEL', '2026-02-03T10:00:00Z', '2026-02-03T10:01:00Z');

INSERT INTO public.direct_message_attachments(
  message_id, conversation_id, uploader_id, storage_path,
  file_name, mime_type, file_size, created_at
) VALUES
  (md5(current_setting('nexus.history.direct') || ':211')::uuid,
   current_setting('nexus.history.direct')::uuid,
   current_setting('nexus.history.owner')::uuid,
   current_setting('nexus.history.direct') || '/history-attachment.pdf',
   'history-attachment.pdf', 'application/pdf', 321, '2026-01-10T10:01:00Z'),
  (current_setting('nexus.history.direct_deleted')::uuid,
   current_setting('nexus.history.direct')::uuid,
   current_setting('nexus.history.owner')::uuid,
   current_setting('nexus.history.direct') || '/PRIVATE_DELETED_DIRECT_PATH.pdf',
   'PRIVATE_DELETED_DIRECT_FILE.pdf', 'application/pdf', 654, '2026-02-03T10:00:30Z');

INSERT INTO public.group_message_attachments(
  message_id, group_id, uploader_id, storage_path,
  file_name, mime_type, file_size, created_at
) VALUES
  (md5(current_setting('nexus.history.group') || ':211')::uuid,
   current_setting('nexus.history.group')::uuid,
   current_setting('nexus.history.owner')::uuid,
   current_setting('nexus.history.group') || '/history-attachment.pdf',
   'history-attachment.pdf', 'application/pdf', 321, '2026-01-10T10:01:00Z'),
  (current_setting('nexus.history.group_deleted')::uuid,
   current_setting('nexus.history.group')::uuid,
   current_setting('nexus.history.owner')::uuid,
   current_setting('nexus.history.group') || '/PRIVATE_DELETED_GROUP_PATH.pdf',
   'PRIVATE_DELETED_GROUP_FILE.pdf', 'application/pdf', 654, '2026-02-03T10:00:30Z');

-- Member: exact keyset coverage, stable equal-timestamp ordering and rich rows.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('nexus.history.member'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  kind text;
  chat_id uuid;
  first_page jsonb;
  second_page jsonb;
  capped_page jsonb;
  cursor jsonb;
  expected_ids uuid[];
  actual_ids uuid[];
  row_count integer;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct', 'group'] LOOP
    chat_id := current_setting('nexus.history.' || kind)::uuid;
    IF kind = 'direct' THEN
      first_page := public.get_direct_message_page(chat_id, NULL, NULL, 17);
    ELSE
      first_page := public.get_group_message_page(chat_id, NULL, NULL, 17);
    END IF;

    IF jsonb_array_length(first_page->'messages') <> 17
       OR NOT (first_page->>'has_more')::boolean
       OR first_page->'next_cursor' IS NULL THEN
      RAISE EXCEPTION '% first history page metadata is incorrect: %', kind, first_page;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT
          (item->>'created_at')::timestamptz AS created_at,
          (item->>'message_id')::uuid AS message_id,
          lag((item->>'created_at')::timestamptz) OVER (ORDER BY ordinal) AS previous_created_at,
          lag((item->>'message_id')::uuid) OVER (ORDER BY ordinal) AS previous_message_id
        FROM jsonb_array_elements(first_page->'messages') WITH ORDINALITY AS rows(item, ordinal)
      ) AS ordered
      WHERE previous_created_at > created_at
         OR (previous_created_at = created_at AND previous_message_id >= message_id)
    ) THEN
      RAISE EXCEPTION '% page is not strictly chronological by (created_at,id)', kind;
    END IF;

    cursor := first_page->'next_cursor';
    IF kind = 'direct' THEN
      second_page := public.get_direct_message_page(
        chat_id,
        (cursor->>'created_at')::timestamptz,
        (cursor->>'message_id')::uuid,
        17
      );
      capped_page := public.get_direct_message_page(chat_id, NULL, NULL, 10000);
      SELECT array_agg(id ORDER BY created_at DESC, id DESC)
      INTO expected_ids
      FROM (
        SELECT id, created_at
        FROM public.direct_messages
        WHERE conversation_id = chat_id
        ORDER BY created_at DESC, id DESC
        LIMIT 34
      ) AS expected;
    ELSE
      second_page := public.get_group_message_page(
        chat_id,
        (cursor->>'created_at')::timestamptz,
        (cursor->>'message_id')::uuid,
        17
      );
      capped_page := public.get_group_message_page(chat_id, NULL, NULL, 10000);
      SELECT array_agg(id ORDER BY created_at DESC, id DESC)
      INTO expected_ids
      FROM (
        SELECT id, created_at
        FROM public.group_messages
        WHERE group_id = chat_id
        ORDER BY created_at DESC, id DESC
        LIMIT 34
      ) AS expected;
    END IF;

    SELECT array_agg(
      (item->>'message_id')::uuid
      ORDER BY (item->>'created_at')::timestamptz DESC, (item->>'message_id')::uuid DESC
    ), count(*)
    INTO actual_ids, row_count
    FROM jsonb_array_elements((first_page->'messages') || (second_page->'messages')) AS rows(item);

    IF row_count <> 34 OR actual_ids IS DISTINCT FROM expected_ids THEN
      RAISE EXCEPTION '% keyset pages contain a duplicate or gap', kind;
    END IF;
    IF jsonb_array_length(capped_page->'messages') <> 200 THEN
      RAISE EXCEPTION '% history limit was not capped at 200', kind;
    END IF;
  END LOOP;

  IF jsonb_array_length(
    public.get_direct_message_context(
      current_setting('nexus.history.direct')::uuid,
      md5(current_setting('nexus.history.direct') || ':100')::uuid,
      3
    )->'messages'
  ) <> 7 THEN
    RAISE EXCEPTION 'Direct anchor context radius is incorrect';
  END IF;

  IF jsonb_array_length(
    public.get_group_message_context(
      current_setting('nexus.history.group')::uuid,
      md5(current_setting('nexus.history.group') || ':100')::uuid,
      3
    )->'messages'
  ) <> 7 THEN
    RAISE EXCEPTION 'Group anchor context radius is incorrect';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_direct_message_context(
        current_setting('nexus.history.direct')::uuid,
        current_setting('nexus.history.direct_cross_reply')::uuid,
        1
      )->'messages'
    ) AS rows(item)
    WHERE item->>'message_id' = current_setting('nexus.history.direct_cross_reply')
      AND (item->>'reply_body' IS NOT NULL OR item->>'reply_sender_id' IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Direct context leaked a reply from another conversation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_group_message_context(
        current_setting('nexus.history.group')::uuid,
        current_setting('nexus.history.group_cross_reply')::uuid,
        1
      )->'messages'
    ) AS rows(item)
    WHERE item->>'message_id' = current_setting('nexus.history.group_cross_reply')
      AND (item->>'reply_body' IS NOT NULL OR item->>'reply_sender_id' IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Group context leaked a reply from another group';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_direct_message_context(
        current_setting('nexus.history.direct')::uuid,
        md5(current_setting('nexus.history.direct') || ':211')::uuid,
        1
      )->'messages'
    ) AS rows(item)
    WHERE item->>'message_id' = md5(current_setting('nexus.history.direct') || ':211')::uuid::text
      AND jsonb_array_length(item->'attachments') = 1
  ) THEN
    RAISE EXCEPTION 'Direct history lost attachment metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_group_message_context(
        current_setting('nexus.history.group')::uuid,
        md5(current_setting('nexus.history.group') || ':211')::uuid,
        1
      )->'messages'
    ) AS rows(item)
    WHERE item->>'message_id' = md5(current_setting('nexus.history.group') || ':211')::uuid::text
      AND jsonb_array_length(item->'attachments') = 1
  ) THEN
    RAISE EXCEPTION 'Group history lost attachment metadata';
  END IF;

  first_page := public.get_direct_message_context(
    current_setting('nexus.history.direct')::uuid,
    current_setting('nexus.history.direct_deleted')::uuid,
    1
  );
  IF first_page::text LIKE '%DELETED_DIRECT_SENTINEL%'
     OR first_page::text LIKE '%PRIVATE_DELETED_DIRECT_%'
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(first_page->'messages') AS rows(item)
       WHERE item->>'message_id' = current_setting('nexus.history.direct_deleted')
         AND item->>'body' = ''
         AND item->>'deleted_at' IS NOT NULL
         AND item->'attachments' = '[]'::jsonb
     ) THEN
    RAISE EXCEPTION 'Deleted direct content or attachment metadata was not redacted';
  END IF;

  first_page := public.get_group_message_context(
    current_setting('nexus.history.group')::uuid,
    current_setting('nexus.history.group_deleted')::uuid,
    1
  );
  IF first_page::text LIKE '%DELETED_GROUP_SENTINEL%'
     OR first_page::text LIKE '%PRIVATE_DELETED_GROUP_%'
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(first_page->'messages') AS rows(item)
       WHERE item->>'message_id' = current_setting('nexus.history.group_deleted')
         AND item->>'body' = ''
         AND item->>'deleted_at' IS NOT NULL
         AND item->'attachments' = '[]'::jsonb
     ) THEN
    RAISE EXCEPTION 'Deleted group content or attachment metadata was not redacted';
  END IF;

  BEGIN
    PERFORM public.get_direct_message_page(
      current_setting('nexus.history.direct')::uuid, now(), NULL, 10
    );
    RAISE EXCEPTION 'Direct history accepted a partial cursor';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültiger Nachrichten-Cursor.' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.get_group_message_page(
      current_setting('nexus.history.group')::uuid, NULL, gen_random_uuid(), 10
    );
    RAISE EXCEPTION 'Group history accepted a partial cursor';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültiger Nachrichten-Cursor.' THEN RAISE; END IF;
  END;
END;
$test$;

-- Search: literal input, strict scopes, half-open dates and keyset coverage.
DO $test$
DECLARE
  result jsonb;
  second_page jsonb;
  cursor jsonb;
  expected_ids uuid[];
  actual_ids uuid[];
BEGIN
  result := public.search_accessible_messages(p_query => 'HistoryMarker', p_limit => 500);
  IF jsonb_array_length(result->'results') <> 50 OR NOT (result->>'has_more')::boolean THEN
    RAISE EXCEPTION 'Search limit was not capped at 50: %', result;
  END IF;
  IF result::text LIKE '%PRIVATE_%' OR result::text LIKE '%DELETED_%' THEN
    RAISE EXCEPTION 'Search exposed inaccessible or deleted text';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE item->>'chat_id' NOT IN (
      current_setting('nexus.history.direct'), current_setting('nexus.history.group')
    )
  ) THEN
    RAISE EXCEPTION 'Search returned a chat outside the member scope';
  END IF;

  result := public.search_accessible_messages(p_query => 'HistoryMarker', p_kind => 'direct', p_limit => 20);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item) WHERE item->>'kind' <> 'direct') THEN
    RAISE EXCEPTION 'Direct kind filter returned a group result';
  END IF;
  result := public.search_accessible_messages(p_query => 'HistoryMarker', p_kind => 'group', p_limit => 20);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item) WHERE item->>'kind' <> 'group') THEN
    RAISE EXCEPTION 'Group kind filter returned a direct result';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_kind => 'direct',
    p_chat_id => current_setting('nexus.history.direct')::uuid,
    p_limit => 20
  );
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE item->>'kind' <> 'direct'
       OR item->>'chat_id' <> current_setting('nexus.history.direct')
  ) THEN
    RAISE EXCEPTION 'Chat-scoped search escaped its direct conversation';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_kind => 'direct',
    p_chat_id => current_setting('nexus.history.group')::uuid,
    p_limit => 20
  );
  IF jsonb_array_length(result->'results') <> 0 THEN
    RAISE EXCEPTION 'Direct chat filter accepted a group identifier';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_sender_id => current_setting('nexus.history.member')::uuid,
    p_limit => 50
  );
  IF jsonb_array_length(result->'results') = 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE item->>'sender_id' <> current_setting('nexus.history.member')
  ) THEN
    RAISE EXCEPTION 'Sender-id filter returned another sender';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_sender_query => 'Member Fil', p_limit => 50
  );
  IF jsonb_array_length(result->'results') = 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE item->>'sender_id' <> current_setting('nexus.history.member')
  ) THEN
    RAISE EXCEPTION 'Sender-name filter matched a peer or chat instead of the sender';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_sender_query => '%_', p_limit => 50
  );
  IF jsonb_array_length(result->'results') <> 0 THEN
    RAISE EXCEPTION 'Sender filter treated SQL wildcard characters specially';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker', p_scope_query => 'Project Alpha', p_limit => 50
  );
  IF jsonb_array_length(result->'results') = 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE item->>'kind' <> 'group'
       OR item->>'chat_id' <> current_setting('nexus.history.group')
  ) THEN
    RAISE EXCEPTION 'Conversation/person scope filter escaped Project Alpha';
  END IF;

  result := public.search_accessible_messages(
    p_query => 'HistoryMarker',
    p_from_date => '2026-01-10T10:00:05Z',
    p_to_date => '2026-01-10T10:00:06Z',
    p_limit => 50
  );
  IF jsonb_array_length(result->'results') = 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(result->'results') AS rows(item)
    WHERE (item->>'created_at')::timestamptz < '2026-01-10T10:00:05Z'
       OR (item->>'created_at')::timestamptz >= '2026-01-10T10:00:06Z'
  ) THEN
    RAISE EXCEPTION 'Half-open timestamp filter is incorrect';
  END IF;

  result := public.search_accessible_messages(p_query => 'HistoryMar', p_limit => 10);
  IF jsonb_array_length(result->'results') = 0 THEN
    RAISE EXCEPTION 'Literal prefix search did not find a partial final word';
  END IF;
  result := public.search_accessible_messages(p_query => '%_', p_limit => 10);
  IF jsonb_array_length(result->'results') <> 0 THEN
    RAISE EXCEPTION 'Punctuation-only query matched messages';
  END IF;
  result := public.search_accessible_messages(
    p_query => 'HistoryMarker OR PRIVATE_DIRECT_SENTINEL', p_limit => 10
  );
  IF jsonb_array_length(result->'results') <> 0 THEN
    RAISE EXCEPTION 'User input was interpreted as tsquery operator syntax';
  END IF;

  result := public.search_accessible_messages(p_query => 'HistoryMarker', p_limit => 13);
  cursor := result->'next_cursor';
  second_page := public.search_accessible_messages(
    p_query => 'HistoryMarker',
    p_before_created_at => (cursor->>'created_at')::timestamptz,
    p_before_message_id => (cursor->>'message_id')::uuid,
    p_limit => 13
  );

  SELECT array_agg(message_id ORDER BY created_at DESC, message_id DESC)
  INTO expected_ids
  FROM (
    SELECT message_id, created_at
    FROM (
      SELECT message.id AS message_id, message.created_at
      FROM public.direct_messages AS message
      WHERE message.conversation_id = current_setting('nexus.history.direct')::uuid
        AND message.deleted_at IS NULL AND btrim(message.body) <> ''
        AND to_tsvector('simple', message.body) @@ to_tsquery('simple', '''historymarker'':*')
      UNION ALL
      SELECT message.id, message.created_at
      FROM public.group_messages AS message
      WHERE message.group_id = current_setting('nexus.history.group')::uuid
        AND message.deleted_at IS NULL AND btrim(message.body) <> ''
        AND to_tsvector('simple', message.body) @@ to_tsquery('simple', '''historymarker'':*')
    ) AS accessible_expected
    ORDER BY created_at DESC, message_id DESC
    LIMIT 26
  ) AS expected;

  SELECT array_agg(
    (item->>'message_id')::uuid
    ORDER BY (item->>'created_at')::timestamptz DESC, (item->>'message_id')::uuid DESC
  )
  INTO actual_ids
  FROM jsonb_array_elements((result->'results') || (second_page->'results')) AS rows(item);

  IF actual_ids IS DISTINCT FROM expected_ids THEN
    RAISE EXCEPTION 'Search keyset pages contain a duplicate or gap';
  END IF;

  BEGIN
    PERFORM public.search_accessible_messages(p_query => 'x');
    RAISE EXCEPTION 'One-character search was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Suchbegriff muss zwischen 2 und 100 Zeichen lang sein.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_accessible_messages(p_query => repeat('x', 101));
    RAISE EXCEPTION 'Oversized search was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Suchbegriff muss zwischen 2 und 100 Zeichen lang sein.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_accessible_messages(
      p_query => 'HistoryMarker', p_chat_id => current_setting('nexus.history.direct')::uuid
    );
    RAISE EXCEPTION 'Chat filter without kind was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ein Gesprächsfilter benötigt eine Chat-Art.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_accessible_messages(p_query => 'HistoryMarker', p_kind => 'channel');
    RAISE EXCEPTION 'Unknown chat kind was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültige Chat-Art.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_accessible_messages(
      p_query => 'HistoryMarker', p_from_date => now(), p_to_date => now()
    );
    RAISE EXCEPTION 'Empty/reversed date interval was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Der Datumsbereich ist ungültig.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.search_accessible_messages(
      p_query => 'HistoryMarker', p_before_created_at => now()
    );
    RAISE EXCEPTION 'Partial search cursor was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültiger Such-Cursor.' THEN RAISE; END IF;
  END;
END;
$test$;

-- Text retries are sender-scoped, exactly idempotent and reject request reuse.
DO $test$
DECLARE
  direct_id uuid;
  repeated_id uuid;
  group_id uuid;
  repeated_group_id uuid;
  direct_reply uuid := md5(current_setting('nexus.history.direct') || ':1')::uuid;
  group_reply uuid := md5(current_setting('nexus.history.group') || ':1')::uuid;
BEGIN
  direct_id := public.send_direct_message_v3(
    current_setting('nexus.history.direct')::uuid,
    '  Retry exact body  ',
    current_setting('nexus.history.direct_request')::uuid,
    direct_reply
  );
  repeated_id := public.send_direct_message_v3(
    current_setting('nexus.history.direct')::uuid,
    'Retry exact body',
    current_setting('nexus.history.direct_request')::uuid,
    direct_reply
  );
  IF direct_id <> repeated_id OR (
    SELECT count(*) FROM public.direct_messages
    WHERE sender_id = current_setting('nexus.history.member')::uuid
      AND client_request_id = current_setting('nexus.history.direct_request')::uuid
  ) <> 1 THEN
    RAISE EXCEPTION 'Direct retry duplicated a message';
  END IF;

  BEGIN
    PERFORM public.send_direct_message_v3(
      current_setting('nexus.history.direct')::uuid,
      'Changed retry body',
      current_setting('nexus.history.direct_request')::uuid,
      direct_reply
    );
    RAISE EXCEPTION 'Direct request id accepted changed body';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'request_conflict:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_direct_message_v3(
      current_setting('nexus.history.direct')::uuid,
      'Retry exact body',
      current_setting('nexus.history.direct_request')::uuid,
      NULL
    );
    RAISE EXCEPTION 'Direct request id accepted changed reply';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'request_conflict:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_direct_message_v3(
      current_setting('nexus.history.direct_alt')::uuid,
      'Retry exact body',
      current_setting('nexus.history.direct_request')::uuid,
      direct_reply
    );
    RAISE EXCEPTION 'Direct request id was reused in another chat';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'request_conflict:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_direct_message_v3(
      current_setting('nexus.history.direct')::uuid,
      'Cross-chat reply', gen_random_uuid(),
      current_setting('nexus.history.direct_foreign_parent')::uuid
    );
    RAISE EXCEPTION 'Direct send accepted a reply target from another chat';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Antwort-Ziel wurde nicht gefunden.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_direct_message_v3(
      current_setting('nexus.history.direct')::uuid, 'No request id', NULL, NULL
    );
    RAISE EXCEPTION 'Direct send accepted a null request id';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültige Anfrage-ID.' THEN RAISE; END IF;
  END;

  group_id := public.send_group_message_v2(
    current_setting('nexus.history.group')::uuid,
    '  Retry exact group body  ',
    current_setting('nexus.history.group_request')::uuid,
    group_reply
  );
  repeated_group_id := public.send_group_message_v2(
    current_setting('nexus.history.group')::uuid,
    'Retry exact group body',
    current_setting('nexus.history.group_request')::uuid,
    group_reply
  );
  IF group_id <> repeated_group_id OR (
    SELECT count(*) FROM public.group_messages
    WHERE sender_id = current_setting('nexus.history.member')::uuid
      AND client_request_id = current_setting('nexus.history.group_request')::uuid
  ) <> 1 THEN
    RAISE EXCEPTION 'Group retry duplicated a message';
  END IF;

  BEGIN
    PERFORM public.send_group_message_v2(
      current_setting('nexus.history.group')::uuid,
      'Changed retry group body',
      current_setting('nexus.history.group_request')::uuid,
      group_reply
    );
    RAISE EXCEPTION 'Group request id accepted changed body';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'request_conflict:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_group_message_v2(
      current_setting('nexus.history.group_alt')::uuid,
      'Retry exact group body',
      current_setting('nexus.history.group_request')::uuid,
      group_reply
    );
    RAISE EXCEPTION 'Group request id was reused in another chat';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'request_conflict:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_group_message_v2(
      current_setting('nexus.history.group')::uuid,
      'Cross-group reply', gen_random_uuid(),
      current_setting('nexus.history.group_foreign_parent')::uuid
    );
    RAISE EXCEPTION 'Group send accepted a reply target from another group';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Antwort-Ziel wurde nicht gefunden.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.send_group_message_v2(
      current_setting('nexus.history.group')::uuid,
      'No request id', '00000000-0000-0000-0000-000000000000', NULL
    );
    RAISE EXCEPTION 'Group send accepted the zero request id';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Ungültige Anfrage-ID.' THEN RAISE; END IF;
  END;
END;
$test$;

-- Two synthetic participants exercise the actual RPCs under authenticated RLS.
-- This checks database behavior, not two signed-in devices or Storage delivery.
DO $test$
DECLARE message_id uuid; kind text;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct', 'group'] LOOP
    EXECUTE format('SELECT id FROM public.%I WHERE sender_id = auth.uid() AND client_request_id = $1', kind || '_messages')
      INTO STRICT message_id USING current_setting('nexus.history.' || kind || '_request')::uuid;
    PERFORM set_config('nexus.history.' || kind || '_sent', message_id::text, true);
    EXECUTE format('SELECT public.%I($1, $2)', 'edit_' || kind || '_message')
      USING message_id, 'Edited by the sender';
  END LOOP;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('nexus.history.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE kind text; message_id uuid; chat_id uuid; result jsonb; reply_id uuid;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct', 'group'] LOOP
    message_id := current_setting('nexus.history.' || kind || '_sent')::uuid;
    chat_id := current_setting('nexus.history.' || kind)::uuid;
    EXECUTE format('SELECT public.%I($1, $2, 1)', 'get_' || kind || '_message_context')
      INTO result USING chat_id, message_id;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'messages') item
      WHERE item->>'message_id' = message_id::text AND item->>'body' = 'Edited by the sender'
        AND item->>'edited_at' IS NOT NULL) THEN
      RAISE EXCEPTION '% recipient did not receive the edit', kind;
    END IF;
    BEGIN
      EXECUTE format('SELECT public.%I($1, $2)', 'edit_' || kind || '_message')
        USING message_id, 'Recipient must not overwrite the sender';
      RAISE EXCEPTION 'Recipient edited another sender message';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('Nachricht nicht gefunden oder kann nicht bearbeitet werden.',
        'Nachricht nicht gefunden, kein Gruppenzugriff oder kann nicht bearbeitet werden.') THEN RAISE; END IF;
    END;
    BEGIN
      EXECUTE format('SELECT public.%I($1)', 'delete_' || kind || '_message') USING message_id;
      RAISE EXCEPTION 'Recipient deleted another sender message';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT IN ('Nachricht nicht gefunden oder kann nicht gelöscht werden.',
        'Nachricht nicht gefunden, kein Gruppenzugriff oder kann nicht gelöscht werden.') THEN RAISE; END IF;
    END;
    IF kind = 'direct' THEN
      PERFORM public.mark_direct_conversation_read(chat_id);
      IF NOT EXISTS (SELECT 1 FROM public.direct_conversation_reads
        WHERE conversation_id = chat_id AND user_id = auth.uid() AND last_read_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Recipient direct read receipt missing';
      END IF;
      reply_id := public.send_direct_message_v3(chat_id, 'Recipient reply', gen_random_uuid(), message_id);
      IF NOT EXISTS (SELECT 1 FROM public.direct_messages WHERE id = reply_id
        AND sender_id = auth.uid() AND reply_to_message_id = message_id) THEN
        RAISE EXCEPTION 'Recipient direct reply missing';
      END IF;
    ELSE
      PERFORM public.mark_group_read(chat_id);
      IF NOT EXISTS (SELECT 1 FROM public.group_reads
        WHERE group_id = chat_id AND user_id = auth.uid() AND last_read_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Recipient group read receipt missing';
      END IF;
      reply_id := public.send_group_message_v2(chat_id, 'Recipient reply', gen_random_uuid(), message_id);
      IF NOT EXISTS (SELECT 1 FROM public.group_messages WHERE id = reply_id
        AND sender_id = auth.uid() AND reply_to_message_id = message_id) THEN
        RAISE EXCEPTION 'Recipient group reply missing';
      END IF;
    END IF;
  END LOOP;
END;
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('nexus.history.member'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE kind text; message_id uuid; result jsonb;
BEGIN
  FOREACH kind IN ARRAY ARRAY['direct', 'group'] LOOP
    message_id := current_setting('nexus.history.' || kind || '_sent')::uuid;
    EXECUTE format('SELECT public.%I($1)', 'delete_' || kind || '_message') USING message_id;
    EXECUTE format('SELECT public.%I($1, $2, 1)', 'get_' || kind || '_message_context')
      INTO result USING current_setting('nexus.history.' || kind)::uuid, message_id;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result->'messages') item
      WHERE item->>'message_id' = message_id::text AND item->>'body' = ''
        AND item->>'deleted_at' IS NOT NULL) THEN
      RAISE EXCEPTION '% sender deletion failed', kind;
    END IF;
    IF result::text LIKE '%Edited by the sender%' THEN
      RAISE EXCEPTION '% deleted text leaked through a reply preview', kind;
    END IF;
  END LOOP;
END;
$test$;

-- Outsider can see only their own alternate/private scopes, never the member's
-- main conversation/group. The same request UUID is valid for another sender.
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('nexus.history.outsider'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE result jsonb; outsider_direct uuid; outsider_group uuid;
BEGIN
  BEGIN
    PERFORM public.get_direct_message_page(current_setting('nexus.history.direct')::uuid);
    RAISE EXCEPTION 'Outsider loaded member direct history';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Chat nicht gefunden oder kein Zugriff.' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_group_message_context(
      current_setting('nexus.history.group')::uuid,
      md5(current_setting('nexus.history.group') || ':1')::uuid
    );
    RAISE EXCEPTION 'Outsider loaded member group context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Gruppe nicht gefunden oder kein Zugriff.' THEN RAISE; END IF;
  END;

  result := public.search_accessible_messages(p_query => 'HistoryMarker', p_limit => 50);
  IF result::text LIKE '%' || current_setting('nexus.history.direct') || '%'
     OR result::text LIKE '%' || current_setting('nexus.history.group') || '%'
     OR result::text LIKE '%DELETED_%'
     OR result::text NOT LIKE '%PRIVATE_DIRECT_SENTINEL%'
     OR result::text NOT LIKE '%PRIVATE_GROUP_SENTINEL%' THEN
    RAISE EXCEPTION 'Outsider search scope is incorrect: %', result;
  END IF;

  outsider_direct := public.send_direct_message_v3(
    current_setting('nexus.history.direct_alt')::uuid,
    'Another sender may reuse the UUID',
    current_setting('nexus.history.direct_request')::uuid,
    NULL
  );
  outsider_group := public.send_group_message_v2(
    current_setting('nexus.history.group_alt')::uuid,
    'Another sender may reuse the UUID',
    current_setting('nexus.history.group_request')::uuid,
    NULL
  );
  IF outsider_direct IS NULL OR outsider_group IS NULL THEN
    RAISE EXCEPTION 'Sender-scoped request id reuse failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.direct_messages
    WHERE conversation_id = current_setting('nexus.history.direct')::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.group_messages
    WHERE group_id = current_setting('nexus.history.group')::uuid
  ) THEN
    RAISE EXCEPTION 'Base-table RLS exposed member chat rows';
  END IF;
END;
$test$;

-- Authenticated callers cannot bypass guarded RPCs through private serializers.
DO $test$
BEGIN
  BEGIN
    PERFORM private.direct_message_json(
      current_setting('nexus.history.direct_foreign_parent')::uuid,
      current_setting('nexus.history.outsider')::uuid
    );
    RAISE EXCEPTION 'Authenticated caller executed private direct serializer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM private.group_message_json(current_setting('nexus.history.group_foreign_parent')::uuid);
    RAISE EXCEPTION 'Authenticated caller executed private group serializer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;

-- New public RPCs must be unavailable to the anonymous API role.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.search_accessible_messages(p_query => 'HistoryMarker');
    RAISE EXCEPTION 'Anonymous search RPC access was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_direct_message_page(current_setting('nexus.history.direct')::uuid);
    RAISE EXCEPTION 'Anonymous history RPC access was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.send_group_message_v2(
      current_setting('nexus.history.group')::uuid, 'forged', gen_random_uuid(), NULL
    );
    RAISE EXCEPTION 'Anonymous send RPC access was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;

RESET ROLE;
SELECT 'History, search isolation, idempotent retries, two-participant replies, edits, deletion and read receipts passed' AS result;
ROLLBACK;
