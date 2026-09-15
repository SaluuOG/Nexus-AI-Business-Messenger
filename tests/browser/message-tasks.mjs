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
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
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
      await page.getByRole('button', { name: 'Als Aufgabe übernehmen', exact: true }).click();
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
      await page.getByRole('button', { name: 'Als Aufgabe übernehmen', exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.groupMessages[0].body = 'L'.repeat(4500); window.nexusTest.emit('group_messages'); });
      await page.locator('.message-body').filter({ hasText: 'L'.repeat(100) }).waitFor();
      await page.getByRole('button', { name: 'Als Aufgabe übernehmen', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'länger als 4.000 Zeichen' }).waitFor();
      assert.equal((await dialog.getByLabel('Beschreibung', { exact: true }).inputValue()).length, 4500);
      assert.equal(await dialog.getByRole('button', { name: 'Aufgabe erstellen', exact: true }).isEnabled(), false);
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Als Aufgabe übernehmen', exact: true }).click();
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
