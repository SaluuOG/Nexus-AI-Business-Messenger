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

const openSearch = async page => {
  const menu = page.getByRole('button', { name: 'Hauptmenü öffnen', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Suche', exact: true }).click();
  await page.getByRole('heading', { name: 'Nachrichten durchsuchen', exact: true }).waitFor();
};

const runSearch = async (page, expectedCount) => {
  const previousCalls = await page.evaluate(() => window.nexusTest.searchCalls.length);
  await page.getByRole('button', { name: 'Nachrichten suchen', exact: true }).click();
  await page.waitForFunction(
    ({ expected, calls }) => window.nexusTest.searchCalls.length > calls
      && document.querySelectorAll('.message-search-result').length === expected,
    { expected: expectedCount, calls: previousCalls },
  );
};

const waitForGlobalMessageSubscription = (page, table) => page.waitForFunction(expectedTable => {
  const expectedChannel = expectedTable === 'direct_messages' ? 'direct-message-list' : 'group-message-list';
  const channels = window.nexusTest.channels.filter(channel => channel.name === expectedChannel && channel.entries.some(entry =>
    entry.filter?.table === expectedTable && entry.filter.filter == null));
  // The development build deliberately remounts effects once in StrictMode.
  // Wait for the surviving generation so the event cannot be delivered to the
  // probe generation immediately before its cleanup.
  return channels.length >= 2 && channels.filter(channel => channel.active).length === 1;
}, table);

const waitForScopedMessageSubscription = (page, channelName, table) => page.waitForFunction(({ expectedChannel, expectedTable }) => {
  const channels = window.nexusTest.channels.filter(channel => channel.name === expectedChannel && channel.entries.some(entry =>
    entry.filter?.table === expectedTable && entry.filter.filter != null));
  return channels.some(channel => channel.active);
}, { expectedChannel: channelName, expectedTable: table });

const noHorizontalOverflow = page => page.evaluate(() => ({
  viewport: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth,
}));

const scenarios = [
  ['received-attachments', async (page, name) => {
    // Real browser media decoding with synthetic bytes; this does not claim
    // Supabase Storage delivery or a recording from a physical microphone.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    const document = Buffer.from('Nexus synthetic attachment\n');
    await page.context().route('https://files.example.invalid/**', route => {
      const url = route.request().url();
      if (url.endsWith('/sample.png')) return route.fulfill({ contentType: 'image/png', body: png });
      if (url.endsWith('/sample.wav')) return route.fulfill({ contentType: 'audio/wav', body: wav });
      if (url.endsWith('/sample.txt')) return route.fulfill({ contentType: 'text/plain', body: document });
      return route.abort();
    });
    await page.goto(`${baseUrl}/#/app/chats?conversation=c1`);
    await page.locator('.messages .message-body').first().waitFor();
    await page.getByRole('button', { name: 'Briefing', exact: true }).click();
    await page.getByRole('heading', { name: 'Dein Tagesbriefing', exact: true }).waitFor();
    for (const kind of ['direct', 'group']) {
      await page.evaluate(({ kind, lengths }) => {
        const row = {
          message_id: `received-${kind}`, sender_id: 'other', body: 'Received attachments',
          sender_full_name: 'Team Kontakt', created_at: new Date().toISOString(),
          deleted_at: null, ...(kind === 'direct' ? { conversation_id: 'c1' } : { group_id: 'g1' }),
          attachments: ['png', 'wav', 'txt'].map((ext, i) => ({
            attachment_id: `received-${kind}-${ext}`, storage_path: `test/${kind}/sample.${ext}`,
            file_name: `sample.${ext}`, mime_type: ['image/png', 'audio/wav', 'text/plain'][i], file_size: lengths[i],
          })),
        };
        (kind === 'direct' ? window.nexusTest.directMessages : window.nexusTest.groupMessages).push(row);
        location.hash = kind === 'direct' ? '#/app/chats?conversation=c1' : '#/app/groups?group=g1';
        window.nexusTest.emit(kind === 'direct' ? 'direct_messages' : 'group_messages', 'INSERT', {
          eventType: 'INSERT', new: { id: row.message_id, ...row }, old: {},
        });
      }, { kind, lengths: [png.length, wav.length, document.length] });
      const received = page.locator(`[data-message-id="received-${kind}"]`);
      await received.waitFor();
      await page.waitForFunction(id => {
        const row = document.querySelector(`[data-message-id="${id}"]`);
        const image = row?.querySelector('img.chat-image'); const audio = row?.querySelector('audio');
        return image?.naturalWidth > 0 && audio?.duration > 0;
      }, `received-${kind}`);
      await received.locator('audio').evaluate(audio => audio.play());
      await page.waitForFunction(id => document.querySelector(`[data-message-id="${id}"] audio`).currentTime > 0, `received-${kind}`);
      await received.locator('audio').evaluate(audio => audio.pause());
      // Signed URLs are cross-origin: browsers may open inline files in a new
      // tab instead of honoring the download attribute. Check the visible file.
      const openedPending = page.waitForEvent('popup');
      await received.getByRole('link', { name: /sample.txt/ }).click();
      const opened = await openedPending;
      await opened.waitForLoadState('domcontentloaded');
      assert.equal((await opened.locator('body').innerText()).trim(), document.toString('utf8').trim());
      await opened.close();
    }
    console.log(`${name}: direct/group received image decoding, audio playback and file opening passed (synthetic media)`);
  }],
  ['history-and-delivery', async (page, name) => {
    const directComposer = page.locator('[data-testid="direct-message-composer"]');
    const directMessageCount = count => page.waitForFunction(
      expected => document.querySelectorAll('.message-wrap[data-message-id]').length === expected,
      count,
    );
    const waitForDirectDraft = value => page.waitForFunction(
      expected => document.querySelector('[data-testid="direct-message-composer"]')?.value === expected,
      value,
    );

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

    // UPDATE events for rows outside the newest 100-message page reconcile
    // edits and logical deletes without resetting pagination or presenting the
    // change as a newly arrived message.
    await waitForScopedMessageSubscription(page, 'direct-conversation:c1', 'direct_messages');
    let delivered = await page.evaluate(() => {
      const message = window.nexusTest.directMessages.find(item => item.message_id === 'dm-history-008');
      message.body = 'Ältere Direktnachricht live bearbeitet';
      message.edited_at = '2026-03-10T12:00:00.000Z';
      return window.nexusTest.emit('direct_messages', 'UPDATE', {
        eventType: 'UPDATE',
        new: { conversation_id: 'c1', id: message.message_id },
        old: { conversation_id: 'c1', id: message.message_id },
      });
    });
    assert.ok(delivered > 0, 'The selected direct chat must receive the old-message UPDATE');
    const oldDirectMessage = page.locator('[data-message-id="dm-history-008"]');
    await oldDirectMessage.getByText('Ältere Direktnachricht live bearbeitet', { exact: true }).waitFor();
    await oldDirectMessage.getByText('bearbeitet', { exact: true }).waitFor();
    assert.equal(await page.locator('.messages-history-button').count(), 0,
      'A targeted UPDATE must not reset the loaded history page');
    assert.equal(await page.locator('.newer-messages-notice').count(), 0,
      'Editing an old loaded message must not be presented as a new message');

    delivered = await page.evaluate(() => {
      const message = window.nexusTest.directMessages.find(item => item.message_id === 'dm-history-008');
      message.deleted_at = '2026-03-10T12:01:00.000Z';
      return window.nexusTest.emit('direct_messages', 'UPDATE', {
        eventType: 'UPDATE',
        new: { conversation_id: 'c1', id: message.message_id },
        old: { conversation_id: 'c1', id: message.message_id },
      });
    });
    assert.ok(delivered > 0, 'The selected direct chat must receive the logical delete UPDATE');
    await oldDirectMessage.getByText('Nachricht gelöscht', { exact: true }).waitFor();

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

    // A signal for a different chat updates its list preview without opening it.
    await waitForGlobalMessageSubscription(page, 'direct_messages');
    await page.evaluate(() => {
      const chat = window.nexusTest.conversations.find(item => item.conversation_id === 'c1');
      chat.last_message = 'Live-Vorschau aus anderem Chat';
      chat.last_message_at = '2026-03-11T09:00:00.000Z';
      window.nexusTest.emit('direct_messages', 'INSERT', {
        new: { conversation_id: 'c1', id: 'remote-direct' }, old: null,
      });
    });
    await page.locator('.chat').filter({ hasText: 'Test Kontakt' }).getByText('Live-Vorschau aus anderem Chat', { exact: true }).waitFor();

    // A lost text response creates exactly one manual retry and reuses the same UUID.
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

    // Failed binary uploads stay outside the retry mechanism and never run again.
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
    console.log(`${name}: isolated history, drafts, live direct list, retry and binary no-retry passed`);
  }],
  ['direct-search-and-mobile', async (page, name) => {
    await page.goto(`${baseUrl}/#/app/chats`);
    await page.locator('.chat-head').getByText('Test Kontakt', { exact: true }).waitFor();
    await openSearch(page);
    await page.locator('#message-search-query').fill('Meilenstein');
    await runSearch(page, 3);
    assert.equal(await page.locator('.message-search-result').count(), 3);

    await page.getByLabel('Chat-Art', { exact: true }).selectOption('direct');
    await page.getByLabel('Gespräch oder Person', { exact: true }).fill('Test Kontakt');
    await runSearch(page, 1);
    assert.equal(await page.locator('.message-search-result').count(), 1);
    const directResult = page.locator('.message-search-result').filter({ hasText: 'Meilenstein Direkt vertraulich' });
    // The message context may finish before the cached chat list mounts the
    // conversation pane. It must still scroll to and highlight the result.
    await page.evaluate(() => { window.nexusTest.directChatListDelay = 300; });
    await directResult.locator('.message-search-open').click();
    const anchoredDirect = page.locator('[data-message-id="dm-history-008"][aria-current="true"]');
    await anchoredDirect.waitFor();
    assert.ok(await anchoredDirect.evaluate(element => element.classList.contains('message-anchor-highlight')),
      'The exact direct-search result must be highlighted');
    await page.locator('.newer-messages-notice').waitFor();
    assert.match(page.url(), /#\/app\/chats\?conversation=c1&message=dm-history-008$/);

    console.log(`${name}: isolated direct search, deep-link and highlight passed`);
  }],
  ...[390, 320].map(width => [`direct-mobile-${width}`, async (page, name) => {
    // Create each browser at the target device width. Resizing a live WebKit
    // renderer while its anchored history is settling can crash that renderer;
    // a fresh viewport still exercises the actual responsive page and controls.
    await page.goto(`${baseUrl}/#/app/chats?conversation=c1&message=dm-history-008`);
    await page.locator('[data-message-id="dm-history-008"][aria-current="true"]').waitFor();
    let dimensions = await noHorizontalOverflow(page);
    assert.equal(dimensions.viewport, width);
    assert.ok(Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= width + 1,
      `Direct chat overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: `browser-results/${name}-message-history-chat-${width}.png`, fullPage: false });
    await openSearch(page);
    dimensions = await noHorizontalOverflow(page);
    assert.ok(Math.max(dimensions.documentWidth, dimensions.bodyWidth) <= width + 1,
      `Search overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    const bounds = await page.locator('.message-search-form').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      `Search form does not fit ${width}px`);
    await page.screenshot({ path: `browser-results/${name}-message-search-${width}.png`, fullPage: false });
    console.log(`${name}: isolated ${width}px direct chat and search layouts passed`);
  }, { width, height: 844 }]),
  ['retired-direct-subscriptions', async (page, name) => {
    // Start directly at the anchored history view so retired-callback checks
    // do not depend on the search and mobile-layout scenario's renderer state.
    await page.goto(`${baseUrl}/#/app/chats?conversation=c1&message=dm-history-008`);
    await page.locator('[data-message-id="dm-history-008"][aria-current="true"]').waitFor();
    await waitForScopedMessageSubscription(page, 'direct-conversation:c1', 'direct_messages');

    // A read callback retained by the previous channel must become inert as
    // soon as another chat is selected. Without the scope + generation guard,
    // its delayed refresh supersedes the new chat request and leaves c2 empty
    // in a permanent loading state.
    await page.evaluate(() => {
      window.nexusTest.directMessageDelay = 350;
      location.hash = '#/app/chats?conversation=c2';
    });
    await page.locator('.chat-head').getByText('Zweiter Kontakt', { exact: true }).waitFor();
    await waitForScopedMessageSubscription(page, 'direct-conversation:c2', 'direct_messages');
    const staleReadDelivered = await page.evaluate(() => {
      const oldChannel = window.nexusTest.channels.find(channel => channel.name === 'direct-conversation:c1' && !channel.active);
      const entry = oldChannel?.entries.find(item => item.filter.table === 'direct_conversation_reads');
      entry?.callback({
        eventType: 'UPDATE',
        new: { conversation_id: 'c1', user_id: 'other' },
        old: { conversation_id: 'c1', user_id: 'other' },
      });
      return Boolean(entry);
    });
    assert.equal(staleReadDelivered, true, 'The regression fixture must retain the retired read callback');
    await page.locator('[data-message-id="dm-second-search"]').waitFor();
    await page.evaluate(() => { window.nexusTest.directMessageDelay = 0; });
    assert.equal(await page.getByText('Nachrichten werden geladen…', { exact: true }).count(), 0,
      'The selected chat must not remain empty/loading after a retired read callback');

    // The retired message callback is covered separately because it also
    // invalidates the scan revision when it is allowed to cross chat scope.
    const newerNoticeCountBeforeStaleCallback = await page.locator('.newer-messages-notice').count();
    const scanCallsBeforeStaleCallback = await page.evaluate(() => window.nexusTest.chatScanStateCalls.filter(call => (
      call.name === 'get_my_chat_scan_state' && call.args.p_chat_id === 'c2'
    )).length);
    const staleCallbackDelivered = await page.evaluate(() => {
      const oldChannel = window.nexusTest.channels.find(channel => channel.name === 'direct-conversation:c1' && !channel.active);
      const entry = oldChannel?.entries.find(item => item.filter.table === 'direct_messages' && item.filter.event === 'INSERT');
      entry?.callback({
        eventType: 'INSERT',
        new: { conversation_id: 'c1', id: 'stale-c1-event' },
        old: {},
      });
      return Boolean(entry);
    });
    assert.equal(staleCallbackDelivered, true, 'The regression fixture must retain the retired channel callback');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.newer-messages-notice').count(), newerNoticeCountBeforeStaleCallback,
      'A retired chat callback must not mutate the newly selected chat');
    assert.equal(await page.evaluate(() => window.nexusTest.chatScanStateCalls.filter(call => (
      call.name === 'get_my_chat_scan_state' && call.args.p_chat_id === 'c2'
    )).length), scanCallsBeforeStaleCallback,
    'A retired chat callback must not invalidate the newly selected chat scan');

    console.log(`${name}: isolated retired direct read/message callbacks preserve the new chat and scan state`);
  }],
  ['group-search-and-live-list', async (page, name) => {
    await page.goto(`${baseUrl}/#/app/search`);
    await page.getByRole('heading', { name: 'Nachrichten durchsuchen', exact: true }).waitFor();
    await page.locator('#message-search-query').fill('Meilenstein');
    await page.getByLabel('Chat-Art', { exact: true }).selectOption('group');
    await runSearch(page, 1);
    assert.equal(await page.locator('.message-search-result').count(), 1);
    await page.locator('.message-search-result').getByText('Meilenstein Gruppe vertraulich', { exact: true }).waitFor();

    // Inclusive date boundaries keep the group result on both edges.
    await page.getByLabel('Chat-Art', { exact: true }).selectOption('all');
    await page.getByLabel('Von', { exact: true }).fill('2026-02-01');
    await page.getByLabel('Bis', { exact: true }).fill('2026-02-28');
    await runSearch(page, 1);
    assert.equal(await page.locator('.message-search-result').count(), 1);
    const groupResult = page.locator('.message-search-result').filter({ hasText: 'Meilenstein Gruppe vertraulich' });
    await groupResult.locator('.message-search-open').click();
    await page.locator('[data-message-id="gm-search-anchor"][data-highlighted="true"]').waitFor({ state: 'attached' });
    assert.match(page.url(), /#\/app\/groups\?group=g1&message=gm-search-anchor$/);

    // The exact loaded group row is reconciled even when the user is viewing
    // an older search context. This becomes an out-of-latest-page regression
    // as soon as the group fixture contains more than one page of messages.
    await waitForScopedMessageSubscription(page, 'group-chat:g1', 'group_messages');
    let delivered = await page.evaluate(() => {
      const message = window.nexusTest.groupMessages.find(item => item.message_id === 'gm-search-anchor');
      message.body = 'Ältere Gruppennachricht live bearbeitet';
      message.edited_at = '2026-03-12T11:00:00.000Z';
      return window.nexusTest.emit('group_messages', 'UPDATE', {
        eventType: 'UPDATE',
        new: { group_id: 'g1', id: message.message_id },
        old: { group_id: 'g1', id: message.message_id },
      });
    });
    assert.ok(delivered > 0, 'The selected group must receive the old-message UPDATE');
    const oldGroupMessage = page.locator('[data-message-id="gm-search-anchor"]');
    await oldGroupMessage.getByText('Ältere Gruppennachricht live bearbeitet', { exact: true }).waitFor();
    await oldGroupMessage.getByText('bearbeitet', { exact: true }).waitFor();

    delivered = await page.evaluate(() => {
      const message = window.nexusTest.groupMessages.find(item => item.message_id === 'gm-search-anchor');
      message.deleted_at = '2026-03-12T11:01:00.000Z';
      return window.nexusTest.emit('group_messages', 'UPDATE', {
        eventType: 'UPDATE',
        new: { group_id: 'g1', id: message.message_id },
        old: { group_id: 'g1', id: message.message_id },
      });
    });
    assert.ok(delivered > 0, 'The selected group must receive the logical delete UPDATE');
    await oldGroupMessage.getByText('Nachricht gelöscht', { exact: true }).waitFor();

    // A retained members callback from g1 must not win a delayed group-list
    // race after g2 has become current. It previously selected g1 again and
    // could leave the new group empty/loading.
    await page.evaluate(() => { window.nexusTest.groupChatListDelay = 350; });
    await page.locator('.chat').filter({ hasText: 'Zweite Gruppe' }).click();
    await page.locator('.chat-head').getByText('Zweite Gruppe', { exact: true }).waitFor();
    await waitForScopedMessageSubscription(page, 'group-chat:g2', 'group_messages');
    const staleMembersDelivered = await page.evaluate(() => {
      const oldChannel = window.nexusTest.channels.find(channel => channel.name === 'group-chat:g1' && !channel.active);
      const entry = oldChannel?.entries.find(item => item.filter.table === 'group_members');
      entry?.callback({
        eventType: 'UPDATE',
        new: { group_id: 'g1', user_id: 'other' },
        old: { group_id: 'g1', user_id: 'other' },
      });
      return Boolean(entry);
    });
    assert.equal(staleMembersDelivered, true, 'The regression fixture must retain the retired members callback');
    await page.evaluate(() => { window.nexusTest.groupChatListDelay = 0; });
    await page.waitForTimeout(500);
    await page.locator('[data-message-id="gm-second"]').waitFor();
    assert.match(page.url(), /#\/app\/groups\?group=g2$/);
    await page.locator('.chat-head').getByText('Zweite Gruppe', { exact: true }).waitFor();
    assert.equal(await page.getByText('Gruppennachrichten werden geladen…', { exact: true }).count(), 0,
      'The selected group must not remain empty/loading after a retired members callback');

    // Return to g1 so the global-list regression below still exercises a
    // message arriving in a non-selected group.
    await page.locator('.chat').filter({ hasText: 'Projektgruppe' }).click();
    await page.locator('.chat-head').getByText('Projektgruppe', { exact: true }).waitFor();

    // The group list also reacts to a message in a non-selected group.
    await waitForGlobalMessageSubscription(page, 'group_messages');
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
    console.log(`${name}: isolated group search, inclusive dates, deep-link, highlight and live list passed`);
  }],
];

const runIsolatedScenario = async (name, engine, scenarioName, scenario, viewport = { width: 1440, height: 1000 }) => {
  const browser = await engine.launch();
  const context = await browser.newContext({
    viewport,
    timezoneId: 'Europe/Berlin',
  });
  await context.route('**/*', route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
  await context.addInitScript(() => sessionStorage.setItem('nexusTest.messageHistoryFixture', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => console.error(`${name}/${scenarioName}: browser renderer crashed`));

  try {
    await scenario(page, name);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(`${name}/${scenarioName} browser errors:`, errors);
    try {
      console.error('Test URL:', page.url());
      console.error('Test UI:', (await page.locator('body').innerText()).slice(0, 9000));
    } catch (diagnosticError) {
      console.error('Failure page state unavailable:', diagnosticError instanceof Error ? diagnosticError.message : diagnosticError);
    }
    try {
      await page.screenshot({ path: `browser-results/${name}-${scenarioName}-failure.png`, fullPage: false });
    } catch (diagnosticError) {
      console.error('Failure screenshot unavailable:', diagnosticError instanceof Error ? diagnosticError.message : diagnosticError);
    }
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
};

try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    for (const [scenarioName, scenario, viewport] of scenarios) {
      // A fresh browser process per scenario prevents renderer state from the
      // 130-message history flow leaking into later WebKit navigation/screenshots.
      await runIsolatedScenario(name, engine, scenarioName, scenario, viewport);
    }
    console.log(`${name}: all isolated Phase 3.7 message-history scenarios passed`);
  }
} finally {
  await server.close();
}
