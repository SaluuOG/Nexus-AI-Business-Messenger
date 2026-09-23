import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertNativeConfiguration, assertNoPrivateCredential, assertPublicConfiguration, assetReferences, verifyPackage } from '../.github/scripts/verify-ios-package.mjs';

const jwt = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'syntheticSignature'].join('.');
const config = () => ({ appId: 'com.saluuog.nexus', webDir: 'dist', server: { iosScheme: 'capacitor' } });

test('iOS builds accept public keys and reject privileged or missing configuration', () => {
  for (const key of ['sb_publishable_synthetic', jwt('anon')]) {
    assertPublicConfiguration({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key });
  }
  for (const key of ['', 'sb_secret_synthetic', jwt('service_role'), jwt('authenticated')]) {
    assert.throws(() => assertPublicConfiguration({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key }));
  }
  assert.throws(() => assertPublicConfiguration({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' }));
});

test('release app uses local assets and cannot enable live reload or permissive navigation', () => {
  assertNativeConfiguration(config());
  for (const extra of [{ url: 'https://example.com' }, { cleartext: true }, { allowNavigation: ['*'] }]) {
    assert.throws(() => assertNativeConfiguration({ ...config(), server: { ...config().server, ...extra } }));
  }
  assert.throws(() => assertNativeConfiguration({ ...config(), ios: { webContentsDebuggingEnabled: true } }));
});

test('native asset check rejects web-only paths, remote code and missing entrypoints', () => {
  assert.deepEqual(assetReferences('<script src="./assets/app.js"></script><link href="./assets/app.css">'), ['./assets/app.js', './assets/app.css']);
  for (const ref of ['/Nexus-AI-Business-Messenger/assets/app.js', 'https://example.com/app.js', '//example.com/app.js', './assets/../../app.js']) {
    assert.throws(() => assetReferences(`<script src="${ref}"></script>`));
  }
  assert.throws(() => assetReferences('<div id="root"></div>'));
});

test('bundle scan catches known private key formats without exposing the credential', () => {
  const secrets = [
    ['sk', 'proj', 'A'.repeat(48)].join('-'),
    ['sk', 'ant', 'api03', 'B'.repeat(48)].join('-'),
    'sb_secret_' + 'C'.repeat(32),
    jwt('service_role'),
    '-----BEGIN PRIVATE KEY-----',
  ];
  for (const secret of secrets) {
    assert.throws(() => assertNoPrivateCredential(`code=${secret}`, 'assets/app.js'), error => !error.message.includes(secret));
  }
  assertNoPrivateCredential(`sb_publishable_synthetic ${jwt('anon')}`);
  assertNoPrivateCredential('Example identifiers: service_role, sk-, sb_secret_');
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-ios-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'public/assets'), { recursive: true });
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify(config()));
  writeFileSync(join(dir, 'public/index.html'), '<script src="./assets/app.js"></script>');
  writeFileSync(join(dir, 'public/assets/app.js'), 'const url="https://example.supabase.co", key="sb_publishable_synthetic";');
  return dir;
}

test('assembled package verifies assets and backend configuration', t => {
  const dir = fixture(t);
  const expected = { url: 'https://example.supabase.co', key: 'sb_publishable_synthetic' };
  assert.equal(verifyPackage(dir, { expected }).compiled, false);
  assert.throws(() => verifyPackage(dir, { expected: { ...expected, url: 'https://missing.supabase.co' } }));
  writeFileSync(join(dir, 'public/index.html'), '<script src="./assets/missing.js"></script>');
  assert.throws(() => verifyPackage(dir));
});

test('assembled package scans lazy-loaded chunks as well as the entrypoint', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'public/assets/lazy-page.js'), 'const key="' + jwt('service_role') + '"');
  assert.throws(() => verifyPackage(dir), /Privileged Supabase JWT detected/);
});

test('compiled package requires native executable and both binary SDK manifests', t => {
  const dir = fixture(t);
  assert.throws(() => verifyPackage(dir, { compiled: true }), /executable is missing/);
  writeFileSync(join(dir, 'App'), 'test-executable-placeholder');
  for (const sdk of ['Capacitor', 'Cordova']) {
    assert.throws(() => verifyPackage(dir, { compiled: true }), /SDK privacy manifest is missing/);
    mkdirSync(join(dir, `Frameworks/${sdk}.framework`), { recursive: true });
    writeFileSync(join(dir, `Frameworks/${sdk}.framework/PrivacyInfo.xcprivacy`), '<plist/>');
  }
  assert.equal(verifyPackage(dir, { compiled: true }).compiled, true);
});
