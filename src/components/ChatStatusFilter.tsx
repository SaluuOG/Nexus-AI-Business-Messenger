import type { ChatScanWorkflowState } from '../features/ai/chatScan';

export type ChatStatusFilterValue = 'all' | 'open' | 'processed' | 'done';

export function matchesChatStatus(state: ChatScanWorkflowState | undefined, filter: ChatStatusFilterValue) {
  return filter === 'all' || Boolean(state && (filter === 'open' ? state.canScan : state.status === filter));
}

export function ChatStatusBadge({ state }: { state?: ChatScanWorkflowState }) {
  if (!state) return null;
  const label = { open: 'Offen', updated: 'Neue Nachrichten', processed: 'Ausgewertet', done: 'Fertig' }[state.status];
  return <small className="chat-status-badge" data-status={state.status} title={`Dein Chatstatus: ${label}`}>{label}</small>;
}

export function ChatStatusFilter({ value, onChange, ready, error, onRetry }: {
  value: ChatStatusFilterValue; onChange: (value: ChatStatusFilterValue) => void;
  ready: boolean; error: boolean; onRetry: () => void;
}) {
  return <div className="chat-status-filter">
    <label><span>Dein Chatstatus</span><select aria-label="Chats nach deinem Status filtern" value={value}
      onChange={event => onChange(event.target.value as ChatStatusFilterValue)}>
      <option value="all">Alle</option><option value="open" disabled={!ready}>Offen</option>
      <option value="processed" disabled={!ready}>Ausgewertet</option><option value="done" disabled={!ready}>Fertig</option>
    </select></label>
    {error ? <div className="chat-status-filter-notice" role="status">Status nicht erreichbar. <button onClick={onRetry}>Erneut laden</button></div>
      : !ready && <div className="chat-status-filter-notice" role="status">Status wird geladen…</div>}
  </div>;
}
