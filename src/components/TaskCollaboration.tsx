import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckSquare2, History, MessageSquare, Paperclip, Plus, RefreshCw } from 'lucide-react';
import type { NexusWorkspaceMember, WorkspaceRole } from '../features/data/nexusData';
import { taskMemberName, taskPermissions } from '../features/data/projectTasks';
import { addChecklistItem, addTaskComment, changeTaskEntry, taskActivityLabel, type TaskChecklistItem, type TaskComment } from '../features/data/taskCollaboration';
import { useTaskCollaboration } from '../features/data/useTaskCollaboration';
import { TaskAttachments } from './TaskAttachments';

type Props = { workspaceId: string; taskId: string; currentUserId: string; role: WorkspaceRole; members: NexusWorkspaceMember[] };
const dateLabel = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function TaskCollaboration({ workspaceId, taskId, currentUserId, role, members }: Props) {
  const model = useTaskCollaboration(workspaceId, taskId);
  const { data, loading, error } = model;
  const permissions = taskPermissions(role);
  const [comment, setComment] = useState('');
  const [label, setLabel] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'comment'; entry: TaskComment } | { kind: 'checklist'; entry: TaskChecklistItem } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const intents = useRef<{ comment?: { id: string; value: string }; checklist?: { id: string; value: string } }>({});
  const headingId = useId();
  const commentInputId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = saving || Boolean(error);
  const author = (id: string | null) => id === currentUserId ? 'Du' : id ? taskMemberName(members.find(member => member.user_id === id)) : 'Ehemaliges Konto / System';
  const done = data.checklist.filter(item => item.is_completed).length;

  const perform = async (action: () => Promise<{ error: string | null }>, success: string, after?: () => void) => {
    if (busy.current || !permissions.write || error) return;
    busy.current = true; setSaving(true); setActionError(null); setFeedback(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (result.error) setActionError(result.error);
      else { after?.(); setFeedback(success); }
      await model.refresh();
    } catch {
      if (mounted.current) { setActionError('Die Verbindung wurde unterbrochen. Deine Eingabe bleibt erhalten; du kannst es erneut versuchen.'); await model.refresh(); }
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };

  const add = (event: FormEvent, kind: 'comment' | 'checklist') => {
    event.preventDefault();
    const value = (kind === 'comment' ? comment : label).trim();
    if (!value) return;
    if (intents.current[kind]?.value !== value) intents.current[kind] = { id: crypto.randomUUID(), value };
    const id = intents.current[kind]!.id;
    void perform(() => kind === 'comment' ? addTaskComment(workspaceId, taskId, currentUserId, id, value)
      : addChecklistItem(workspaceId, taskId, currentUserId, id, value), kind === 'comment' ? 'Kommentar gespeichert.' : 'Checklistenpunkt hinzugefügt.', () => {
      delete intents.current[kind];
      if (kind === 'comment') setComment(''); else setLabel('');
    });
  };

  const remove = (kind: 'comment' | 'checklist', entry: TaskComment | TaskChecklistItem) => {
    if (!window.confirm(kind === 'comment' ? 'Diesen Kommentar und seine Anhänge dauerhaft entfernen?' : 'Diesen Checklistenpunkt dauerhaft entfernen?')) return;
    void perform(() => changeTaskEntry(kind === 'comment' ? 'task_comments' : 'task_checklist_items', workspaceId, taskId, entry, 'delete'), 'Eintrag entfernt.', () => { if (editor?.entry.id === entry.id) setEditor(null); });
  };

  return <section className="task-collaboration" aria-labelledby={headingId}>
    <div className="task-collaboration-head"><div><h3 id={headingId}>Zusammenarbeit</h3><p>Abstimmen, nächste Schritte festhalten und Änderungen verfolgen.</p></div>
      <button className="secondary" onClick={() => void model.refresh()} disabled={saving || loading} aria-label="Zusammenarbeit aktualisieren"><RefreshCw size={15} /> Aktualisieren</button></div>
    {!permissions.write && <p className="collaboration-note">Du hast Lesezugriff und kannst Anhänge ansehen und herunterladen. Änderungen können von Mitgliedern vorgenommen werden.</p>}
    {loading && <p role="status">Zusammenarbeit wird aktualisiert…</p>}
    {error && <div className="data-alert" role="alert">{error}</div>}
    {actionError && <div className="data-alert" role="alert">{actionError}</div>}
    {feedback && <p className="contact-feedback" role="status">{feedback}</p>}

    {!error && <div className="task-collaboration-grid">
      <section className="collaboration-section" aria-label="Checkliste">
        <h4><CheckSquare2 size={17} /> Checkliste <span>{done} / {data.checklist.length}</span></h4>
        {data.checklist.length > 0 && <progress aria-label="Checklistenfortschritt" max={data.checklist.length} value={done} />}
        {!loading && !data.checklist.length && <p className="collaboration-empty">Welche Schritte sind für diese Aufgabe nötig?</p>}
        <ul className="checklist-items">{data.checklist.map(item => <li key={item.id}>
          <label className={item.is_completed ? 'is-complete' : ''}><input type="checkbox" checked={item.is_completed} disabled={!permissions.write || disabled}
            onChange={() => void perform(() => changeTaskEntry('task_checklist_items', workspaceId, taskId, item, { is_completed: !item.is_completed }), item.is_completed ? 'Checklistenpunkt wieder geöffnet.' : 'Checklistenpunkt erledigt.')} /><span>{item.label}</span></label>
          {permissions.write && <div className="collaboration-actions"><button disabled={disabled} onClick={() => setEditor({ kind: 'checklist', entry: item })} aria-label={`Checklistenpunkt ${item.label} bearbeiten`}>Bearbeiten</button><button disabled={disabled} onClick={() => remove('checklist', item)} aria-label={`Checklistenpunkt ${item.label} entfernen`}>Entfernen</button></div>}
          {editor?.kind === 'checklist' && editor.entry.id === item.id && <EntryEditor key={item.id} initial={editor.entry.label} maxLength={240} label="Checklistenpunkt bearbeiten" disabled={disabled} onCancel={() => setEditor(null)} onSave={value => void perform(() => changeTaskEntry('task_checklist_items', workspaceId, taskId, editor.entry, { label: value }), 'Checklistenpunkt gespeichert.', () => setEditor(null))} />}
        </li>)}</ul>
        {permissions.write && <form className="collaboration-add-checklist" onSubmit={event => add(event, 'checklist')}><label><span>Neuer Checklistenpunkt</span><input value={label} maxLength={240} required disabled={disabled} onChange={event => setLabel(event.target.value)} placeholder="z. B. Entwurf abstimmen" /></label><button className="secondary" disabled={disabled || !label.trim()}><Plus size={14} /> Hinzufügen</button></form>}
      </section>

      <section className="collaboration-section" aria-label="Kommentare">
        <h4><MessageSquare size={17} /> Kommentare</h4>
        {permissions.write && <form className="collaboration-comment-form" onSubmit={event => add(event, 'comment')}><label htmlFor={commentInputId}><span>Neuer Kommentar</span></label><textarea id={commentInputId} value={comment} maxLength={4000} required disabled={disabled} onChange={event => setComment(event.target.value)} placeholder="Teile einen Zwischenstand oder stelle eine Frage…" /><div><small>Für alle Mitglieder dieses Workspaces sichtbar.</small><button className="primary" disabled={disabled || !comment.trim()}>Kommentar senden</button></div></form>}
        {!loading && !data.comments.length && <p className="collaboration-empty">Noch keine Kommentare.</p>}
        {data.comments.length > 0 && <p className="collaboration-note">Neueste Kommentare zuerst</p>}
        <ol className="task-comments">{data.comments.map(entry => <li key={entry.id}>
          <div className="comment-byline"><b>{author(entry.created_by)}</b><time dateTime={entry.created_at}>{dateLabel(entry.created_at)}</time>{entry.revision > 1 && <small>bearbeitet</small>}</div>
          {editor?.kind === 'comment' && editor.entry.id === entry.id ? <EntryEditor key={entry.id} initial={editor.entry.body} maxLength={4000} label="Kommentar bearbeiten" disabled={disabled} onCancel={() => setEditor(null)} onSave={value => void perform(() => changeTaskEntry('task_comments', workspaceId, taskId, editor.entry, { body: value }), 'Kommentar gespeichert.', () => setEditor(null))} /> : <p className="task-comment-body">{entry.body}</p>}
          {permissions.write && <div className="collaboration-actions">
            {entry.created_by === currentUserId && <button disabled={disabled} onClick={() => setEditor({ kind: 'comment', entry })}>Kommentar bearbeiten</button>}
            {(entry.created_by === currentUserId || permissions.delete) && <button disabled={disabled} onClick={() => remove('comment', entry)}>Kommentar entfernen</button>}
          </div>}
          <TaskAttachments workspaceId={workspaceId} taskId={taskId} commentId={entry.id} userId={currentUserId} role={role} files={data.attachments.filter(file => file.comment_id === entry.id)} canUpload={permissions.write && entry.created_by === currentUserId} refresh={model.refresh} />
        </li>)}</ol>
        {data.moreComments && <button className="secondary" disabled={loading || saving} onClick={() => void model.more('comments')}>Ältere Kommentare laden</button>}
      </section>

      <section className="collaboration-section task-files-section" aria-label="Dateien">
        <h4><Paperclip size={17} /> Dateien zur Aufgabe</h4>
        <TaskAttachments workspaceId={workspaceId} taskId={taskId} userId={currentUserId} role={role} files={data.attachments.filter(file => !file.comment_id)} canUpload={permissions.write} refresh={model.refresh} />
      </section>

      <section className="collaboration-section task-activity" aria-label="Änderungsverlauf">
        <h4><History size={17} /> Änderungsverlauf</h4>
        {!loading && !data.activity.length && <p className="collaboration-empty">Künftige Änderungen an dieser Aufgabe erscheinen hier automatisch.</p>}
        <ol>{data.activity.map(entry => <li key={entry.id}><span>{taskActivityLabel(entry)}</span><small>{author(entry.actor_id)} · <time dateTime={entry.created_at}>{dateLabel(entry.created_at)}</time></small></li>)}</ol>
        {data.moreActivity && <button className="secondary" disabled={loading || saving} onClick={() => void model.more('activity')}>Älteren Verlauf laden</button>}
      </section>
    </div>}
  </section>;
}

function EntryEditor({ initial, maxLength, label, disabled, onSave, onCancel }: {
  initial: string; maxLength: number; label: string; disabled: boolean; onSave: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputId = useId();
  return <form className="collaboration-entry-editor" onSubmit={event => { event.preventDefault(); if (value.trim()) onSave(value.trim()); }}>
    <label htmlFor={inputId}><span>{label}</span></label><textarea id={inputId} autoFocus required value={value} maxLength={maxLength} disabled={disabled} onChange={event => setValue(event.target.value)} />
    <div className="collaboration-actions"><button className="secondary" disabled={disabled || !value.trim()}>Speichern</button><button type="button" disabled={disabled} onClick={onCancel}>Abbrechen</button></div>
  </form>;
}
