import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Reactions batch reads, constrain payloads and use idempotent desired state', async t => {
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'reactions-unit', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/messageReactions.ts');
    await t.test('Batch bounds and duplicate message IDs', async () => {
      stub.setResponse(request => ({ data: request.args.p_message_ids.map(message_id => ({ message_id, emoji: '❤️', count: 2, mine: true })), error: null }));
      const ids = Array.from({ length: 401 }, (_, i) => `message-${i}`);
      const rows = await api.loadMessageReactions('group', 'chat', [...ids, ids[0]]);
      assert.equal(rows.length, 401);
      assert.deepEqual(stub.requests.map(r => r.args.p_message_ids.length), [200,200,1]);
      assert.ok(stub.requests.every(r => r.args.p_kind === 'group' && r.args.p_chat_id === 'chat'));
    });
    await t.test('Do not accept malformed or foreign summaries; no partial results', async () => {
      for (const row of [{ message_id: 'foreign', emoji: '❤️', count: 1, mine: true }, { message_id: 'message', emoji: '❤️', count: -1, mine: false }, { message_id: 'message', emoji: 'invalid', count: 1, mine: true }]) {
        stub.setResponse(() => ({ data: [row], error: null }));
        await assert.rejects(api.loadMessageReactions('direct','chat',['message']));
      }
      stub.setResponse(r => r.args.p_message_ids[0] === '0' ? { data: [], error: null } : { data: null, error: { message: 'Failed' } });
      await assert.rejects(api.loadMessageReactions('direct','chat',Array.from({length:201},(_,i)=>String(i))));
    });
    await t.test('Setting twice repeats the same scoped value, clearing uses null', async () => {
      stub.setResponse(() => ({ data: null, error: null }));
      await api.setMessageReaction('direct','chat','message','❤️');
      await api.setMessageReaction('direct','chat','message','❤️');
      assert.deepEqual(stub.requests[0],stub.requests[1]);
      assert.deepEqual(stub.requests[0], { rpc: 'set_message_reaction', args: { p_kind:'direct',p_chat_id:'chat',p_message_id:'message',p_emoji:'❤️' } });
      await api.setMessageReaction('direct','chat','message',null);
      assert.equal(stub.requests[2].args.p_emoji,null);
      await assert.rejects(api.setMessageReaction('direct','chat','message','unsupported'));
      assert.equal(stub.requests.length,3);
    });
    await t.test('Realtime listens only to scoped INSERT/UPDATE, including removals', () => {
      stub.setResponse(() => ({ data: [], error: null }));
      let refreshed=0;
      api.subscribeMessageReactions('group','chat',()=>refreshed++);
      assert.equal(refreshed,1);
      assert.deepEqual(stub.subscriptions.map(s=>s.filter),[
        { event:'INSERT',schema:'public',table:'group_message_reactions',filter:'group_id=eq.chat' },
        { event:'UPDATE',schema:'public',table:'group_message_reactions',filter:'group_id=eq.chat' },
      ]);
    });
  } finally { await server.close(); }
});
