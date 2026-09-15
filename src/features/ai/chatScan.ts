import { supabase } from '../../lib/supabase';

export type ChatScanKind = 'direct' | 'group';
export type ChatScanScope = { kind: ChatScanKind; chatId: string };
export type ChatScanStatus = { available: boolean; providerLabel: string | null };
export type ChatScanFinding = { text: string; sourceIds: string[] };
export type ChatScanSource = { id: string; sender: string; createdAt: string; excerpt: string };
export type ChatScanResult = {
  scanId: string;
  chatKind: ChatScanKind;
  chatId: string;
  summary: string;
  facts: ChatScanFinding[];
  decisions: ChatScanFinding[];
  tasks: ChatScanFinding[];
  questions: ChatScanFinding[];
  sources: ChatScanSource[];
  coverage: { messageCount: number; from: string | null; to: string | null; attachmentsExcluded: number; complete: true };
};

const errorMessages = {
  ai_not_configured: 'Die KI ist noch nicht eingerichtet. Sobald ein Anbieter verbunden ist, kannst du den gesamten Chat auswerten.',
  no_access: 'Du hast keinen Zugriff mehr auf diesen Chat. Die Auswertung wurde verworfen.',
  empty_chat: 'Dieser Chat enthält noch keine Textnachrichten, die ausgewertet werden können.',
  history_too_large: 'Dieser Verlauf ist für eine vollständige Auswertung derzeit zu groß. Es wurde keine unvollständige Auswertung erstellt.',
  rate_limited: 'Zu viele Auswertungen in kurzer Zeit. Bitte warte einen Moment und versuche es erneut.',
  provider_error: 'Die KI konnte den Chat gerade nicht auswerten. Bitte versuche es erneut.',
  history_changed: 'Der Verlauf hat sich geändert. Bitte erneut auswerten.',
  invalid_response: 'Die Auswertung konnte nicht sicher zu diesem Chat zugeordnet werden. Bitte versuche es erneut.',
  connection_error: 'Die KI-Verbindung ist gerade nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.',
} as const;
export type ChatScanErrorCode = keyof typeof errorMessages;

export class ChatScanError extends Error {
  readonly code: ChatScanErrorCode;
  constructor(code: ChatScanErrorCode) {
    super(errorMessages[code]);
    this.name = 'ChatScanError';
    this.code = code;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 4000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function date(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function invalid(): never { throw new ChatScanError('invalid_response'); }

export function parseChatScanStatus(value: unknown): ChatScanStatus {
  if (!record(value) || typeof value.available !== 'boolean') return invalid();
  if (value.providerLabel !== null && !text(value.providerLabel, 100)) return invalid();
  if (value.available && !text(value.providerLabel, 100)) return invalid();
  return { available: value.available, providerLabel: value.providerLabel };
}

export function parseChatScanResult(value: unknown, scope: ChatScanScope): ChatScanResult {
  if (!record(value) || value.chatKind !== scope.kind || value.chatId !== scope.chatId ||
      !text(value.scanId, 128) || !text(value.summary, 10000) || !Array.isArray(value.sources) || value.sources.length > 5000) return invalid();
  const sourceIds = new Set<string>();
  const sources: ChatScanSource[] = value.sources.map(source => {
    if (!record(source) || !text(source.id, 128) || sourceIds.has(source.id) || !text(source.sender, 300) ||
        !date(source.createdAt) || !text(source.excerpt, 5000)) return invalid();
    sourceIds.add(source.id);
    return { id: source.id, sender: source.sender, createdAt: source.createdAt, excerpt: source.excerpt };
  });
  const findings = (items: unknown): ChatScanFinding[] => {
    if (!Array.isArray(items) || items.length > 200) return invalid();
    return items.map(item => {
      if (!record(item) || !text(item.text) || !Array.isArray(item.sourceIds) || !item.sourceIds.length ||
          item.sourceIds.length > 100 || !item.sourceIds.every(id => typeof id === 'string' && sourceIds.has(id)) ||
          new Set(item.sourceIds).size !== item.sourceIds.length) return invalid();
      return { text: item.text, sourceIds: item.sourceIds as string[] };
    });
  };
  const coverage = value.coverage;
  if (!record(coverage) || coverage.complete !== true || !count(coverage.messageCount) || coverage.messageCount < 1 ||
      !count(coverage.attachmentsExcluded) || (coverage.from !== null && !date(coverage.from)) ||
      (coverage.to !== null && !date(coverage.to)) ||
      (typeof coverage.from === 'string' && typeof coverage.to === 'string' && Date.parse(coverage.from) > Date.parse(coverage.to))) return invalid();
  return {
    scanId: value.scanId, chatKind: scope.kind, chatId: scope.chatId, summary: value.summary,
    facts: findings(value.facts), decisions: findings(value.decisions), tasks: findings(value.tasks), questions: findings(value.questions),
    sources,
    coverage: { messageCount: coverage.messageCount, from: coverage.from, to: coverage.to, attachmentsExcluded: coverage.attachmentsExcluded, complete: true },
  };
}

function responseError(value: unknown): ChatScanError | null {
  if (!record(value) || typeof value.code !== 'string' || !Object.hasOwn(errorMessages, value.code)) return null;
  return new ChatScanError(value.code as ChatScanErrorCode);
}

async function invoke(action: 'status' | 'scan', scope: ChatScanScope, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (!supabase) throw new ChatScanError('connection_error');
  try {
    const { data, error } = await supabase.functions.invoke('chat-scan', { body: { action, ...scope }, signal });
    signal.throwIfAborted();
    if (error) {
      // Supabase places an HTTP error response in context. Never surface raw
      // provider responses, request bodies or credentials to the user.
      const context: unknown = error.context;
      let body: unknown;
      if (context instanceof Response) {
        try { body = await context.clone().json(); } catch { /* Non-JSON gateway response. */ }
        signal.throwIfAborted();
        const known = responseError(body);
        if (known) throw known;
        if (context.status === 401 || context.status === 403) throw new ChatScanError('no_access');
        if (context.status === 429) throw new ChatScanError('rate_limited');
      }
      throw responseError(data) ?? new ChatScanError('connection_error');
    }
    const known = responseError(data);
    if (known) throw known;
    return data;
  } catch (error) {
    signal.throwIfAborted();
    throw error instanceof ChatScanError ? error : new ChatScanError('connection_error');
  }
}

export async function loadChatScanStatus(scope: ChatScanScope, signal: AbortSignal): Promise<ChatScanStatus> {
  return parseChatScanStatus(await invoke('status', scope, signal));
}
export async function scanChat(scope: ChatScanScope, signal: AbortSignal): Promise<ChatScanResult> {
  return parseChatScanResult(await invoke('scan', scope, signal), scope);
}
