import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAuthHandler, NATIVE_AUTH_REDIRECT, parseNativeAuthLink } from '../src/features/auth/nativeAuthLink.ts';

test('native auth callback accepts only its registered URL and token fragment', () => {
  const link = parseNativeAuthLink(`${NATIVE_AUTH_REDIRECT}?auth=recovery#access_token=access&refresh_token=refresh&type=recovery`);
  assert.deepEqual(link, { recovery: true, accessToken: 'access', refreshToken: 'refresh', failed: false });
  assert.deepEqual(parseNativeAuthLink(`${NATIVE_AUTH_REDIRECT}?auth=callback#error=access_denied`),
    { recovery: false, accessToken: null, refreshToken: null, failed: true });
  for (const url of [
    'https://example.com/auth/callback?auth=recovery#access_token=access&refresh_token=refresh',
    'com.saluuog.nexus://evil/auth/callback?auth=recovery#access_token=access',
    'com.saluuog.nexus://evil@auth/callback?auth=recovery#access_token=access',
    'com.saluuog.nexus://auth/other?auth=recovery#access_token=access',
    `${NATIVE_AUTH_REDIRECT}?auth=unknown#access_token=access`,
  ]) assert.equal(parseNativeAuthLink(url), null);
  assert.equal(parseNativeAuthLink(`${NATIVE_AUTH_REDIRECT}?auth=recovery&access_token=access&refresh_token=refresh`)?.accessToken, null);
});

const link = (marker = 'recovery', token = 'access') => `${NATIVE_AUTH_REDIRECT}?auth=${marker}#access_token=${token}&refresh_token=refresh`;
const validSession = () => ({ data: { session: { user: { id: 'synthetic-user' } } }, error: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('cold and warm delivery of one link creates exactly one session', async () => {
  const gate = deferred();
  let calls = 0;
  const results = [];
  const handler = createNativeAuthHandler({
    setSession: async () => { calls++; await gate.promise; return validSession(); },
    onStart() {}, onResult: result => results.push(result),
  });
  const first = handler.handle(link());
  await handler.handle(link());
  gate.resolve();
  await first;
  await handler.handle(link());
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ recovery: true, success: true }]);
});

test('the same native link can be retried after a network failure', async () => {
  let calls = 0;
  const results = [];
  const handler = createNativeAuthHandler({
    setSession: async () => { if (++calls === 1) throw new Error('offline'); return validSession(); },
    onStart() {}, onResult: result => results.push(result),
  });
  await handler.handle(link());
  await handler.handle(link());
  assert.equal(calls, 2);
  assert.deepEqual(results, [{ recovery: true, success: false }, { recovery: true, success: true }]);
});

test('an invalid or sessionless link cannot enable recovery for an existing account', async () => {
  let recovery = true;
  let calls = 0;
  const handler = createNativeAuthHandler({
    setSession: async () => { calls++; return { data: { session: null }, error: null }; },
    onStart() { recovery = false; },
    onResult: result => { recovery = result.recovery && result.success; },
  });
  await handler.handle(link());
  assert.equal(recovery, false);
  await handler.handle(`${NATIVE_AUTH_REDIRECT}?auth=recovery#error=expired`);
  assert.equal(calls, 1);
  assert.equal(recovery, false);
});

test('confirmation clears previous recovery and distinct links complete in order', async () => {
  const gate = deferred();
  const tokens = [];
  const results = [];
  let recovery = true;
  const handler = createNativeAuthHandler({
    setSession: async token => { tokens.push(token.access_token); if (tokens.length === 1) await gate.promise; return validSession(); },
    onStart() { recovery = false; },
    onResult: result => { results.push(result); recovery = result.recovery && result.success; },
  });
  const first = handler.handle(link('recovery', 'first'));
  const second = handler.handle(link('callback', 'second'));
  assert.equal(recovery, false);
  await Promise.resolve();
  assert.deepEqual(tokens, ['first']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(tokens, ['first', 'second']);
  assert.deepEqual(results, [{ recovery: false, success: true }]);
  assert.equal(recovery, false);
});

test('disposed native listeners cannot update the UI or process queued links', async () => {
  const gate = deferred();
  let calls = 0;
  const results = [];
  const handler = createNativeAuthHandler({
    setSession: async () => { calls++; await gate.promise; return validSession(); },
    onStart() {}, onResult: result => results.push(result),
  });
  const first = handler.handle(link());
  await Promise.resolve();
  const second = handler.handle(link('callback', 'second'));
  handler.dispose();
  gate.resolve();
  await Promise.all([first, second]);
  await handler.handle(link('callback', 'third'));
  assert.equal(calls, 1);
  assert.deepEqual(results, []);
});
