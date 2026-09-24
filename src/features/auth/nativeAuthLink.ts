export const NATIVE_AUTH_SCHEME = 'com.saluuog.nexus:';
export const NATIVE_AUTH_REDIRECT = 'com.saluuog.nexus://auth/callback';

export type NativeAuthLink = {
  recovery: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  failed: boolean;
};

// Only the dedicated callback may carry credentials into the app. Never put
// the received URL or its token fragment in logs, analytics or history.
export function parseNativeAuthLink(value: string): NativeAuthLink | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== NATIVE_AUTH_SCHEME || url.hostname !== 'auth' || url.pathname !== '/callback' || url.username || url.password || url.port) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const marker = url.searchParams.get('auth');
  if (marker !== 'callback' && marker !== 'recovery') return null;
  return {
    recovery: marker === 'recovery',
    accessToken: fragment.get('access_token'),
    refreshToken: fragment.get('refresh_token'),
    failed: Boolean(url.searchParams.get('error') || fragment.get('error') || url.searchParams.get('error_code') || fragment.get('error_code')),
  };
}
