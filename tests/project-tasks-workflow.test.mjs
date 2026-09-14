import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('Task data and UI workflow handles permissions, concurrent edits, pagination and realtime deletion', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: 'custom',
    plugins: [{ name: 'mock-business-database', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const stub = await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
    const api = await server.ssrLoadModule('/src/features/data/businessData.ts');
    const { ProjectTasksPanel } = await server.ssrLoadModule('/src/components/ProjectTasksPanel.tsx');
    const task = { id: 'task-1', workspace_id: 'workspace-1', project_id: 'project-1', title: 'Startseite', status: 'todo', priority: 'medium', assigned_to: 'member-1', due_date: '2026-09-15', description: '<script>alert(1)</script>', updated_at: '2026-09-14T10:00:00Z' };
    const input = { ...task, title: '  Startseite  ', description: '  Briefing  ' };

    await t.test('Create normalizes user input and sends no audit fields', async () => {
      stub.setResponse(() => ({ data: task, error: null }));
      const result = await api.createProjectTask('workspace-1', input);
      assert.equal(result.error, null);
      assert.deepEqual(stub.requests[0].value, { workspace_id: 'workspace-1', project_id: 'project-1', title: 'Startseite', status: 'todo', priority: 'medium', assigned_to: 'member-1', due_date: '2026-09-15', description: 'Briefing' });
    });
    await t.test('Stale update and delete report conflicts; status updates never overwrite descriptions', async () => {
      stub.setResponse(() => ({ data: null, error: null }));
      for (const action of [
        () => api.updateProjectTask('workspace-1', task.id, input, task.updated_at),
        () => api.updateProjectTaskStatus('workspace-1', task, 'done'),
        () => api.deleteProjectTask('workspace-1', task),
      ]) assert.match((await action()).error, /inzwischen geändert oder entfernt/);
      for (const request of stub.requests) assert.deepEqual(request.filters, [['id', 'task-1'], ['workspace_id', 'workspace-1'], ['updated_at', task.updated_at]]);
      assert.deepEqual(stub.requests[1].value, { status: 'done' });
    });
    await t.test('All task pages load and task failure is separate from customer/project data', async () => {
      stub.setResponse(request => ({ data: request.table === 'project_tasks' ? Array.from({ length: request.range[0] === 0 ? 500 : 1 }, (_, i) => ({ ...task, id: String(request.range[0] + i) })) : [], error: null }));
      assert.equal((await api.loadBusinessWorkspace('workspace-1')).tasks.length, 501);
      assert.deepEqual(stub.requests.filter(r => r.table === 'project_tasks').map(r => r.range), [[0, 499], [500, 999]]);
      stub.setResponse(request => request.table === 'project_tasks' ? { data: null, error: { message: 'connection failed' } } : { data: [], error: null });
      const result = await api.loadBusinessWorkspace('workspace-1');
      assert.equal(result.error, null); assert.match(result.taskError, /Aufgaben konnten nicht geladen/); assert.deepEqual(result.tasks, []);
    });
    await t.test('Realtime listens to scoped writes and unfiltered key-only deletions', () => {
      stub.setResponse(() => ({ data: [], error: null }));
      let refreshes = 0;
      api.subscribeToBusinessWorkspace('workspace-1', () => { refreshes++; });
      for (const table of ['customers', 'projects', 'project_tasks', 'workspace_members']) {
        const entries = stub.subscriptions.filter(s => s.filter.table === table);
        assert.equal(entries.length, 3);
        for (const entry of entries) {
          assert.equal(entry.filter.filter, entry.filter.event === 'DELETE' ? undefined : 'workspace_id=eq.workspace-1');
          entry.callback({ old: { id: 'deleted-id' } });
        }
      }
      assert.equal(refreshes, 13);
    });
    await t.test('Rendered role controls follow live membership and escape task descriptions', () => {
      for (const role of ['owner', 'admin', 'member', 'guest', undefined]) {
        const html = renderToStaticMarkup(React.createElement(ProjectTasksPanel, { workspaceId: 'workspace-1', currentUserId: 'member-1', tasks: [task], projects: [{ id: 'project-1', title: 'Website' }], members: role ? [{ user_id: 'member-1', role, full_name: 'Testperson' }] : [], defaultProjectId: 'all', loading: false, loadError: null, onRefresh: async () => {} }));
        assert.equal(html.includes('Aufgabe anlegen'), ['owner', 'admin', 'member'].includes(role));
        assert.equal(html.includes('Aufgabe Startseite löschen'), ['owner', 'admin'].includes(role));
        assert.equal(html.includes('Status für Startseite'), ['owner', 'admin', 'member'].includes(role));
        assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
      }
    });
  } finally { await server.close(); }
});
