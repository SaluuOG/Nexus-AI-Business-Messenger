import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Briefing reads complete authorized data and handles failed reads honestly', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom',
    plugins: [{ name: 'briefing-database', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/businessData.ts');
    const member = { user_id: 'me', role: 'member' };
    await t.test('Projects and tasks are fully paginated without unrelated customer reads or writes', async () => {
      stub.setResponse(r => ({ data: r.rpc ? [member] : Array.from({ length: r.range[0] === 0 ? 500 : 2 }, (_, i) => ({ id: r.table + (r.range[0] + i), workspace_id: 'w1', progress: '25', value_cents: '120' })), error: null }));
      const result = await api.loadBriefingWorkspace('w1', 'me');
      assert.equal(result.error, null);
      assert.equal(result.projects.length, 502);
      assert.equal(result.tasks.length, 502);
      assert.equal(result.projects[0].progress, 25);
      assert.equal(stub.requests.some(r => r.table === 'customers' || (r.operation && r.operation !== 'select')), false);
      for (const r of stub.requests.filter(r => r.table)) assert.deepEqual(r.filters, [['workspace_id', 'w1']]);
    });
    await t.test('Failure on a later page returns an error instead of partial counters', async () => {
      stub.setResponse(r => r.rpc ? { data: [member], error: null } : r.table === 'projects'
        ? r.range[0] ? { data: null, error: { message: 'network failed' } } : { data: Array.from({ length: 500 }, () => ({})), error: null }
        : { data: [], error: null });
      const result = await api.loadBriefingWorkspace('w1', 'me');
      assert.match(result.error, /Projekte konnten nicht geladen/);
      assert.deepEqual(result.projects, []);
      assert.deepEqual(result.tasks, []);
    });
    await t.test('Removed membership and role-check failures never produce a clean empty briefing', async () => {
      stub.setResponse(() => ({ data: [], error: null }));
      assert.match((await api.loadBriefingWorkspace('w1', 'me')).error, /keinen Zugriff/);
      stub.setResponse(r => ({ data: [], error: r.rpc ? { message: 'unavailable' } : null }));
      assert.match((await api.loadBriefingWorkspace('w1', 'me')).error, /Zugriff konnte nicht geprüft/);
    });
    await t.test('Read-only guests still receive the briefing', async () => {
      stub.setResponse(r => ({ data: r.rpc ? [{ ...member, role: 'guest' }] : [], error: null }));
      assert.equal((await api.loadBriefingWorkspace('w1', 'me')).error, null);
    });
  } finally { await server.close(); }
});
