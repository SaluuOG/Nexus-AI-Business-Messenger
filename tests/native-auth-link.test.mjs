import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_AUTH_REDIRECT, parseNativeAuthLink } from '../src/features/auth/nativeAuthLink.ts';

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
