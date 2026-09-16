import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const url = new URL(process.env.NEXUS_LIVE_URL);
assert.equal(url.origin, 'https://saluuog.github.io');
assert.equal(url.pathname, '/Nexus-AI-Business-Messenger/');
url.searchParams.set('release', process.env.GITHUB_SHA || 'check');
url.hash = '/auth';
await mkdir('browser-results', { recursive: true });
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const failedAssets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (['script', 'stylesheet'].includes(response.request().resourceType()) && response.status() >= 400) failedAssets.push(response.url());
  });
  try {
    let matched = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30_000 });
      assert.equal(response.status(), 200);
      const script = await page.locator('script[type="module"][src]').first().getAttribute('src');
      if (script === process.env.NEXUS_EXPECTED_SCRIPT) { matched = true; break; }
      await page.waitForTimeout(5000);
    }
    assert.ok(matched, 'Live page must serve the exact asset from this release');
    await page.getByLabel('E-Mail', { exact: true }).waitFor({ state: 'visible' });
    await page.locator('input[type="password"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    assert.equal(await page.getByText('Demo-Modus öffnen', { exact: true }).count(), 0);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    assert.equal(manifestHref, '/Nexus-AI-Business-Messenger/manifest.webmanifest');
    const manifestResponse = await page.request.get(new URL(manifestHref, url).href);
    assert.equal(manifestResponse.status(), 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.short_name, 'Nexus');
    for (const icon of manifest.icons) {
      assert.equal((await page.request.get(new URL(icon.src, url).href)).status(), 200);
    }
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('region', { name: 'Nexus auf dem Handy' }).waitFor();
    }
    await page.screenshot({ path: 'browser-results/live-' + name + '.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(failedAssets, []);
    console.log(name + ': published release asset, configured login and styles loaded without application errors');
  } finally { await browser.close(); }
}
