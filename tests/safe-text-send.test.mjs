import test from 'node:test';
import assert from 'node:assert/strict';
import { safeTextSend } from '../src/features/drafts/safeTextSend.ts';
test('offline never submits and returns a recoverable failure', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  try { const result = await safeTextSend(() => assert.fail('must not send')); assert.match(result.error.message, /Text bleibt/); }
  finally { delete navigator.onLine; }
});
test('unexpected network rejection is recoverable, sanitised, and never automatically retried', async () => {
  let calls = 0;
  const result = await safeTextSend(async () => { calls++; throw new Error('private request'); });
  assert.equal(calls, 1); assert.equal(result.data, null); assert.match(result.error.message, /Erneut senden/); assert.ok(!result.error.message.includes('private'));
});
test('preserves server acknowledgement and permission errors', async () => {
  for (const expected of [{ data: 'message-id', error: null }, { data: null, error: { message: 'Kein Zugriff' } }]) assert.equal(await safeTextSend(async () => expected), expected);
});
