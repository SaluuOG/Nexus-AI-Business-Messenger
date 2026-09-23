import { CalendarDays, CheckCheck, CheckSquare2, ListTodo, Plus, Search, SquarePen, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createProjectTask, deleteProjectTask, projectPriorities, updateProjectTask, updateProjectTaskStatus,
  type NexusProject, type NexusProjectTask, type ProjectTaskInput,
} from '../features/data/businessData';
import { useNavigate } from 'react-router-dom';
import { routes } from '../app/routes';
import { businessSearch } from '../app/businessNavigation';
import { TaskCollaboration } from './TaskCollaboration';
import { useTaskSourceLinks } from './TaskSourceLinks';
import type { NexusWorkspaceMember } from '../features/data/nexusData';
import {
  filterTasks, localDateKey, summarizeTasks, taskIsOverdue, taskMemberName, taskPermissions,
  taskPriorityLabels, taskStatuses, taskStatusLabels, type TaskFilters, type TaskStatus,
} from '../features/data/projectTasks';

type Props = {
  workspaceId: string;
  currentUserId?: string;
  tasks: NexusProjectTask[];
  projects: NexusProject[];
  members: NexusWorkspaceMember[];
  defaultProjectId: string;
  initialTaskId?: string | null;
  initialCommentId?: string | null;
  onClearTaskFocus?: () => void;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => Promise<void>;
};

function dueLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : 'Keine Deadline';
}

export function ProjectTasksPanel({ workspaceId, currentUserId, tasks, projects, members, defaultProjectId, initialTaskId, initialCommentId, onClearTaskFocus, loading, loadError, onRefresh }: Props) {
  const navigate = useNavigate();
  const sources = useTaskSourceLinks(workspaceId, tasks);
  const sourcesByTask = new Map(sources.sources.map(source => [source.task_id, source.kind]));
  const [filters, setFilters] = useState<TaskFilters>({ query: '', project: defaultProjectId, status: 'all', assignee: 'all' });
  const [editor, setEditor] = useState<NexusProjectTask | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const [today, setToday] = useState(localDateKey);

  useEffect(() => {
    mounted.current = true;
    const interval = window.setInterval(() => setToday(localDateKey()), 60_000);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, []);

  const membersById = useMemo(() => new Map(members.map(member => [member.user_id, member])), [members]);
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.title])), [projects]);
  const permissions = taskPermissions(currentUserId ? membersById.get(currentUserId)?.role : undefined);
  const summary = summarizeTasks(tasks, today, currentUserId);
  const visibleTasks = initialTaskId ? tasks.filter(task => task.id === initialTaskId) : filterTasks(tasks, filters, today, projectNames, membersById, currentUserId);
  const scopeTasks = filters.project === 'all' ? tasks : tasks.filter(task => task.project_id === filters.project);
  const scopeSummary = summarizeTasks(scopeTasks, today, currentUserId);
  const progress = scopeSummary.total ? Math.round(scopeSummary.done / scopeSummary.total * 100) : 0;

  const perform = async (id: string, action: () => Promise<{ error: string | null }>, success: string) => {
    if (busy.current) return;
    busy.current = true;
    setBusyId(id); setError(null); setFeedback(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (result.error) setError(result.error);
      else setFeedback(success);
      await onRefresh();
    } catch {
      if (mounted.current) setError('Die Verbindung wurde unterbrochen. Bitte aktualisieren und erneut versuchen.');
    } finally {
      busy.current = false;
      if (mounted.current) setBusyId(null);
    }
  };

  const openEditor = (task: NexusProjectTask | 'new') => {
    setError(null); setFeedback(null); setEditor(task);
  };

  const changeStatus = (task: NexusProjectTask, status: TaskStatus) => {
    if (!permissions.write) return;
    void perform(task.id, () => updateProjectTaskStatus(workspaceId, task, status), status === 'done' ? 'Aufgabe erledigt.' : 'Aufgabenstatus gespeichert.');
  };

  const removeTask = (task: NexusProjectTask) => {
    if (!permissions.delete || !window.confirm(`Aufgabe „${task.title}“ dauerhaft löschen?`)) return;
    void perform(task.id, () => deleteProjectTask(workspaceId, task), 'Aufgabe gelöscht.');
  };

  return <div className="project-tasks-panel">
    {!initialTaskId && <div className="task-summary">
      <button className={filters.assignee === 'me' ? 'active' : ''} disabled={!currentUserId} onClick={() => setFilters(f => ({ ...f, project: 'all', assignee: 'me', status: 'open' }))}>
        <UserRound size={17} /><b>{summary.mine}</b><span>Meine offenen Aufgaben</span>
      </button>
      <button onClick={() => setFilters(f => ({ ...f, project: 'all', assignee: 'all', status: 'open' }))}>
        <ListTodo size={17} /><b>{summary.open}</b><span>Offen im Team</span>
      </button>
      <button onClick={() => setFilters(f => ({ ...f, project: 'all', assignee: 'all', status: 'today' }))}>
        <CalendarDays size={17} /><b>{summary.today}</b><span>Heute fällig</span>
      </button>
      <button className={summary.overdue ? 'is-alert' : ''} onClick={() => setFilters(f => ({ ...f, project: 'all', assignee: 'all', status: 'overdue' }))}>
        <CalendarDays size={17} /><b>{summary.overdue}</b><span>Überfällig</span>
      </button>
    </div>}
    {initialTaskId && <div className="business-focus-note" role="status"><span>Aufgabendetails</span><button className="secondary" onClick={onClearTaskFocus}>Alle Projektaufgaben</button></div>}

    <div className="task-panel-head">
      <div><h2>Aufgaben im Team</h2><p>{permissions.write ? 'Arbeit verteilen, Fristen planen und Fortschritt teilen.' : 'Aufgaben, Zuständigkeiten und Fortschritt deines Teams ansehen.'}</p></div>
      {permissions.write && <button className="primary" disabled={loading || Boolean(loadError) || !projects.length || Boolean(busyId)} onClick={() => openEditor('new')}><Plus size={15} /> Aufgabe anlegen</button>}
    </div>
    {loadError && <div className="data-alert" role="alert">{loadError}</div>}
    {error && <div className="data-alert" role="alert">{error}</div>}
    {feedback && <div className="contact-feedback" role="status">{feedback}</div>}
    {sources.error && <p className="task-source-error" role="status">{sources.error} Beim erneuten Öffnen wird der Zugriff noch einmal geprüft.</p>}

    {!initialTaskId && <div className="task-filters panel">
      <label className="business-search"><Search size={15} /><input aria-label="Aufgaben durchsuchen" placeholder="Aufgabe, Projekt oder Person suchen…" value={filters.query} onChange={event => setFilters(f => ({ ...f, query: event.target.value }))} /></label>
      <label><span>Projekt</span><select value={filters.project} onChange={event => setFilters(f => ({ ...f, project: event.target.value }))}>
        <option value="all">Alle Projekte</option>
        {filters.project !== 'all' && !projectNames.has(filters.project) && <option value={filters.project} disabled>Projekt nicht mehr verfügbar</option>}
        {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select></label>
      <label><span>Status</span><select value={filters.status} onChange={event => setFilters(f => ({ ...f, status: event.target.value as TaskFilters['status'] }))}>
        <option value="all">Alle Status</option><option value="open">Alle offenen</option><option value="today">Heute fällig</option><option value="overdue">Überfällig</option>
        {taskStatuses.map(status => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}
      </select></label>
      <label><span>Verantwortlich</span><select value={filters.assignee} onChange={event => setFilters(f => ({ ...f, assignee: event.target.value }))}>
        <option value="all">Alle Personen</option><option value="me" disabled={!currentUserId}>Meine Aufgaben</option><option value="unassigned">Nicht zugewiesen</option>
        {members.filter(member => member.role !== 'guest').map(member => <option key={member.user_id} value={member.user_id}>{taskMemberName(member)}</option>)}
      </select></label>
      <button className="secondary" onClick={() => setFilters({ query: '', project: 'all', status: 'all', assignee: 'all' })}>Zurücksetzen</button>
    </div>}

    <div className="task-progress-line">
      <span><CheckCheck size={15} /> {scopeSummary.done} von {scopeSummary.total} Aufgaben erledigt{filters.project !== 'all' ? ' im Projekt' : ''}</span>
      <div className="business-progress" role="progressbar" aria-label="Aufgabenfortschritt" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><b>{progress}%</b>
    </div>

    {loading && !tasks.length ? <div className="panel business-loading">Aufgaben werden geladen…</div> : loadError && !tasks.length ? <div className="panel business-empty-state">Aufgaben derzeit nicht verfügbar.</div> : visibleTasks.length === 0 ?
      <div className="panel business-empty-state"><CheckSquare2 size={32} /><b>{initialTaskId ? 'Aufgabe nicht mehr verfügbar' : tasks.length ? 'Keine passenden Aufgaben' : 'Noch keine Aufgaben'}</b><span>{initialTaskId ? 'Die Aufgabe wurde entfernt oder ist für dich nicht mehr zugänglich.' : !projects.length ? 'Lege zuerst ein Projekt an. Aufgaben werden immer einem Projekt zugeordnet.' : tasks.length ? 'Ändere die Filter oder setze sie zurück.' : permissions.write ? 'Teile das Projekt in konkrete Schritte auf und lege die erste Aufgabe an.' : 'Dein Team kann hier Aufgaben anlegen.'}</span></div> :
      <div className="task-list">{visibleTasks.map(task => {
        const overdue = taskIsOverdue(task, today);
        const dueToday = task.status !== 'done' && task.due_date === today;
        return <article id={'nexus-task-' + task.id} className={`panel task-card ${task.status === 'done' ? 'is-done' : ''} ${initialTaskId === task.id ? 'is-focused' : ''}`} key={task.id} aria-label={task.title}>
          <div className="task-card-main">
            <span className={`task-state-dot task-${task.status}`} aria-hidden="true" />
            <div><span className="task-project-name">{projectNames.get(task.project_id) ?? 'Projekt nicht verfügbar'}</span><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}</div>
          </div>
          <div className="task-card-details">
            <span className={`business-badge priority-${task.priority}`}>{taskPriorityLabels[task.priority]}</span>
            <span><UserRound size={14} />{task.assigned_to ? taskMemberName(membersById.get(task.assigned_to)) : 'Nicht zugewiesen'}{task.assigned_to === currentUserId ? ' · Du' : ''}</span>
            <span className={overdue ? 'task-overdue' : dueToday ? 'task-due-today' : ''}><CalendarDays size={14} />{dueLabel(task.due_date)}{overdue ? ' · Überfällig' : dueToday ? ' · Heute' : ''}</span>
          </div>
          <div className="task-card-actions">
            {!initialTaskId && <button className="secondary" onClick={() => navigate(routes.business + '?' + businessSearch(workspaceId, { view: 'tasks', taskId: task.id, projectId: filters.project === 'all' ? undefined : filters.project }))}>Details & Zusammenarbeit</button>}
            {sourcesByTask.has(task.id) && <button className="secondary" onClick={() => navigate((sourcesByTask.get(task.id) === 'group' ? routes.groups : routes.chats) + '?' + new URLSearchParams({ task: task.id, workspace: workspaceId }).toString())}>Ursprungsnachricht öffnen</button>}
            {permissions.write ? <select aria-label={`Status für ${task.title}`} value={task.status} disabled={Boolean(busyId) || Boolean(loadError)} onChange={event => changeStatus(task, event.target.value as TaskStatus)}>{taskStatuses.map(status => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select> : <span className={`business-badge task-${task.status}`}>{taskStatusLabels[task.status]}</span>}
            {permissions.write && <button className="secondary" disabled={Boolean(busyId) || Boolean(loadError)} onClick={() => openEditor(task)}><SquarePen size={14} /> Bearbeiten</button>}
            {permissions.delete && <button className="task-delete" aria-label={`Aufgabe ${task.title} löschen`} disabled={Boolean(busyId) || Boolean(loadError)} onClick={() => removeTask(task)}><Trash2 size={15} /></button>}
          </div>
          {initialTaskId === task.id && currentUserId && membersById.get(currentUserId)?.role && !loadError && <TaskCollaboration
            key={`${currentUserId}:${workspaceId}:${task.id}:${membersById.get(currentUserId)!.role}`}
            workspaceId={workspaceId} taskId={task.id} initialCommentId={initialCommentId} currentUserId={currentUserId} role={membersById.get(currentUserId)!.role} members={members} />}
        </article>;
      })}</div>}

    {editor && <ProjectTaskDialog task={editor} workspaceId={workspaceId} projects={projects} members={members} canWrite={permissions.write && !loadError} defaultProjectId={filters.project} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); setFeedback(editor === 'new' ? 'Aufgabe erfolgreich angelegt.' : 'Aufgabe gespeichert.'); void onRefresh();
    }} />}
  </div>;
}

type DialogProps = {
  task: NexusProjectTask | 'new'; workspaceId: string; projects: NexusProject[]; members: NexusWorkspaceMember[];
  canWrite: boolean; defaultProjectId: string; onClose: () => void; onSaved: () => void;
};

function ProjectTaskDialog({ task, workspaceId, projects, members, canWrite, defaultProjectId, onClose, onSaved }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectTaskInput>(() => task === 'new' ? {
    project_id: projects.some(project => project.id === defaultProjectId) ? defaultProjectId : projects.find(project => !['completed', 'archived'].includes(project.status))?.id ?? projects[0]?.id ?? '',
    title: '', status: 'todo', priority: 'medium', assigned_to: null, due_date: null, description: null,
  } : { project_id: task.project_id, title: task.title, status: task.status, priority: task.priority, assigned_to: task.assigned_to, due_date: task.due_date, description: task.description });
  const assignableMembers = members.filter(member => member.role !== 'guest');
  const invalidAssignee = Boolean(draft.assigned_to && !assignableMembers.some(member => member.user_id === draft.assigned_to));
  const selectedProject = projects.find(project => project.id === draft.project_id);
  const afterProjectDeadline = Boolean(draft.due_date && selectedProject?.deadline && draft.due_date > selectedProject.deadline);

  useEffect(() => { dialog.current?.showModal(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !canWrite) return;
    if (!selectedProject) { setError('Bitte wähle ein verfügbares Projekt aus.'); return; }
    if (draft.title.trim().length < 2) { setError('Die Aufgabe braucht einen Titel mit mindestens 2 Zeichen.'); return; }
    if (invalidAssignee) { setError('Bitte wähle eine aktive Person aus dem Team oder „Nicht zugewiesen“.'); return; }
    busy.current = true; setSaving(true); setError(null);
    try {
      const result = task === 'new' ? await createProjectTask(workspaceId, draft) : await updateProjectTask(workspaceId, task.id, draft, task.updated_at);
      if (result.error) setError(result.error);
      else onSaved();
    } catch { setError('Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.'); }
    finally { busy.current = false; setSaving(false); }
  };

  return <dialog ref={dialog} className="business-modal task-dialog" aria-labelledby="task-dialog-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <div className="business-modal-head"><div><small>PROJEKTAUFGABE</small><h2 id="task-dialog-title">{task === 'new' ? 'Aufgabe anlegen' : 'Aufgabe bearbeiten'}</h2></div><button type="button" aria-label="Aufgabendialog schließen" disabled={saving} onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={event => void submit(event)}>
      {error && <div className="data-alert" role="alert">{error}</div>}
      {!canWrite && <div className="data-alert" role="alert">Deine Rolle erlaubt gerade keine Änderungen. Bitte schließen und aktualisieren.</div>}
      <fieldset className="business-form-grid task-fieldset" disabled={saving || !canWrite}>
        <label className="wide"><span>Aufgabentitel *</span><input autoFocus required minLength={2} maxLength={180} value={draft.title} onChange={event => setDraft(d => ({ ...d, title: event.target.value }))} placeholder="z. B. Startseite gestalten" /></label>
        <label className="wide"><span>Projekt *</span><select required value={draft.project_id} onChange={event => setDraft(d => ({ ...d, project_id: event.target.value }))}><option value="" disabled>Projekt auswählen</option>{!selectedProject && draft.project_id && <option value={draft.project_id} disabled>Projekt nicht mehr verfügbar</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label><span>Status</span><select value={draft.status} onChange={event => setDraft(d => ({ ...d, status: event.target.value as TaskStatus }))}>{taskStatuses.map(status => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select></label>
        <label><span>Priorität</span><select value={draft.priority} onChange={event => setDraft(d => ({ ...d, priority: event.target.value as ProjectTaskInput['priority'] }))}>{projectPriorities.map(priority => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}</select></label>
        <label><span>Verantwortliche Person</span><select value={draft.assigned_to ?? ''} onChange={event => setDraft(d => ({ ...d, assigned_to: event.target.value || null }))}><option value="">Nicht zugewiesen</option>{invalidAssignee && <option value={draft.assigned_to ?? ''} disabled>Person nicht mehr verfügbar</option>}{assignableMembers.map(member => <option key={member.user_id} value={member.user_id}>{taskMemberName(member)}</option>)}</select></label>
        <label><span>Deadline</span><input type="date" value={draft.due_date ?? ''} onChange={event => setDraft(d => ({ ...d, due_date: event.target.value || null }))} /></label>
        <label className="wide"><span>Beschreibung</span><textarea maxLength={4000} value={draft.description ?? ''} onChange={event => setDraft(d => ({ ...d, description: event.target.value }))} placeholder="Was soll erledigt werden? Was braucht das Team dafür?" /></label>
      </fieldset>
      {afterProjectDeadline && <p className="task-deadline-note" role="status">Diese Aufgabe ist später als die Projekt-Deadline ({dueLabel(selectedProject?.deadline ?? null)}) fällig.</p>}
      <div className="business-modal-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Abbrechen</button><button className="primary" disabled={saving || !canWrite || invalidAssignee || !selectedProject}>{saving ? 'Speichert…' : task === 'new' ? 'Aufgabe anlegen' : 'Änderungen speichern'}</button></div>
    </form>
  </dialog>;
}
