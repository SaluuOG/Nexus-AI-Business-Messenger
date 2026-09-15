import {
  normalizeChatDraftText,
  type ChatDraftScope,
} from './chatDrafts';

export type TextSendRetryPayload = Readonly<{
  id: string;
  clientRequestId: string;
  scope: ChatDraftScope;
  text: string;
  attempt: number;
  failedAt: number;
}>;

export type TextSendRetrySnapshot = Readonly<{
  payload: TextSendRetryPayload;
  status: 'ready' | 'retrying';
}>;

export type TextSendRetryStore = Readonly<{
  rememberFailure: (scope: ChatDraftScope, text: string, clientRequestId: string) => TextSendRetryPayload | null;
  get: (scope: ChatDraftScope) => TextSendRetrySnapshot | null;
  beginRetry: (scope: ChatDraftScope, retryId: string) => TextSendRetryPayload | null;
  finishRetry: (scope: ChatDraftScope, retryId: string, succeeded: boolean) => boolean;
  discard: (scope: ChatDraftScope, retryId?: string) => boolean;
  clearUser: (userId: string) => void;
}>;

type RetryEntry = {
  payload: TextSendRetryPayload;
  status: 'ready' | 'retrying';
};

const scopeKey = (scope: ChatDraftScope) => {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : '';
  const chatId = typeof scope?.chatId === 'string' ? scope.chatId.trim() : '';
  if (!userId || !chatId || (scope.kind !== 'direct' && scope.kind !== 'group')) return null;
  return JSON.stringify([userId, scope.kind, chatId]);
};

const copyScope = (scope: ChatDraftScope): ChatDraftScope => Object.freeze({
  userId: scope.userId.trim(),
  kind: scope.kind,
  chatId: scope.chatId.trim(),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Creates the idempotency key before the first network request. */
export function createTextClientRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Keeps at most one failed text send per account/chat in memory. Nothing in
 * this model invokes a sender: the UI must explicitly acquire a retry through
 * beginRetry, and a second acquisition is rejected until finishRetry runs.
 * Attachments and audio are intentionally outside this text-only API.
 */
export function createTextSendRetryStore(now: () => number = Date.now): TextSendRetryStore {
  const entries = new Map<string, RetryEntry>();
  let sequence = 0;

  const rememberFailure = (scope: ChatDraftScope, sourceText: string, sourceClientRequestId: string) => {
    const key = scopeKey(scope);
    const text = normalizeChatDraftText(sourceText);
    const clientRequestId = typeof sourceClientRequestId === 'string' ? sourceClientRequestId.trim() : '';
    if (!key || !text.trim() || !UUID_PATTERN.test(clientRequestId)) return null;

    const current = entries.get(key);
    if (current?.payload.text === text && current.payload.clientRequestId === clientRequestId) return current.payload;
    if (current?.status === 'retrying') return null;

    const failedAt = now();
    const payload: TextSendRetryPayload = Object.freeze({
      id: `text-retry-${failedAt.toString(36)}-${(++sequence).toString(36)}`,
      clientRequestId,
      scope: copyScope(scope),
      text,
      attempt: 0,
      failedAt,
    });
    entries.set(key, { payload, status: 'ready' });
    return payload;
  };

  const get = (scope: ChatDraftScope): TextSendRetrySnapshot | null => {
    const key = scopeKey(scope);
    const entry = key ? entries.get(key) : undefined;
    return entry ? Object.freeze({ payload: entry.payload, status: entry.status }) : null;
  };

  const beginRetry = (scope: ChatDraftScope, retryId: string) => {
    const key = scopeKey(scope);
    const entry = key ? entries.get(key) : undefined;
    if (!entry || entry.status !== 'ready' || entry.payload.id !== retryId) return null;

    entry.payload = Object.freeze({ ...entry.payload, attempt: entry.payload.attempt + 1 });
    entry.status = 'retrying';
    return entry.payload;
  };

  const finishRetry = (scope: ChatDraftScope, retryId: string, succeeded: boolean) => {
    const key = scopeKey(scope);
    const entry = key ? entries.get(key) : undefined;
    if (!key || !entry || entry.status !== 'retrying' || entry.payload.id !== retryId) return false;
    if (succeeded) entries.delete(key);
    else entry.status = 'ready';
    return true;
  };

  const discard = (scope: ChatDraftScope, retryId?: string) => {
    const key = scopeKey(scope);
    const entry = key ? entries.get(key) : undefined;
    if (!key || !entry || (retryId !== undefined && entry.payload.id !== retryId)) return false;
    entries.delete(key);
    return true;
  };

  const clearUser = (userId: string) => {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) return;
    for (const [key, entry] of entries) {
      if (entry.payload.scope.userId === normalizedUserId) entries.delete(key);
    }
  };

  return Object.freeze({ rememberFailure, get, beginRetry, finishRetry, discard, clearUser });
}
