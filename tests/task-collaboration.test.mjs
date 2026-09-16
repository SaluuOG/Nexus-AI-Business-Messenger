import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Task collaboration data: scoped reads, stable pagination, retries, conflicts and permissions', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'collaboration-database', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/taskCollaboration.ts');
    const entry = { id: 'intent-1', workspace_id: 'w1', task_id: 't1', body: 'Hello', created_by: 'me', revision: 2, created_at: '2026-09-16T08:00:00Z' };

    await t.test('Creation trims text, reuses the supplied intent and excludes audit fields', async () => {
      stub.setResponse(() => ({ data: { id: entry.id }, error: null }));
      assert.equal((await api.addTaskComment('w1', 't1', 'me', entry.id, '  Hello  ')).error, null);
      assert.deepEqual(stub.requests[0].value, { id: entry.id, workspace_id: 'w1', task_id: 't1', body: 'Hello' });
      assert.equal((await api.addChecklistItem('w1', 't1', 'me', 'check-1', '  Draft  ')).error, null);
      assert.deepEqual(stub.requests[1].value, { id: 'check-1', workspace_id: 'w1', task_id: 't1', label: 'Draft' });
      assert.ok((await api.addTaskComment('w1', 't1', 'me', 'empty', ' ')).error);
      assert.ok((await api.addChecklistItem('w1', 't1', 'me', 'long', 'x'.repeat(241))).error);
      assert.equal(stub.requests.length, 2);
    });
    await t.test('Duplicate intent after a lost response is recovered only for the same author, task and input', async () => {
      stub.setResponse(r => r.operation === 'insert' ? { data: null, error: { code: '23505' } } : { data: entry, error: null });
      assert.equal((await api.addTaskComment('w1', 't1', 'me', entry.id, 'Hello')).error, null);
      assert.deepEqual(stub.requests[1].filters, [['id', entry.id], ['workspace_id', 'w1'], ['task_id', 't1']]);
      assert.ok((await api.addTaskComment('w1', 't1', 'someone-else', entry.id, 'Hello')).error);
      assert.ok((await api.addTaskComment('w1', 't1', 'me', entry.id, 'Changed input')).error);
      stub.setResponse(r => r.operation === 'insert' ? { data: null, error: { code: '23505' } } : { data: null, error: null });
      assert.ok((await api.addTaskComment('w2', 't2', 'me', entry.id, 'Hello')).error);
    });
    await t.test('Writes bind workspace, task, ID and revision; toggling never overwrites checklist text', async () => {
      stub.setResponse(() => ({ data: null, error: null }));
      for (const [table, change] of [['task_comments', { body: 'Edit' }], ['task_checklist_items', { is_completed: true }], ['task_comments', 'delete']]) {
        assert.match((await api.changeTaskEntry(table, 'w1', 't1', entry, change)).error, /inzwischen geändert/);
      }
      for (const r of stub.requests) assert.deepEqual(r.filters, [['workspace_id', 'w1'], ['task_id', 't1'], ['id', entry.id], ['revision', 2]]);
      assert.deepEqual(stub.requests[1].value, { is_completed: true });
      stub.setResponse(() => ({ data: null, error: { code: '42501', message: 'private internal detail' } }));
      assert.equal((await api.changeTaskEntry('task_comments', 'w1', 't1', entry, 'delete')).error, 'Deine aktuelle Rolle erlaubt diese Aktion nicht.');
    });
    await t.test('Identical timestamps use ID tie-breakers and all checklist pages load', async () => {
      const comments = Array.from({ length: 85 }, (_, i) => ({ ...entry, id: `comment-${String(85-i).padStart(3,'0')}` }));
      const checklist = Array.from({ length: 205 }, (_, i) => ({ ...entry, id: `check-${String(i).padStart(3,'0')}`, label: String(i), is_completed: false }));
      stub.setResponse(r => {
        if (r.table === 'project_tasks') return { data: { id: 't1' }, error: null };
        let rows = r.table === 'task_comments' ? comments : r.table === 'task_checklist_items' ? checklist : [];
        if (r.or) { const id = /id.lt.([^)]*)/.exec(r.or)[1]; rows = rows.filter(row => row.id < id); }
        if (r.gt) rows = rows.filter(row => row[r.gt[0]] > r.gt[1]);
        return { data: rows.slice(0, r.limit), error: null };
      });
      const controller = new AbortController();
      const result = await api.loadTaskCollaboration('w1','t1',{ comments: 80, activity: 40 },controller.signal);
      assert.equal(result.error, null);
      assert.equal(result.data.comments.length, 80); assert.equal(new Set(result.data.comments.map(c => c.id)).size, 80);
      assert.equal(result.data.moreComments, true); assert.equal(result.data.checklist.length, 205);
      for (const r of stub.requests) {
        assert.ok(r.filters.some(([key,value]) => key === 'workspace_id' && value === 'w1'));
        assert.ok(r.filters.some(([key,value]) => ['id','task_id'].includes(key) && value === 't1'));
        assert.equal(r.signal, controller.signal);
      }
      const pages = stub.requests.filter(r => r.table === 'task_comments');
      assert.equal(pages.length, 3); assert.equal(pages[2].limit, 1);
      assert.match(pages[1].or, /created_at.lt.*and\(created_at.eq.*id.lt.comment-046\)/);
      assert.deepEqual(pages[0].orders, [['created_at',{ascending:false}],['id',{ascending:false}]]);
    });
    await t.test('Any failed read or vanished parent clears all collaboration records', async () => {
      for (const failure of ['task_comments','task_checklist_items','task_activity','project_tasks','removed']) {
        stub.setResponse(r => r.table === failure ? { data: null, error: { message: 'private detail' } } : r.table === 'project_tasks' ? { data: failure === 'removed' ? null : { id:'t1' }, error:null } : {data:[entry],error:null});
        const result = await api.loadTaskCollaboration('w1','t1');
        assert.ok(result.error); assert.deepEqual(result.data, api.emptyTaskCollaboration);
        assert.ok(!result.error.includes('private detail'));
      }
    });
    await t.test('Realtime covers scoped changes, key-only deletions and membership loss', () => {
      stub.setResponse(() => ({ data: [], error: null }));
      let changes = 0;
      api.subscribeTaskCollaboration('w1','t1',() => changes++);
      assert.equal(changes, 1);
      for (const table of ['task_comments','task_checklist_items','task_activity','project_tasks','workspace_members']) {
        const entries=stub.subscriptions.filter(s=>s.filter.table===table); assert.equal(entries.length,3);
        for(const s of entries){
          assert.equal(s.filter.filter,s.filter.event==='DELETE'?undefined:table==='workspace_members'?'workspace_id=eq.w1':table==='project_tasks'?'id=eq.t1':'task_id=eq.t1');
          s.callback({old:{id:'removed'}});
        }
      }
      assert.equal(changes,16);
    });
    await t.test('Activity displays only known field labels', () => {
      assert.equal(api.taskActivityLabel({event_type:'task_updated',changed_fields:['status','assigned_to','private body']}),'Aufgabe geändert · Status, Zuständigkeit');
      assert.equal(api.taskActivityLabel({event_type:'comment_deleted',changed_fields:[]}),'Kommentar entfernt');
    });
  } finally { await server.close(); }
});
