export const MAX_CHAT_DRAFT_LENGTH = 5000;

export type ChatDraftKind = 'direct' | 'group';

export type ChatDraftScope = Readonly<{
  userId: string;
  kind: ChatDraftKind;
  chatId: string;
}>;

type StoredChatDraft = {
  version: 1;
  text: string;
};

const STORAGE_PREFIX = 'nexus.chat-draft.v1';

function normalizedScope(scope: ChatDraftScope): ChatDraftScope | null {
  const userId = typeof scope?.userId === 'string' ? scope.userId.trim() : '';
  const chatId = typeof scope?.chatId === 'string' ? scope.chatId.trim() : '';
  if (!userId || !chatId || (scope.kind !== 'direct' && scope.kind !== 'group')) return null;
  return { userId, kind: scope.kind, chatId };
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Applies the same 5,000-character ceiling as the chat composers. It also
 * avoids keeping half of an UTF-16 surrogate pair at the truncation boundary.
 */
export function normalizeChatDraftText(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (value.length <= MAX_CHAT_DRAFT_LENGTH) return value;

  let text = value.slice(0, MAX_CHAT_DRAFT_LENGTH);
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  const nextCodeUnit = value.charCodeAt(text.length);
  const cutsSurrogatePair = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
  if (cutsSurrogatePair) text = text.slice(0, -1);
  return text;
}

export function chatDraftStorageKey(scope: ChatDraftScope): string | null {
  const validScope = normalizedScope(scope);
  if (!validScope) return null;
  return `${STORAGE_PREFIX}:${encodeURIComponent(validScope.userId)}:${validScope.kind}:${encodeURIComponent(validScope.chatId)}`;
}

export function readChatDraft(scope: ChatDraftScope): string {
  const key = chatDraftStorageKey(scope);
  const storage = browserStorage();
  if (!key || !storage) return '';

  try {
    const raw = storage.getItem(key);
    if (raw === null) return '';
    const parsed = JSON.parse(raw) as Partial<StoredChatDraft> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.text !== 'string') {
      try { storage.removeItem(key); } catch { /* The draft still safely falls back to empty. */ }
      return '';
    }
    return normalizeChatDraftText(parsed.text);
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be unavailable altogether. */ }
    return '';
  }
}

/**
 * Persists only composer text. Empty text removes an existing draft. The
 * return value tells the UI whether browser storage accepted the change.
 */
export function saveChatDraft(scope: ChatDraftScope, value: unknown): boolean {
  const key = chatDraftStorageKey(scope);
  const storage = browserStorage();
  if (!key || !storage || typeof value !== 'string') return false;

  const text = normalizeChatDraftText(value);
  try {
    if (!text) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ version: 1, text } satisfies StoredChatDraft));
    return true;
  } catch {
    return false;
  }
}

export function clearChatDraft(scope: ChatDraftScope): boolean {
  const key = chatDraftStorageKey(scope);
  const storage = browserStorage();
  if (!key || !storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Call this only after the server has acknowledged a successful text send. */
export function clearChatDraftAfterSuccessfulSend(scope: ChatDraftScope): boolean {
  return clearChatDraft(scope);
}
