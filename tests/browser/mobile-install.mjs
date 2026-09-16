// Production-build mobile/PWA acceptance; no real account or outbound writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preview } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const startServer = () => preview({ root, preview: { host: '127.0.0.1', port: 4183, strictPort: true } });
let server = await startServer();
const base = 'http://127.0.0.1:4183/Nexus-AI-Business-Messenger/';
await mkdir('browser-results', { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    try {
      await page.goto(base + '#/auth');
      await page.getByLabel('E-Mail', { exact: true }).waitFor();
      assert.equal(await page.title(), 'Nexus · AI Business Messenger');
      const manifestURL = await page.locator('link[rel="manifest"]').getAttribute('href');
      assert.equal(manifestURL, '/Nexus-AI-Business-Messenger/manifest.webmanifest');
      const response = await context.request.get(new URL(manifestURL, base).href);
      assert.equal(response.status(), 200);
      const manifest = await response.json();
      assert.equal(manifest.display, 'standalone');
      assert.equal(new URL(manifest.start_url, base).href, base);
      assert.equal(new URL(manifest.scope, base).href, base);
      assert.equal(manifest.short_name, 'Nexus');
      for (const icon of manifest.icons) {
        const dimensions = await page.evaluate(src => new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
          img.onerror = reject;
          img.src = src;
        }), new URL(icon.src, base).href);
        assert.equal(dimensions, icon.sizes);
      }
      const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
      assert.equal((await context.request.get(new URL(appleIcon, base).href)).status(), 200);
      const panel = page.getByRole('region', { name: 'Nexus auf dem Handy' });
      await panel.getByText('So installierst du Nexus', { exact: true }).click();
      await panel.getByText('iPhone / iPad:', { exact: true }).waitFor();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no overflow at ${width}px`);
        assert.equal(await page.getByLabel('E-Mail', { exact: true }).evaluate(el => getComputedStyle(el).fontSize), '16px');
        await page.screenshot({ path: `browser-results/${name}-mobile-install-${width}.png`, fullPage: true });
      }
      // Exercise browser prompt failure/dismissal and confirmation without installing
      // anything on a real device or claiming OS-level installation coverage.
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { throw new Error('Browser denied prompt'); };
        event.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(event);
      });
      await panel.getByRole('button', { name: 'Nexus installieren', exact: true }).click();
      await panel.getByRole('status').waitFor();
      await page.evaluate(() => {
        window.mobilePromptCalls = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { window.mobilePromptCalls++; };
        event.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(event);
      });
      await panel.getByRole('button', { name: 'Nexus installieren', exact: true }).click();
      assert.equal(await page.evaluate(() => window.mobilePromptCalls), 1);
      assert.equal(await panel.getByRole('button', { name: 'Nexus installieren', exact: true }).count(), 0);
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      await panel.getByText('Nexus ist als App eingerichtet.', { exact: true }).waitFor();

      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const cachedURLs = await page.evaluate(async () => {
        const cache = await caches.open('nexus-mobile-offline-v1');
        return (await cache.keys()).map(request => request.url);
      });
      assert.deepEqual(cachedURLs, [base + 'offline.html']);
      // Stop the actual origin: browser offline emulation does not consistently
      // apply to separate service-worker network contexts across engines.
      await new Promise(resolve => server.httpServer.close(resolve));
      const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(offlineResponse.fromServiceWorker(), true);
      await page.getByRole('heading', { name: 'Deine Verbindung fehlt gerade.', exact: true }).waitFor();
      assert.equal(await page.getByLabel('E-Mail', { exact: true }).count(), 0);
      server = await startServer();
      await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await page.getByLabel('E-Mail', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`${name}: production manifest, PNG icons, 320/390px layout, install guidance, prompt handling, public-only cache and offline/reconnect passed`);
    } catch (error) {
      console.error(name + ': mobile acceptance failure at ' + page.url());
      console.error((await page.locator('body').innerText()).slice(0,1600));
      throw error;
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
