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
    for (const scenario of ['transient', 'persistent', 'briefing']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4177') ? route.continue() : route.abort());
      await context.addInitScript(failures => sessionStorage.setItem('nexusTest.clockFailures', JSON.stringify(failures)),
        scenario === 'transient' ? { workspaces: 2 } : scenario === 'persistent' ? { workspaces: 99 } : { projects: 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      try {
        await page.goto('http://127.0.0.1:4177/#/app/briefing');
        if (scenario === 'persistent') {
          const retry = page.getByRole('button', { name: 'Erneut laden', exact: true });
          await retry.waitFor();
          assert.match(await page.getByRole('alert').innerText(), /Sitzung/);
          assert.equal(await page.getByText('Workspace nicht verfügbar', { exact: true }).count(), 0);
          assert.equal(await page.evaluate(() => window.nexusTest.clockReads.workspaces), 4); // StrictMode adds one cancelled initial read.
          await page.evaluate(() => { window.nexusTest.clockFailures.workspaces = 0; });
          await retry.click();
        }
        await page.getByRole('heading', { name: /Heute erledigen/ }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await page.evaluate(() => window.nexusTest.writes), 0);
        if (scenario === 'transient') assert.equal(await page.evaluate(() => window.nexusTest.clockReads.workspaces), 3);
        // A later briefing-only failure must also be recoverable via its button.
        if (scenario === 'briefing') {
          await page.evaluate(() => { window.nexusTest.clockFailures.projects = 99; });
          await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
          const retry = page.getByRole('button', { name: 'Erneut laden', exact: true });
          await retry.waitFor();
          await page.evaluate(() => { window.nexusTest.clockFailures.projects = 0; });
          await retry.click();
          await page.getByRole('heading', { name: /Heute erledigen/ }).waitFor();
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log(name + ': startup/briefing read recovery ' + scenario + ' passed');
      } finally { await context.close(); }
    }
    await browser.close();
  }
} finally { await server.close(); }
