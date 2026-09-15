import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Message-to-task data preserves content, scopes sources and retries atomically', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'message-task-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/messageTasks.ts');
    const business = await server.ssrLoadModule('/src/features/data/businessData.ts');
    const source = { kind: 'direct', messageId: 'message-1', body: '  Angebot prüfen!\nDetails <script>unsafe()</script>  ', chatName: 'Test Chat' };
    await t.test('Draft keeps the full source and handles attachments and long Unicode text', () => {
      const draft = api.messageTaskDraft(source);
      assert.equal(draft.title, 'Angebot prüfen!');
      assert.equal(draft.description, source.body.trim());
      const long = api.messageTaskDraft({ ...source, body: '🙂'.repeat(190) + '\n' + 'x'.repeat(4000) });
      assert.equal(Array.from(long.title).length, 180);
      assert.equal(long.description, '🙂'.repeat(190) + '\n' + 'x'.repeat(4000));
      assert.equal(api.messageTaskDraft({ ...source, body: '', attachmentName: 'Angebot.pdf' }).title, 'Anhang prüfen: Angebot.pdf');
    });
    await t.test('One allowlisted RPC creates both records; retries keep the request ID', async () => {
      stub.setResponse(() => ({ data: { id: 'task-1' }, error: null }));
      const input = { ...api.messageTaskDraft(source), project_id: 'p1', assigned_to: 'teammate', due_date: '2026-09-16', priority: 'urgent', created_by: 'forged' };
      for (let i = 0; i < 2; i++) assert.equal((await api.createTaskFromMessage('w1', source, input, 'retry-key')).data.id, 'task-1');
      assert.equal(stub.requests.length, 2);
      assert.deepEqual(stub.requests[0], stub.requests[1]);
      assert.equal(stub.requests[0].rpc, 'create_task_from_message');
      assert.deepEqual(stub.requests[0].args, { p_request_id: 'retry-key', p_workspace_id: 'w1', p_project_id: 'p1', p_kind: 'direct', p_message_id: 'message-1', p_title: 'Angebot prüfen!', p_description: source.body.trim(), p_priority: 'urgent', p_assigned_to: 'teammate', p_due_date: '2026-09-16' });
    });
    await t.test('Source links paginate completely and clear partial results on error', async () => {
      stub.setResponse(r => ({ data: Array.from({ length: r.range[0] === 0 ? 500 : 1 }, (_, i) => ({ task_id: String(r.range[0] + i), kind: 'group' })), error: null }));
      assert.equal((await api.loadAccessibleTaskSources('w2')).data.length, 501);
      for (const r of stub.requests) { assert.deepEqual(r.filters, [['workspace_id', 'w2']]); assert.equal(r.columns, 'task_id, kind'); }
      stub.setResponse(r => r.range[0] === 0 ? { data: Array.from({ length: 500 }, () => ({})), error: null } : { data: null, error: { message: 'offline' } });
      const failed = await api.loadAccessibleTaskSources('w2');
      assert.deepEqual(failed.data, []); assert.ok(failed.error);
    });
    await t.test('Source resolution never substitutes the task copy for deleted or inaccessible messages', async () => {
      stub.setResponse(() => ({ data: null, error: null }));
      assert.deepEqual(await api.loadTaskMessageSource('task-1'), { data: null, error: null });
      assert.deepEqual(stub.requests, [{ rpc: 'get_task_message_source', args: { p_task_id: 'task-1' } }]);
      stub.setResponse(() => ({ data: null, error: { message: 'network failure' } }));
      assert.match((await api.loadTaskMessageSource('task-1')).error, /erneut versuchen/);
    });
    await t.test('Destination failures discard projects and assignees together', async () => {
      stub.setResponse(r => r.rpc ? { data: null, error: { message: 'offline' } } : { data: [{ id: 'p1', workspace_id: 'w1' }], error: null });
      const result = await business.loadTaskWorkspace('w1');
      assert.deepEqual(result.projects, []); assert.deepEqual(result.members, []); assert.ok(result.error);
      assert.ok(stub.requests.every(r => r.rpc === 'get_workspace_members' || r.table === 'projects'));
    });
  } finally { await server.close(); }
});
