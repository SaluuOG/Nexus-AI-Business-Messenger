import { CheckSquare2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { businessSearch } from '../app/businessNavigation';
import { routes } from '../app/routes';
import { loadTaskWorkspace, projectPriorities, type NexusProject, type NexusProjectTask } from '../features/data/businessData';
import { createTaskFromMessage, messageTaskDraft, type MessageTaskOrigin } from '../features/data/messageTasks';
import { loadWorkspaces, loadWorkspaceMemberships, type NexusWorkspace, type NexusWorkspaceMember } from '../features/data/nexusData';
import { taskMemberName, taskPermissions, taskPriorityLabels } from '../features/data/projectTasks';

type Props = { source: MessageTaskOrigin; currentUserId?: string; workspaceId?: string | null };

export function MessageTaskAction(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="message-task-action" title="Als Aufgabe übernehmen" aria-label="Als Aufgabe übernehmen" disabled={!props.currentUserId} onClick={() => setOpen(true)}><CheckSquare2 size={14} /><span>Als Aufgabe übernehmen</span></button>
    {open && props.currentUserId && <MessageTaskDialog {...props} currentUserId={props.currentUserId} onClose={() => setOpen(false)} />}
  </>;
}

function MessageTaskDialog({ source, currentUserId, workspaceId: preferredWorkspaceId, onClose }: Props & { currentUserId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const fieldId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState(() => messageTaskDraft(source));
  const [workspaces, setWorkspaces] = useState<NexusWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [scope, setScope] = useState<{ id: string; projects: NexusProject[]; members: NexusWorkspaceMember[]; error: string | null } | null>(null);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<NexusProjectTask | null>(null);
  const currentScope = scope?.id === workspaceId ? scope : null;
  const projects = currentScope?.projects ?? [];
  const members = currentScope?.members ?? [];
  const canWrite = taskPermissions(members.find(m => m.user_id === currentUserId)?.role).write;
  const selectedProject = projects.find(p => p.id === draft.project_id);
  const assignableMembers = members.filter(m => m.role !== 'guest');
  const invalidAssignee = Boolean(draft.assigned_to && !assignableMembers.some(m => m.user_id === draft.assigned_to));
  const tooLong = Array.from(draft.description ?? '').length > 4000;
  const ready = Boolean(!loadingWorkspaces && workspaces.some(w => w.id === workspaceId) && currentScope && !currentScope.error && canWrite && selectedProject && !invalidAssignee && !tooLong);

  useEffect(() => { mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoadingWorkspaces(true); setError(null);
    void Promise.all([loadWorkspaces(), loadWorkspaceMemberships(currentUserId)]).then(([ws, roles]) => {
      if (!active) return;
      if (ws.error || roles.error) { setError('Workspaces konnten nicht geladen werden. Bitte erneut versuchen.'); setWorkspaces([]); return; }
      const writable = ws.data.filter(w => taskPermissions(roles.data.find(m => m.workspace_id === w.id)?.role).write);
      setWorkspaces(writable);
      setWorkspaceId(current => writable.some(w => w.id === current) ? current : writable.find(w => w.id === preferredWorkspaceId)?.id ?? writable[0]?.id ?? '');
    }).catch(() => { if (active) setError('Workspaces konnten nicht geladen werden. Bitte erneut versuchen.'); })
      .finally(() => { if (active) setLoadingWorkspaces(false); });
    return () => { active = false; };
  }, [currentUserId, preferredWorkspaceId, revision]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setScope(null);
    void loadTaskWorkspace(workspaceId).then(result => {
      if (!active) return;
      setScope({ ...result, id: workspaceId });
      setDraft(d => ({ ...d, project_id: result.projects.find(p => !['completed', 'archived'].includes(p.status))?.id ?? result.projects[0]?.id ?? '', assigned_to: null }));
    }).catch(() => { if (active) setScope({ id: workspaceId, projects: [], members: [], error: 'Projekte und Team konnten nicht geladen werden. Bitte erneut versuchen.' }); });
    return () => { active = false; };
  }, [workspaceId, revision]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !ready || draft.title.trim().length < 2) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const result = await createTaskFromMessage(workspaceId, source, draft, requestId);
      if (!mounted.current) return;
      if (result.error || !result.data) setError(result.error || 'Die Aufgabe konnte nicht angelegt werden. Bitte erneut versuchen.');
      else setSaved(result.data);
    } catch { if (mounted.current) setError('Die Verbindung wurde unterbrochen. Du kannst die Übernahme erneut versuchen.'); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };

  return createPortal(<dialog ref={dialog} className="business-modal task-dialog message-task-dialog" aria-labelledby="message-task-title" onCancel={e => { e.preventDefault(); if (!busy.current) onClose(); }}>
    <div className="business-modal-head"><div><small>NACHRICHT → AUFGABE</small><h2 id="message-task-title">{saved ? 'Aufgabe übernommen' : 'Als Aufgabe übernehmen'}</h2></div><button type="button" aria-label="Aufgabendialog schließen" disabled={saving} onClick={onClose}><X size={19} /></button></div>
    {saved ? <div className="message-task-success" role="status"><CheckSquare2 size={30} /><h3>{saved.title}</h3><p>Die Aufgabe ist im Workspace gespeichert und mit der Ursprungsnachricht verknüpft.</p><div className="business-modal-actions"><button className="secondary" onClick={onClose}>Zurück zum Chat</button><button className="primary" onClick={() => { onClose(); navigate(routes.business + '?' + businessSearch(saved.workspace_id, { view: 'tasks', projectId: saved.project_id, taskId: saved.id })); }}>Aufgabe öffnen</button></div></div> : <form onSubmit={e => void submit(e)}>
      <p className="message-task-context">Aus {source.kind === 'group' ? 'Gruppe' : 'Chat'} „{source.chatName}“</p>
      <p className="message-task-sharing">Titel und Beschreibung sind für alle Mitglieder des ausgewählten Workspaces sichtbar. Prüfe den Text vor der Übernahme. Anhänge bleiben im Chat.</p>
      {(error || currentScope?.error) && <div className="data-alert" role="alert">{error || currentScope?.error}<button type="button" className="secondary" disabled={saving} onClick={() => setRevision(r => r + 1)}>Auswahl aktualisieren</button></div>}
      {loadingWorkspaces ? <p role="status">Workspaces werden geladen…</p> : !workspaces.length && !error ? <p role="status">Du brauchst einen Workspace mit Schreibrecht, um eine Aufgabe anzulegen.</p> : null}
      <fieldset className="business-form-grid task-fieldset" disabled={saving || loadingWorkspaces}>
        <label className="wide"><span id={fieldId + '-workspace'}>Workspace *</span><select aria-labelledby={fieldId + '-workspace'} required value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); setDraft(d => ({ ...d, project_id: '', assigned_to: null })); setError(null); }}><option value="" disabled>Workspace auswählen</option>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        {workspaceId && !currentScope && <p className="wide" role="status">Projekte und Team werden geladen…</p>}
        {currentScope && !currentScope.error && !canWrite && <p className="wide data-alert" role="alert">Du hast in diesem Workspace kein Schreibrecht mehr.</p>}
        {currentScope && !currentScope.error && canWrite && !projects.length && <p className="wide" role="status">Lege zuerst im Business-Bereich ein Projekt für diesen Workspace an.</p>}
        <label className="wide"><span id={fieldId + '-project'}>Projekt *</span><select aria-labelledby={fieldId + '-project'} required value={draft.project_id} disabled={!canWrite || !projects.length} onChange={e => setDraft(d => ({ ...d, project_id: e.target.value }))}><option value="" disabled>Projekt auswählen</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
        <label className="wide"><span id={fieldId + '-title'}>Aufgabentitel *</span><input aria-labelledby={fieldId + '-title'} required minLength={2} maxLength={180} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
        <label><span id={fieldId + '-priority'}>Priorität</span><select aria-labelledby={fieldId + '-priority'} value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value as typeof d.priority }))}>{projectPriorities.map(p => <option key={p} value={p}>{taskPriorityLabels[p]}</option>)}</select></label>
        <label><span id={fieldId + '-due'}>Deadline</span><input aria-labelledby={fieldId + '-due'} type="date" value={draft.due_date ?? ''} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value || null }))} /></label>
        <label className="wide"><span id={fieldId + '-assignee'}>Verantwortliche Person</span><select aria-labelledby={fieldId + '-assignee'} value={draft.assigned_to ?? ''} disabled={!canWrite} onChange={e => setDraft(d => ({ ...d, assigned_to: e.target.value || null }))}><option value="">Nicht zugewiesen</option>{assignableMembers.map(m => <option key={m.user_id} value={m.user_id}>{taskMemberName(m)}</option>)}</select></label>
        <label className="wide"><span id={fieldId + '-description'}>Beschreibung</span><textarea aria-labelledby={fieldId + '-description'} maxLength={4000} value={draft.description ?? ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>
      </fieldset>
      {tooLong && <p className="data-alert" role="alert">Die Nachricht ist länger als 4.000 Zeichen. Kürze die Beschreibung vor der Übernahme; die Ursprungsnachricht bleibt verknüpft.</p>}
      {draft.due_date && selectedProject?.deadline && draft.due_date > selectedProject.deadline && <p className="task-deadline-note">Die Aufgaben-Deadline liegt nach der Projekt-Deadline ({selectedProject.deadline}).</p>}
      <div className="business-modal-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Abbrechen</button><button type="submit" className="primary" disabled={saving || !ready}>{saving ? 'Übernimmt…' : 'Aufgabe erstellen'}</button></div>
    </form>}
  </dialog>, document.body);
}
