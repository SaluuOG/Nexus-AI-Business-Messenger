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
  } finally { await server.close(); }
});
