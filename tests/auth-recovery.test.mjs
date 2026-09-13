import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Phase 2.7 wires the complete Supabase password-recovery contract', async () => {
  const [provider, routes, app] = await Promise.all([
    read('src/features/auth/AuthProvider.tsx'),
    read('src/app/routes.ts'),
    read('src/app/App.tsx'),
  ]);

  assert.match(provider, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
  assert.match(provider, /event === 'PASSWORD_RECOVERY'/);
  assert.match(provider, /updateUser\(\{ password \}\)/);
  assert.match(provider, /buildAuthRedirect\('recovery', routes\.resetPassword\)/);
  assert.match(provider, /AUTH_CALLBACK_KEYS/);
  assert.match(routes, /resetPassword: '\/auth\/reset-password'/);
  assert.match(app, /path=\{routes\.resetPassword\}/);
});

test('Password-reset requests never disclose whether an account exists', async () => {
  const [page, policy] = await Promise.all([
    read('src/pages/AuthPage.tsx'),
    read('src/features/auth/passwordPolicy.ts'),
  ]);

  assert.match(
    policy,
    /Falls ein Nexus-Konto zu dieser E-Mail-Adresse existiert, wurde ein Wiederherstellungslink gesendet/,
  );
  assert.match(page, /setMessage\(RESET_REQUEST_CONFIRMATION\)/);
  assert.doesNotMatch(page, /Account (existiert|wurde) nicht|Nutzer nicht gefunden/i);
});

test('Recovery UI covers password confirmation, strength and invalid links', async () => {
  const [resetPage, passwordInput, policy] = await Promise.all([
    read('src/pages/ResetPasswordPage.tsx'),
    read('src/components/PasswordInput.tsx'),
    read('src/features/auth/passwordPolicy.ts'),
  ]);

  assert.match(resetPage, /auth\.session && auth\.recoveryMode/);
  assert.match(resetPage, /Link nicht mehr gültig/);
  assert.match(resetPage, /validateNewPassword\(password, confirmation\)/);
  assert.match(resetPage, /Neuen Link anfordern/);
  assert.match(passwordInput, /aria-label=\{visibilityLabel\}/);
  assert.match(passwordInput, /aria-pressed=\{visible\}/);
  assert.match(policy, /PASSWORD_MIN_LENGTH = 8/);
  assert.match(policy, /password !== confirmation/);
});

test('Authenticated users can change their password in Settings', async () => {
  const [settings, app] = await Promise.all([
    read('src/pages/SettingsPage.tsx'),
    read('src/app/App.tsx'),
  ]);

  assert.match(settings, /onUpdatePassword\?:/);
  assert.match(settings, /await onUpdatePassword\(newPassword\)/);
  assert.match(settings, /Passwort erfolgreich geändert/);
  assert.match(app, /onUpdatePassword=\{auth\.configured \? auth\.updatePassword : undefined\}/);
});
