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

type NativeAuthResult = { recovery: boolean; success: boolean };
type NativeAuthDependencies = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{ data: { session: unknown | null }; error: unknown }>;
  onStart: () => void;
  onResult: (result: NativeAuthResult) => void;
};

// iOS can deliver the same launch URL through both native APIs. Serialize
// distinct links, suppress duplicate delivery, and allow retry after failure.
export function createNativeAuthHandler({ setSession, onStart, onResult }: NativeAuthDependencies) {
  let active = true;
  let sequence = 0;
  let lastSuccessfulUrl: string | null = null;
  let queue = Promise.resolve();
  const pending = new Set<string>();
  return {
    handle(value: string): Promise<void> {
      const link = parseNativeAuthLink(value);
      if (!active || !link || pending.has(value) || value === lastSuccessfulUrl) return Promise.resolve();
      const started = ++sequence;
      pending.add(value);
      onStart();
      const task = queue.then(async () => {
        if (!active) return;
        let success = false;
        if (!link.failed && link.accessToken && link.refreshToken) {
          try {
            const result = await setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
            success = !result.error && Boolean(result.data.session);
          } catch { /* Report a failed link without logging its credentials. */ }
        }
        if (success) lastSuccessfulUrl = value;
        if (active && started === sequence) onResult({ recovery: link.recovery, success });
      }).finally(() => { pending.delete(value); });
      queue = task.catch(() => {});
      return task;
    },
    dispose() {
      active = false;
      sequence++;
      lastSuccessfulUrl = null;
      pending.clear();
    },
  };
}
