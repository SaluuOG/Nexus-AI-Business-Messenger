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
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4177') ? route.continue() : route.abort());
    await context.addInitScript(() => sessionStorage.setItem('nexus_password_recovery', 'active'));
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto('http://127.0.0.1:4177/#/auth/reset-password');
      await page.getByLabel('Neues Passwort', { exact: true }).fill('Nexus_Test!42');
      await page.getByLabel('Passwort bestätigen', { exact: true }).fill('Nexus_Test!42');
      await page.evaluate(() => { window.nexusTest.authFailure = 'network error'; });
      await page.getByRole('button', { name: 'Neues Passwort speichern' }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Neues Passwort', { exact: true }).inputValue(), 'Nexus_Test!42');
      await page.evaluate(() => { window.nexusTest.authFailure = null; });
      await page.getByRole('button', { name: 'Neues Passwort speichern' }).click();
      await page.getByRole('heading', { name: 'Dein Zugang ist wieder sicher' }).waitFor();
      assert.equal(await page.getByText('Link nicht mehr gültig', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('nexus_password_recovery')), null);
      await page.getByRole('button', { name: 'Nexus öffnen', exact: true }).click();
      await page.waitForURL(url => url.hash === '#/app/briefing');
      await page.goto('http://127.0.0.1:4177/#/auth/reset-password');
      await page.getByRole('heading', { name: 'Link nicht mehr gültig' }).waitFor();
      console.log(name + ': recovery retry, persistent success, cleared recovery and exit passed');
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
