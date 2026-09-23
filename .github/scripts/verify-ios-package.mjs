// Build-time safeguards, not a substitute for a full security/privacy review.
// Never include a detected credential in diagnostics.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function jwtRole(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role; }
  catch { return null; }
}

export function assertPublicConfiguration(env) {
  const url = new URL(env.VITE_SUPABASE_URL || 'invalid:');
  assert.equal(url.protocol, 'https:', 'The Supabase endpoint must use HTTPS.');
  assert.ok(url.hostname && !url.username && !url.password, 'Invalid Supabase endpoint.');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  assert.ok(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || jwtRole(key) === 'anon',
    'Only a Supabase publishable/anon key may enter the app build.');
  return { url: env.VITE_SUPABASE_URL, key };
}

export function assertNativeConfiguration(config) {
  assert.equal(config.appId, 'com.saluuog.nexus', 'Unexpected iOS bundle identifier.');
  assert.equal(config.webDir, 'dist', 'The iOS app must use the built web assets.');
  assert.equal(config.server?.iosScheme, 'capacitor', 'Unexpected native origin.');
  assert.ok(!config.server?.url, 'Release builds cannot use a live-reload server.');
  assert.ok(!config.server?.cleartext, 'Release builds cannot enable cleartext traffic.');
  assert.ok(!config.server?.allowNavigation?.length, 'Unreviewed navigation allowlist.');
  assert.ok(!config.ios?.webContentsDebuggingEnabled, 'Release WebView debugging must be disabled.');
}

export function assertNoPrivateCredential(text, label = 'bundle') {
  assert.ok(!/sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}/.test(text), `Private provider key detected in ${label}.`);
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{16,}/.test(text), `Private Supabase key detected in ${label}.`);
  assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), `Private key material detected in ${label}.`);
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    assert.notEqual(jwtRole(match[0]), 'service_role', `Privileged Supabase JWT detected in ${label}.`);
  }
}

export function assetReferences(html) {
  const refs = [];
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const match = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/i);
    if (match) refs.push(match[1]);
  }
  assert.ok(refs.some(ref => ref.endsWith('.js')), 'No JavaScript entry point in the iOS bundle.');
  for (const ref of refs) {
    assert.ok(ref.startsWith('./') && !ref.slice(2).includes('..') && !ref.includes('\\'),
      'Every iOS entry asset must use a local relative path.');
  }
  return refs;
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

export function verifyPackage(directory, { compiled = false, expected } = {}) {
  const root = resolve(directory);
  const publicRoot = resolve(root, 'public');
  assertNativeConfiguration(JSON.parse(readFileSync(resolve(root, 'capacitor.config.json'), 'utf8')));
  const html = readFileSync(resolve(publicRoot, 'index.html'), 'utf8');
  for (const ref of assetReferences(html)) {
    assert.ok(existsSync(resolve(publicRoot, ref)), 'An iOS entry asset is missing.');
  }
  const files = filesUnder(root);
  let hasUrl = !expected, hasKey = !expected;
  for (const file of files) {
    if (!/\.(?:html|css|js|mjs|json|map|webmanifest|xml|plist|xcprivacy|env)$/i.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    assertNoPrivateCredential(text, relative(root, file));
    // The connection must be compiled into the actual app code, not just config.
    if (file.startsWith(publicRoot + sep) && file.endsWith('.js') && expected) {
      hasUrl ||= text.includes(expected.url);
      hasKey ||= text.includes(expected.key);
    }
  }
  assert.ok(hasUrl && hasKey, 'The iOS bundle is missing the public backend configuration.');
  if (compiled) {
    assert.ok(existsSync(resolve(root, 'App')), 'The compiled iOS executable is missing.');
    for (const sdk of ['Capacitor', 'Cordova']) {
      assert.ok(files.some(file => file.endsWith(`${sdk}.framework${sep}PrivacyInfo.xcprivacy`)),
        `The ${sdk} SDK privacy manifest is missing from the compiled app.`);
    }
  }
  return { checkedFiles: files.length, compiled };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const expected = assertPublicConfiguration(process.env);
  if (process.argv.includes('--config-only')) console.log('Public build configuration verified.');
  else console.log(JSON.stringify(verifyPackage(process.argv[2] || 'ios/App/App', {
    compiled: process.argv.includes('--compiled'), expected,
  })));
}
