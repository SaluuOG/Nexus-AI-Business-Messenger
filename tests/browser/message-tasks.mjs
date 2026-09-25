import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({
  root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4176, strictPort: true, hmr: false },
  plugins: [{ name: 'message-task-browser-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });

// Exercise the real message bubbles with isolated fixture messages. Task creation
// below also verifies that selecting a menu item does not unmount its dialog.
async function checkMessageOptions(page, browserName, kind) {
  const groups = kind === 'group';
  const ownId = `${kind}-options-own`;
  const other = page.locator('.message-wrap').first();
  const trigger = other.getByRole('button', { name: 'Optionen', exact: true });
  const menu = page.getByRole('menu', { name: 'Nachrichtenoptionen' });
  await trigger.waitFor();
  assert.equal(await page.locator('.message-actions').count(), 0, 'No action row below messages');
  assert.equal(await menu.count(), 0, 'Actions stay hidden until requested');
  assert.equal(await other.locator('.bubble').getByRole('button', { name: 'Optionen', exact: true }).count(), 1);
  await trigger.focus();
  await trigger.press('ArrowDown');
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Als Aufgabe übernehmen', 'Antworten']);
  await page.keyboard.press('End');
  assert.equal(await menu.getByRole('menuitem', { name: 'Antworten', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'Antworten', exact: true }).click();
  await page.locator('.composer-context').getByText('Antworten', { exact: true }).waitFor();
  await page.locator('.composer-context button').click();
  await page.evaluate(({ groups, ownId }) => {
    const rows = groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages;
    rows.push({ ...structuredClone(rows[0]), message_id: ownId, sender_id: 'me', body: 'Eigene Nachricht mit Optionen', created_at: '2026-09-14T09:00:00Z' });
    window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages', 'INSERT');
  }, { groups, ownId });
  const own = page.locator(`[data-message-id="${ownId}"]`);
  const ownTrigger = own.getByRole('button', { name: 'Optionen', exact: true });
  await ownTrigger.click();
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Als Aufgabe übernehmen', 'Antworten', 'Bearbeiten', 'Löschen']);
  await menu.getByRole('menuitem', { name: 'Bearbeiten', exact: true }).click();
  assert.equal(await page.locator('.composer input:not([type=file])').inputValue(), 'Eigene Nachricht mit Optionen');
  await page.locator('.composer-context button').click();
  await ownTrigger.click();
  const confirmation = page.waitForEvent('dialog').then(async dialog => {
    assert.equal(dialog.type(), 'confirm');
    assert.match(dialog.message(), /löschen/);
    await dialog.dismiss();
  });
  await menu.getByRole('menuitem', { name: 'Löschen', exact: true }).click();
  await confirmation;
  assert.equal(await own.count(), 1, 'Cancel keeps the message');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await ownTrigger.click();
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844, 'Menu fits the mobile viewport');
    const target = await ownTrigger.boundingBox();
    const bubble = await own.locator('.bubble').boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44, 'Touch target is large enough');
    assert.ok(target.x >= bubble.x && target.y >= bubble.y && target.x + target.width <= bubble.x + bubble.width && target.y + target.height <= bubble.y + bubble.height, 'Options are inside the bubble');
    await page.screenshot({ path: `browser-results/${browserName}-${kind}-message-options-${width}.png`, fullPage: true });
    await own.locator('.message-body').click();
    await menu.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ownTrigger.click();
  await trigger.click();
  assert.equal(await menu.count(), 1, 'Only the selected message menu stays open');
  assert.equal(await ownTrigger.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Tab');
  await menu.waitFor({ state: 'hidden' });
  await ownTrigger.click();
  await page.evaluate(({ groups, ownId }) => {
    const rows = groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages;
    rows.find(row => row.message_id === ownId).deleted_at = new Date().toISOString();
    window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages');
  }, { groups, ownId });
  await own.getByText('Nachricht gelöscht', { exact: true }).waitFor();
  assert.equal(await ownTrigger.count(), 0, 'Deleted messages have no options');
  await menu.waitFor({ state: 'hidden' });
}

try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4176') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const dialog = page.getByRole('dialog');
    const source = page.getByRole('region', { name: 'Ursprungsnachricht', exact: true });
    try {
      await page.clock.setFixedTime(new Date('2026-09-14T10:00:00Z'));
      await page.goto('http://127.0.0.1:4176/#/app/chats');
      await checkMessageOptions(page, name, 'direct');
      await page.getByRole('button', { name: 'Optionen', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Als Aufgabe übernehmen', exact: true }).click();
      await dialog.getByRole('option', { name: 'Überfälliges Projekt', exact: true }).waitFor({ state: 'attached' });
      assert.equal(await dialog.getByLabel('Aufgabentitel *', { exact: true }).inputValue(), 'Bitte das Angebot prüfen!');
      assert.equal(await dialog.getByLabel('Beschreibung', { exact: true }).inputValue(), 'Bitte das Angebot prüfen!\nDetails für das Team.');
      assert.match(await dialog.innerText(), /für alle Mitglieder/);
      assert.equal(await dialog.getByRole('option', { name: 'Zweites Team', exact: true }).count(), 0, 'Guest workspace must not be offered');
      await dialog.getByLabel('Aufgabentitel *', { exact: true }).fill('Angebot prüfen!');
      await dialog.getByLabel('Beschreibung', { exact: true }).fill('Bewusst geteilte Aufgabenbeschreibung.');
      await dialog.getByLabel('Priorität', { exact: true }).selectOption('urgent');
      await dialog.getByLabel('Deadline', { exact: true }).fill('2026-09-14');
      await dialog.getByLabel('Verantwortliche Person', { exact: true }).selectOption('me');

      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Dialog must fit mobile width');
      const createTaskButton = dialog.locator('form button[type="submit"]');
      assert.ok(await createTaskButton.isEnabled());
      await page.screenshot({ path: `browser-results/${name}-message-task-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { window.nexusTest.createDelay = 1_000; window.nexusTest.loseCreateResponse = true; });
      await Promise.all([
        dialog.locator('form button[type="submit"]:disabled').filter({ hasText: 'Übernimmt…' }).waitFor(),
        createTaskButton.click(),
      ]);
      assert.equal(await createTaskButton.isEnabled(), false);
      await dialog.getByRole('alert').filter({ hasText: 'Verbindung wurde unterbrochen' }).waitFor();
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 1);
      await dialog.getByRole('button', { name: 'Aufgabe erstellen', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Aufgabe übernommen', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 1, 'Retry after lost response must not duplicate');
      await dialog.getByRole('button', { name: 'Aufgabe öffnen', exact: true }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Angebot prüfen!', exact: true }).waitFor();
      assert.equal(await page.locator('.task-card').count(), 1);
      await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).waitFor();
      await page.screenshot({ path: `browser-results/${name}-message-task-detail.png`, fullPage: true });

      // Resolve an old source independently of the most recent chat window.
      await page.evaluate(() => { window.nexusTest.hideRecentSource = true; });
      await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).click();
      await source.getByText('Bitte das Angebot prüfen!\nDetails für das Team.', { exact: true }).waitFor();
      assert.equal(await source.getByText('Bewusst geteilte Aufgabenbeschreibung.', { exact: true }).count(), 0);
      await page.reload();
      await source.getByText('Bitte das Angebot prüfen!\nDetails für das Team.', { exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.directMessages[0].body = 'Bearbeitete Ursprungsnachricht!'; window.nexusTest.emit('direct_messages'); });
      await source.getByText('Bearbeitete Ursprungsnachricht!', { exact: true }).waitFor();
      await source.getByRole('button', { name: 'Zur Aufgabe', exact: true }).click();
      await page.locator('.task-card').getByText('Bewusst geteilte Aufgabenbeschreibung.', { exact: true }).waitFor();

      await page.getByRole('button', { name: 'Briefing', exact: true }).click();
      await page.getByRole('region', { name: 'Heute erledigen' }).getByRole('button', { name: /Angebot prüfen!/ }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Angebot prüfen!', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).click();
      await source.getByText('Bearbeitete Ursprungsnachricht!', { exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.directMessages[0].deleted_at = new Date().toISOString(); window.nexusTest.emit('direct_messages'); });
      await source.getByText(/entfernt oder du hast keinen Zugriff/).waitFor();
      assert.equal(await source.locator('blockquote').count(), 0);
      await source.getByRole('button', { name: 'Zur Aufgabe', exact: true }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Angebot prüfen!', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).count(), 0);

      // Group conversion, long-text correction, workspace isolation and cancel.
      await page.getByRole('button', { name: 'Gruppen', exact: true }).click();
      await checkMessageOptions(page, name, 'group');
      await page.getByRole('button', { name: 'Optionen', exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.groupMessages[0].body = 'L'.repeat(4500); window.nexusTest.emit('group_messages'); });
      await page.locator('.message-body').filter({ hasText: 'L'.repeat(100) }).waitFor();
      await page.getByRole('button', { name: 'Optionen', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Als Aufgabe übernehmen', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'länger als 4.000 Zeichen' }).waitFor();
      assert.equal((await dialog.getByLabel('Beschreibung', { exact: true }).inputValue()).length, 4500);
      assert.equal(await dialog.getByRole('button', { name: 'Aufgabe erstellen', exact: true }).isEnabled(), false);
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Optionen', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Als Aufgabe übernehmen', exact: true }).click();
      await dialog.getByLabel('Beschreibung', { exact: true }).fill('Kurze freigegebene Beschreibung <script>window.unsafe = true</script>');
      await dialog.getByLabel('Aufgabentitel *', { exact: true }).fill('Startseite vorbereiten!');
      await dialog.getByLabel('Workspace *', { exact: true }).selectOption('w3');
      await dialog.getByRole('option', { name: 'Drittes Projekt', exact: true }).waitFor({ state: 'attached' });
      assert.equal(await dialog.getByRole('option', { name: 'Überfälliges Projekt', exact: true }).count(), 0);
      assert.equal(await dialog.getByLabel('Verantwortliche Person', { exact: true }).inputValue(), '');
      await dialog.getByRole('button', { name: 'Aufgabe erstellen', exact: true }).click();
      await dialog.getByRole('button', { name: 'Aufgabe öffnen', exact: true }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Startseite vorbereiten!', exact: true }).waitFor();
      assert.match(page.url(), /workspace=w3/);
      assert.equal(await page.evaluate(() => window.unsafe), undefined);
      await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).click();
      await source.locator('blockquote').waitFor();
      assert.equal((await source.locator('blockquote').innerText()).length, 4500);
      await page.screenshot({ path: `browser-results/${name}-group-task-source.png`, fullPage: true });
      await page.evaluate(() => { window.nexusTest.sourceDenied = true; window.nexusTest.emit('group_members', 'DELETE'); });
      await source.getByText(/entfernt oder du hast keinen Zugriff/).waitFor();
      assert.equal(await source.locator('blockquote').count(), 0);
      await source.getByRole('button', { name: 'Zur Aufgabe', exact: true }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Startseite vorbereiten!', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Ursprungsnachricht öffnen', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(name + ': direct/group conversion, explicit sharing, mobile dialog, retry, source history, reload, edits, deletion, briefing, long text, workspace isolation and lost access passed');
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-message-task-failure.png`, fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 7000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
