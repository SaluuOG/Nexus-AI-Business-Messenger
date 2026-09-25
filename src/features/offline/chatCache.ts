import { readableLoadError } from '../connection/readAvailability';
// Only previously authorized text snapshots live here. Cache records are never
// used to authorize server requests. No tokens, attachment URLs or files persist.
export type ChatKind = 'direct' | 'group';
type Row = Record<string, unknown>;
type RecordValue = { key: string; owner: string; kind: ChatKind; id: string; at: number; rows: Row[] };
const DATABASE = 'nexus-offline-chats-v1';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
let owner: string | null | undefined;
let epoch = 0;
const requests = new Map<string, number>();
const allowedChats = new Map<ChatKind, Set<unknown>>();
let ready: Promise<unknown> = Promise.resolve();
let dbPromise: Promise<IDBDatabase> | null = null;
const key = (account: string, kind: ChatKind, id: string) => JSON.stringify([account, kind, id]);
function open() {
  if (!dbPromise) dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Offline-Speicher nicht verfügbar.'));
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
function transaction(db: IDBDatabase, change: (store: IDBObjectStore) => void) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    change(tx.objectStore('snapshots'));
  });
}
// Runs synchronously before rendering the next account; late responses are fenced.
export function syncOfflineChatAccount(next: string | null): Promise<unknown> {
  if (owner === next) return ready.catch(() => {});
  if (next === null) { try { localStorage.setItem('nexus-offline-reset', '1'); } catch { /* Storage may be unavailable. */ } }
  owner = next; epoch++; requests.clear(); allowedChats.clear();
  ready = ready.catch(() => {}).then(async () => {
    const db = await open();
    let reset = false;
    try { reset = localStorage.getItem('nexus-offline-reset') === '1'; } catch { reset = true; }
    await transaction(db, store => {
      const request = store.openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return;
        const row = cursor.value as RecordValue;
        if (reset || !next || row.owner !== next || Date.now() - row.at > MAX_AGE) cursor.delete();
        cursor.continue();
      };
    });
    try { localStorage.removeItem('nexus-offline-reset'); } catch { /* No persistent cache if storage is blocked. */ }
  });
  return ready.catch(() => {});
}
const capture = (account?: string) => ({ account, epoch });
type Scope = ReturnType<typeof capture>;
const valid = (scope: Scope) => Boolean(scope.account && owner === scope.account && epoch === scope.epoch);
function text(value: unknown, max = 5000) { return typeof value === 'string' ? value.slice(0, max) : null; }
const stringFields = ['message_id','sender_id','created_at','reply_to_message_id','reply_sender_id','reply_body','edited_at','deleted_at','read_at','group_id','sender_full_name','sender_username','reply_sender_name'];
export function sanitizeRows(kind: ChatKind, id: string, input: unknown): Row[] {
  if (!Array.isArray(input)) return [];
  return input.slice(id === 'list' ? 0 : -100, id === 'list' ? 100 : undefined).filter(row => row && typeof row === 'object').map((row): Row => {
    if (id === 'list') {
      const result: Row = {};
      for (const field of kind === 'direct' ? ['conversation_id','contact_user_id','full_name','username','last_message','last_message_at'] : ['group_id','name','last_message','last_message_at']) result[field] = text(row[field]);
      const memberCount = Number(row.member_count);
      return { ...result, ...(kind === 'group' ? { name: text(row.name, 80) || 'Gruppe' } : {}), avatar_url: null, avatar_path: null, unread_count: 0, member_count: Number.isFinite(memberCount) ? memberCount : 0, role: 'member' };
    }
    const result: Row = {};
    for (const field of stringFields) result[field] = text(row[field]);
    const hasAttachment = Array.isArray(row.attachments) && row.attachments.length > 0;
    return { ...result, body: row.deleted_at ? '' : (text(row.body) || '') + (hasAttachment ? '\n[Anhang nur online verfügbar]' : ''), reply_body: null, attachments: [], sender_avatar_url: null, read_count: 0, recipient_count: 0 };
  }).filter(row => typeof row[id === 'list' ? kind === 'direct' ? 'conversation_id' : 'group_id' : 'message_id'] === 'string');
}
async function read(scope: Scope, kind: ChatKind, id: string): Promise<RecordValue | null> {
  try {
    await ready; const db = await open(); if (!valid(scope)) return null;
    const record = await new Promise<RecordValue | undefined>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get(key(scope.account!, kind, id));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (!valid(scope) || !record || record.owner !== scope.account || record.kind !== kind || record.id !== id || !Number.isFinite(record.at) || record.at > Date.now() || Date.now() - record.at > MAX_AGE || !Array.isArray(record.rows)) return null;
    return { ...record, rows: sanitizeRows(kind, id, record.rows) };
  } catch { return null; }
}
async function write(scope: Scope, kind: ChatKind, id: string, rows: unknown, latest: () => boolean) {
  try {
    await ready; const db = await open(); if (!valid(scope) || !latest()) return;
    if (id !== 'list' && allowedChats.has(kind) && !allowedChats.get(kind)!.has(id)) return;
    const record: RecordValue = { key: key(scope.account!, kind, id), owner: scope.account!, kind, id, at: Date.now(), rows: sanitizeRows(kind, id, rows) };
    if (id === 'list') allowedChats.set(kind, new Set(record.rows.map(row => row[kind === 'direct' ? 'conversation_id' : 'group_id'])));
    await transaction(db, store => {
      store.put(record);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = (request.result as RecordValue[]).sort((a, b) => b.at - a.at);
        const allowedIds = id === 'list' ? new Set(record.rows.map(row => row[kind === 'direct' ? 'conversation_id' : 'group_id'])) : null;
        let bytes = 0, pages = 0;
        for (const item of records) {
          bytes += JSON.stringify(item).length * 2;
          if (item.id !== 'list') pages++;
          if (item.owner !== scope.account || Date.now() - item.at > MAX_AGE || bytes > 8_000_000 || pages > 40 || (allowedIds && item.kind === kind && item.id !== 'list' && !allowedIds.has(item.id))) store.delete(item.key);
        }
      };
    });
  } catch { /* Quota/private mode must not prevent the online read. */ }
}
async function remove(scope: Scope, kind: ChatKind, id: string, latest: () => boolean) {
  try { await ready; const db = await open(); if (!valid(scope) || !latest()) return;
    if (id === 'list') allowedChats.set(kind, new Set());
    await transaction(db, store => {
      const request = store.openCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor) return;
        const item = cursor.value as RecordValue;
        if (item.owner === scope.account && item.kind === kind && (id === 'list' || item.id === id)) cursor.delete();
        cursor.continue();
      };
    });
  } catch { /* Cache remains unavailable while online access is rejected. */ }
}
export type OfflineResult<T> = { data: T; error: string | null; cachedAt: number | null };
export async function cachedChatRead<T>(config: {
  account?: string; kind: ChatKind; id: string; empty: T;
  fetch: () => Promise<{ data: T; error: string | null }>;
  rows: (data: T) => unknown; restore: (rows: Row[]) => T;
}): Promise<OfflineResult<T>> {
  const scope = capture(config.account);
  const requestKey = key(config.account || '', config.kind, config.id);
  const request = (requests.get(requestKey) || 0) + 1;
  requests.set(requestKey, request);
  const latest = () => requests.get(requestKey) === request;
  if (navigator.onLine === false) {
    const cached = await read(scope, config.kind, config.id);
    return cached ? { data: config.restore(cached.rows), error: null, cachedAt: cached.at }
      : { data: config.empty, error: 'Für diesen Chat sind noch keine Nachrichten offline gespeichert.', cachedAt: null };
  }
  try {
    const result = await config.fetch();
    if (!result.error) await write(scope, config.kind, config.id, config.rows(result.data), latest);
    else if (!/fetch|network|load failed|Verbindung|Sitzung kann gerade/i.test(result.error)) await remove(scope, config.kind, config.id, latest);
    return { ...result, error: result.error ? readableLoadError(result.error) : null, cachedAt: null };
  } catch { return { data: config.empty, error: 'Die Daten konnten nicht geladen werden. Bitte prüfe deine Verbindung.', cachedAt: null }; }
}

// For the isolated reader: no server calls and no invented auth session.
export async function readSavedChat(account: string, kind: ChatKind, id: string) {
  if (navigator.onLine !== false) return null;
  return read(capture(account), kind, id);
}

// Apply authorized realtime edits/deletions even when reading an older page.
export async function patchSavedMessage(account: string | undefined, kind: ChatKind, id: string, messageId: string, message: unknown | null) {
  const scope = capture(account);
  const recordKey = key(account || '', kind, id);
  requests.set(recordKey, (requests.get(recordKey) || 0) + 1);
  try {
    await ready; const db = await open(); if (!valid(scope)) return;
    await transaction(db, store => {
      const request = store.get(recordKey);
      request.onsuccess = () => {
        const record = request.result as RecordValue | undefined;
        if (!valid(scope) || !record || !Array.isArray(record.rows)) return;
        const replacement = message ? sanitizeRows(kind, id, [message])[0] : null;
        record.rows = record.rows.flatMap(row => row.message_id === messageId ? replacement ? [replacement] : [] : [row]);
        store.put(record);
      };
    });
  } catch { /* Online changes must succeed even if storage is full. */ }
}
