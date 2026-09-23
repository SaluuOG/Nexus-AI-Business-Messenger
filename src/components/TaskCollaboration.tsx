import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AtSign, CheckSquare2, History, MessageSquare, Paperclip, Plus, RefreshCw, X } from 'lucide-react';
import type { NexusWorkspaceMember, WorkspaceRole } from '../features/data/nexusData';
import { taskMemberName, taskPermissions } from '../features/data/projectTasks';
import { addChecklistItem, addTaskComment, changeTaskEntry, taskActivityLabel, type TaskChecklistItem, type TaskComment } from '../features/data/taskCollaboration';
import { beginTaskMention, findTaskMentionQuery, insertTaskMention, pruneTaskMentions, removeTaskMention, taskMentionCandidates, taskMentionLabel, taskMentionLimit, type TaskMentionDraft, type TaskMentionQuery } from '../features/data/taskMentions';
import { useTaskCollaboration } from '../features/data/useTaskCollaboration';
import { TaskAttachments } from './TaskAttachments';

type Props = { workspaceId: string; taskId: string; initialCommentId?: string | null; currentUserId: string; role: WorkspaceRole; members: NexusWorkspaceMember[] };
const dateLabel = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function TaskCollaboration({ workspaceId, taskId, initialCommentId, currentUserId, role, members }: Props) {
  const model = useTaskCollaboration(workspaceId, taskId, initialCommentId);
  const { data, loading, error } = model;
  const permissions = taskPermissions(role);
  const [comment, setComment] = useState('');
  const [mentions, setMentions] = useState<TaskMentionDraft[]>([]);
  const [mentionQuery, setMentionQuery] = useState<TaskMentionQuery | null>(null);
  const [label, setLabel] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'comment'; entry: TaskComment } | { kind: 'checklist'; entry: TaskChecklistItem } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const intents = useRef<{ comment?: { id: string; value: string; mentionIds?: string[] }; checklist?: { id: string; value: string; mentionIds?: string[] } }>({});
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const commentCaret = useRef<number | null>(null);
  const focusedComment = useRef<string | null>(null);
  const headingId = useId();
  const commentInputId = useId();
  const mentionMenuId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = saving || Boolean(error);
  const author = (id: string | null) => id === currentUserId ? 'Du' : id ? taskMemberName(members.find(member => member.user_id === id)) : 'Ehemaliges Konto / System';
  const done = data.checklist.filter(item => item.is_completed).length;
  const mentionChoices = useMemo(() => taskMentionCandidates(members, currentUserId, mentions, mentionQuery?.query ?? ''), [members, currentUserId, mentions, mentionQuery?.query]);

  useLayoutEffect(() => {
    const caret = commentCaret.current;
    if (caret === null) return;
    commentCaret.current = null;
    commentInput.current?.focus();
    commentInput.current?.setSelectionRange(caret, caret);
    setMentionQuery(findTaskMentionQuery(comment, caret));
  }, [comment]);

  useEffect(() => {
    if (!initialCommentId) { focusedComment.current = null; return; }
    if (loading || error || focusedComment.current === initialCommentId || !data.comments.some(entry => entry.id === initialCommentId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`nexus-comment-${initialCommentId}`);
      if (!target) return;
      focusedComment.current = initialCommentId;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.comments, error, initialCommentId, loading]);

  const setCommentAndCaret = (value: string, caret: number) => {
    commentCaret.current = caret;
    setComment(value);
  };

  const chooseMention = (member: NexusWorkspaceMember) => {
    if (!mentionQuery || mentions.length >= taskMentionLimit) return;
    const label = taskMentionLabel(member);
    const next = insertTaskMention(comment, mentionQuery, label);
    if (next.value.length > 4000) return;
    setMentions(current => [...current, { userId: member.user_id, label }]);
    setMentionQuery(null);
    setCommentAndCaret(next.value, next.caret);
  };

  const startMention = () => {
    if (comment.length >= 4000) return;
    const input = commentInput.current;
    const next = beginTaskMention(comment, input?.selectionStart ?? comment.length, input?.selectionEnd ?? comment.length);
    setMentionQuery(next.query); setCommentAndCaret(next.value, next.caret);
  };

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
    const mentionIds = kind === 'comment' ? mentions.map(mention => mention.userId).sort() : [];
    const previous = intents.current[kind];
    if (previous?.value !== value || kind === 'comment' && JSON.stringify(previous?.mentionIds ?? []) !== JSON.stringify(mentionIds)) {
      intents.current[kind] = kind === 'comment' ? { id: crypto.randomUUID(), value, mentionIds } : { id: crypto.randomUUID(), value };
    }
    const id = intents.current[kind]!.id;
    void perform(() => kind === 'comment' ? addTaskComment(workspaceId, taskId, currentUserId, id, value, mentionIds)
      : addChecklistItem(workspaceId, taskId, currentUserId, id, value), kind === 'comment' ? 'Kommentar gespeichert.' : 'Checklistenpunkt hinzugefügt.', () => {
      delete intents.current[kind];
      if (kind === 'comment') { setComment(''); setMentions([]); setMentionQuery(null); } else setLabel('');
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
        {permissions.write && <form className="collaboration-comment-form" onSubmit={event => add(event, 'comment')} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMentionQuery(null);
        }}><label htmlFor={commentInputId}><span>Neuer Kommentar</span></label>
          <textarea ref={commentInput} id={commentInputId} value={comment} maxLength={4000} required disabled={disabled}
            aria-expanded={Boolean(mentionQuery)} aria-controls={mentionQuery ? mentionMenuId : undefined}
            onChange={event => { const value = event.target.value; setComment(value); setMentions(current => pruneTaskMentions(value, current)); setMentionQuery(findTaskMentionQuery(value, event.target.selectionStart)); }}
            onClick={event => setMentionQuery(findTaskMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart))}
            onKeyUp={event => { if (event.key === 'Escape') setMentionQuery(null); else setMentionQuery(findTaskMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)); }}
            placeholder="Teile einen Zwischenstand oder erwähne jemanden mit @…" />
          <div className="mention-toolbar"><button type="button" className="mention-start" disabled={disabled || mentions.length >= taskMentionLimit || members.length < 2} onClick={startMention}><AtSign size={14} /> Person erwähnen</button><small>Nur ausgewählte Teammitglieder werden gezielt benachrichtigt.</small></div>
          {mentions.length > 0 && <div className="mention-chips" aria-label="Ausgewählte Erwähnungen">{mentions.map(mention => <span key={mention.userId}>@{mention.label}<button type="button" disabled={disabled} aria-label={`Erwähnung von ${mention.label} entfernen`} onClick={() => { setComment(current => removeTaskMention(current, mention.label)); setMentions(current => current.filter(item => item.userId !== mention.userId)); setMentionQuery(null); }}><X size={12} /></button></span>)}</div>}
          {mentionQuery && <div id={mentionMenuId} className="mention-suggestions" aria-label="Teammitglied auswählen">
            {mentionChoices.map(member => { const name = taskMentionLabel(member); return <button type="button" key={member.user_id} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(member)}><b>{name}</b>{member.username && member.username !== name && <span>@{member.username}</span>}<small>{member.role === 'guest' ? 'Gast · Lesezugriff' : 'Teammitglied'}</small></button>; })}
            {!mentionChoices.length && <p>Keine weitere passende Person gefunden.</p>}
          </div>}
          <div><small>Für alle Mitglieder dieses Workspaces sichtbar.</small><button className="primary" disabled={disabled || !comment.trim()}>Kommentar senden</button></div>
        </form>}
        {!loading && !data.comments.length && <p className="collaboration-empty">Noch keine Kommentare.</p>}
        {data.comments.length > 0 && <p className="collaboration-note">Neueste Kommentare zuerst</p>}
        <ol className="task-comments">{data.comments.map(entry => <li id={`nexus-comment-${entry.id}`} tabIndex={-1} className={initialCommentId === entry.id ? 'is-mentioned-target' : undefined} key={entry.id}>
          <div className="comment-byline"><b>{author(entry.created_by)}</b><time dateTime={entry.created_at}>{dateLabel(entry.created_at)}</time>{entry.revision > 1 && <small>bearbeitet</small>}</div>
          {editor?.kind === 'comment' && editor.entry.id === entry.id ? <EntryEditor key={entry.id} initial={editor.entry.body} maxLength={4000} label="Kommentar bearbeiten" disabled={disabled} onCancel={() => setEditor(null)} onSave={value => void perform(() => changeTaskEntry('task_comments', workspaceId, taskId, editor.entry, { body: value }), 'Kommentar gespeichert.', () => setEditor(null))} /> : <p className="task-comment-body">{entry.body}</p>}
          <CommentMentions entry={entry} members={members} currentUserId={currentUserId} />
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

function CommentMentions({ entry, members, currentUserId }: { entry: TaskComment; members: NexusWorkspaceMember[]; currentUserId: string }) {
  const ids = entry.mentioned_user_ids ?? [];
  if (!ids.length) return null;
  return <div className="comment-mentions" aria-label="Erwähnte Personen"><AtSign size={13} /><span>Erwähnt:</span>{ids.map(id => <b key={id}>{id === currentUserId ? 'Du' : taskMemberName(members.find(member => member.user_id === id))}</b>)}</div>;
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
