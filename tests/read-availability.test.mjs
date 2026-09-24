import assert from 'node:assert/strict';
import test from 'node:test';
import { readChatList, readableLoadError } from '../src/features/connection/readAvailability.ts';
test('offline list load is unavailable rather than successful empty', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  try { assert.ok((await readChatList(() => assert.fail('offline request'))).error); }
  finally { delete navigator.onLine; }
});
test('thrown and returned network errors are readable; access errors remain meaningful', async () => {
  const thrown = await readChatList(async () => { throw new TypeError('Load failed'); });
  assert.ok(thrown.error); assert.ok(!thrown.error.includes('TypeError'));
  assert.equal(readableLoadError('TypeError: Load failed'), thrown.error);
  assert.equal(readableLoadError('Kein Zugriff auf diese Gruppe.'), 'Kein Zugriff auf diese Gruppe.');
});
test('successful empty list is distinguishable from failure', async () => {
  assert.deepEqual(await readChatList(async () => ({ data: [], error: null })), { data: [], error: null });
});
