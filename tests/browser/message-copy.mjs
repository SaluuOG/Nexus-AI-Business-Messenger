import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const origin = 'http://127.0.0.1:4202';
const server = await createServer({ root, configFile: false, base: '/', cacheDir: 'node_modules/.vite-copy-browser',
  server: { host: '127.0.0.1', port: 4202, strictPort: true, hmr: false },
  plugins: [{ name: 'message-copy-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });

try {
  for (const [name, engine] of (process.env.NEXUS_BROWSER === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]])) {
    const browser = await engine.launch();
    try {
      for (const kind of ['direct', 'group']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        await context.addInitScript(() => {
          window.copyOnline = true;
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.copyOnline });
          window.copyMode = 'success'; window.copyWrites = [];
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: text => {
              window.copyWrites.push(text);
              if (window.copyMode === 'denied') return Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
              if (window.copyMode === 'pending') return new Promise(resolve => { window.finishCopy = resolve; });
              return Promise.resolve();
            },
          } });
        });
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const groups = kind === 'group';
        const url = `${origin}/#/app/${groups ? 'groups?group=g1' : 'chats?conversation=c1'}`;
        const message = page.locator(`[data-message-id="${groups ? 'gm1' : 'dm1'}"]`);
        const menu = page.getByRole('menu', { name: 'Nachrichtenoptionen', exact: true });
        const feedback = page.locator('.message-copy-feedback');
        const trigger = message.getByRole('button', { name: 'Optionen', exact: true });
        const open = async () => {
          await trigger.scrollIntoViewIfNeeded();
          // Anchored menus dismiss on scroll/resize; settle fixture and viewport changes.
          await trigger.evaluate(el => new Promise(resolve => {
            let changed = performance.now(), previous = '';
            const note = () => { changed = performance.now(); };
            const viewport = window.visualViewport;
            document.addEventListener('scroll', note, true);
            window.addEventListener('resize', note);
            viewport?.addEventListener('scroll', note); viewport?.addEventListener('resize', note);
            const frame = () => {
              const b = el.getBoundingClientRect();
              const shape = [b.x, b.y, b.width, b.height, viewport?.width, viewport?.height, viewport?.offsetTop].join(':');
              if (shape !== previous) { previous = shape; note(); }
              if (performance.now() - changed < 150) { requestAnimationFrame(frame); return; }
              document.removeEventListener('scroll', note, true); window.removeEventListener('resize', note);
              viewport?.removeEventListener('scroll', note); viewport?.removeEventListener('resize', note);
              resolve();
            }; requestAnimationFrame(frame);
          }));
          await trigger.click();
          await menu.waitFor();
        };
        try {
          await page.goto(url);
          await message.locator('.message-body').waitFor();
          const original = await message.locator('.message-body').innerText();
          await open();
          await page.evaluate(() => document.querySelector('.messages').dispatchEvent(new Event('scroll')));
          assert.equal(await menu.isVisible(), true, 'Queued ancestor scroll without anchor movement keeps the menu open');
          await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await feedback.getByText('Text kopiert.', { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.copyWrites.at(-1)), original);
          assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Focus returns to the selected message');
          assert.equal(await menu.count(), 0);

          // Preserve Unicode, whitespace and newlines verbatim, including captions.
          const text = '  Angebot 👨‍👩‍👧‍👦\nhttps://example.com/?a=1&b=2\nGrüße <b>Team</b>  ';
          await page.evaluate(({ groups, text }) => {
            const rows = groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages;
            rows[0].body = text; rows[0].sender_id = 'me';
            window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages');
          }, { groups, text });
          await page.waitForFunction(text => document.querySelector('.message-body')?.textContent === text, text);
          const composer = page.locator('.composer input:not([type=file])');
          await composer.fill('Mein ungesendeter Entwurf');
          await open(); await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await page.waitForFunction(text => window.copyWrites.at(-1) === text, text);
          assert.equal(await composer.inputValue(), 'Mein ungesendeter Entwurf');

          await page.evaluate(() => { window.copyMode = 'denied'; });
          await open(); await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await feedback.getByText('Kopieren nicht möglich. Bitte versuche es erneut.', { exact: true }).waitFor();
          assert.equal(await page.getByText('Text kopiert.', { exact: true }).count(), 0, 'A denied write is never reported as success');

          // Pending writes cannot be duplicated or report success after leaving the chat.
          await page.evaluate(() => { window.copyMode = 'pending'; });
          await open(); await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await open();
          assert.equal(await menu.getByRole('menuitem', { name: 'Text kopieren' }).isDisabled(), true);
          await page.keyboard.press('Escape');
          await page.evaluate(() => { window.location.hash = '/app/contacts'; });
          await message.waitFor({ state: 'hidden' });
          await page.evaluate(async () => { window.finishCopy(); await Promise.resolve(); });
          assert.equal(await feedback.count(), 0);
          await page.evaluate(url => { window.location.hash = new URL(url).hash; }, url);
          await message.locator('.message-body').waitFor();

          // Embedded-view fallback uses the browser's real selection/copy event.
          await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            document.addEventListener('copy', () => {
              const el = document.activeElement;
              window.legacyCopied = el instanceof HTMLTextAreaElement ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
            });
          });
          await open(); await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await feedback.getByText('Text kopiert.', { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.legacyCopied), text);
          assert.equal(await page.locator('textarea').count(), 0, 'Temporary copy input is removed');
          assert.equal(await composer.inputValue(), 'Mein ungesendeter Entwurf');
          assert.equal(await trigger.evaluate(el => el === document.activeElement), true);

          await page.evaluate(() => { window.realCopyCommand = document.execCommand; document.execCommand = () => false; });
          await open(); await menu.getByRole('menuitem', { name: 'Text kopieren', exact: true }).click();
          await feedback.getByText('Kopieren nicht möglich. Bitte versuche es erneut.', { exact: true }).waitFor();
          assert.equal(await page.locator('textarea').count(), 0);
          await page.evaluate(() => { document.execCommand = window.realCopyCommand; });

          await page.evaluate(() => { window.copyOnline = false; window.dispatchEvent(new Event('offline')); });
          await page.getByText('Offline – gespeicherter Verlauf', { exact: true }).waitFor();
          await open();
          assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Text kopieren']);
          await menu.getByRole('menuitem', { name: 'Text kopieren' }).click();
          await feedback.getByText('Text kopiert.', { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => window.legacyCopied), text);
          await page.evaluate(() => { window.copyOnline = true; window.dispatchEvent(new Event('online')); });
          await page.getByText('Offline – gespeicherter Verlauf', { exact: true }).waitFor({ state: 'hidden' });

          // No text action on pure attachments or deleted messages.
          await page.evaluate(groups => {
            (groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages)[0].body = '';
            window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages');
          }, groups);
          await message.locator('.message-body').waitFor({ state: 'hidden' });
          await open();
          assert.equal(await menu.getByRole('menuitem', { name: 'Text kopieren' }).count(), 0);
          await page.keyboard.press('Escape');
          await page.evaluate(groups => {
            (groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages)[0].body = 'Nachricht für Menüprüfung';
            window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages');
          }, groups);
          await message.locator('.message-body').waitFor();
          for (const width of [320, 390, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await open();
            const box = await menu.boundingBox();
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844);
            await page.screenshot({ path: `browser-results/${name}-${kind}-message-copy-${width}.png` });
            await page.keyboard.press('Escape');
          }
          await page.evaluate(groups => {
            (groups ? window.nexusTest.groupMessages : window.nexusTest.directMessages)[0].deleted_at = new Date().toISOString();
            window.nexusTest.emit(groups ? 'group_messages' : 'direct_messages');
          }, groups);
          await message.getByText('Nachricht gelöscht', { exact: true }).waitFor();
          assert.equal(await trigger.count(), 0);
          assert.deepEqual(errors, []);
          console.log(`${name} ${kind}: exact text, Unicode, clipboard errors, embedded fallback, offline, draft/focus preservation, empty/deleted messages and viewport checks passed`);
        } catch (error) {
          await page.screenshot({ path: `browser-results/${name}-${kind}-message-copy-failure.png` });
          console.error((await page.locator('body').innerText()).slice(-2000));
          throw error;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
