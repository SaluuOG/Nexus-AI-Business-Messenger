import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4177, strictPort: true, hmr: false },
  plugins: [{ name: 'settings-browser-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4177') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const categories = page.getByRole('navigation', { name: 'Einstellungskategorien', exact: true });
    const choose = label => categories.getByRole('link', { name: new RegExp('^' + label) }).click();
    try {
      await page.goto('http://127.0.0.1:4177/#/app/settings');
      await page.getByRole('heading', { name: 'Allgemein', exact: true }).waitFor();
      assert.equal(await categories.getByRole('link').count(), 5);
      assert.equal(await page.getByRole('heading', { name: 'Passwort ändern', exact: true }).count(), 0);
      await page.getByLabel('Startansicht', { exact: true }).selectOption('groups');
      await page.getByRole('button', { name: 'Privat Persönliches Profil', exact: true }).click();
      await page.reload();
      await page.getByRole('heading', { name: 'Allgemein', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Startansicht', { exact: true }).inputValue(), 'groups');
      assert.equal(await page.getByRole('button', { name: 'Privat Persönliches Profil', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.goto('http://127.0.0.1:4177/#/');
      await page.waitForURL(url => url.hash === '#/app/groups');
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
      await choose('Profil & Business');
      await page.getByLabel('Name', { exact: true }).fill('Ungespeicherter Profilentwurf');
      await choose('Datenschutz & Sicherheit');
      await page.getByRole('heading', { name: 'Passwort ändern', exact: true }).waitFor();
      assert.match(page.url(), /category=security/);
      await page.goBack();
      await page.getByRole('heading', { name: 'Profil & Business', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Ungespeicherter Profilentwurf');

      await choose('Workspace & Team');
      await page.getByLabel('Workspace auswählen', { exact: true }).selectOption('w2');
      await page.locator('.team-panel').getByText('Zweites Team · Guest', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Einladung erstellen', exact: true }).count(), 0);
      await page.getByLabel('Workspace auswählen', { exact: true }).selectOption('w3');
      await page.getByRole('button', { name: 'Einladung erstellen', exact: true }).waitFor();
      await categories.getByRole('link', { name: /^Datenschutz & Sicherheit/ }).press('Enter');
      await page.getByRole('heading', { name: 'Datenschutz & Sicherheit', exact: true }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Datenschutz & Sicherheit', exact: true }).waitFor();
      assert.equal(await categories.getByRole('link', { name: /^Datenschutz & Sicherheit/ }).getAttribute('aria-current'), 'page');
      await page.screenshot({ path: `browser-results/${name}-settings-security-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const link of await categories.getByRole('link').all()) assert.equal(await link.isVisible(), true);
      await page.screenshot({ path: `browser-results/${name}-settings-security-mobile.png`, fullPage: true });

      // Synthetic credentials stay in the fixture. No real user is changed and no
      // email is sent: all external network access is blocked for this context.
      await page.getByLabel('Neues Passwort', { exact: true }).fill('Nexus_Test!42');
      await page.getByLabel('Passwort bestätigen', { exact: true }).fill('Nexus_Test!43');
      await page.getByRole('button', { name: 'Passwort aktualisieren', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'stimmen nicht überein' }).waitFor();
      assert.equal(await page.evaluate(() => window.nexusTest.passwordUpdates.length), 0);
      await page.getByLabel('Passwort bestätigen', { exact: true }).fill('Nexus_Test!42');
      await page.getByRole('button', { name: 'Passwort aktualisieren', exact: true }).click();
      await page.getByText('Passwort erfolgreich geändert.', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.nexusTest.passwordUpdates), ['Nexus_Test!42']);
      assert.equal(await page.getByLabel('Neues Passwort', { exact: true }).inputValue(), '');
      await page.evaluate(() => { window.nexusTest.authFailure = 'Too many requests'; });
      await page.getByRole('button', { name: 'Link zum Zurücksetzen senden', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Zu viele Versuche' }).waitFor();
      await page.evaluate(() => { window.nexusTest.authFailure = null; });
      await page.getByRole('button', { name: 'Link zum Zurücksetzen senden', exact: true }).dblclick();
      await page.getByText(/Falls ein Nexus-Konto zu dieser E-Mail-Adresse existiert/).waitFor();
      assert.equal(await page.getByRole('button', { name: /Erneut senden in/ }).isEnabled(), false);
      const resets = await page.evaluate(() => window.nexusTest.resetRequests);
      assert.equal(resets.length, 2, 'Second click must not send another email');
      assert.equal(resets[1].email, 'nexus-test@example.invalid');
      assert.equal(resets[1].options.redirectTo, 'http://127.0.0.1:4177/?auth=recovery');

      await page.goto('http://127.0.0.1:4177/#/app/settings?category=unknown&invite=test-only-invite');
      await page.getByRole('heading', { name: 'Workspace & Team', exact: true }).waitFor();
      await choose('Allgemein');
      assert.match(page.url(), /invite=test-only-invite/);
      await page.getByRole('button', { name: 'Einladung schließen', exact: true }).click();
      await page.waitForURL(url => !url.hash.includes('invite='));
      await choose('Datenschutz & Sicherheit');
      await page.evaluate(() => { window.nexusTest.authFailure = 'network error'; });
      await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Abmeldung ist gerade nicht möglich' }).waitFor();
      await page.evaluate(() => { window.nexusTest.authFailure = null; });
      await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
      await page.getByRole('heading', { name: 'Willkommen zurück', exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(name + ': settings categories, browser history, saved preferences, start route, drafts, mobile workspace roles, password validation, reset/cooldown, invitation links and sign-out passed');
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-settings-failure.png`, fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 7000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
