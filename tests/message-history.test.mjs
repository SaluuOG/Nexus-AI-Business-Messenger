import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const at = second => `2026-09-15T12:00:${String(second).padStart(2, '0')}.000Z`;

const directMessage = (overrides = {}) => ({
  message_id: uuid(101),
  sender_id: uuid(102),
  body: 'Direkte Nachricht',
  created_at: at(1),
  reply_to_message_id: null,
  reply_sender_id: null,
  reply_body: null,
  edited_at: null,
  deleted_at: null,
  read_at: null,
  attachments: [{
    attachment_id: uuid(103),
    storage_path: 'direct/report.pdf',
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
    file_size: '42',
  }],
  ...overrides,
});

const groupMessage = (overrides = {}) => ({
  message_id: uuid(201),
  group_id: uuid(202),
  sender_id: uuid(203),
  sender_full_name: 'Ada Beispiel',
  sender_username: 'ada',
  sender_avatar_url: null,
  body: 'Gruppennachricht',
  created_at: at(2),
  edited_at: null,
  deleted_at: null,
  reply_to_message_id: null,
  reply_body: null,
  reply_sender_id: null,
  reply_sender_name: null,
  attachments: [{
    attachment_id: uuid(204),
    storage_path: 'groups/photo.png',
    file_name: 'photo.png',
    mime_type: 'image/png',
    file_size: 84,
  }],
  read_count: '3',
  recipient_count: '4',
  ...overrides,
});

const searchResult = (overrides = {}) => ({
  kind: 'direct',
  chat_id: uuid(301),
  chat_name: 'Darlyn',
  message_id: uuid(302),
  sender_id: uuid(303),
  sender_name: 'Darlyn Beispiel',
  sender_username: 'darlyn',
  body: 'Das Angebot ist fertig.',
  created_at: at(3),
  edited_at: null,
  ...overrides,
});

test('Phase 3.7 message history/search data contract is bounded, safe and retryable', async t => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    plugins: [{
      name: 'message-history-data-fixture',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/supabase')) return stubPath;
      },
    }],
  });

  try {
    const directApi = await server.ssrLoadModule('/src/features/data/chatData.ts');
    const groupApi = await server.ssrLoadModule('/src/features/data/groupChatData.ts');
    const searchApi = await server.ssrLoadModule('/src/features/data/messageSearchData.ts');
    const stub = await server.ssrLoadModule(stubPath);
    const signedRequests = [];

    // The shared fixture intentionally stays minimal. Attachment signing is
    // installed here so this test exercises the real data-layer serializers.
    stub.supabase.storage = {
      from(bucket) {
        return {
          createSignedUrl(path, expiresIn) {
            signedRequests.push({ bucket, path, expiresIn });
            if (path === 'groups/photo.png') {
              return Promise.resolve({ data: null, error: { message: 'signing failed' } });
            }
            return Promise.resolve({
              data: { signedUrl: `https://signed.invalid/${encodeURIComponent(path)}` },
              error: null,
            });
          },
        };
      },
    };

    await t.test('direct/group pages use stable keyset cursors, bounded limits and signed attachment shapes', async () => {
      const cursor = { created_at: at(10), message_id: uuid(10) };
      stub.setResponse(request => {
        if (request.rpc === 'get_direct_message_page') {
          return {
            data: { messages: [directMessage()], has_more: true, next_cursor: cursor },
            error: null,
          };
        }
        if (request.rpc === 'get_group_message_page') {
          return {
            data: { messages: [groupMessage()], has_more: false, next_cursor: cursor },
            error: null,
          };
        }
        throw new Error(`Unexpected request: ${request.rpc}`);
      });

      const direct = await directApi.loadDirectMessagePage(uuid(1), cursor, 900.9);
      const group = await groupApi.loadGroupMessagePage(uuid(2), cursor, -10);

      assert.deepEqual(stub.requests.map(({ rpc, args }) => ({ rpc, args })), [{
        rpc: 'get_direct_message_page',
        args: {
          p_conversation_id: uuid(1),
          p_before_created_at: cursor.created_at,
          p_before_message_id: cursor.message_id,
          p_limit: 200,
        },
      }, {
        rpc: 'get_group_message_page',
        args: {
          p_group_id: uuid(2),
          p_before_created_at: cursor.created_at,
          p_before_message_id: cursor.message_id,
          p_limit: 1,
        },
      }]);
      assert.equal(direct.error, null);
      assert.equal(direct.data.messages[0].attachments[0].file_size, 42);
      assert.equal(direct.data.messages[0].attachments[0].signed_url, 'https://signed.invalid/direct%2Freport.pdf');
      assert.deepEqual(direct.data.next_cursor, cursor);
      assert.equal(group.error, null);
      assert.equal(group.data.messages[0].read_count, 3);
      assert.equal(group.data.messages[0].recipient_count, 4);
      assert.equal(group.data.messages[0].attachments[0].signed_url, null, 'Signing errors never preserve an untrusted URL');
      assert.deepEqual(signedRequests, [
        { bucket: 'nexus-chat-attachments', path: 'direct/report.pdf', expiresIn: 3600 },
        { bucket: 'nexus-chat-attachments', path: 'groups/photo.png', expiresIn: 3600 },
      ]);

      stub.setResponse(request => ({
        data: request.rpc === 'get_direct_message_page'
          ? { messages: [], has_more: false, next_cursor: null }
          : { messages: [], has_more: false, next_cursor: null },
        error: null,
      }));
      await directApi.loadDirectMessagePage(uuid(1), null, Number.NaN);
      await groupApi.loadGroupMessagePage(uuid(2), null, Number.POSITIVE_INFINITY);
      assert.equal(stub.requests[0].args.p_limit, 100);
      assert.equal(stub.requests[1].args.p_limit, 100);
    });

    await t.test('deep-link contexts use exact RPC arguments, clamp radius and retain the requested anchor', async () => {
      const directAnchor = uuid(101);
      const groupAnchor = uuid(201);
      stub.setResponse(request => {
        if (request.rpc === 'get_direct_message_context') {
          return { data: {
            messages: [directMessage()],
            anchor_message_id: directAnchor,
            has_older: true,
            has_newer: false,
            oldest_cursor: { created_at: at(1), message_id: directAnchor },
            newest_cursor: { created_at: at(1), message_id: directAnchor },
          }, error: null };
        }
        if (request.rpc === 'get_group_message_context') {
          return { data: {
            messages: [groupMessage()],
            anchor_message_id: groupAnchor,
            has_older: false,
            has_newer: true,
            oldest_cursor: { created_at: at(2), message_id: groupAnchor },
            newest_cursor: { created_at: at(2), message_id: groupAnchor },
          }, error: null };
        }
        throw new Error(`Unexpected request: ${request.rpc}`);
      });

      const direct = await directApi.loadDirectMessageContext(uuid(1), directAnchor, 500);
      const group = await groupApi.loadGroupMessageContext(uuid(2), groupAnchor, 0);
      assert.equal(direct.data.anchor_message_id, directAnchor);
      assert.equal(group.data.anchor_message_id, groupAnchor);
      assert.deepEqual(stub.requests.map(({ rpc, args }) => ({ rpc, args })), [{
        rpc: 'get_direct_message_context',
        args: { p_conversation_id: uuid(1), p_message_id: directAnchor, p_radius: 50 },
      }, {
        rpc: 'get_group_message_context',
        args: { p_group_id: uuid(2), p_message_id: groupAnchor, p_radius: 1 },
      }]);
    });

    await t.test('search sends all filters and converts inclusive local dates across DST to exclusive UTC bounds', async () => {
      const cursor = { created_at: at(20), message_id: uuid(20) };
      stub.setResponse(() => ({
        data: { results: [searchResult()], has_more: true, next_cursor: cursor },
        error: null,
      }));

      const spring = await searchApi.searchAccessibleMessages({
        query: '  Angebot  ',
        kind: 'direct',
        chatId: uuid(301),
        senderId: uuid(303),
        senderQuery: '  Darlyn  ',
        scopeQuery: '  Vertrieb  ',
        fromDate: '2026-03-29',
        toDate: '2026-03-29',
        cursor,
        limit: 500,
      });
      assert.equal(spring.error, null);
      assert.deepEqual(spring.data.results, [searchResult()]);
      assert.deepEqual(stub.requests[0], {
        rpc: 'search_accessible_messages',
        args: {
          p_query: 'Angebot',
          p_kind: 'direct',
          p_chat_id: uuid(301),
          p_sender_id: uuid(303),
          p_sender_query: 'Darlyn',
          p_scope_query: 'Vertrieb',
          p_from_date: '2026-03-28T23:00:00.000Z',
          p_to_date: '2026-03-29T22:00:00.000Z',
          p_before_created_at: cursor.created_at,
          p_before_message_id: cursor.message_id,
          p_limit: 50,
        },
      });

      stub.setResponse(() => ({ data: { results: [], has_more: false, next_cursor: null }, error: null }));
      await searchApi.searchAccessibleMessages({ query: 'Plan', fromDate: '2026-10-25', toDate: '2026-10-25' });
      assert.equal(stub.requests[0].args.p_from_date, '2026-10-24T22:00:00.000Z');
      assert.equal(stub.requests[0].args.p_to_date, '2026-10-25T23:00:00.000Z');
      assert.equal(stub.requests[0].args.p_limit, 50);
    });

    await t.test('query, filter and date validation rejects invalid input before the database', async () => {
      stub.setResponse(() => { throw new Error('Invalid input must not reach Supabase'); });
      const invalid = [
        { query: ' x ' },
        { query: 'x'.repeat(101) },
        { query: 'ok', kind: 'unknown' },
        { query: 'ok', chatId: uuid(1) },
        { query: 'ok', senderQuery: 'x'.repeat(101) },
        { query: 'ok', scopeQuery: 'x'.repeat(101) },
        { query: 'ok', fromDate: '29.03.2026' },
        { query: 'ok', fromDate: '2026-02-29' },
        { query: 'ok', fromDate: '2026-03-30', toDate: '2026-03-29' },
      ];
      for (const filters of invalid) {
        const result = await searchApi.searchAccessibleMessages(filters);
        assert.notEqual(result.error, null, `Expected local validation for ${JSON.stringify(filters)}`);
      }
      assert.equal(stub.requests.length, 0);

      stub.setResponse(() => ({ data: { results: [], has_more: false, next_cursor: null }, error: null }));
      const unicode = await searchApi.searchAccessibleMessages({ query: '😀'.repeat(100) });
      assert.equal(unicode.error, null, '100 Unicode code points match the database char_length limit');
      assert.equal(stub.requests[0].args.p_query, '😀'.repeat(100));

      stub.setResponse(() => { throw new Error('101 code points must be rejected locally'); });
      const tooLongUnicode = await searchApi.searchAccessibleMessages({ query: '😀'.repeat(101) });
      assert.notEqual(tooLongUnicode.error, null);
      assert.equal(stub.requests.length, 0);
    });

    await t.test('malformed page, context and search JSON fails closed without exposing partial objects', async () => {
      stub.setResponse(request => {
        if (request.rpc === 'get_direct_message_page') {
          return { data: {
            messages: [directMessage({ attachments: [{ storage_path: 'private/unknown' }] })],
            has_more: true,
            next_cursor: { created_at: 'not-a-date', message_id: 7 },
          }, error: null };
        }
        if (request.rpc === 'get_group_message_context') {
          return { data: {
            messages: [groupMessage({ body: 123 })],
            anchor_message_id: uuid(999),
            has_older: 'yes',
            has_newer: false,
            oldest_cursor: {},
            newest_cursor: {},
          }, error: null };
        }
        if (request.rpc === 'search_accessible_messages') {
          return { data: {
            results: [searchResult({ kind: 'admin', body: { private: true } })],
            has_more: 'yes',
            next_cursor: { created_at: 'yesterday', message_id: null },
          }, error: null };
        }
        throw new Error(`Unexpected request: ${request.rpc}`);
      });

      const direct = await directApi.loadDirectMessagePage(uuid(1));
      const group = await groupApi.loadGroupMessageContext(uuid(2), uuid(201));
      const search = await searchApi.searchAccessibleMessages({ query: 'ok' });
      assert.deepEqual(direct.data, { messages: [], has_more: false, next_cursor: null });
      assert.notEqual(direct.error, null);
      assert.equal(group.data, null);
      assert.notEqual(group.error, null);
      assert.deepEqual(search.data, { results: [], has_more: false, next_cursor: null });
      assert.notEqual(search.error, null);
      assert.equal(signedRequests.some(request => request.path === 'private/unknown'), false, 'Malformed attachments are never signed');
    });

    await t.test('text send APIs reuse caller idempotency IDs and reject malformed IDs without transport', async () => {
      const directRequestId = uuid(401);
      const groupRequestId = uuid(402);
      stub.setResponse(request => ({ data: request.args.p_client_request_id, error: null }));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal((await directApi.sendDirectMessage(uuid(1), ' Gleich ', uuid(4), directRequestId)).data, directRequestId);
        assert.equal((await groupApi.sendGroupMessage(uuid(2), ' Gleich ', uuid(5), groupRequestId)).data, groupRequestId);
      }
      assert.deepEqual(stub.requests.map(({ rpc, args }) => ({ rpc, args })), [
        { rpc: 'send_direct_message_v3', args: {
          p_conversation_id: uuid(1), p_body: ' Gleich ', p_client_request_id: directRequestId, p_reply_to_message_id: uuid(4),
        } },
        { rpc: 'send_group_message_v2', args: {
          p_group_id: uuid(2), p_body: ' Gleich ', p_client_request_id: groupRequestId, p_reply_to_message_id: uuid(5),
        } },
        { rpc: 'send_direct_message_v3', args: {
          p_conversation_id: uuid(1), p_body: ' Gleich ', p_client_request_id: directRequestId, p_reply_to_message_id: uuid(4),
        } },
        { rpc: 'send_group_message_v2', args: {
          p_group_id: uuid(2), p_body: ' Gleich ', p_client_request_id: groupRequestId, p_reply_to_message_id: uuid(5),
        } },
      ]);

      stub.setResponse(() => { throw new Error('Malformed idempotency IDs must not reach Supabase'); });
      assert.notEqual((await directApi.sendDirectMessage(uuid(1), 'Text', null, 'not-a-uuid')).error, null);
      assert.notEqual((await groupApi.sendGroupMessage(uuid(2), 'Text', null, 'not-a-uuid')).error, null);
      assert.equal(stub.requests.length, 0);

      stub.setResponse(request => ({ data: request.args.p_client_request_id, error: null }));
      await directApi.sendDirectMessage(uuid(1), 'Automatisch');
      await groupApi.sendGroupMessage(uuid(2), 'Automatisch');
      const generated = stub.requests.map(request => request.args.p_client_request_id);
      assert.ok(generated.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)));
      assert.notEqual(generated[0], generated[1]);
    });

    await t.test('global realtime channels observe unopened direct/group list dependencies without row filters', () => {
      stub.setResponse(() => ({ data: null, error: null }));
      let directChanges = 0;
      const directChannel = directApi.subscribeToDirectMessagesRealtime(() => { directChanges += 1; });
      assert.equal(directChannel.name, 'direct-message-list');
      assert.deepEqual(stub.subscriptions.map(({ type, filter }) => ({ type, filter })), [
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'direct_messages' } },
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'direct_conversation_reads' } },
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'direct_conversations' } },
      ]);
      for (const subscription of stub.subscriptions) subscription.callback();
      assert.equal(directChanges, 3);

      stub.setResponse(() => ({ data: null, error: null }));
      let groupChanges = 0;
      const groupChannel = groupApi.subscribeToGroupMessagesRealtime(() => { groupChanges += 1; });
      assert.equal(groupChannel.name, 'group-message-list');
      assert.deepEqual(stub.subscriptions.map(({ type, filter }) => ({ type, filter })), [
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'group_messages' } },
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'group_reads' } },
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'group_conversations' } },
        { type: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'group_members' } },
      ]);
      for (const subscription of stub.subscriptions) subscription.callback();
      assert.equal(groupChanges, 4);
    });
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
    await server.close();
  }
});
