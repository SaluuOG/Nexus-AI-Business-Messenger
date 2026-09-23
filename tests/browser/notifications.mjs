import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4178, strictPort: true, hmr: false },
  plugins: [{ name: 'notifications-browser-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4178') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const rows = page.locator('.notification-item');
    const bell = () => page.getByRole('link', { name: /^Benachrichtigungen:/ });
    const row = title => rows.filter({ has: page.locator('.notification-open>b', { hasText: title }) });
    const waitCount = async count => { await page.waitForFunction(count => document.querySelectorAll('.notification-item').length === count, count); };
    const returnToFeed = async () => { await bell().click(); await page.getByRole('heading', { name: 'Benachrichtigungen', exact: true }).waitFor(); };
    try {
      await page.goto('http://127.0.0.1:4178/#/app/notifications');
      await page.getByRole('heading', { name: 'Noch keine Benachrichtigungen', exact: true }).waitFor();
      await page.evaluate(() => {
        const s = window.nexusTest;
        const item = (id, kind, title, details = {}, read = false) => ({ id: String(id), recipient_id: 'me', kind, created_at: '2026-09-15T10:00:00Z', read_at: read ? '2026-09-15T10:01:00Z' : null, details: { title, detail: 'Team-Aktivität', ...details } });
        s.notifications = [
          ...Array.from({ length: 30 }, (_, i) => item(i + 1, 'task_assigned', 'Team-Aufgabe ' + (i + 1), { workspace_id: 'w1', project_id: 'p1', task_id: 'mine' })),
          item(31, 'task_overdue', 'Überfällige Aufgabe', { workspace_id: 'w1', project_id: 'p1', task_id: 'past' }),
          item(32, 'task_mention', 'Erwähnung bei Meine heutige Aufgabe', { workspace_id: 'w1', project_id: 'p1', task_id: 'mine', comment_id: 'notification-comment' }),
          item(33, 'workspace_invitation', 'Einladung zu einem neuen Team', { invite_token: 'test-notification-invite' }),
          item(34, 'contact_request', 'Neue Kontaktanfrage'),
          item(35, 'group_message', 'Neue Nachricht in Projektgruppe', { chat_id: 'g1' }),
          item(36, 'direct_message', 'Nachricht vom Test Kontakt', { chat_id: 'c1' }),
          item(37, 'task_assigned', '<script>window.unsafe = true</script>', { workspace_id: 'w1', project_id: 'p1', task_id: 'mine' }, true),
          { ...item(999, 'direct_message', 'Privater fremder Hinweis', { chat_id: 'private' }), recipient_id: 'different' },
        ];
        s.collaboration.task_comments.push({ id:'notification-comment',workspace_id:'w1',task_id:'mine',body:'Bitte diesen Entwurf prüfen.',mentioned_user_ids:['me'],created_by:'other',created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z',revision:1 });
        s.persistCollaboration();
        s.persistNotifications(); s.emit('notifications', 'INSERT');
      });
      await page.getByRole('link', { name: 'Benachrichtigungen: 36 ungelesen', exact: true }).waitFor();
      await waitCount(25);
      assert.equal(await page.getByText('Privater fremder Hinweis', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.unsafe), undefined);
      assert.equal(await page.evaluate(() => window.nexusTest.notificationCalls[0].args.p_timezone), 'Europe/Berlin');
      await page.getByRole('button', { name: 'Weitere Hinweise laden', exact: true }).click();
      await waitCount(37);
      assert.equal(await page.getByRole('button', { name: 'Weitere Hinweise laden', exact: true }).count(), 0);
      await page.getByRole('heading', { name: 'Benachrichtigungen', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `browser-results/${name}-notifications-desktop.png`, fullPage: true });

      // A failed read does not remove the unread dot or report success.
      await page.evaluate(() => { window.nexusTest.failure = 'mark_notifications_read'; });
      await row('Nachricht vom Test Kontakt').getByRole('button', { name: /^Als gelesen markieren:/ }).click();
      await page.getByRole('alert').filter({ hasText: 'Gelesen-Status konnte nicht gespeichert' }).waitFor();
      assert.match(await row('Nachricht vom Test Kontakt').getAttribute('class'), /unread/);
      await page.evaluate(() => { window.nexusTest.failure = null; });
      await row('Nachricht vom Test Kontakt').getByRole('button', { name: /^Als gelesen markieren:/ }).click();
      await page.getByRole('link', { name: 'Benachrichtigungen: 35 ungelesen', exact: true }).waitFor();
      await page.reload();
      await waitCount(25);
      assert.equal(await row('Nachricht vom Test Kontakt').getByRole('button', { name: /^Als gelesen markieren:/ }).count(), 0);

      // Destination routing, reload and browser history use the actual App.
      await row('Nachricht vom Test Kontakt').locator('.notification-open').click();
      await page.waitForURL(url => url.hash === '#/app/chats?conversation=c1');
      await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
      await page.reload();
      await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
      await returnToFeed();
      await row('Neue Nachricht in Projektgruppe').locator('.notification-open').click();
      await page.waitForURL(url => url.hash === '#/app/groups?group=g1');
      await page.locator('.chat-head').getByText('Projektgruppe', { exact: true }).waitFor();
      await returnToFeed();
      await row('Erwähnung bei Meine heutige Aufgabe').locator('.notification-open').click();
      await page.locator('.task-card').getByRole('heading', { name: 'Meine heutige Aufgabe', exact: true }).waitFor();
      await page.locator('#nexus-comment-notification-comment.is-mentioned-target').waitFor();
      assert.match(page.url(), /workspace=w1&view=tasks&project=p1&task=mine&comment=notification-comment/);
      await page.goBack();
      await page.getByRole('heading', { name: 'Benachrichtigungen', exact: true }).waitFor();
      await row('Einladung zu einem neuen Team').locator('.notification-open').click();
      await page.getByRole('heading', { name: 'Workspace & Team', exact: true }).waitFor();
      assert.match(page.url(), /invite=test-notification-invite/);
      await page.getByRole('button', { name: 'Einladung schließen', exact: true }).click();
      await returnToFeed();

      // Category choices persist, filter both feed and badge, and recover on error.
      await page.locator('.notification-settings-link').click();
      await page.getByRole('heading', { name: 'Benachrichtigungen', exact: true }).waitFor();
      const messages = page.getByRole('switch', { name: 'Nachrichten', exact: true });
      await page.evaluate(() => { window.nexusTest.failure = 'set_notification_preference'; });
      await messages.click();
      await page.getByRole('alert').filter({ hasText: 'Einstellung konnte nicht gespeichert' }).waitFor();
      assert.equal(await messages.isChecked(), true);
      await page.evaluate(() => { window.nexusTest.failure = null; });
      await messages.uncheck();
      await page.getByText('Einstellung gespeichert.', { exact: true }).waitFor();
      await page.reload();
      await page.getByRole('switch', { name: 'Nachrichten', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('input[aria-label="Nachrichten"]')?.checked === false);
      await returnToFeed();
      assert.equal(await row('Nachricht vom Test Kontakt').count(), 0);
      assert.equal(await row('Neue Nachricht in Projektgruppe').count(), 0);

      // Snapshot marking keeps a concurrently arriving hint unread.
      await page.evaluate(() => { window.nexusTest.notificationReadDelay = 550; });
      await page.getByRole('button', { name: 'Alle als gelesen markieren', exact: true }).click();
      await page.evaluate(() => {
        window.nexusTest.notifications.push({ id: '1000', recipient_id: 'me', kind: 'task_assigned', created_at: new Date().toISOString(), read_at: null, details: { title: 'Gerade neu eingetroffen', detail: 'Team-Aufgabe', workspace_id: 'w1', project_id: 'p1', task_id: 'mine' } });
        window.nexusTest.persistNotifications();
      });
      await page.getByRole('link', { name: 'Benachrichtigungen: 1 ungelesen', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Ungelesen', exact: true }).click();
      await waitCount(1);
      await row('Gerade neu eingetroffen').waitFor();
      await page.evaluate(() => { window.nexusTest.notificationReadDelay = 0; });

      // A small viewport retains reachable actions and no horizontal overflow.
      await page.getByRole('button', { name: 'Alle', exact: true }).click();
      await waitCount(25);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await bell().isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok((await page.locator('.notification-summary>div:nth-child(2)').boundingBox()).width >= 180, 'Summary text must have room to read on mobile');
      await page.screenshot({ path: `browser-results/${name}-notifications-mobile.png`, fullPage: false });
      await page.locator('.notification-settings-link').click();
      await page.getByRole('switch', { name: 'Nachrichten', exact: true }).waitFor();
      assert.equal(await page.getByRole('switch').count(), 6);
      assert.equal(await page.getByRole('switch', { name: 'Aufgabenkommentare', exact: true }).isChecked(), true);
      assert.equal(await page.locator('.settings-category b').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth)), true, 'Category labels must fit their cards');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `browser-results/${name}-notification-settings-mobile.png`, fullPage: true });
      await page.getByRole('switch', { name: 'Nachrichten', exact: true }).press('Space');
      await page.getByText('Einstellung gespeichert.', { exact: true }).waitFor();
      await returnToFeed();

      // Source loss and refresh failures remove stale details; retry recovers.
      await page.evaluate(() => { window.nexusTest.notifications.find(n => n.id === '1000').revoked = true; window.nexusTest.emit('workspace_members', 'DELETE'); });
      await page.waitForFunction(() => !document.querySelector('.notification-list')?.textContent.includes('Gerade neu eingetroffen'));
      await page.evaluate(() => { window.nexusTest.failure = 'get_my_notifications'; window.nexusTest.emit('notifications'); });
      await page.getByRole('alert').filter({ hasText: 'Benachrichtigungen konnten nicht aktualisiert' }).waitFor();
      assert.equal(await rows.count(), 0);
      await page.getByRole('link', { name: 'Benachrichtigungen: Aktualisierung fehlgeschlagen', exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.failure = null; });
      await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await waitCount(25);
      await page.evaluate(() => window.nexusTest.connection('CHANNEL_ERROR'));
      await page.getByText(/Die Verbindung wird wiederhergestellt/).waitFor();
      await page.evaluate(() => window.nexusTest.connection('SUBSCRIBED'));

      // Pending responses from the former account cannot overwrite a new session.
      await page.evaluate(() => { window.nexusTest.notificationDelay = 700; window.nexusTest.emit('notifications'); });
      await page.waitForTimeout(250);
      await page.evaluate(() => { window.nexusTest.notificationDelay = 0; window.nexusTest.switchUser('different'); });
      await row('Privater fremder Hinweis').waitFor();
      await page.waitForTimeout(800);
      assert.equal(await rows.count(), 1);
      assert.equal(await row('Meine heutige Aufgabe').count(), 0);
      assert.deepEqual(errors, []);
      console.log(name + ': notification counts, keyset pages, read persistence, concurrent events, direct/group/task/invite links, preferences, keyboard, mobile, errors, reconnect, revoked access and account switching passed');
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-notifications-failure.png`, fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 6000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
