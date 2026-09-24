import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, base: '/', server: { host: '127.0.0.1', port: 4187, strictPort: true, hmr: false },
  plugins: [{ name: 'connection-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; } }],
});
await server.listen();
try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    try {
      for (const kind of ['direct', 'group']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        try {
          await context.addInitScript(() => { sessionStorage.setItem('nexusTest.mobileBusinessFixture', '1'); sessionStorage.setItem('nexusTest.messageHistoryFixture', '1'); });
          await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4187') ? route.continue() : route.abort());
          const page = await context.newPage();
          await page.goto('http://127.0.0.1:4187/#/app/' + (kind === 'direct' ? 'chats' : 'groups'));
          await page.locator('.chat-list .chat').filter({ hasText: kind === 'direct' ? 'Test Kontakt' : 'Projektgruppe' }).click();
          const input = kind === 'direct' ? page.getByTestId('direct-message-composer') : page.getByLabel('Gruppennachricht', { exact: true });
          await input.fill('Text bleibt erhalten');
          await page.evaluate(() => window.nexusTest.channels.filter(c => c.active).forEach(c => c.statusCallback?.('CHANNEL_ERROR')));
          await page.locator('.conversation [role=status]').filter({ hasText: 'Live-Verbindung unterbrochen' }).waitFor();
          assert.equal(await input.inputValue(), 'Text bleibt erhalten');
          await context.setOffline(true);
          await page.locator('.conversation [role=status]').filter({ hasText: 'Keine Internetverbindung' }).waitFor();
          await page.locator('.composer .send-button, .composer button[title="Nachricht senden"], .composer button[aria-label="Nachricht senden"]').first().click();
          const retry = page.getByRole('button', { name: 'Erneut senden', exact: true });
          await retry.waitFor();
          assert.equal(await input.inputValue(), 'Text bleibt erhalten');
          assert.equal(await page.evaluate(() => window.nexusTest.textSendCalls.length), 0);
          await context.setOffline(false);
          await page.evaluate(() => window.nexusTest.channels.filter(c => c.active).forEach(c => c.statusCallback?.('SUBSCRIBED')));
          await page.locator('.conversation [role=status]').filter({ hasText: 'wiederhergestellt' }).waitFor();
          assert.equal(await page.evaluate(() => window.nexusTest.textSendCalls.length), 0, 'No automatic write');
          await retry.click();
          await page.waitForFunction(() => window.nexusTest.textSendWrites === 1);
          await page.waitForFunction(() => !document.querySelector('.composer input')?.value);
          await page.evaluate(() => { window.nexusTest.loseTextSendResponse = true; });
          await input.fill('Antwort verloren');
          await page.locator('.composer .send-button, .composer button[title="Nachricht senden"], .composer button[aria-label="Nachricht senden"]').first().click();
          await retry.waitFor(); await retry.click();
          await page.waitForFunction(() => window.nexusTest.textSendCalls.length === 3);
          assert.equal(await page.evaluate(() => window.nexusTest.textSendWrites), 2, 'Lost response retry does not duplicate');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          console.log(`${name} ${kind}: offline draft, reconnection, manual retry and deduplication passed`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
