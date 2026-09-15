import { ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { businessSearch } from '../app/businessNavigation';
import { routes } from '../app/routes';
import { loadTaskMessageSource, type TaskMessageSource } from '../features/data/messageTasks';
import { supabase } from '../lib/supabase';

// The single-message RPC has no recent-history limit and enforces both chat and
// workspace membership. Never put the copied task text in this live source view.
export function TaskMessageContext({ kind, onChatResolved }: { kind: 'direct' | 'group'; onChatResolved: (chatId: string) => void }) {
  const [search, setSearch] = useSearchParams();
  const taskId = search.get('task');
  const workspaceId = search.get('workspace');
  const navigate = useNavigate();
  const onResolved = useRef(onChatResolved);
  onResolved.current = onChatResolved;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ id: string; source: TaskMessageSource | null; error: string | null } | null>(null);
  const source = state?.id === taskId ? state.source : null;
  const error = state?.id === taskId ? state.error : null;

  useEffect(() => {
    if (!taskId) { setState(null); return; }
    let active = true;
    let version = 0;
    const refresh = async () => {
      const request = ++version;
      setState(null);
      try {
        const result = await loadTaskMessageSource(taskId);
        if (!active || request !== version) return;
        const next = result.data?.kind === kind ? result.data : null;
        setState({ id: taskId, source: next, error: result.error || (!next ? 'Die Ursprungsnachricht wurde entfernt oder du hast keinen Zugriff mehr darauf.' : null) });
        if (next) onResolved.current(next.chat_id);
      } catch { if (active && request === version) setState({ id: taskId, source: null, error: 'Die Ursprungsnachricht konnte nicht geladen werden. Bitte erneut versuchen.' }); }
    };
    void refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    const focus = () => void refresh();
    const visibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
    const channel = supabase?.channel('task-source:' + taskId)
      .on('postgres_changes', { event: '*', schema: 'public', table: kind === 'direct' ? 'direct_messages' : 'group_messages' }, focus)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tasks', filter: 'id=eq.' + taskId }, focus)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'workspace_members' }, focus)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_members' }, focus)
      .subscribe();
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility); if (channel) void supabase?.removeChannel(channel); };
  }, [taskId, kind, revision]);

  if (!taskId) return null;
  return <section className="task-message-context" aria-label="Ursprungsnachricht">
    <div className="task-message-context-head"><b>Ursprungsnachricht</b><button className="secondary" aria-label="Nachrichtenfokus schließen" onClick={() => { const next = new URLSearchParams(search); next.delete('task'); next.delete('workspace'); setSearch(next, { replace: true }); }}><X size={15} /></button></div>
    {!state || state.id !== taskId ? <p role="status">Ursprungsnachricht wird geprüft…</p> : error ? <p role="status">{error}</p> : source && <>
      <time dateTime={source.created_at}>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(source.created_at))}{source.edited_at ? ' · bearbeitet' : ''}</time>
      <blockquote>{source.body || 'Nachricht mit Anhang. Dateien bleiben im Chat.'}</blockquote>
    </>}
    <div className="task-message-context-actions"><button className="secondary" onClick={() => navigate(routes.business + '?' + businessSearch(source?.workspace_id ?? workspaceId, { view: 'tasks', taskId }))}><ArrowLeft size={14} /> Zur Aufgabe</button>{error && <button className="secondary" onClick={() => setRevision(r => r + 1)}><RefreshCw size={14} /> Erneut prüfen</button>}</div>
  </section>;
}
