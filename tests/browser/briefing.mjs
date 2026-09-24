import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({
  root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4175, strictPort: true },
  plugins: [{ name: 'browser-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4175') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.clock.setFixedTime(new Date('2026-09-14T10:00:00Z'));
      await page.goto('http://127.0.0.1:4175/#/app/briefing');
      const today = page.getByRole('region', { name: 'Heute erledigen' });
      await today.getByRole('button', { name: /Meine heutige Aufgabe/ }).waitFor();
      assert.equal(await today.locator('.briefing-item').count(), 2);
      assert.equal(await today.getByText('Aufgabe einer anderen Person').count(), 0);
      const attention = page.getByRole('region', { name: 'Handlungsbedarf' });
      assert.match(await attention.locator('h2').innerText(), /8/);
      assert.equal(await attention.locator('.briefing-item').count(), 5);
      await attention.getByRole('button', { name: /Weitere anzeigen/ }).click();
      assert.equal(await attention.locator('.briefing-item').count(), 8);
      assert.match(await page.locator('.briefing-project-row').first().innerText(), /Überfälliges Projekt/);
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 0);

      await page.setViewportSize({ width: 390, height: 844 });
      const mainNav = page.getByRole('navigation', { name: 'Hauptnavigation', exact: true });
      const openMenu = page.getByRole('button', { name: 'Hauptmenü öffnen', exact: true });
      assert.equal(await mainNav.isVisible(), false);
      assert.ok((await openMenu.boundingBox()).x < 24, 'Mobile menu belongs at the top left');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await openMenu.click();
        assert.equal(await page.getByRole('button', { name: 'Hauptmenü schließen', exact: true }).getAttribute('aria-expanded'), 'true');
        assert.equal(await mainNav.getByRole('button').count(), 8);
        assert.equal(await page.evaluate(() => ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)), false, 'Opening navigation must not focus a text field');
        const box = await mainNav.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 844);
        await page.screenshot({ path: `browser-results/${name}-mobile-menu-${width}.png`, fullPage: false });
        await page.keyboard.press('Escape');
        assert.equal(await mainNav.isVisible(), false);
        assert.equal(await openMenu.evaluate(el => document.activeElement === el), true);
      }
      await openMenu.click();
      await page.getByRole('button', { name: 'Menü schließen', exact: true }).click({ position: { x: 310, y: 800 } });
      assert.equal(await mainNav.isVisible(), false);
      await openMenu.click();
      await mainNav.getByRole('button', { name: 'Chats', exact: true }).click();
      await page.waitForURL(url => url.hash === '#/app/chats');
      assert.equal(await mainNav.isVisible(), false);
      await openMenu.click();
      assert.equal(await mainNav.getByRole('button', { name: 'Chats', exact: true }).getAttribute('aria-current'), 'page');
      await mainNav.getByRole('button', { name: 'Briefing', exact: true }).click();
      await today.locator('.briefing-item').first().waitFor();
      assert.equal(await mainNav.isVisible(), false);
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(() => window.scrollY > 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await today.locator('.briefing-item-side').first().isVisible(), true);
      const overflow = await page.evaluate(() => ({
        width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })),
      }));
      assert.ok(overflow.scrollWidth <= overflow.width, JSON.stringify(overflow));
      await page.screenshot({ path: 'browser-results/' + name + '-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await mainNav.isVisible(), true);
      assert.equal(await openMenu.isVisible(), false);

      await today.getByRole('button', { name: /Meine heutige Aufgabe/ }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Meine heutige Aufgabe', exact: true }).waitFor();
      assert.equal(await page.locator('.task-card').count(), 1);
      assert.match(page.url(), /workspace=w1/);
      assert.match(page.url(), /task=mine/);
      assert.equal(await page.evaluate(() => window.unsafe), undefined);
      await page.reload();
      await page.locator('.task-card').getByRole('heading', { name: 'Meine heutige Aufgabe', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Status für Meine heutige Aufgabe', exact: true }).selectOption('done');
      await page.getByText('Aufgabe erledigt.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Briefing', exact: true }).click();
      await today.getByRole('button', { name: /Meine überfällige Aufgabe/ }).waitFor();
      assert.equal(await today.getByRole('button', { name: /Meine heutige Aufgabe/ }).count(), 0);

      // A new local calendar day updates the due list without a database change.
      await page.clock.setFixedTime(new Date('2026-09-15T10:00:00Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await today.getByRole('button', { name: /Meine morgige Aufgabe/ }).waitFor();

      // Realtime deletes remove records and failed reads must not claim "all clear".
      await page.evaluate(() => {
        window.nexusTest.tasks = window.nexusTest.tasks.filter(t => !t.id.startsWith('unassigned'));
        window.nexusTest.emit('project_tasks', 'DELETE');
      });
      await attention.getByText('Keine blockierten oder nicht zugewiesenen Aufgaben.', { exact: true }).waitFor();
      await page.evaluate(() => { window.nexusTest.failure = 'project_tasks'; window.nexusTest.emit(); });
      await page.getByRole('alert').filter({ hasText: 'Die Übersicht konnte nicht vollständig geladen werden.' }).waitFor();
      assert.equal(await page.getByText('Keine blockierten oder nicht zugewiesenen Aufgaben.', { exact: true }).count(), 0);
      assert.equal(await page.locator('.briefing-stat b').first().innerText(), '—');
      await page.evaluate(() => { window.nexusTest.failure = null; window.nexusTest.emit(); });
      await today.getByRole('button', { name: /Meine morgige Aufgabe/ }).waitFor();
      await page.evaluate(() => window.nexusTest.connection('CHANNEL_ERROR'));
      await page.getByText('Live-Verbindung unterbrochen', { exact: true }).waitFor();
      await page.evaluate(() => window.nexusTest.connection('SUBSCRIBED'));
      await page.getByText('Automatische Aktualisierung', { exact: true }).waitFor();

      await page.getByRole('region', { name: 'Projekte im Blick' }).getByRole('button', { name: /Überfälliges Projekt/ }).click();
      await page.locator('.business-project-card').getByRole('heading', { name: 'Überfälliges Projekt', exact: true }).waitFor();
      assert.equal(await page.locator('.business-project-card').count(), 1);
      await page.getByRole('button', { name: 'Alle Projekte anzeigen', exact: true }).click();
      await page.locator('.business-project-card').getByRole('heading', { name: 'Kommendes Projekt', exact: true }).waitFor();
      assert.equal(await page.locator('.business-project-card').count(), 3);
      await page.getByRole('button', { name: /Alle Projektaufgaben/ }).click();
      await page.waitForURL(url => url.hash.includes('view=tasks'));
      assert.equal(new URL(page.url().split('#')[1], 'https://example.invalid').searchParams.has('task'), false);
      await page.getByRole('button', { name: 'Briefing', exact: true }).click();
      await today.getByRole('button', { name: /Meine morgige Aufgabe/ }).waitFor();

      // Workspace switching must discard slow responses and use guest permissions.
      await page.evaluate(() => { window.nexusTest.delayWorkspace = 'w1'; window.nexusTest.emit(); });
      await page.waitForTimeout(250);
      await page.locator('.workspace select').selectOption('w2');
      await page.getByRole('button', { name: /Aufgabe im zweiten Team/ }).waitFor();
      await page.waitForTimeout(900);
      assert.equal(await page.getByText('Meine überfällige Aufgabe', { exact: true }).count(), 0);
      await page.getByRole('button', { name: /Aufgabe im zweiten Team/ }).click();
      await page.locator('.task-card').getByRole('heading', { name: 'Aufgabe im zweiten Team', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Bearbeiten', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Aufgabe anlegen', exact: true }).count(), 0);
      await page.reload();
      await page.locator('.task-card').getByRole('heading', { name: 'Aufgabe im zweiten Team', exact: true }).waitFor();
      assert.equal(await page.locator('.workspace select').inputValue(), 'w2');
      await page.evaluate(() => { window.nexusTest.tasks = window.nexusTest.tasks.filter(t => t.id !== 'second'); window.nexusTest.emit('project_tasks', 'DELETE'); });
      await page.getByText('Aufgabe nicht mehr verfügbar', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Briefing', exact: true }).click();
      await page.getByRole('heading', { name: /Heute erledigen/ }).waitFor();
      await page.evaluate(() => { window.nexusTest.revoked = true; window.nexusTest.emit('workspace_members', 'DELETE'); });
      await page.getByRole('alert').filter({ hasText: 'Die Übersicht konnte nicht vollständig geladen werden.' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: /Heute erledigen/ }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(name + ': briefing, counters, mobile layout, detail navigation, reload, status, calendar rollover, realtime, errors, workspace isolation and guest access passed');
    } catch (error) {
      await page.screenshot({ path: 'browser-results/' + name + '-failure.png', fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Menu state:', await page.evaluate(() => ({
        open: document.querySelector('.side')?.getAttribute('data-menu-open'),
        active: document.activeElement?.tagName,
        toggle: document.querySelector('.mobile-menu-toggle')?.getAttribute('aria-expanded'),
        nav: document.querySelector('#nexus-main-navigation')?.getBoundingClientRect().toJSON(),
      })));
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 6000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
