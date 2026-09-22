import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('Notification data, navigation, pagination and persistence errors', async t => {
  const stubPath = fileURLToPath(new URL('./support/supabaseStub.mjs', import.meta.url));
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
    plugins: [{ name: 'notification-data-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase')) return stubPath; } }],
  });
  try {
    const api = await server.ssrLoadModule('/src/features/notifications/notifications.ts');
    const stub = await server.ssrLoadModule(stubPath);
    await t.test('Targets preserve explicit chat, workspace, project and task context without accepting external routes', () => {
      const target = (kind, details) => api.notificationTarget({ kind, details });
      assert.equal(target('direct_message', { chat_id: 'a&next=https://example.invalid' }), '/app/chats?conversation=a%26next%3Dhttps%3A%2F%2Fexample.invalid');
      assert.equal(target('group_message', { chat_id: 'g2' }), '/app/groups?group=g2');
      assert.equal(target('workspace_invitation', { invite_token: 'secret?token' }), '/app/settings?category=workspace&invite=secret%3Ftoken');
      assert.equal(target('contact_request', {}), '/app/contacts');
      for (const kind of ['task_assigned','task_due','task_overdue','task_comment']) {
        assert.equal(target(kind, { workspace_id: 'w2', project_id: 'p2', task_id: 't2' }), '/app/business?workspace=w2&view=tasks&project=p2&task=t2');
        assert.equal(target(kind, { task_id: 't2' }), null);
      }
      assert.equal(target('redirect', { url: 'https://example.invalid' }), null);
      assert.equal(target('direct_message', {}), null);
    });
    await t.test('Keyset pages retain exact global counts beyond the displayed slice', async () => {
      const items = Array.from({ length: 210 }, (_, i) => ({ id: String(210 - i), kind: 'task_assigned', details: { title: 'Task ' + i } }));
      stub.setResponse(request => {
        const start = request.args.p_before ? items.findIndex(item => item.id === request.args.p_before) + 1 : 0;
        const page = items.slice(start, start + request.args.p_limit);
        return { data: { items: page, unread_count: 207, total_count: 210, through_id: '210', has_more: start + page.length < 210, preferences: api.defaultNotificationPreferences }, error: null };
      });
      const result = await api.loadNotifications(125, true);
      assert.equal(result.items.length, 125);
      assert.equal(new Set(result.items.map(item => item.id)).size, 125);
      assert.equal(result.items[124].id, '86');
      assert.equal(result.unread_count, 207);
      assert.equal(result.has_more, true);
      assert.deepEqual(stub.requests.map(r => [r.args.p_before, r.args.p_limit, r.args.p_unread_only]), [[null, 100, true], ['111', 25, true]]);
      assert.equal(stub.requests[0].args.p_timezone, api.notificationTimezone());
    });
    await t.test('Read snapshot and per-category updates use server-scoped RPCs', async () => {
      stub.setResponse(() => ({ data: null, error: null }));
      await api.markNotificationsRead('9007199254740993', '45');
      await api.saveNotificationPreference('deadlines', false);
      assert.deepEqual(stub.requests[0].args, { p_through: '9007199254740993', p_id: '45', p_timezone: api.notificationTimezone() });
      assert.deepEqual(stub.requests[1].args, { p_category: 'deadlines', p_enabled: false });
      assert.equal('recipient_id' in stub.requests[0].args, false);
    });
    await t.test('Network, backend and invalid responses cannot masquerade as a successful empty feed', async () => {
      stub.setResponse(() => ({ data: null, error: { message: 'permission denied' } }));
      await assert.rejects(api.loadNotifications(), /permission denied/);
      await assert.rejects(api.markNotificationsRead('1'), /permission denied/);
      await assert.rejects(api.saveNotificationPreference('messages', false), /permission denied/);
      stub.setResponse(() => ({ data: [], error: null }));
      await assert.rejects(api.loadNotifications(), /nicht geladen/);
      stub.setResponse(() => { throw new Error('offline'); });
      await assert.rejects(api.loadNotifications(), /offline/);
    });
  } finally { await server.close(); }
});
