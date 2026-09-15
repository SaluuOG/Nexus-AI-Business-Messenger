import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Chat drafts and failed text retries stay safe and account scoped', async t => {
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const rows = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => rows.get(key) ?? null,
      setItem: (key, value) => rows.set(key, value),
      removeItem: key => rows.delete(key),
    },
  });

  try {
    const drafts = await server.ssrLoadModule('/src/features/drafts/chatDrafts.ts');
    const retries = await server.ssrLoadModule('/src/features/drafts/textSendRetry.ts');
    const directA = { userId: 'account-a', kind: 'direct', chatId: 'same-chat' };
    const directB = { userId: 'account-b', kind: 'direct', chatId: 'same-chat' };
    const groupA = { userId: 'account-a', kind: 'group', chatId: 'same-chat' };

    await t.test('Text persists per account, chat and chat kind, then clears after success', () => {
      assert.equal(drafts.saveChatDraft(directA, 'Entwurf A'), true);
      assert.equal(drafts.saveChatDraft(directB, 'Entwurf B'), true);
      assert.equal(drafts.saveChatDraft(groupA, 'Gruppenentwurf'), true);
      assert.equal(drafts.readChatDraft(directA), 'Entwurf A');
      assert.equal(drafts.readChatDraft(directB), 'Entwurf B');
      assert.equal(drafts.readChatDraft(groupA), 'Gruppenentwurf');

      assert.equal(drafts.clearChatDraftAfterSuccessfulSend(directA), true);
      assert.equal(drafts.readChatDraft(directA), '');
      assert.equal(drafts.readChatDraft(directB), 'Entwurf B');
      assert.equal(drafts.readChatDraft(groupA), 'Gruppenentwurf');
      assert.equal(drafts.saveChatDraft(directB, ''), true);
      assert.equal(drafts.readChatDraft(directB), '');
    });

    await t.test('Drafts are capped at 5,000 characters without cutting an emoji in half', () => {
      const oversized = 'x'.repeat(4999) + '🚀' + 'tail';
      const normalized = drafts.normalizeChatDraftText(oversized);
      assert.equal(normalized, 'x'.repeat(4999));
      assert.ok(normalized.length <= drafts.MAX_CHAT_DRAFT_LENGTH);
      assert.equal(drafts.saveChatDraft(directA, 'y'.repeat(6000)), true);
      assert.equal(drafts.readChatDraft(directA).length, 5000);
    });

    await t.test('Missing, corrupt and blocked storage fail closed without breaking the composer', () => {
      assert.equal(drafts.readChatDraft({ userId: '', kind: 'direct', chatId: 'x' }), '');
      assert.equal(drafts.saveChatDraft({ userId: '', kind: 'direct', chatId: 'x' }, 'private'), false);
      const key = drafts.chatDraftStorageKey(directA);
      rows.set(key, '{broken json');
      assert.equal(drafts.readChatDraft(directA), '');
      assert.equal(rows.has(key), false);

      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      assert.equal(drafts.readChatDraft(directA), '');
      assert.equal(drafts.saveChatDraft(directA, 'not saved'), false);
      assert.equal(drafts.clearChatDraft(directA), false);
    });

    await t.test('Retries are text-only, in-memory and require one explicit retry acquisition', () => {
      let storageTouches = 0;
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { storageTouches += 1; throw new Error('must stay in memory'); } });
      let timestamp = 1_000;
      const store = retries.createTextSendRetryStore(() => timestamp++);
      assert.match(retries.createTextClientRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      const requestId = '11111111-1111-4111-8111-111111111111';
      assert.equal(store.rememberFailure(directA, { name: 'voice-message.webm' }, requestId), null, 'binary payloads are never retained');
      const first = store.rememberFailure(directA, 'Bitte erneut senden', requestId);
      assert.ok(first);
      assert.equal(first.attempt, 0);
      assert.equal(first.text, 'Bitte erneut senden');
      assert.equal(first.clientRequestId, requestId, 'the initial request id survives a lost response and every retry');
      assert.equal(store.get(directB), null, 'another account cannot see the retry');
      assert.equal(store.get(groupA), null, 'a group with the same id cannot see it');

      assert.equal(store.rememberFailure(directA, 'Bitte erneut senden', requestId).id, first.id, 'duplicate failure callbacks are deduplicated');
      const acquired = store.beginRetry(directA, first.id);
      assert.equal(acquired.attempt, 1);
      assert.equal(store.get(directA).status, 'retrying');
      assert.equal(store.beginRetry(directA, first.id), null, 'a retry cannot be acquired twice');
      assert.equal(store.rememberFailure(directA, 'Eine andere Nachricht', '22222222-2222-4222-8222-222222222222'), null, 'an in-flight retry is never overwritten');

      assert.equal(store.finishRetry(directA, first.id, false), true);
      assert.equal(store.get(directA).status, 'ready');
      assert.equal(store.beginRetry(directA, first.id).attempt, 2);
      assert.equal(store.finishRetry(directA, first.id, true), true);
      assert.equal(store.get(directA), null);
      assert.equal(storageTouches, 0, 'retry state never reaches browser persistence');
    });

    await t.test('Retry text is bounded and retry state can be discarded per chat or account', () => {
      const store = retries.createTextSendRetryStore(() => 2_000);
      assert.equal(store.rememberFailure(directA, '   ', '33333333-3333-4333-8333-333333333333'), null);
      assert.equal(store.rememberFailure(directA, 'text', 'not-a-uuid'), null);
      const a = store.rememberFailure(directA, 'z'.repeat(6000), '33333333-3333-4333-8333-333333333333');
      const b = store.rememberFailure(directB, 'B', '44444444-4444-4444-8444-444444444444');
      assert.equal(a.text.length, 5000);
      assert.equal(store.discard(directA, 'wrong-id'), false);
      assert.equal(store.discard(directA, a.id), true);
      assert.equal(store.get(directA), null);
      assert.ok(store.get(directB));
      store.clearUser('account-b');
      assert.equal(store.get(directB), null);
      assert.equal(store.discard(groupA), false);
      assert.ok(b);
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
    await server.close();
  }
});
