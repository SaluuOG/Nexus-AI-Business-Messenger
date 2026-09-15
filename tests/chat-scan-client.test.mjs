import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('Whole-chat client rejects incomplete, cross-chat and untrusted responses', async t => {
  const stubPath = fileURLToPath(new URL('./support/chatScanStub.mjs', import.meta.url));
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'chat-scan-data-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const api = await server.ssrLoadModule('/src/features/ai/chatScan.ts');
    const stub = await server.ssrLoadModule(stubPath);
    const scope = { kind: 'direct', chatId: 'conversation-test' };
    const revision = 'a'.repeat(32);
    const workflow = (status = 'open') => ({ chat_id: scope.chatId, status, revision,
      last_scanned_at: ['updated', 'processed'].includes(status) ? '2026-09-15T09:00:00Z' : null,
      can_scan: ['open', 'updated'].includes(status) });
    const valid = () => ({
      scanId: 'scan-test', chatKind: scope.kind, chatId: scope.chatId, summary: 'Angebot und Bilder sind offen.',
      facts: [{ text: 'Budget: 2.500 Euro', sourceIds: ['old-source'] }], decisions: [], tasks: [], questions: [],
      sources: [{ id: 'old-source', sender: 'Kontakt', createdAt: '2025-01-01T09:00:00Z', excerpt: 'Unser Budget beträgt 2.500 Euro.' }],
      coverage: { messageCount: 251, from: '2025-01-01T09:00:00Z', to: '2026-01-01T09:00:00Z', attachmentsExcluded: 2, complete: true },
    });
    await t.test('Server history coverage includes old messages independently of chat viewport', async () => {
      stub.setResponse(() => ({ data: valid(), error: null }));
      const signal = new AbortController().signal;
      const result = await api.scanChat(scope, signal);
      assert.equal(result.coverage.messageCount, 251);
      assert.equal(result.sources[0].id, 'old-source');
      assert.deepEqual(stub.requests[0].body, { action: 'scan', ...scope });
      assert.equal(stub.requests[0].signal, signal);
      assert.equal('messages' in stub.requests[0].body, false, 'Client cannot supply a partial or forged conversation');
    });
    await t.test('Status never sends chat text and reports an unconfigured provider honestly', async () => {
      stub.setResponse(() => ({ data: { available: false, providerLabel: null }, error: null }));
      assert.deepEqual(await api.loadChatScanStatus(scope, new AbortController().signal), { available: false, providerLabel: null });
      assert.deepEqual(stub.requests[0].body, { action: 'status', ...scope });
      for (const invalid of [{ available: true, providerLabel: null }, { available: 'yes', providerLabel: 'Test' }, null]) {
        assert.throws(() => api.parseChatScanStatus(invalid), e => e.code === 'invalid_response');
      }
    });
    await t.test('Wrong chat, partial coverage, forged sources and malformed dates fail closed', () => {
      const cases = [
        v => { v.chatId = 'another-chat'; }, v => { v.chatKind = 'group'; },
        v => { v.coverage.complete = false; }, v => { v.coverage.messageCount = -1; },
        v => { v.coverage.from = 'invalid-date'; }, v => { v.coverage.to = '2020-01-01T09:00:00Z'; },
        v => { v.facts[0].sourceIds = ['not-in-chat']; }, v => { v.facts[0].sourceIds = []; },
        v => { v.sources.push({ ...v.sources[0] }); }, v => { v.sources[0].createdAt = 'invalid-date'; },
        v => { v.summary = ''; }, v => { v.questions = null; },
      ];
      for (const mutate of cases) {
        const value = valid(); mutate(value);
        assert.throws(() => api.parseChatScanResult(value, scope), e => e.code === 'invalid_response');
      }
    });
    await t.test('Full 5000-codepoint non-BMP source text survives scans and saved-result reads', async () => {
      const value = valid(); value.sources[0].excerpt = '😀'.repeat(5000);
      assert.equal(value.sources[0].excerpt.length, 10000);
      stub.setResponse(() => ({ data: value, error: null }));
      const fresh = await api.scanChat(scope, new AbortController().signal);
      assert.equal(fresh.sources[0].excerpt, value.sources[0].excerpt);
      stub.setResponse(() => ({ data: value, error: null }));
      const saved = await api.loadChatScanResult(scope, new AbortController().signal);
      assert.equal(saved.sources[0].excerpt, value.sources[0].excerpt);
      value.sources[0].excerpt += '😀';
      assert.throws(() => api.parseChatScanResult(value, scope), e => e.code === 'invalid_response');
    });
    await t.test('Personal workflow states reject malformed status, revision, scan eligibility and scope', async () => {
      for (const status of ['open', 'updated', 'processed', 'done']) {
        const value = workflow(status);
        assert.deepEqual(api.parseChatScanWorkflowState(value, scope.chatId), {
          chatId: scope.chatId, status, revision, lastScannedAt: value.last_scanned_at, canScan: value.can_scan,
        });
      }
      const invalidValues = [null, [], {},
        { ...workflow(), chat_id: 'other-chat' }, { ...workflow(), status: 'archived' },
        { ...workflow('done'), status: { toString: () => 'done' } },
        { ...workflow(), revision: 'old' }, { ...workflow(), revision: 'a'.repeat(31) },
        { ...workflow(), revision: 'A'.repeat(32) }, { ...workflow(), revision: 123 },
        { ...workflow(), can_scan: false }, { ...workflow('done'), can_scan: true },
        { ...workflow(), can_scan: 'true' }, { ...workflow(), last_scanned_at: 'yesterday' },
        { ...workflow('processed'), last_scanned_at: null }, { ...workflow('updated'), last_scanned_at: null },
      ];
      for (const value of invalidValues) {
        assert.throws(() => api.parseChatScanWorkflowState(value, scope.chatId), e => e.code === 'invalid_response');
      }
      const signal = new AbortController().signal;
      stub.setResponse(() => ({ data: workflow('done'), error: null }));
      assert.equal((await api.loadChatScanWorkflow(scope, signal)).status, 'done');
      assert.deepEqual(stub.requests[0], { transport: 'rpc', name: 'get_my_chat_scan_state',
        args: { p_kind: 'direct', p_chat_id: scope.chatId }, signal });
      stub.setResponse(() => ({ data: { ...workflow(), chat_id: 'other-chat' }, error: null }));
      await assert.rejects(api.loadChatScanWorkflow(scope, signal), e => e.code === 'invalid_response');
    });
    await t.test('Provider availability and personal workflow stay independent while checking the requested chat', async () => {
      stub.setResponse(() => ({ data: { available: false, providerLabel: null, workflow: workflow('processed') }, error: null }));
      const value = await api.loadChatScanStatus(scope, new AbortController().signal);
      assert.equal(value.available, false); assert.equal(value.workflow.status, 'processed');
      assert.equal(value.workflow.canScan, false);
      assert.throws(() => api.parseChatScanStatus({ available: true, providerLabel: 'OpenAI',
        workflow: { ...workflow(), chat_id: 'another-chat' } }, scope), e => e.code === 'invalid_response');
    });
    await t.test('Batch states preserve distinct chats and reject duplicates or malformed entries', async () => {
      const signal = new AbortController().signal;
      stub.setResponse(() => ({ data: [workflow(), { ...workflow('done'), chat_id: 'second-chat' }], error: null }));
      const states = await api.loadChatScanWorkflows('group', signal);
      assert.deepEqual(states.map(value => [value.chatId, value.status]), [[scope.chatId, 'open'], ['second-chat', 'done']]);
      assert.deepEqual(stub.requests[0], { transport: 'rpc', name: 'get_my_chat_scan_states', args: { p_kind: 'group' }, signal });
      for (const data of [[workflow(), workflow('done')], [workflow(), null], { states: [] }]) {
        stub.setResponse(() => ({ data, error: null }));
        await assert.rejects(api.loadChatScanWorkflows('direct', signal), e => e.code === 'invalid_response');
      }
      stub.setResponse(() => ({ data: [], error: null }));
      assert.deepEqual(await api.loadChatScanWorkflows('direct', signal), []);
    });
    await t.test('Finish/reopen sends the expected personal revision and rejects invalid input before transport', async () => {
      const signal = new AbortController().signal;
      for (const done of [true, false]) {
        stub.setResponse(() => ({ data: workflow(done ? 'done' : 'open'), error: null }));
        assert.equal((await api.setChatScanDone(scope, done, revision, signal)).status, done ? 'done' : 'open');
        assert.deepEqual(stub.requests[0], { transport: 'rpc', name: 'set_my_chat_scan_done', args: {
          p_kind: scope.kind, p_chat_id: scope.chatId, p_done: done, p_expected_revision: revision,
        }, signal });
      }
      for (const [done, expected] of [['true', revision], [true, 'outdated'], [true, null],
        [true, { toString: () => revision }]]) {
        stub.setResponse(() => { throw new Error('Invalid input must not reach database'); });
        await assert.rejects(api.setChatScanDone(scope, done, expected, signal), e => e.code === 'invalid_response');
        assert.equal(stub.requests.length, 0);
      }
      stub.setResponse(() => ({ data: { ...workflow('done'), chat_id: 'other-chat' }, error: null }));
      await assert.rejects(api.setChatScanDone(scope, true, revision, signal), e => e.code === 'invalid_response');
    });
    await t.test('Saved results use only the authenticated read RPC and never invoke the provider, including cache misses', async () => {
      const signal = new AbortController().signal;
      stub.setResponse(() => ({ data: valid(), error: null }));
      assert.equal((await api.loadChatScanResult(scope, signal)).sources[0].id, 'old-source');
      assert.deepEqual(stub.requests, [{ transport: 'rpc', name: 'get_my_chat_scan_result',
        args: { p_kind: scope.kind, p_chat_id: scope.chatId }, signal }]);
      stub.setResponse(() => ({ data: null, error: null }));
      assert.equal(await api.loadChatScanResult(scope, signal), null);
      assert.equal(stub.requests.length, 1); assert.equal(stub.requests[0].transport, 'rpc');
      for (const data of [{ ...valid(), chatId: 'another-chat' }, { ...valid(), chatKind: 'group' },
        { ...valid(), coverage: { ...valid().coverage, complete: false } }]) {
        stub.setResponse(() => ({ data, error: null }));
        await assert.rejects(api.loadChatScanResult(scope, signal), e => e.code === 'invalid_response');
        assert.equal(stub.requests.length, 1); assert.equal(stub.requests[0].transport, 'rpc');
      }
    });
    await t.test('Workflow failures expose safe known errors, never database internals or credentials', async () => {
      for (const code of ['chat_done', 'already_processed', 'status_changed', 'history_changed', 'scan_expired', 'no_access']) {
        stub.setResponse(() => ({ data: null, error: { code: 'P0001', message: code, details: 'private-key and row data' } }));
        await assert.rejects(api.setChatScanDone(scope, true, revision, new AbortController().signal),
          e => e.code === code && !e.message.includes('private-key'));
      }
      for (const [error, code] of [
        [{ code: '42501', message: 'private database denial' }, 'no_access'],
        [{ code: 'PGRST301', message: 'private token details' }, 'no_access'],
        [{ code: 'XX000', message: 'private database internals' }, 'connection_error'],
      ]) {
        stub.setResponse(() => ({ data: null, error }));
        await assert.rejects(api.loadChatScanResult(scope, new AbortController().signal),
          e => e.code === code && !e.message.includes('private'));
      }
      stub.setResponse(() => { throw new Error('private connection details'); });
      await assert.rejects(api.loadChatScanWorkflow(scope, new AbortController().signal),
        e => e.code === 'connection_error' && !e.message.includes('private'));
    });
    await t.test('Safe public errors replace raw provider details and credentials', async () => {
      for (const [status, body, code] of [
        [503, { error: 'secret-provider-key should never render', code: 'provider_error' }, 'provider_error'],
        [503, { error: 'secret', code: 'ai_not_configured' }, 'ai_not_configured'],
        [401, { message: 'auth details' }, 'no_access'],
        [429, { message: 'rate internals' }, 'rate_limited'],
      ]) {
        stub.setResponse(() => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } }));
        await assert.rejects(api.scanChat(scope, new AbortController().signal), e => e.code === code && !e.message.includes('secret'));
      }
      stub.setResponse(() => { throw new Error('private connection internals'); });
      await assert.rejects(api.scanChat(scope, new AbortController().signal), e => e.code === 'connection_error' && !e.message.includes('private'));
    });
    await t.test('Cancellation blocks late responses even if the transport ignores AbortSignal', async () => {
      let resolve;
      stub.setResponse(() => new Promise(done => { resolve = done; }));
      const controller = new AbortController();
      const pending = api.scanChat(scope, controller.signal);
      controller.abort();
      resolve({ data: valid(), error: null });
      await assert.rejects(pending, e => e.name === 'AbortError');
      stub.setResponse(() => { throw new Error('Must not be invoked'); });
      await assert.rejects(api.scanChat(scope, controller.signal), e => e.name === 'AbortError');
      assert.equal(stub.requests.length, 0);
    });
    await t.test('All personal workflow operations reject late responses after cancellation without applying stale state', async () => {
      for (const [operation, data] of [
        [signal => api.loadChatScanWorkflow(scope, signal), workflow()],
        [signal => api.loadChatScanWorkflows('direct', signal), [workflow()]],
        [signal => api.setChatScanDone(scope, true, revision, signal), workflow('done')],
        [signal => api.loadChatScanResult(scope, signal), valid()],
      ]) {
        let resolve;
        stub.setResponse(() => new Promise(done => { resolve = done; }));
        const controller = new AbortController(), pending = operation(controller.signal);
        assert.equal(stub.requests[0].signal, controller.signal);
        controller.abort(); resolve({ data, error: null });
        await assert.rejects(pending, e => e.name === 'AbortError');
        stub.setResponse(() => { throw new Error('Aborted operation must not invoke the transport'); });
        await assert.rejects(operation(controller.signal), e => e.name === 'AbortError');
        assert.equal(stub.requests.length, 0);
      }
    });
  } finally { await server.close(); }
});
