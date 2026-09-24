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
    const toolbar = page.locator('.chat-scan-toolbar');
    const trigger = toolbar.getByRole('button', { name: 'Chat mit KI auswerten', exact: true });
    const markDone = toolbar.getByRole('button', { name: 'Als fertig markieren', exact: true });
    const reopen = toolbar.getByRole('button', { name: 'Wieder öffnen', exact: true });
    const statusFilter = page.getByRole('combobox', { name: 'Chats nach deinem Status filtern', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Chat auswerten', exact: true });
    const start = dialog.getByRole('button', { name: 'Gesamten Chat auswerten', exact: true });
    const consent = () => dialog.getByRole('checkbox', { name: /Übertragung für die aktuelle Auswertung/ }).check();
    const close = async () => { await dialog.getByRole('button', { name: 'Chat-Auswertung schließen', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
    const scanCount = () => page.evaluate(() => window.nexusTest.chatScanCalls.filter(call => call.body.action === 'scan').length);
    const waitReady = () => start.waitFor();
    const waitResult = () => dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).waitFor();
    const waitState = status => toolbar.getByText(status, { exact: true }).waitFor();
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const changeHistory = (kind = 'direct', chatId = 'c1') => page.evaluate(({ kind, chatId }) => window.nexusTest.changeChatHistory(kind, chatId), { kind, chatId });
    try {
      await page.goto('http://127.0.0.1:4179/#/app/chats');
      await waitState('Offen');
      assert.equal(await page.locator('.message-body').count(), 1, 'Only one recent message is loaded in the chat fixture');
      assert.equal(await page.evaluate(() => window.nexusTest.chatScanCalls.length), 0, 'Opening a chat must not contact an AI provider');

      // Manual completion already works without an AI provider. Done chats stay
      // excluded even when someone adds a message, until explicitly reopened.
      await page.evaluate(() => { window.nexusTest.chatScanAvailable = false; });
      await trigger.click();
      await dialog.getByRole('heading', { name: 'KI noch nicht eingerichtet', exact: true }).waitFor();
      assert.equal(await scanCount(), 0);
      assert.equal(await start.count(), 0);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Chat mit KI auswerten');
      await markDone.click();
      await waitState('Fertig');
      assert.equal(await trigger.isEnabled(), false, 'Done chats cannot trigger a paid scan');
      await statusFilter.selectOption({ label: 'Offen' });
      assert.equal(await page.locator('.chat-list .chat-status-badge').count(), 0, 'Done chat is excluded from the open list');
      await statusFilter.selectOption({ label: 'Fertig' });
      await page.locator('.chat-list .chat-status-badge[data-status="done"]').waitFor();
      await statusFilter.selectOption({ label: 'Alle' });
      await changeHistory();
      await waitState('Fertig');
      await page.reload();
      await waitState('Fertig');
      assert.equal(await scanCount(), 0);
      await reopen.click();
      await waitState('Offen');
      await page.evaluate(() => { window.nexusTest.chatScanAvailable = true; });

      // Opening, cancelling, and loading the status are always free. A paid
      // request requires the second explicit button inside the dialog.
      await trigger.press('Enter');
      await waitReady();
      assert.equal(await scanCount(), 0);
      await close();
      assert.equal(await scanCount(), 0);
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      assert.equal(await start.isDisabled(), true, 'AI transfer requires explicit consent');
      await consent();
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      assert.equal(await scanCount(), 1);
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; window.nexusTest.finishChatScans(); });
      await waitResult();
      await waitState('Ausgewertet');
      await dialog.getByText('250 Nachrichten ausgewertet', { exact: true }).waitFor();
      for (const heading of ['Wichtige Informationen', 'Entscheidungen', 'Aufgaben', 'Offene Fragen']) {
        await dialog.getByRole('heading', { name: heading, exact: true }).waitFor();
      }
      await dialog.getByText('Das vereinbarte Budget beträgt 2.500 Euro.', { exact: true }).waitFor();
      await dialog.getByText('Quellen anzeigen (1)', { exact: true }).first().click();
      await dialog.locator('details[open] blockquote').filter({ hasText: 'Unser Budget beträgt 2.500 Euro. Wer liefert die Produktbilder?' }).waitFor();
      assert.match(await dialog.innerText(), /2025/);
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 0, 'An analysis never creates or modifies project tasks');
      await page.screenshot({ path: `browser-results/${name}-chat-scan-desktop.png`, fullPage: true });
      await close();
      await statusFilter.selectOption({ label: 'Ausgewertet' });
      await page.locator('.chat-list .chat-status-badge[data-status="processed"]').waitFor();
      await statusFilter.selectOption({ label: 'Offen' });
      assert.equal(await page.locator('.chat-list .chat-status-badge').count(), 0, 'Current processed chats are excluded from the open list');
      await statusFilter.selectOption({ label: 'Alle' });

      // Persisted current results are reused across dialog openings, reloads,
      // and finishing/reopening an unchanged chat. No duplicate paid request.
      const afterScan = await scanCount();
      await trigger.click();
      await waitResult();
      assert.equal(await start.count(), 0);
      assert.equal(await scanCount(), afterScan);
      await close();
      await markDone.click();
      await waitState('Fertig');
      await reopen.click();
      await waitState('Ausgewertet');
      await trigger.click();
      await waitResult();
      assert.equal(await scanCount(), afterScan);
      await close();

      // A cached RPC also carries private content. A late response after blur
      // or a hidden tab must stay hidden until the user explicitly resumes.
      for (const exitMode of ['blur', 'hidden']) {
        await page.evaluate(() => { window.nexusTest.chatScanCacheDeferred = true; });
        await trigger.click();
        // StrictMode replays mount effects: the first aborted RPC and its live
        // replacement can both remain pending in this uncooperative transport.
        await page.waitForFunction(() => window.nexusTest.chatScanCachePending.length > 0);
        await settle();
        await page.evaluate(mode => {
          if (mode === 'hidden') {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
          } else window.dispatchEvent(new Event('blur'));
        }, exitMode);
        await dialog.getByText('Die Auswertung wurde ausgeblendet. Öffne sie erneut, um den aktuellen Stand zu prüfen.', { exact: true }).waitFor();
        await page.evaluate(() => { window.nexusTest.chatScanCacheDeferred = false; window.nexusTest.finishChatScanCacheReads(); });
        await settle();
        assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0, `${exitMode} must suppress a late cached result`);
        await page.evaluate(() => {
          delete document.visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        });
        await settle();
        assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0, 'Regaining focus cannot automatically reveal cached output');
        assert.equal(await scanCount(), afterScan);
        await dialog.getByRole('button', { name: 'Aktuellen Stand prüfen', exact: true }).click();
        await waitResult();
        assert.equal(await scanCount(), afterScan, 'Explicit resume reuses the cache instead of invoking AI');
        await close();
      }
      await page.reload();
      await waitState('Ausgewertet');
      await trigger.click();
      await waitResult();
      assert.equal(await scanCount(), 0, 'Reloading a current cached result never invokes the AI');
      assert.ok(await page.evaluate(() => window.nexusTest.chatScanStateCalls.some(c => c.name === 'get_my_chat_scan_result')));

      // Editing an older source outside the loaded message viewport invalidates
      // the saved result; it never silently starts another billable analysis.
      await changeHistory();
      await waitState('Neue Nachrichten');
      await dialog.getByText('Der Verlauf hat sich geändert. Bitte erneut auswerten.', { exact: true }).waitFor();
      assert.equal(await dialog.getByText('Das vereinbarte Budget beträgt 2.500 Euro.', { exact: true }).count(), 0);
      await waitReady();
      assert.equal(await scanCount(), 0);
      await page.evaluate(() => { window.nexusTest.chatScanFailure = 'provider_error'; });
      await consent();
      await start.click();
      await dialog.getByRole('alert').filter({ hasText: 'Die KI konnte den Chat gerade nicht auswerten. Bitte versuche es erneut.' }).waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await waitState('Neue Nachrichten');
      await page.evaluate(() => { window.nexusTest.chatScanFailure = null; });
      await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await waitResult();
      await waitState('Ausgewertet');
      assert.equal(await scanCount(), 2, 'Only explicit start and explicit retry invoke the AI');
      await close();

      // A second device can finish a chat while an analysis is pending. Its
      // late response is discarded, and reopening cannot reveal that result.
      await changeHistory();
      await waitState('Neue Nachrichten');
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await consent();
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.evaluate(() => { window.nexusTest.setChatDone('direct', 'c1', true); window.dispatchEvent(new Event('focus')); });
      await waitState('Fertig');
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = false; window.nexusTest.finishChatScans(); });
      await settle();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      if (await dialog.isVisible()) await close();
      await reopen.click();
      await waitState('Neue Nachrichten');

      // A done/open cycle on another device advances the opaque revision even
      // if status text ends up unchanged. Its in-flight result must be rejected.
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await consent();
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.evaluate(() => {
        // Simulate a missed realtime event while a second device changes state.
        const emit = window.nexusTest.emit;
        window.nexusTest.emit = () => {};
        window.nexusTest.setChatDone('direct', 'c1', true);
        window.nexusTest.setChatDone('direct', 'c1', false);
        window.nexusTest.emit = emit;
        window.nexusTest.chatScanDeferred = false;
        window.nexusTest.finishChatScans();
      });
      await page.waitForFunction(() => window.nexusTest.chatScanRejections.at(-1) === 'status_changed');
      await waitReady();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await close();

      // A cancelled request, and an older reply from another chat/account, must
      // never repopulate an unrelated dialog with private output.
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanDeferred = true; });
      await consent();
      await start.click();
      await page.waitForFunction(() => window.nexusTest.chatScanPending.length === 1);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await page.evaluate(() => window.nexusTest.chatScanAborts.some(call => call.body.action === 'scan')));
      await page.evaluate(() => {
        window.nexusTest.chatScanDeferred = false;
        window.nexusTest.conversations.push({ conversation_id: 'c2', contact_user_id: 'second', full_name: 'Zweiter Kontakt', username: 'second', unread_count: 0, last_message: 'Neuer Chat' });
      });
      await page.locator('.chat-refresh').click();
      await page.getByRole('button', { name: /Zweiter Kontakt/ }).waitFor();
      await page.evaluate(() => { location.hash = '#/app/chats?conversation=c2'; });
      await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
      await waitState('Offen');
      await trigger.click();
      await waitReady();
      await page.evaluate(() => window.nexusTest.finishChatScans());
      await settle();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await close();
      await markDone.click();
      await waitState('Fertig');
      await page.evaluate(() => window.nexusTest.switchUser('another-user'));
      await waitState('Offen');
      await page.evaluate(() => window.nexusTest.switchUser('me'));
      await waitState('Fertig');
      assert.equal(await page.evaluate(() => window.nexusTest.chatScanState('direct', 'c1').status), 'updated', 'Finishing a different chat must not affect this one');

      // Group workflows remain independently scoped and reuse successful output.
      await page.getByRole('button', { name: 'Gruppen', exact: true }).click();
      await page.locator('.chat-head').getByText('Projektgruppe', { exact: true }).waitFor();
      await waitState('Offen');
      await statusFilter.selectOption({ label: 'Fertig' });
      assert.equal(await page.locator('.chat-list .chat-status-badge').count(), 0);
      await statusFilter.selectOption({ label: 'Offen' });
      await page.locator('.chat-list .chat-status-badge[data-status="open"]').waitFor();
      await statusFilter.selectOption({ label: 'Alle' });
      await trigger.click();
      await waitReady();
      await page.evaluate(() => { window.nexusTest.chatScanFailure = 'provider_error'; });
      await consent();
      await start.click();
      await dialog.getByRole('alert').waitFor();
      await waitState('Offen');
      await page.evaluate(() => { window.nexusTest.chatScanFailure = null; });
      await dialog.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
      await waitResult();
      await waitState('Ausgewertet');
      assert.equal(await page.evaluate(() => window.nexusTest.chatScanCalls.filter(c => c.body.action === 'scan').at(-1).body.kind), 'group');
      const beforeBlur = await scanCount();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await dialog.getByText('Die Auswertung wurde ausgeblendet. Öffne sie erneut, um den aktuellen Stand zu prüfen.', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('heading', { name: 'Zusammenfassung', exact: true }).count(), 0);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await settle();
      assert.equal(await scanCount(), beforeBlur, 'Focus refresh must not invoke the AI');
      await close();

      // State transport failure disables actions rather than assuming open.
      await page.evaluate(() => { window.nexusTest.failure = 'get_my_chat_scan_state'; window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('focus')); });
      await toolbar.waitFor({ state: 'hidden' });
      assert.equal(await trigger.count(), 0, 'Offline saved chats must expose no scan actions');
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
      await toolbar.getByRole('button', { name: 'Chatstatus erneut laden', exact: true }).waitFor();
      assert.equal(await trigger.isEnabled(), false);
      await page.evaluate(() => { window.nexusTest.failure = null; });
      await toolbar.getByRole('button', { name: 'Chatstatus erneut laden', exact: true }).click();
      await waitState('Ausgewertet');
      assert.equal(await scanCount(), beforeBlur);

      // Untrusted model text is inert, including persisted sources. Test on a
      // changed history so this explicit request legitimately needs a new scan.
      await changeHistory('group', 'g1');
      await waitState('Neue Nachrichten');
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
      await consent();
      await start.click();
      await waitResult();
      await dialog.getByText('Quellen anzeigen (1)', { exact: true }).click();
      assert.ok(await dialog.getByText('<img src=x onerror="window.chatScanUnsafe=true">', { exact: true }).count() >= 3);
      assert.equal(await dialog.locator('img').count(), 0);
      assert.equal(await page.evaluate(() => window.chatScanUnsafe), undefined);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Dialog must fit ${width}px width`);
        assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        assert.equal(await dialog.getByRole('button', { name: 'Chat-Auswertung schließen', exact: true }).isVisible(), true);
        await page.screenshot({ path: `browser-results/${name}-chat-scan-mobile-${width}.png`, fullPage: false });
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Chat mit KI auswerten');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const action of [trigger, markDone]) {
          const bounds = await action.boundingBox();
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Both corner actions must fit ${width}px width`);
        }
        await page.screenshot({ path: `browser-results/${name}-chat-status-mobile-${width}.png`, fullPage: false });
      }
      assert.equal(await page.evaluate(() => window.nexusTest.writes), 0);
      assert.deepEqual(errors, []);
      console.log(name + ': personal chat status, done exclusion without AI, explicit reopening, persisted cached results, old-history changes, provider failure, cross-device revision races, cancellation, account/chat isolation, direct/group workflows, focus/offline recovery, inert text and 320/390px keyboard-accessible controls passed');
    } catch (error) {
      await page.screenshot({ path: `browser-results/${name}-chat-scan-failure.png`, fullPage: true });
      console.error('Browser errors:', errors);
      console.error('Test URL:', page.url());
      console.error('Pending scan/cache requests:', await page.evaluate(() => ({ scans: window.nexusTest?.chatScanPending.length, cache: window.nexusTest?.chatScanCachePending.length })));
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 9000));
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally { await server.close(); }
