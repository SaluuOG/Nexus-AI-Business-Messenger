import { briefingLoadError } from '../features/data/readRetry';
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, FolderKanban, RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Header } from '../components/Header';
import type { BusinessTarget } from '../app/businessNavigation';
import type { NexusProjectTask } from '../features/data/businessData';
import { briefingDateKey, buildBriefing } from '../features/data/briefing';
import { useBriefingWorkspace } from '../features/data/useBriefingWorkspace';
import { taskPriorityLabels, taskStatusLabels } from '../features/data/projectTasks';

type Props = {
  openBusiness: (target?: BusinessTarget) => void;
  displayName?: string; workspaceId: string | null; workspaceName?: string;
  onRetryWorkspace?: () => void;
  currentUserId?: string; workspaceLoading?: boolean; workspaceError?: string | null;
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value + 'T12:00:00'));
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="briefing-empty-inline"><CheckCircle2 size={22} /><span>{children}</span></div>;
}
function More({ count, limit, onMore }: { count: number; limit: number; onMore: () => void }) {
  return count > limit ? <button className="briefing-link briefing-more" onClick={onMore}>Weitere anzeigen ({count - limit}) <ArrowRight size={14} /></button> : null;
}

export function BriefingPage({ openBusiness, displayName, workspaceId, workspaceName, currentUserId, workspaceLoading, workspaceError, onRetryWorkspace }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [taskLimit, setTaskLimit] = useState(5);
  const [attentionLimit, setAttentionLimit] = useState(5);
  const [projectLimit, setProjectLimit] = useState(4);
  const data = useBriefingWorkspace(workspaceId, currentUserId);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => { setTaskLimit(5); setAttentionLimit(5); setProjectLimit(4); }, [workspaceId, currentUserId]);
  const today = briefingDateKey(now);
  const model = useMemo(() => buildBriefing(data.projects, data.tasks, workspaceId ?? '', currentUserId, today), [data.projects, data.tasks, workspaceId, currentUserId, today]);
  const available = Boolean(data.updatedAt) && !data.error && !workspaceLoading && !workspaceError;
  const loading = Boolean(workspaceLoading) || data.loading;
  const error = workspaceError || data.error;
  const firstName = (displayName?.trim() || 'Nexus Nutzer').split(/\s+/)[0].toUpperCase();
  const greeting = now.getHours() < 12 ? 'GUTEN MORGEN' : now.getHours() < 18 ? 'GUTEN TAG' : 'GUTEN ABEND';
  const focus = model.attentionTasks.length
    ? `${model.attentionTasks.length} Aufgaben im Team brauchen Klärung. Prüfe Zuständigkeiten und Blockaden.`
    : model.dueTasks.length
      ? `${model.dueTasks.length} deiner Aufgaben sind heute fällig oder überfällig.`
      : model.overdueProjectCount
        ? `${model.overdueProjectCount} Projekte haben ihre Deadline überschritten.`
        : model.deadlineCount
          ? `${model.deadlineCount} Projekt-Deadlines stehen in den nächsten sieben Kalendertagen an.`
          : 'Aktuell sind keine eigenen Aufgaben fällig und keine Blockaden oder offenen Zuständigkeiten erfasst.';

  const taskRow = (task: NexusProjectTask, attention = false) => {
    const overdue = Boolean(task.due_date && task.due_date < today);
    const reasons = [task.status === 'blocked' ? 'Blockiert' : '', task.assigned_to === null ? 'Nicht zugewiesen' : ''].filter(Boolean).join(' · ');
    return <button type="button" className={'briefing-item ' + (overdue ? 'is-overdue' : '')} key={task.id}
      onClick={() => openBusiness({ view: 'tasks', projectId: task.project_id, taskId: task.id })}>
      {attention ? <UsersRound size={18} /> : overdue ? <CircleAlert size={18} /> : <CalendarClock size={18} />}
      <span className="briefing-item-copy"><b>{task.title}</b><small>{model.projectNames.get(task.project_id) ?? 'Projekt nicht verfügbar'} · {attention ? reasons : taskStatusLabels[task.status]}</small></span>
      <span className="briefing-item-side"><strong>{task.due_date ? dateLabel(task.due_date) : 'Keine Deadline'}{overdue ? ' · Überfällig' : task.due_date === today ? ' · Heute' : ''}</strong><small>{taskPriorityLabels[task.priority]}</small></span>
    </button>;
  };

  return <section className="page briefing-page" aria-busy={loading}>
    <div className="title-row briefing-title-row">
      <Header kicker={greeting + ', ' + firstName} title="Dein Tagesbriefing"
        sub={workspaceName ? 'Deine Prioritäten im Workspace ' + workspaceName + '.' : 'Aufgaben, Deadlines und Handlungsbedarf auf einen Blick.'} />
      {(workspaceId || workspaceError) && <button className="secondary briefing-refresh" onClick={() => workspaceError && onRetryWorkspace ? onRetryWorkspace() : void data.refresh()} disabled={loading}><RefreshCw size={15} />{loading ? 'Lädt…' : error ? 'Erneut laden' : 'Aktualisieren'}</button>}
    </div>
    {error && <div className="data-alert" role="alert">{briefingLoadError(error)}</div>}
    {!workspaceId ? <div className="panel briefing-empty">
      <FolderKanban size={34} /><b>{workspaceLoading ? 'Workspaces werden geladen…' : workspaceError ? 'Workspaces konnten nicht geladen werden' : 'Noch kein Workspace ausgewählt'}</b>
      {!workspaceLoading && !workspaceError && <span>Lege in den Einstellungen einen Workspace an oder wähle einen bestehenden aus.</span>}
    </div> : <>
      <div className="briefing-live-note" role="status">
        <span className={'briefing-live-pill ' + (data.connection === 'connected' && available ? 'is-connected' : '')}><i />
          {error ? 'Aktualisierung fehlgeschlagen' : data.connection === 'disconnected' ? 'Live-Verbindung unterbrochen' : data.connection === 'connected' ? 'Automatische Aktualisierung' : 'Verbindung wird hergestellt…'}
        </span>
        <span>{data.updatedAt && !error ? 'Stand ' + new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(data.updatedAt) : loading ? 'Daten werden geladen…' : 'Bitte erneut aktualisieren.'}</span>
      </div>
      <div className="stats">
        {[
          [model.openCount, 'Offen im Team'],
          [model.mineCount, 'Meine offenen Aufgaben'],
          [model.deadlineCount, 'Projekt-Deadlines · 7 Tage'],
          [model.attentionTasks.length, 'Handlungsbedarf'],
        ].map(([value, label]) => <div className="stat briefing-stat" key={label}><b>{available ? value : '—'}</b><span>{label}</span></div>)}
      </div>
      {!available ? <div className="panel briefing-empty"><FolderKanban size={28} /><b>{loading ? 'Dein Briefing wird geladen…' : 'Briefing derzeit nicht verfügbar'}</b><span>{loading ? 'Aufgaben und Projekte werden synchronisiert.' : 'Aktualisiere die Übersicht, um den aktuellen Stand zu laden.'}</span></div> : <>
        <div className="grid briefing-grid">
          <section className="panel briefing-section" aria-labelledby="briefing-today">
            <div className="briefing-panel-head"><div><h2 id="briefing-today">Heute erledigen <span>{model.dueTasks.length}</span></h2><p>Deine heute fälligen und überfälligen Aufgaben.{model.overdueCount > 0 ? ' Davon ' + model.overdueCount + ' überfällig.' : ''}</p></div>
              <button className="briefing-link" onClick={() => openBusiness({ view: 'tasks' })}>Alle Aufgaben <ArrowRight size={14} /></button></div>
            {model.dueTasks.length ? <div className="briefing-list">{model.dueTasks.slice(0, taskLimit).map(task => taskRow(task))}</div> : <Empty>Keine eigenen Aufgaben bis heute fällig.</Empty>}
            <More count={model.dueTasks.length} limit={taskLimit} onMore={() => setTaskLimit(n => n + 5)} />
          </section>
          <section className="panel briefing-section" aria-labelledby="briefing-projects">
            <div className="briefing-panel-head"><div><h2 id="briefing-projects">Projekte im Blick <span>{model.activeProjects.length}</span></h2><p>Überfällige Projekte zuerst, danach die nächsten Deadlines. Sieben-Tage-Zeitraum: {dateLabel(today)} – {dateLabel(model.endDate)}.</p></div>
              <button className="briefing-link" onClick={() => openBusiness({ view: 'projects' })}>Alle Projekte <ArrowRight size={14} /></button></div>
            {model.activeProjects.length ? <div className="briefing-project-list">{model.activeProjects.slice(0, projectLimit).map(project => <button type="button" className="briefing-project-row" key={project.id} onClick={() => openBusiness({ view: 'projects', projectId: project.id })}>
              <span className="briefing-project-icon"><FolderKanban size={17} /></span>
              <span className="briefing-project-copy"><b>{project.title}</b><small>{project.deadline ? dateLabel(project.deadline) : 'Keine Deadline'}{project.deadline && project.deadline < today ? ' · Überfällig' : ''}</small></span>
              <span className="briefing-project-progress"><small>Projektfortschritt</small><i role="progressbar" aria-label={'Fortschritt ' + project.title} aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}><em style={{ width: Math.min(100, Math.max(0, project.progress)) + '%' }} /></i><strong>{project.progress}%</strong></span>
            </button>)}</div> : <Empty>Noch keine aktiven Projekte im Workspace.</Empty>}
            <More count={model.activeProjects.length} limit={projectLimit} onMore={() => setProjectLimit(n => n + 4)} />
          </section>
        </div>
        <div className="grid briefing-grid briefing-grid-lower">
          <section className="panel briefing-section" aria-labelledby="briefing-attention">
            <div className="briefing-panel-head"><div><h2 id="briefing-attention">Handlungsbedarf <span>{model.attentionTasks.length}</span></h2><p>Blockierte oder nicht zugewiesene Aufgaben im gesamten Team.</p></div></div>
            {model.attentionTasks.length ? <div className="briefing-list">{model.attentionTasks.slice(0, attentionLimit).map(task => taskRow(task, true))}</div> : <Empty>Keine blockierten oder nicht zugewiesenen Aufgaben.</Empty>}
            <More count={model.attentionTasks.length} limit={attentionLimit} onMore={() => setAttentionLimit(n => n + 5)} />
          </section>
          <section className="panel briefing-section briefing-focus-card" aria-labelledby="briefing-focus">
            <Sparkles size={21} /><h2 id="briefing-focus">Arbeitsfokus</h2><p>{focus}</p>
            <button className="primary" onClick={() => openBusiness({ view: model.attentionTasks.length || model.dueTasks.length ? 'tasks' : 'projects' })}>Business öffnen <ArrowRight size={15} /></button>
          </section>
        </div>
      </>}
    </>}
  </section>;
}
