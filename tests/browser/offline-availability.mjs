import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, base: '/', server: { host: '127.0.0.1', port: 4189, strictPort: true, hmr: false },
  plugins: [{ name: 'offline-fixture', enforce: 'pre', resolveId(source) { if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub; },
    transform(code, id) { if (id === stub) return code.replace('async rpcResult(name, args) {', `async rpcResult(name, args) {
      if (window.failChatList && ['get_direct_conversations','get_my_group_chats'].includes(name)) return { data: null, error: { message: 'TypeError: Load failed' } };`); }
  }],
});
await server.listen();
const setOnline = (page, online) => page.evaluate(value => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}, online);
try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    try {
      for (const scenario of ['chats', 'groups', 'chats-error', 'groups-error', 'briefing']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        try {
          await context.addInitScript(mode => {
            sessionStorage.setItem('nexusTest.mobileBusinessFixture', '1');
            sessionStorage.setItem('nexusTest.messageHistoryFixture', '1');
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: mode.endsWith('-error') });
            window.failChatList = mode.endsWith('-error');
          }, scenario);
          await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4189') ? route.continue() : route.abort());
          const page = await context.newPage(); page.setDefaultTimeout(12000);
          const route = scenario.replace('-error', '');
          await page.goto('http://127.0.0.1:4189/#/app/' + route);
          if (scenario === 'briefing') {
            await page.getByText('Briefing offline nicht verfügbar', { exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Offline', exact: true }).isDisabled(), true);
            assert.equal(await page.getByText('Aktualisierung fehlgeschlagen', { exact: true }).count(), 0);
            await setOnline(page, true);
            await page.getByRole('heading', { name: /Heute erledigen/ }).waitFor();
          } else {
            const groups = route === 'groups';
            await page.getByText(groups ? 'Gruppen derzeit nicht verfügbar' : 'Chats derzeit nicht verfügbar', { exact: true }).waitFor();
            assert.equal(await page.getByText(groups ? 'Noch keine Gruppen' : 'Noch keine Chats', { exact: true }).count(), 0);
            assert.ok(!(await page.locator('body').innerText()).includes('TypeError'));
            if (!scenario.endsWith('-error')) assert.equal(await page.getByText('Status nicht erreichbar.', { exact: false }).count(), 0);
            await page.evaluate(() => { window.failChatList = false; });
            await setOnline(page, true);
            const chat = page.locator('.chat-list .chat').filter({ hasText: groups ? 'Projektgruppe' : 'Test Kontakt' });
            await chat.waitFor();
            await setOnline(page, false);
            await page.locator('.chat-list-title button.chat-refresh').first().click();
            await page.locator('.chat-list [role=status]').filter({ hasText: 'Offline – zuletzt gespeichert:' }).waitFor();
            assert.equal(await chat.isVisible(), true, 'Loaded chats survive an offline refresh');
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          console.log(`${name} ${scenario}: unavailable state and automatic read recovery passed`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
