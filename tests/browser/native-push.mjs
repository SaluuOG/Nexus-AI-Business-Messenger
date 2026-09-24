import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
  server: { host: '127.0.0.1', port: 4188, strictPort: true, hmr: false },
  plugins: [{ name: 'native-push-ui-test', configureServer(server) {
    server.middlewares.use('/native-push-test', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script type="module" src="/tests/browser/native-push-entry.tsx"></script>');
    });
  } }],
});
await server.listen();
try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4188') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    try {
      await page.goto('http://127.0.0.1:4188/native-push-test');
      const previews = page.getByLabel('Inhalte auf dem Sperrbildschirm anzeigen');
      assert.equal(await previews.isChecked(), false);
      await previews.check();
      await page.getByRole('button', { name: 'Auswahl vormerken' }).click();
      await page.getByRole('status').filter({ hasText: 'Push bleibt' }).waitFor();
      await page.reload();
      assert.equal(await previews.isChecked(), true);
      await page.evaluate(() => window.setTestUser('user-b'));
      await page.waitForFunction(() => document.querySelector('input[type=checkbox]:last-of-type') !== null);
      await page.getByRole('button', { name: 'Auswahl vormerken' }).waitFor();
      // Render completion, not a fixed delay.
      await page.waitForFunction(() => !document.querySelectorAll('input')[3].checked);
      assert.equal(await previews.isChecked(), false);
      assert.equal(await page.getByRole('button', { name: 'Push aktivieren', exact: true }).count(), 0);
      console.log(name + ': native push drafts persist privately per account, without activation');
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
