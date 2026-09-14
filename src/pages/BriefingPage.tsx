import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FolderKanban,
  ListTodo,
  RefreshCw,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../components/Header';
import {
  loadBusinessWorkspace,
  subscribeToBusinessWorkspace,
  unsubscribeBusinessWorkspace,
  type NexusProject,
  type NexusProjectTask,
} from '../features/data/businessData';
import {
  localDateKey,
  taskIsOverdue,
  taskPriorityLabels,
  taskStatusLabels,
} from '../features/data/projectTasks';

type BriefingTarget = {
  view?: 'projects' | 'tasks';
  projectId?: string;
  taskId?: string;
};

type BriefingPageProps = {
  openChat: () => void;
  openBusiness: (target?: BriefingTarget) => void;
  displayName?: string;
  workspaceId: string | null;
  workspaceName?: string;
  currentUserId?: string;
};

const activeProjectStatuses = new Set([
  'planning',
  'active',
  'review',
  'waiting_customer',
]);

const projectStatusLabels: Record<NexusProject['status'], string> = {
  planning: 'Planung',
  active: 'In Arbeit',
  review: 'Review',
  waiting_customer: 'Wartet auf Kunde',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
};

function formatDate(value: string | null) {
  if (!value) return 'Keine Deadline';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value + 'T12:00:00'));
}

function dateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function sortTasks(a: NexusProjectTask, b: NexusProjectTask) {
  const dueA = a.due_date ?? '9999-12-31';
  const dueB = b.due_date ?? '9999-12-31';
  if (dueA !== dueB) return dueA.localeCompare(dueB);
  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  return (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'GUTEN MORGEN' : hour < 18 ? 'GUTEN TAG' : 'GUTEN ABEND';
}

function Stat({ n, t, className = '' }: { n: string; t: string; className?: string }) {
  return (
    <div className={'stat briefing-stat ' + className}>
      <b>{n}</b>
      <span>{t}</span>
    </div>
  );
}

export function BriefingPage({
  openChat,
  openBusiness,
  displayName,
  workspaceId,
  workspaceName,
  currentUserId,
}: BriefingPageProps) {
  const firstName = (displayName || 'Nexus Nutzer').trim().split(/\s+/)[0].toUpperCase();
  const today = localDateKey();
  const weekEnd = dateAfter(7);
  const [tasks, setTasks] = useState<NexusProjectTask[]>([]);
  const [projects, setProjects] = useState<NexusProject[]>([]);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [error, setError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(
    async (showLoader = true) => {
      const requestId = ++requestVersion.current;
      if (!workspaceId) {
        setTasks([]);
        setProjects([]);
        setError(null);
        setTaskError(null);
        setLastUpdated(null);
        setLoading(false);
        return;
      }
      if (showLoader) setLoading(true);
      try {
        const result = await loadBusinessWorkspace(workspaceId);
        if (requestId !== requestVersion.current) return;
        setTasks(result.tasks);
        setProjects(result.projects);
        setError(result.error);
        setTaskError(result.taskError);
        setLastUpdated(new Date());
      } catch {
        if (requestId !== requestVersion.current) return;
        setError('Das Briefing konnte nicht geladen werden. Bitte erneut aktualisieren.');
        setTaskError('Aufgaben konnten nicht geladen werden. Bitte erneut aktualisieren.');
      } finally {
        if (requestId === requestVersion.current) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    setTasks([]);
    setProjects([]);
    setLastUpdated(null);
    void refresh();

    if (!workspaceId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(false), 150);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const channel = subscribeToBusinessWorkspace(workspaceId, scheduleRefresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', scheduleRefresh);
    return () => {
      requestVersion.current += 1;
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', scheduleRefresh);
      void unsubscribeBusinessWorkspace(channel);
    };
  }, [refresh, workspaceId]);

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'done'),
    [tasks],
  );
  const dueTasks = useMemo(
    () =>
      openTasks
        .filter((task) => task.due_date && task.due_date <= today)
        .sort(sortTasks)
        .slice(0, 5),
    [openTasks, today],
  );
  const upcomingProjects = useMemo(() => {
    const active = projects.filter((project) => activeProjectStatuses.has(project.status));
    const withDeadline = active
      .filter((project) => project.deadline && project.deadline >= today)
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
    return (withDeadline.length ? withDeadline : active).slice(0, 4);
  }, [projects, today]);
  const deadlineProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          activeProjectStatuses.has(project.status) &&
          Boolean(project.deadline) &&
          (project.deadline ?? '') >= today &&
          (project.deadline ?? '') <= weekEnd,
      ),
    [projects, today, weekEnd],
  );
  const attentionTasks = useMemo(() => {
    const unique = new Map<string, NexusProjectTask>();
    for (const task of openTasks.filter((item) => item.status === 'blocked' || !item.assigned_to)) {
      unique.set(task.id, task);
    }
    return [...unique.values()].sort(sortTasks).slice(0, 5);
  }, [openTasks]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const ownOpenCount = currentUserId
    ? openTasks.filter((task) => task.assigned_to === currentUserId).length
    : 0;
  const focusText = attentionTasks.length
    ? 'Zuerst blockierte oder noch nicht zugewiesene Aufgaben klären.'
    : dueTasks.length
      ? 'Die fälligen Aufgaben für heute sind bereit.'
      : 'Der Workspace ist für den nächsten Schritt sauber vorbereitet.';

  return (
    <section className="page briefing-page">
      <div className="title-row briefing-title-row">
        <Header
          kicker={greeting() + ', ' + firstName}
          title="Dein Tagesbriefing"
          sub={
            workspaceName
              ? 'Live-Übersicht für den Workspace ' + workspaceName + '.'
              : 'Aufgaben, Deadlines und Handlungsbedarf auf einen Blick.'
          }
        />
        {workspaceId && (
          <div className="briefing-actions">
            <span className="briefing-live-pill"><i /> Live-Daten</span>
            <button className="secondary" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={15} />
              {loading ? 'Lädt…' : 'Aktualisieren'}
            </button>
          </div>
        )}
      </div>

      {!workspaceId ? (
        <div className="panel briefing-empty">
          <FolderKanban size={34} />
          <b>Noch kein Workspace ausgewählt</b>
          <span>Lege in den Einstellungen einen Workspace an oder wähle links einen bestehenden aus.</span>
        </div>
      ) : (
        <>
          {(error || taskError) && (
            <div className="data-alert" role="alert">
              {error || taskError}
            </div>
          )}
          <div className="briefing-live-note">
            <span className="briefing-live-pill"><i /> Automatische Aktualisierung</span>
            <span>
              {lastUpdated
                ? 'Zuletzt synchronisiert um ' +
                  new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(lastUpdated)
                : 'Workspace wird synchronisiert…'}
            </span>
          </div>

          <div className="stats">
            <Stat n={String(openTasks.length)} t="Offene Aufgaben" />
            <Stat n={String(ownOpenCount)} t="Meine offenen Aufgaben" />
            <Stat n={String(deadlineProjects.length)} t="Projekt-Deadlines in 7 Tagen" className={deadlineProjects.length ? 'is-alert' : ''} />
            <Stat n={String(attentionTasks.length)} t="Handlungsbedarf" className={attentionTasks.length ? 'is-alert' : ''} />
          </div>

          <div className="grid briefing-grid">
            <div className="panel briefing-section">
              <div className="briefing-panel-head">
                <div>
                  <h3>Heute erledigen</h3>
                  <p>Fällige und überfällige Aufgaben aus deinem Workspace.</p>
                </div>
                <button className="briefing-link" onClick={() => openBusiness({ view: 'tasks' })}>
                  Alle Aufgaben <ArrowRight size={14} />
                </button>
              </div>
              {loading && !tasks.length ? (
                <div className="briefing-loading">Aufgaben werden geladen…</div>
              ) : dueTasks.length ? (
                <div className="briefing-list">
                  {dueTasks.map((task) => {
                    const overdue = taskIsOverdue(task, today);
                    return (
                      <button
                        type="button"
                        className={'briefing-item ' + (overdue ? 'is-overdue' : '')}
                        key={task.id}
                        onClick={() => openBusiness({ view: 'tasks', projectId: task.project_id, taskId: task.id })}
                      >
                        {overdue ? <CircleAlert size={18} /> : <CalendarClock size={18} />}
                        <span className="briefing-item-copy">
                          <b>{task.title}</b>
                          <small>
                            {projectNames.get(task.project_id) ?? 'Projekt nicht verfügbar'} · {taskStatusLabels[task.status]}
                          </small>
                        </span>
                        <span className="briefing-item-side">
                          <strong>{task.due_date ? formatDate(task.due_date) : 'Ohne Deadline'}</strong>
                          <small>{taskPriorityLabels[task.priority]}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="briefing-empty-inline">
                  <CheckCircle2 size={22} />
                  <span>Keine fälligen Aufgaben. Gute Ausgangslage.</span>
                </div>
              )}
            </div>

            <div className="panel briefing-section">
              <div className="briefing-panel-head">
                <div>
                  <h3>Projekte im Blick</h3>
                  <p>Aktive Projekte und die nächsten Deadlines.</p>
                </div>
                <button className="briefing-link" onClick={() => openBusiness({ view: 'projects' })}>
                  Alle Projekte <ArrowRight size={14} />
                </button>
              </div>
              {loading && !projects.length ? (
                <div className="briefing-loading">Projekte werden geladen…</div>
              ) : upcomingProjects.length ? (
                <div className="briefing-project-list">
                  {upcomingProjects.map((project) => (
                    <button
                      type="button"
                      className="briefing-project-row"
                      key={project.id}
                      onClick={() => openBusiness({ view: 'projects', projectId: project.id })}
                    >
                      <span className="briefing-project-icon"><FolderKanban size={17} /></span>
                      <span className="briefing-project-copy">
                        <b>{project.title}</b>
                        <small>
                          {project.deadline ? formatDate(project.deadline) : 'Keine Deadline'} · {projectStatusLabels[project.status]}
                        </small>
                      </span>
                      <span className="briefing-project-progress">
                        <i><em style={{ width: Math.min(100, Math.max(0, project.progress)) + '%' }} /></i>
                        <strong>{project.progress}%</strong>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="briefing-empty-inline">
                  <FolderKanban size={22} />
                  <span>Noch keine aktiven Projekte im Workspace.</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid briefing-grid briefing-grid-lower">
            <div className="panel briefing-section">
              <div className="briefing-panel-head">
                <div>
                  <h3>Handlungsbedarf</h3>
                  <p>Blockierte oder noch nicht zugewiesene Aufgaben.</p>
                </div>
                <button className="briefing-link" onClick={() => openBusiness({ view: 'tasks' })}>
                  Öffnen <ArrowRight size={14} />
                </button>
              </div>
              {attentionTasks.length ? (
                <div className="briefing-list">
                  {attentionTasks.map((task) => (
                    <button
                      type="button"
                      className="briefing-item is-attention"
                      key={task.id}
                      onClick={() => openBusiness({ view: 'tasks', projectId: task.project_id, taskId: task.id })}
                    >
                      <UsersRound size={18} />
                      <span className="briefing-item-copy">
                        <b>{task.title}</b>
                        <small>
                          {projectNames.get(task.project_id) ?? 'Projekt nicht verfügbar'} · {task.status === 'blocked' ? 'Blockiert' : 'Nicht zugewiesen'}
                        </small>
                      </span>
                      <span className="briefing-item-side">
                        <strong>{task.assigned_to ? 'Zugewiesen' : 'Offen'}</strong>
                        <small>{taskPriorityLabels[task.priority]}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="briefing-empty-inline">
                  <CheckCircle2 size={22} />
                  <span>Kein offener Handlungsbedarf.</span>
                </div>
              )}
            </div>

            <div className="panel briefing-section briefing-focus-card">
              <Sparkles size={21} />
              <h3>Arbeitsfokus</h3>
              <p>{focusText}</p>
              <div className="briefing-focus-meta">
                <span><ListTodo size={14} /> {openTasks.length} offen</span>
                <span><CircleAlert size={14} /> {attentionTasks.length} Klärfälle</span>
              </div>
              <button className="primary" onClick={() => attentionTasks.length || dueTasks.length ? openBusiness({ view: 'tasks' }) : openChat()}>
                {attentionTasks.length || dueTasks.length ? 'Aufgaben öffnen' : 'Zum Chat'} <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
