export type NativePushOptions = { messages: boolean; assignments: boolean; comments: boolean; previews: boolean };
export const defaultNativePushOptions: NativePushOptions = { messages: true, assignments: true, comments: true, previews: false };
export function parseNativePushOptions(value: unknown): NativePushOptions {
  const result = { ...defaultNativePushOptions };
  if (value && typeof value === 'object') for (const key of Object.keys(result) as (keyof NativePushOptions)[]) {
    const setting = (value as Record<string, unknown>)[key];
    if (typeof setting === 'boolean') result[key] = setting;
  }
  return result;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Payloads are navigation hints only. Destination pages must still read via RLS.
export function nativePushTarget(value: unknown, userId: string, deviceId: string, now = Date.now()): string | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.v !== 1 || p.recipient !== userId || p.device !== deviceId || typeof p.id !== 'string' || p.id.length > 128 ||
      !p.id || typeof p.expires !== 'number' || !Number.isFinite(p.expires) || p.expires <= now || typeof p.path !== 'string') return null;
  // Never follow URLs, fragments, unknown query parameters or arbitrary routes.
  const match = /^\/app\/(chats|groups)\?(conversation|group)=([0-9a-fA-F-]+)$/.exec(p.path);
  if (!match) {
    const task = /^\/app\/business\?workspace=([0-9a-fA-F-]+)&view=tasks&project=([0-9a-fA-F-]+)&task=([0-9a-fA-F-]+)(?:&comment=([0-9a-fA-F-]+))?$/.exec(p.path);
    return task && task.slice(1).filter(Boolean).every(id => uuid.test(id)) ? p.path : null;
  }
  if (!uuid.test(match[3]) || (match[1] === 'chats' ? match[2] !== 'conversation' : match[2] !== 'group')) return null;
  return `/app/${match[1]}?${match[2]}=${match[3]}`;
}

export type NativePushPlatform = {
  permission: () => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission: () => Promise<'granted' | 'denied' | 'prompt'>;
  register: (signal: AbortSignal) => Promise<string>;
  unregister: () => Promise<void>;
  clearDelivered: () => Promise<void>;
};
// The future server implementation must derive the account from the verified
// session, enforce device ownership, and never return or log APNs tokens.
export type NativePushBackend = {
  bind: (device: { id: string; token: string; environment: 'sandbox' | 'production'; options: NativePushOptions }) => Promise<void>;
  unbind: (deviceId: string) => Promise<void>;
  saveOptions: (deviceId: string, options: NativePushOptions) => Promise<void>;
};

export function createNativePushEnrollment(config: {
  ready: boolean; environment: 'sandbox' | 'production'; deviceId: string;
  platform: NativePushPlatform; backend: NativePushBackend;
}) {
  let enabled = false;
  let disposed = false;
  let working = false;
  const abort = new AbortController();
  function available() {
    if (!config.ready) throw new Error('Native Push-Benachrichtigungen sind noch nicht freigeschaltet.');
    if (disposed) throw new Error('Die Sitzung wurde beendet.');
  }
  return {
    get enabled() { return enabled; },
    // Call only from an explicit user tap, never at launch or on login.
    async enable(options: NativePushOptions) {
      available();
      if (working) throw new Error('Die Geräteanmeldung läuft bereits.');
      working = true;
      let bindingAttempted = false;
      try {
        let permission = await config.platform.permission();
        available();
        if (permission === 'prompt') permission = await config.platform.requestPermission();
        available();
        if (permission !== 'granted') throw new Error('Benachrichtigungen sind nicht erlaubt. Du kannst sie in den iPhone-Einstellungen freigeben.');
        const token = await config.platform.register(abort.signal);
        available();
        if (!/^[0-9a-f]{32,512}$/i.test(token) || token.length % 2) throw new Error('Die Geräteanmeldung konnte nicht abgeschlossen werden.');
        bindingAttempted = true;
        try {
          await config.backend.bind({ id: config.deviceId, token, environment: config.environment, options: parseNativePushOptions(options) });
        } catch { throw new Error('Die Geräteanmeldung konnte nicht gespeichert werden. Bitte versuche es erneut.'); }
        available();
        enabled = true;
      } catch (error) {
        enabled = false;
        // Also revoke after an uncertain response: the server may have saved it.
        const cleanup = await Promise.allSettled([
          config.platform.unregister(),
          ...(bindingAttempted ? [config.backend.unbind(config.deviceId)] : []),
        ]);
        if (cleanup.some(result => result.status === 'rejected')) throw new Error('Die Geräteanmeldung wurde abgebrochen. Die Abmeldung muss erneut versucht werden.');
        throw error;
      } finally { working = false; }
    },
    async saveOptions(options: NativePushOptions) {
      available();
      if (!enabled || working) throw new Error('Aktiviere zuerst die Benachrichtigungen.');
      await config.backend.saveOptions(config.deviceId, parseNativePushOptions(options));
      await config.platform.clearDelivered();
    },
    async disable() {
      available();
      if (working) throw new Error('Die Geräteanmeldung läuft noch.');
      // Stop locally first; server failure must remain visible to the caller.
      enabled = false;
      const results = await Promise.allSettled([config.platform.unregister(), config.platform.clearDelivered(), config.backend.unbind(config.deviceId)]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Die Abmeldung konnte nicht vollständig abgeschlossen werden. Bitte versuche es erneut.');
    },
    async dispose() {
      disposed = true; enabled = false; abort.abort();
      if (!config.ready) return;
      // Caller must await cleanup before replacing its authenticated backend.
      // A bind already in flight performs an additional unbind in enable().
      const results = await Promise.allSettled([config.platform.unregister(), config.platform.clearDelivered(), config.backend.unbind(config.deviceId)]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Die Abmeldung konnte nicht vollständig abgeschlossen werden. Bitte versuche es erneut.');
    },
  };
}

export function createNativePushActionHandler(config: {
  deviceId: string; userId: () => string | null; navigate: (path: string) => void; now?: () => number;
}) {
  let pending: unknown = null;
  const seen = new Set<string>();
  const now = config.now ?? Date.now;
  function flush() {
    const user = config.userId();
    if (!user || !pending) return;
    const data = pending as Record<string, unknown>;
    pending = null;
    const target = nativePushTarget(data, user, config.deviceId, now());
    if (!target || seen.has(data.id as string)) return;
    seen.add(data.id as string);
    if (seen.size > 100) seen.delete(seen.values().next().value!);
    config.navigate(target);
  }
  return {
    handle(data: unknown) {
      if (!data || typeof data !== 'object') return;
      const payload = data as Record<string, unknown>;
      // Only retain structurally valid payloads while the session is restoring.
      if (typeof payload.recipient !== 'string' || !nativePushTarget(payload, payload.recipient, config.deviceId, now())) return;
      pending = data;
      flush();
    },
    flush,
    clear() { pending = null; seen.clear(); },
  };
}
