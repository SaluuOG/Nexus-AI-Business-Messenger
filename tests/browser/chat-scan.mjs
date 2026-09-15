import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({
  root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4179, strictPort: true, hmr: false },
  plugins: [{ name: 'chat-scan-browser-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  } }],
});
await server.listen();
await mkdir('browser-results', { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Berlin' });
    await context.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4179') ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const trigger = page.getByRole('button', { name: 'Chat mit KI auswerten', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Chat auswerten', exact: true });
    const start = dialog.getByRole('button', { name: 'Gesamten Chat auswerten', exact: true });
    const close = () => dialog.getByRole('button', { name: 'Chat-Auswertung schließen', exact: true }).click();
    const scanCount = () => page.evaluate(() => window.nexusTest.chatScanCalls.filter(call => call.body.action === 'scan').length);
    const waitReady = () => start.waitFor();
    const waitResult = () => dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).waitFor();
    const waitClosed = () => dialog.waitFor({ state: 'hidden' });
    try {
      await page.goto('http://127.0.0.1:4179/#/app/chats');
      await trigger.waitFor();
      assert.equal(await page.locator('.message-body').count(), 1, 'Only one recent message is loaded in the chat fixture');
      assert.equal(await page.evaluate(() => window.nexusTest.chatScanCalls.length), 0, 'Opening a chat must not contact an AI provider');

      // Missing configuration is honest and cannot produce a fake analysis.
      await page.evaluate(() => { window.nexusTest.chatScanAvailable = false; });
      await trigger.click();
      await dialog.getByRole('heading', { name: 'KI noch nicht eingerichtet', exact: true }).waitFor();
      assert.equal(await scanCount(), 0);
      assert.equal(await start.count(), 0);
      assert.deepEqual(await page.evaluate(() => window.nexusTest.chatScanCalls[0].body), { action: 'status', kind: 'direct', chatId: 'c1' });
      await page.keyboard.press('Escape');
      await waitClosed();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Chat mit KI auswerten');

      // A ready dialog still waits for a separate, explicit start. Cancel is free.
      await page.evaluate(() => { window.nexusTest.chatScanAvailable = true; });
      await trigger.press('Enter');
      await waitReady();
      assert.equal(await scanCount(), 0);
      await close();
      await waitClosed();
      assert.equal(await scanCount(), 0);
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      assert.equal(await scanCount(), 1, 'One explicit start must invoke exactly one scan');
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      if (await start.count()) assert.equal(await start.isEnabled(), false);
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; window.nexusTest.finishChatScans(); });
      await waitResult();

      // Whole-history coverage and an old source are shown despite the limited
      // message viewport. Findings stay separate and never create tasks by magic.
      await dialog.getByText('250 Nachrichten ausgewertet', { exact: true }).waitFor();
      for (const heading of ['Wichtige Informationen', 'Entscheidungen', 'Aufgaben', 'Offene Fragen']) {
        await dialog.getByRole('heading', { name: heading, exact: true }).waitFor();
      }
      await dialog.getByText('Das vereinbarte Budget beträgt 2.500 Euro.', { exact: true }).waitFor();
      await dialog.getByText('Quellen anzeigen (1)', { exact: true }).first().click();
      await dialog.getByText('Unser Budget beträgt 2.500 Euro. Wer liefert die Produktbilder?', { exact: true }).waitFor();
      assert.match(await dialog.innerText(), /2025/);
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 0, 'An analysis never creates or modifies project tasks');
      await page.screenshot({ path: `browser-results/${name}-chat-scan-desktop.png`, fullPage: true });

      // A realtime history change retires obsolete findings immediately.
      await page.evaluate(() => { window.nexusTest.directMessages[0].body = 'Das Budget muss neu abgestimmt werden.'; window.nexusTest.emit('direct_messages'); });
      await dialog.getByText('Der Verlauf hat sich geändert. Bitte erneut auswerten.', { exact: true }).waitFor();
      assert.equal(await dialog.getByText('Das vereinbarte Budget beträgt 2.500 Euro.', { exact: true }).count(), 0);
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.evaluate(() => { window.nexusTest.directMessages[0].body = 'Die Aufgaben haben sich ebenfalls geändert.'; window.nexusTest.emit('direct_messages'); });
      await dialog.getByText('Der Verlauf hat sich geändert. Bitte erneut auswerten.', { exact: true }).waitFor();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; window.nexusTest.finishChatScans(); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0, 'A changed history invalidates a pending scan as well as a displayed result');
      await close();
      await waitClosed();

      // Provider failure is recoverable and cannot masquerade as a result.
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanFailure = 'provider_error'; });
      await start.click();
      await dialog.getByRole('alert').filter({ hasText: 'Die KI konnte den Chat gerade nicht auswerten. Bitte versuche es erneut.' }).waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await page.evaluate(() => { window.nexusTest.chatScanFailure = null; });
      await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await waitResult();
      await close();
      await waitClosed();

      // A transport that returns after cancellation must not restore old output.
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.keyboard.press('Escape');
      await waitClosed();
      assert.ok(await page.evaluate(() => window.nexusTest.chatScanAborts.some(call => call.body.action === 'scan')), 'Cancel must abort the in-flight request');
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; });
      await trigger.click();
      await waitReady();
      await page.evaluate(() => window.nexusTest.finishChatScans());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await close();
      await waitClosed();

      // Route changes cancel pending work. A second direct chat and a group each
      // start with a fresh scope, including responses arriving from the old chat.
      await page.evaluate(() => { window.nexusTest.conversations.push({ conversation_id: 'c2', contact_user_id: 'second', full_name: 'Zweiter Kontakt', username: 'second', unread_count: 0, last_message: 'Neuer Chat' }); });
      await page.locator('.chat-refresh').click();
      await page.getByRole('button', { name: /Zweiter Kontakt/ }).waitFor();
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; location.hash = '#/app/chats?conversation=c2'; });
      await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
      await waitClosed();
      await trigger.click();
      await waitReady();
      await page.evaluate(() => window.nexusTest.finishChatScans());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.nexusTest.chatScanCalls.at(-1).body), { action: 'status', kind: 'direct', chatId: 'c2' });
      await close();
      await waitClosed();
      await page.getByRole('button', { name: 'Gruppen', exact: true }).click();
      await page.locator('.chat-head').getByText('Projektgruppe', { exact: true }).waitFor();
      await trigger.click();
      await waitReady();
      await start.click();
      await waitResult();
      assert.deepEqual(await page.evaluate(() => window.nexusTest.chatScanCalls.at(-1).body), { action: 'scan', kind: 'group', chatId: 'g1' });
      const beforeBlur = await scanCount();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await dialog.getByText('Die Auswertung wurde beim Verlassen des Fensters geschlossen. Du kannst den aktuellen Verlauf erneut auswerten.', { exact: true }).waitFor();
      await waitReady();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0, 'Leaving the window must clear private output');
      assert.equal(await scanCount(), beforeBlur, 'Returning to the window must not trigger a new scan');

      // Model strings and cited excerpts are rendered as text, never executable
      // HTML. Reuse the server-shaped result with hostile content in all fields.
      await close();
      await waitClosed();
      await page.evaluate(() => {
        const unsafe = '<img src=x onerror="window.chatScanUnsafe=true">';
        window.nexusTest.chatScanResult = {
          scanId: 'unsafe-scan', chatKind: 'group', chatId: 'g1', summary: unsafe,
          facts: [{ text: unsafe, sourceIds: ['unsafe-source'] }], decisions: [], tasks: [], questions: [],
          sources: [{ id: 'unsafe-source', sender: unsafe, createdAt: '2025-09-14T08:00:00Z', excerpt: unsafe }],
          coverage: { messageCount: 250, from: '2025-01-01T09:00:00Z', to: '2025-09-14T08:00:00Z', attachmentsExcluded: 2, complete: true },
        };
      });
      await trigger.click();
      await waitReady();
      await start.click();
      await waitResult();
      await dialog.getByText('Quellen anzeigen (1)', { exact: true }).click();
      assert.ok(await dialog.getByText('<img src=x onerror="window.chatScanUnsafe=true">', { exact: true }).count() >= 3);
      assert.equal(await dialog.locator('img').count(), 0);
      assert.equal(await page.evaluate(() => window.chatScanUnsafe), undefined);

      // Narrow phones keep the result dialog and corner action within reach.
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Dialog must fit ${width}px width`);
        assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'Result content must not overflow the dialog');
        assert.equal(await dialog.getByRole('button', { name: 'Chat-Auswertung schließen', exact: true }).isVisible(), true);
        await page.screenshot({ path: `browser-results/${name}-chat-scan-mobile-${width}.png`, fullPage: false });
      }
      await page.keyboard.press('Escape');
      await waitClosed();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Chat mit KI auswerten');
      const triggerBounds = await trigger.boundingBox();
      assert.ok(triggerBounds && triggerBounds.x >= 0 && triggerBounds.x + triggerBounds.width <= 321, 'Corner action must fit the narrow chat window');
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 0);
      assert.deepEqual(errors, []);
      console.log(name + ': explicit whole-chat scan, unavailable provider, old sources, read-only results, history invalidation, retry, cancellation, cross-chat isolation, direct/group routing, unsafe text, keyboard and 320/390px dialogs passed');
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-chat-scan-failure.png`, fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 8000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
