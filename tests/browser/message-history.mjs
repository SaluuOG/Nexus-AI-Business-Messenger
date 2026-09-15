import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium, webkit } = await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const baseUrl = 'http://127.0.0.1:4180';
const server = await createServer({
  root,
  configFile: false,
  base: '/',
  server: { host: '127.0.0.1', port: 4180, strictPort: true, hmr: false },
  plugins: [{
    name: 'message-history-browser-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
    },
  }],
});

await server.listen();
await mkdir('browser-results', { recursive: true });

try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Europe/Berlin',
    });
    await context.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => sessionStorage.setItem('nexusTest.messageHistoryFixture', '1'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const directComposer = page.locator('[data-testid="direct-message-composer"]');
    const directMessageCount = count => page.waitForFunction(
      expected => document.querySelectorAll('.message-wrap[data-message-id]').length === expected,
      count,
    );
    const waitForDirectDraft = value => page.waitForFunction(
      expected => document.querySelector('[data-testid="direct-message-composer"]')?.value === expected,
      value,
    );
    const openSearch = async () => {
      await page.getByRole('button', { name: 'Suche', exact: true }).click();
      await page.getByRole('heading', { name: 'Nachrichten durchsuchen', exact: true }).waitFor();
    };
    const runSearch = async expectedCount => {
      const previousCalls = await page.evaluate(() => window.nexusTest.searchCalls.length);
      await page.getByRole('button', { name: 'Nachrichten suchen', exact: true }).click();
      await page.waitForFunction(
        ({ expected, calls }) => window.nexusTest.searchCalls.length > calls
          && document.querySelectorAll('.message-search-result').length === expected,
        { expected: expectedCount, calls: previousCalls },
      );
    };
    const waitForGlobalMessageSubscription = table => page.waitForFunction(expectedTable => {
      const expectedChannel = expectedTable === 'direct_messages' ? 'direct-message-list' : 'group-message-list';
      const channels = window.nexusTest.channels.filter(channel => channel.name === expectedChannel && channel.entries.some(entry =>
        entry.filter?.table === expectedTable && entry.filter.filter == null));
      // The development build deliberately remounts effects once in StrictMode.
      // Wait for the surviving generation so the event cannot be delivered to
      // the probe generation immediately before its cleanup.
      return channels.length >= 2 && channels.filter(channel => channel.active).length === 1;
    }, table);
    const noHorizontalOverflow = () => page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));

    try {
      await page.goto(`${baseUrl}/#/app/chats`);
      await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
      await directMessageCount(100);

      // Keyset history prepends older messages and keeps the same visible
      // content anchored instead of jumping to the oldest row or the bottom.
      const messages = page.locator('.conversation .messages');
      const loadOlder = page.locator('.messages-history-button');
      await loadOlder.waitFor();
      await messages.evaluate(element => { element.scrollTop = 0; });
      const beforeHistory = await messages.evaluate(element => ({
        top: element.scrollTop,
        height: element.scrollHeight,
        viewport: element.clientHeight,
      }));
      await loadOlder.click();
      await directMessageCount(130);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const afterHistory = await messages.evaluate(element => ({
        top: element.scrollTop,
        height: element.scrollHeight,
        viewport: element.clientHeight,
      }));
      const insertedHeight = afterHistory.height - beforeHistory.height;
      assert.ok(insertedHeight > 0, 'Loading older messages must prepend real history');
      assert.ok(Math.abs((afterHistory.top - beforeHistory.top) - insertedHeight) < 20,
        `The visible history anchor moved (${JSON.stringify({ beforeHistory, afterHistory })})`);
      assert.ok(afterHistory.top + afterHistory.viewport < afterHistory.height - 20,
        'Loading older messages must not force the viewport to the bottom');

      // Drafts follow account + chat, survive switching and a full reload, and
      // are not mixed between two conversations.
      await directComposer.fill('Entwurf im ersten Chat');
      await page.locator('.chat').filter({ hasText: 'Zweiter Kontakt' }).click();
      await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
      await directComposer.fill('Entwurf im zweiten Chat');
      await page.locator('.chat').filter({ hasText: 'Test Kontakt' }).click();
      await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
      await waitForDirectDraft('Entwurf im ersten Chat');
      assert.equal(await directComposer.inputValue(), 'Entwurf im ersten Chat');
      await page.evaluate(() => { location.hash = '#/app/chats?conversation=c2'; });
      await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
      await waitForDirectDraft('Entwurf im zweiten Chat');
      assert.equal(await directComposer.inputValue(), 'Entwurf im zweiten Chat');
      await page.reload();
      await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
      await waitForDirectDraft('Entwurf im zweiten Chat');
      assert.equal(await directComposer.inputValue(), 'Entwurf im zweiten Chat');

      // A signal for a different chat updates its list preview without opening
      // it. Filter-aware fixture dispatch prevents the selected-chat channel
      // from accidentally satisfying this assertion.
      await waitForGlobalMessageSubscription('direct_messages');
      await page.evaluate(() => {
        const chat = window.nexusTest.conversations.find(item => item.conversation_id === 'c1');
        chat.last_message = 'Live-Vorschau aus anderem Chat';
        chat.last_message_at = '2026-03-11T09:00:00.000Z';
        window.nexusTest.emit('direct_messages', 'INSERT', {
          new: { conversation_id: 'c1', id: 'remote-direct' }, old: null,
        });
      });
      await page.locator('.chat').filter({ hasText: 'Test Kontakt' }).getByText('Live-Vorschau aus anderem Chat', { exact: true }).waitFor();

      // A lost text response creates exactly one manual retry. The same request
      // UUID is reused, so the simulated committed message is never duplicated.
      await page.evaluate(() => { location.hash = '#/app/chats?conversation=c1'; });
      await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
      await directComposer.fill('Nur einmal senden');
      await page.evaluate(() => { window.nexusTest.loseTextSendResponse = true; });
      await directComposer.press('Enter');
      const retry = page.locator('.text-send-retry');
      await retry.waitFor();
      assert.deepEqual(await page.evaluate(() => ({
        calls: window.nexusTest.textSendCalls.length,
        writes: window.nexusTest.textSendWrites,
      })), { calls: 1, writes: 1 });
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.nexusTest.textSendCalls.length), 1,
        'Text must never retry without the explicit retry button');
      await retry.locator('[data-action="retry-text-send"]').click();
      await retry.waitFor({ state: 'hidden' });
      const sendState = await page.evaluate(() => ({
        calls: window.nexusTest.textSendCalls.length,
        writes: window.nexusTest.textSendWrites,
        ids: window.nexusTest.textSendCalls.map(call => call.args.p_client_request_id),
        stored: window.nexusTest.directMessages.filter(message => message.body === 'Nur einmal senden').length,
      }));
      assert.equal(sendState.calls, 2);
      assert.equal(sendState.writes, 1);
      assert.equal(sendState.stored, 1);
      assert.equal(sendState.ids[0], sendState.ids[1], 'Manual retry must reuse its idempotency UUID');

      // Failed binary uploads stay outside the text retry mechanism and are not
      // retained or retried in the background.
      await page.evaluate(() => { window.nexusTest.failAttachmentUpload = true; });
      await page.locator('.attachment-file-input').setInputFiles({
        name: 'beleg.pdf', mimeType: 'application/pdf', buffer: Buffer.from('test-only'),
      });
      await page.locator('.pending-attachment').getByText('beleg.pdf', { exact: true }).waitFor();
      await page.locator('.attachment-composer > button').last().click();
      await page.locator('.chat-error').getByText(/Upload fehlgeschlagen: Simulierter Uploadfehler/).waitFor();
      assert.equal(await page.locator('.text-send-retry').count(), 0);
      assert.equal(await page.evaluate(() => window.nexusTest.uploadCalls.length), 1);
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.nexusTest.uploadCalls.length), 1,
        'Files and audio must never be uploaded again automatically');

      // Global server-side search: all kinds, type filter, inclusive date
      // boundaries and conversation/person scope.
      await openSearch();
      await page.locator('#message-search-query').fill('Meilenstein');
      await runSearch(3);
      assert.equal(await page.locator('.message-search-result').count(), 3);

      await page.getByLabel('Chat-Art', { exact: true }).selectOption('group');
      await runSearch(1);
      assert.equal(await page.locator('.message-search-result').count(), 1);
      await page.locator('.message-search-result').getByText('Meilenstein Gruppe vertraulich', { exact: true }).waitFor();

      await page.getByLabel('Chat-Art', { exact: true }).selectOption('all');
      await page.getByLabel('Von', { exact: true }).fill('2026-02-01');
      await page.getByLabel('Bis', { exact: true }).fill('2026-02-28');
      await runSearch(1);
      assert.equal(await page.locator('.message-search-result').count(), 1);
      const groupResult = page.locator('.message-search-result').filter({ hasText: 'Meilenstein Gruppe vertraulich' });
      await groupResult.locator('.message-search-open').click();
      await page.locator('[data-message-id="gm-search-anchor"][data-highlighted="true"]').waitFor();
      assert.match(page.url(), /#\/app\/groups\?group=g1&message=gm-search-anchor$/);

      // The group list also reacts to a message in a non-selected group.
      await waitForGlobalMessageSubscription('group_messages');
      const previousGroupListLoads = await page.evaluate(() => window.nexusTest.groupChatListLoads);
      const deliveredGroupEvents = await page.evaluate(() => {
        const group = window.nexusTest.groupChats.find(item => item.group_id === 'g2');
        group.last_message = 'Live-Vorschau aus anderer Gruppe';
        group.last_message_at = '2026-03-12T09:00:00.000Z';
        return window.nexusTest.emit('group_messages', 'INSERT', {
          new: { group_id: 'g2', id: 'remote-group' }, old: null,
        });
      });
      assert.ok(deliveredGroupEvents > 0, 'The active group list channel must receive the realtime event');
      await page.waitForFunction(previous => window.nexusTest.groupChatListLoads > previous, previousGroupListLoads);
      await page.locator('.chat').filter({ hasText: 'Zweite Gruppe' }).getByText('Live-Vorschau aus anderer Gruppe', { exact: true }).waitFor();

      await openSearch();
      await page.locator('#message-search-query').fill('Meilenstein');
      await page.getByLabel('Chat-Art', { exact: true }).selectOption('direct');
      await page.getByLabel('Gespräch oder Person', { exact: true }).fill('Test Kontakt');
      await runSearch(1);
      assert.equal(await page.locator('.message-search-result').count(), 1);
      const directResult = page.locator('.message-search-result').filter({ hasText: 'Meilenstein Direkt vertraulich' });
      await directResult.locator('.message-search-open').click();
      const anchoredDirect = page.locator('[data-message-id="dm-history-008"]');
      await anchoredDirect.waitFor();
      assert.ok(await anchoredDirect.evaluate(element => element.classList.contains('message-anchor-highlight')),
        'The exact direct-search result must be highlighted');
      await page.locator('.newer-messages-notice').waitFor();
      assert.match(page.url(), /#\/app\/chats\?conversation=c1&message=dm-history-008$/);

      // Both common phone widths must remain operable without horizontal page
      // overflow on the dense search form and exact-message chat view.
      await page.setViewportSize({ width: 390, height: 844 });
      let dimensions = await noHorizontalOverflow();
      assert.ok(Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= dimensions.viewport + 1, JSON.stringify(dimensions));
      await page.screenshot({ path: `browser-results/${name}-message-history-mobile-chat.png`, fullPage: true });
      await openSearch();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        dimensions = await noHorizontalOverflow();
        assert.ok(Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= dimensions.viewport + 1,
          `Search overflows at ${width}px: ${JSON.stringify(dimensions)}`);
        const bounds = await page.locator('.message-search-form').boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          `Search form does not fit ${width}px`);
      }
      await page.screenshot({ path: `browser-results/${name}-message-search-320.png`, fullPage: true });

      assert.deepEqual(errors, []);
      console.log(`${name}: history anchoring, scoped drafts, idempotent retry, binary no-retry, global search/deep-links, exact highlights, live lists and 390/320px layouts passed`);
    } catch (error) {
      console.error('Browser errors:', errors);
      try {
        console.error('Test URL:', page.url());
        console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 9000));
      } catch (diagnosticError) {
        console.error('Failure page state unavailable:', diagnosticError instanceof Error ? diagnosticError.message : diagnosticError);
      }
      try {
        await page.screenshot({ path: `browser-results/${name}-message-history-failure.png`, fullPage: false });
      } catch (diagnosticError) {
        console.error('Failure screenshot unavailable:', diagnosticError instanceof Error ? diagnosticError.message : diagnosticError);
      }
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
}
