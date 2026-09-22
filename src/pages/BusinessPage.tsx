import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Copy,
  CircleDollarSign,
  FolderKanban,
  Globe2,
  Mail,
  MessageCircle,
  ListTodo,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { businessSearch, readBusinessSearch } from '../app/businessNavigation';
import { Header } from '../components/Header';
import { ProjectTemplatePicker, SaveProjectTemplate } from '../components/ProjectTemplates';
import { cleanInitialChecklists } from '../features/data/projectTemplates';
import { ProjectTasksPanel } from '../components/ProjectTasksPanel';
import {
  createCustomer,
  createProjectWithTasks,
  customerStatuses,
  deleteCustomer,
  deleteProject,
  loadBusinessWorkspace,
  projectPriorities,
  projectStatuses,
  subscribeToBusinessWorkspace,
  unsubscribeBusinessWorkspace,
  updateCustomer,
  updateProject,
  type CustomerInput,
  type CustomerStatus,
  type NexusCustomer,
  type NexusProject,
  type NexusProjectTask,
  type ProjectInput,
  type ProjectPriority,
  type ProjectStatus,
  type InitialProjectTask,
} from '../features/data/businessData';
import { loadNexusContacts, type NexusContact } from '../features/data/contactsData';
import { taskMemberName } from '../features/data/projectTasks';
import type { NexusWorkspaceMember, WorkspaceRole } from '../features/data/nexusData';

type BusinessPageProps = {
  workspaceId: string | null;
  workspaceName?: string;
  workspaceRole?: WorkspaceRole;
  currentUserId?: string;
  workspaceLoading?: boolean;
  workspaceError?: string | null;
  onStartChat: (contactUserId: string) => Promise<{ error: string | null }>;
};

type CustomerDraft = {
  name: string;
  contactName: string;
  chatUserId: string;
  email: string;
  phone: string;
  website: string;
  status: CustomerStatus;
  notes: string;
};

type ProjectDraft = {
  title: string;
  customerId: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  value: string;
  deadline: string;
  progress: string;
  description: string;
};

const customerStatusLabels: Record<CustomerStatus, string> = {
  lead: 'Lead',
  active: 'Aktiv',
  inactive: 'Inaktiv',
};

const projectStatusLabels: Record<ProjectStatus, string> = {
  planning: 'Planung',
  active: 'In Arbeit',
  review: 'Review',
  waiting_customer: 'Wartet auf Kunde',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
};

const projectPriorityLabels: Record<ProjectPriority, string> = {
  low: 'Niedrig',
  medium: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend',
};

const emptyCustomerDraft: CustomerDraft = {
  name: '',
  contactName: '',
  chatUserId: '',
  email: '',
  phone: '',
  website: '',
  status: 'lead',
  notes: '',
};

const emptyProjectDraft: ProjectDraft = {
  title: '',
  customerId: '',
  status: 'planning',
  priority: 'medium',
  value: '',
  deadline: '',
  progress: '0',
  description: '',
};

const activeProjectStatuses: ProjectStatus[] = [
  'planning',
  'active',
  'review',
  'waiting_customer',
];

function formatMoney(cents: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return 'Keine Deadline';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function websiteUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function customerDraftFrom(customer: NexusCustomer): CustomerDraft {
  return {
    name: customer.name,
    contactName: customer.contact_name ?? '',
    chatUserId: customer.chat_user_id ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    website: customer.website ?? '',
    status: customer.status,
    notes: customer.notes ?? '',
  };
}

function projectDraftFrom(project: NexusProject): ProjectDraft {
  return {
    title: project.title,
    customerId: project.customer_id ?? '',
    status: project.status,
    priority: project.priority,
    value: (project.value_cents / 100).toFixed(2),
    deadline: project.deadline ?? '',
    progress: String(project.progress),
    description: project.description ?? '',
  };
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: '', error: null };
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid protocol');
    return { value: url.toString(), error: null };
  } catch {
    return { value: trimmed, error: 'Bitte gib eine gültige Website-Adresse ein.' };
  }
}

export function BusinessPage({ workspaceId, workspaceName, currentUserId, workspaceLoading, workspaceError, onStartChat }: BusinessPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = readBusinessSearch(searchParams.toString(), workspaceId);
  const { view, projectId: requestedProjectId, taskId: requestedTaskId } = selection;
  const taskProjectId = requestedProjectId || 'all';
  const setView = (next: 'projects' | 'customers' | 'tasks') => setSearchParams(businessSearch(workspaceId, { view: next }));
  const [customers, setCustomers] = useState<NexusCustomer[]>([]);
  const [projects, setProjects] = useState<NexusProject[]>([]);
  const [tasks, setTasks] = useState<NexusProjectTask[]>([]);
  const [members, setMembers] = useState<NexusWorkspaceMember[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<ProjectStatus | 'all'>('all');
  const [customerFilter, setCustomerFilter] = useState<CustomerStatus | 'all'>('all');
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [customerEditor, setCustomerEditor] = useState<NexusCustomer | 'new' | null>(null);
  const [projectEditor, setProjectEditor] = useState<NexusProject | 'new' | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomerDraft);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyProjectDraft);
  const [templateSource, setTemplateSource] = useState<NexusProject | null>(null);
  const [initialTasks, setInitialTasks] = useState<InitialProjectTask[]>([]);
  const [contacts, setContacts] = useState<NexusContact[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [openingChat, setOpeningChat] = useState<string | null>(null);
  const projectRequestId = useRef('');
  const saveBusy = useRef(false);
  const requestVersion = useRef(0);

  // Memberships refresh on Realtime/focus; the shell's initial role can be stale.
  const workspaceRole = members.find(member => member.user_id === currentUserId)?.role;
  const canCreate = workspaceRole === 'owner' || workspaceRole === 'admin';
  const canEdit = canCreate;
  const canDelete = canCreate;
  const editorScope = useRef(0);
  useEffect(() => { editorScope.current += 1; return () => { editorScope.current += 1; }; }, [workspaceId, currentUserId, workspaceRole]);

  useEffect(() => {
    if (!canEdit) { setCustomerEditor(null); setProjectEditor(null); setTemplateSource(null); setInitialTasks([]); }
  }, [canEdit]);

  useEffect(() => {
    if (!customerEditor) return;
    let active = true;
    setContactsLoading(true); setContactsError(null);
    void loadNexusContacts().then(result => {
      if (!active) return;
      setContacts(result.data); setContactsError(result.error); setContactsLoading(false);
    }).catch(() => { if (active) { setContactsError('Kontakte konnten nicht geladen werden. Bitte den Dialog erneut öffnen.'); setContactsLoading(false); } });
    return () => { active = false; };
  }, [customerEditor]);

  const refresh = useCallback(
    async (showLoader = true) => {
      const requestId = ++requestVersion.current;
      if (!workspaceId) {
        setCustomers([]);
        setProjects([]);
        setTasks([]); setMembers([]); setTaskError(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (showLoader) setLoading(true);
      try {
        const result = await loadBusinessWorkspace(workspaceId);
        if (requestId !== requestVersion.current) return;
        setCustomers(result.customers);
        setProjects(result.projects);
        setTasks(result.tasks); setMembers(result.members); setTaskError(result.taskError);
        setError(result.error);
      } catch {
        if (requestId !== requestVersion.current) return;
        setMembers([]);
        setError('Business-Daten konnten nicht geladen werden. Bitte erneut aktualisieren.');
        setTaskError('Aufgaben konnten nicht geladen werden. Bitte erneut aktualisieren.');
      } finally {
        if (requestId === requestVersion.current) setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    setFeedback(null);
    setCustomerEditor(null);
    setProjectEditor(null);
    void refresh();

    if (!workspaceId) return;
    let refreshTimer: ReturnType<typeof setTimeout>;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(false), 150);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') scheduleRefresh(); };
    const channel = subscribeToBusinessWorkspace(workspaceId, scheduleRefresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', scheduleRefresh);
    return () => {
      requestVersion.current += 1;
      clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', scheduleRefresh);
      void unsubscribeBusinessWorkspace(channel);
    };
  }, [refresh, workspaceId]);

  useEffect(() => {
    if (!customerEditor && !projectEditor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        setCustomerEditor(null);
        setProjectEditor(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [customerEditor, projectEditor, saving]);

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (project.customer_id) {
        counts.set(project.customer_id, (counts.get(project.customer_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const projectTaskCounts = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>();
    for (const task of tasks) {
      const count = counts.get(task.project_id) ?? { total: 0, done: 0 };
      count.total++;
      if (task.status === 'done') count.done++;
      counts.set(task.project_id, count);
    }
    return counts;
  }, [tasks]);

  const openTasks = (projectId = 'all') => {
    setSearchParams(businessSearch(workspaceId, { view: 'tasks', projectId: projectId === 'all' ? undefined : projectId }));
  };

  const normalizedQuery = query.trim().toLocaleLowerCase('de-DE');
  const visibleProjects = projects.filter((project) => {
    const customer = project.customer_id ? customerById.get(project.customer_id) : null;
    const matchesQuery =
      !normalizedQuery ||
      project.title.toLocaleLowerCase('de-DE').includes(normalizedQuery) ||
      customer?.name.toLocaleLowerCase('de-DE').includes(normalizedQuery) ||
      project.description?.toLocaleLowerCase('de-DE').includes(normalizedQuery);
    if (requestedProjectId) return project.id === requestedProjectId;
    return matchesQuery && (projectFilter === 'all' || project.status === projectFilter);
  });

  const visibleCustomers = customers.filter((customer) => {
    const searchable = [
      customer.name,
      customer.contact_name,
      customer.email,
      customer.phone,
      customer.website,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('de-DE');
    return (
      (!normalizedQuery || searchable.includes(normalizedQuery)) &&
      (customerFilter === 'all' || customer.status === customerFilter)
    );
  });

  const activeProjects = projects.filter((project) => activeProjectStatuses.includes(project.status));
  const openValue = activeProjects.reduce((sum, project) => sum + project.value_cents, 0);
  const today = localDateKey();
  const overdueProjects = activeProjects.filter(
    (project) => project.deadline && project.deadline < today,
  ).length;

  const openNewCustomer = () => {
    setFeedback(null);
    setError(null);
    setCustomerDraft(emptyCustomerDraft);
    setCustomerEditor('new');
  };

  const openCustomer = (customer: NexusCustomer) => {
    setFeedback(null);
    setError(null);
    setCustomerDraft(customerDraftFrom(customer));
    setCustomerEditor(customer);
  };

  const openNewProject = () => {
    setFeedback(null);
    setError(null);
    setProjectDraft(emptyProjectDraft);
    setInitialTasks([]);
    projectRequestId.current = crypto.randomUUID();
    setProjectEditor('new');
  };

  const openProject = (project: NexusProject) => {
    setFeedback(null);
    setError(null);
    setProjectDraft(projectDraftFrom(project));
    setProjectEditor(project);
  };

  const updateInitialTask = (id: string, patch: Partial<InitialProjectTask>) => {
    setInitialTasks(current => current.map(task => task.id === id ? { ...task, ...patch } : task));
  };

  const openCustomerChat = async (customer: NexusCustomer) => {
    if (openingChat) return;
    if (!customer.chat_user_id) {
      if (canEdit) {
        openCustomer(customer);
        setFeedback('Wähle im Kundenformular den Nexus-Kontakt für den Kundenchat aus.');
      } else setFeedback('Für diesen Kunden ist noch kein Nexus-Kontakt verknüpft. Bitte einen Owner oder Admin darum bitten.');
      return;
    }
    if (customer.chat_user_id === currentUserId) {
      setFeedback('Dieser Kunde ist mit deinem eigenen Nexus-Konto verknüpft.');
      return;
    }
    setOpeningChat(customer.id); setError(null); setFeedback(null);
    try {
      const result = await onStartChat(customer.chat_user_id);
      if (result.error) setError(result.error.includes('Nexus-Kontakten')
        ? 'Verbinde dich zuerst im Bereich Kontakte mit diesem Kunden. Danach öffnet die Sprechblase euren privaten Chat.' : result.error);
    } catch { setError('Der Kundenchat konnte nicht geöffnet werden. Bitte erneut versuchen.'); }
    finally { setOpeningChat(null); }
  };

  const saveCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !customerEditor || !canEdit || saveBusy.current) return;
    if (customerDraft.name.trim().length < 2) {
      setError('Der Kundenname muss mindestens 2 Zeichen lang sein.');
      return;
    }
    if (customerDraft.email && !/^\S+@\S+\.\S+$/.test(customerDraft.email.trim())) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }
    const website = normalizeWebsite(customerDraft.website);
    if (website.error) {
      setError(website.error);
      return;
    }

    const input: CustomerInput = {
      name: customerDraft.name,
      contact_name: customerDraft.contactName,
      chat_user_id: customerDraft.chatUserId || null,
      email: customerDraft.email,
      phone: customerDraft.phone,
      website: website.value,
      status: customerDraft.status,
      notes: customerDraft.notes,
    };
    saveBusy.current = true;
    setSaving(true);
    setError(null);
    const result = await (customerEditor === 'new'
      ? createCustomer(workspaceId, input)
      : updateCustomer(customerEditor.id, input)).catch(() => ({ data: null, error: 'Die Verbindung wurde unterbrochen. Bitte erneut versuchen.' }));
    saveBusy.current = false;
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    const wasNew = customerEditor === 'new';
    setCustomerEditor(null);
    setFeedback(wasNew ? 'Kunde erfolgreich angelegt.' : 'Kunde gespeichert.');
    await refresh(false);
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !projectEditor || !canEdit || saveBusy.current) return;
    const value = Number(projectDraft.value.replace(',', '.') || 0);
    const progress = Number(projectDraft.progress);
    if (projectDraft.title.trim().length < 2) {
      setError('Der Projekttitel muss mindestens 2 Zeichen lang sein.');
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) {
      setError('Bitte gib einen gültigen Auftragswert ein.');
      return;
    }
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      setError('Der Fortschritt muss zwischen 0 und 100 Prozent liegen.');
      return;
    }

    const input: ProjectInput = {
      title: projectDraft.title,
      customer_id: projectDraft.customerId || null,
      status: projectDraft.status,
      priority: projectDraft.priority,
      value_cents: Math.round(value * 100),
      deadline: projectDraft.deadline || null,
      progress,
      description: projectDraft.description,
    };
    if (projectEditor === 'new' && initialTasks.some(task => task.title.trim().length < 2)) {
      setError('Bitte gib jeder Aufgabe einen Titel mit mindestens 2 Zeichen oder entferne die leere Aufgabe.');
      return;
    }
    let tasksToCreate: InitialProjectTask[];
    try { tasksToCreate = projectEditor === 'new' ? cleanInitialChecklists(initialTasks) : []; } catch (reason) { setError((reason as Error).message); return; }
    const scope = editorScope.current;
    saveBusy.current = true;
    setSaving(true);
    setError(null);
    const result = await (projectEditor === 'new'
      ? createProjectWithTasks(workspaceId, projectRequestId.current, input, tasksToCreate)
      : updateProject(projectEditor.id, input)).catch(() => ({ data: null, error: 'Die Verbindung wurde unterbrochen. Bitte erneut versuchen.' }));
    saveBusy.current = false;
    setSaving(false);
    if (scope !== editorScope.current) return;
    if (result.error) {
      setError(result.error);
      return;
    }
    const wasNew = projectEditor === 'new';
    setProjectEditor(null);
    setFeedback(wasNew ? 'Projekt erfolgreich angelegt.' : 'Projekt gespeichert.');
    await refresh(false);
  };

  const removeCustomer = async (customer: NexusCustomer) => {
    if (!window.confirm(`${customer.name} wirklich löschen? Zugeordnete Projekte bleiben erhalten.`)) return;
    setError(null);
    const result = await deleteCustomer(customer.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFeedback('Kunde gelöscht. Zugeordnete Projekte wurden nicht entfernt.');
    await refresh(false);
  };

  const removeProject = async (project: NexusProject) => {
    if (!window.confirm(`${project.title} und alle zugehörigen Aufgaben wirklich dauerhaft löschen?`)) return;
    setError(null);
    const result = await deleteProject(project.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFeedback('Projekt gelöscht.');
    await refresh(false);
  };

  return (
    <section className="page business-page">
      <div className="title-row business-title-row">
        <Header
          kicker="BUSINESS"
          title="Projekte & Kunden"
          sub={
            workspaceName
              ? `Echte Business-Daten im Workspace ${workspaceName}.`
              : 'Kunden, Aufträge, Status, Wert und Deadlines zentral verwalten.'
          }
        />
        {workspaceId && (
          <div className="business-header-actions">
            <button className="secondary" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw size={15} />
              {loading ? 'Lädt…' : 'Aktualisieren'}
            </button>
            {canCreate && (
              <>
                <button className="secondary" onClick={openNewCustomer}>
                  <Plus size={15} /> Kunde
                </button>
                <button className="primary" onClick={openNewProject}>
                  <Plus size={15} /> Projekt
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!workspaceId ? (
        <div className="panel business-empty-state">
          <Building2 size={34} />
          <b>{workspaceLoading ? 'Workspaces werden geladen…' : workspaceError ? 'Workspace nicht verfügbar' : 'Kein Workspace ausgewählt'}</b>
          <span>{workspaceError || (!workspaceLoading && 'Lege in den Einstellungen einen Workspace an oder wähle einen bestehenden aus.')}</span>
        </div>
      ) : (
        <>
          {error && <div className="data-alert business-alert">{error}</div>}
          {feedback && <div className="contact-feedback business-feedback">{feedback}</div>}

          <div className="business-role-note">
            <UsersRound size={14} />
            {workspaceRole === 'guest'
              ? 'Guest: Du kannst Business-Daten ansehen.'
              : workspaceRole === 'member'
                ? 'Member: Kunden und Projekte ansehen sowie Projektaufgaben anlegen und bearbeiten.'
                : 'Owner/Admin: Kunden, Projekte und Aufgaben vollständig verwalten.'}
          </div>

          <div className="business-stats">
            <div className="stat business-stat">
              <Building2 size={18} />
              <div><b>{customers.length}</b><span>Kunden</span></div>
            </div>
            <div className="stat business-stat">
              <FolderKanban size={18} />
              <div><b>{activeProjects.length}</b><span>Offene Projekte</span></div>
            </div>
            <div className="stat business-stat">
              <CircleDollarSign size={18} />
              <div><b>{formatMoney(openValue)}</b><span>Offener Auftragswert</span></div>
            </div>
            <div className={`stat business-stat ${overdueProjects ? 'is-alert' : ''}`}>
              <CalendarDays size={18} />
              <div><b>{overdueProjects}</b><span>Überfällige Deadlines</span></div>
            </div>
          </div>

          <div className="business-toolbar panel">
            <div className="business-tabs" role="tablist" aria-label="Business-Bereich">
              <button
                className={view !== 'customers' ? 'active' : ''}
                onClick={() => setView('projects')}
                role="tab"
                aria-selected={view !== 'customers'}
              >
                Projekte <span>{projects.length}</span>
              </button>
              <button
                className={view === 'customers' ? 'active' : ''}
                onClick={() => setView('customers')}
                role="tab"
                aria-selected={view === 'customers'}
              >
                Kunden <span>{customers.length}</span>
              </button>
            </div>
            {view !== 'tasks' && !requestedProjectId && <div className="business-filters">
              <label className="business-search">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={view === 'projects' ? 'Projekte durchsuchen…' : 'Kunden durchsuchen…'}
                />
              </label>
              {view === 'projects' ? (
                <select
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value as ProjectStatus | 'all')}
                >
                  <option value="all">Alle Status</option>
                  {projectStatuses.map((status) => (
                    <option key={status} value={status}>{projectStatusLabels[status]}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={customerFilter}
                  onChange={(event) => setCustomerFilter(event.target.value as CustomerStatus | 'all')}
                >
                  <option value="all">Alle Status</option>
                  {customerStatuses.map((status) => (
                    <option key={status} value={status}>{customerStatusLabels[status]}</option>
                  ))}
                </select>
              )}
            </div>}
          </div>

          {view === 'projects' && requestedProjectId && <div className="business-focus-note" role="status"><span>Geöffnetes Projekt</span><button className="secondary" onClick={() => setView('projects')}>Alle Projekte anzeigen</button></div>}

          {view === 'projects' && <div className="project-tasks-entry"><span>Aufgaben direkt im Projekt öffnen und verteilen.</span><button className="secondary" onClick={() => openTasks()}><ListTodo size={16} /> Alle Projektaufgaben ({tasks.length})</button></div>}
          {view === 'tasks' && <div className="project-tasks-entry"><button className="secondary" onClick={() => setView('projects')}><ArrowLeft size={16} /> Zurück zu Projekten</button><b>{projects.find(project => project.id === requestedProjectId)?.title ?? 'Alle Projektaufgaben'}</b></div>}

          {view === 'tasks' ? <ProjectTasksPanel key={`${workspaceId}:${taskProjectId}:${requestedTaskId ?? ''}`} workspaceId={workspaceId} currentUserId={currentUserId} tasks={tasks} projects={projects} members={members} defaultProjectId={taskProjectId} initialTaskId={requestedTaskId} onClearTaskFocus={() => openTasks(taskProjectId)} loading={loading} loadError={taskError || error} onRefresh={() => refresh(false)} /> : loading && customers.length === 0 && projects.length === 0 ? (
            <div className="panel business-loading">Business-Daten werden geladen…</div>
          ) : error && !projects.length && !customers.length ? <div className="panel business-empty-state">Business-Daten derzeit nicht verfügbar.</div> : view === 'projects' ? (
            visibleProjects.length === 0 ? (
              <div className="panel business-empty-state">
                <FolderKanban size={32} />
                <b>{requestedProjectId ? 'Projekt nicht mehr verfügbar' : projects.length ? 'Keine passenden Projekte' : 'Noch keine Projekte'}</b>
                <span>
                  {requestedProjectId ? 'Das Projekt wurde entfernt oder ist für dich nicht mehr zugänglich.' : projects.length
                    ? 'Ändere Suche oder Filter.'
                    : canCreate
                      ? 'Lege den ersten echten Auftrag für diesen Workspace an.'
                      : 'Owner oder Admin können hier Projekte anlegen.'}
                </span>
                {!requestedProjectId && !projects.length && canCreate && (
                  <button className="primary" onClick={openNewProject}><Plus size={15} /> Erstes Projekt</button>
                )}
              </div>
            ) : (
              <div className="business-project-list">
                {visibleProjects.map((project) => {
                  const customer = project.customer_id ? customerById.get(project.customer_id) : null;
                  const overdue = Boolean(
                    project.deadline &&
                      activeProjectStatuses.includes(project.status) &&
                      project.deadline < today,
                  );
                  return (
                    <article id={'nexus-project-' + project.id} className={'business-project-card panel ' + (requestedProjectId === project.id ? 'briefing-focus-project' : '')} key={project.id}>
                      <div className="business-project-main">
                        <div className="business-project-icon"><FolderKanban size={19} /></div>
                        <div>
                          <div className="business-project-heading">
                            <h3>{project.title}</h3>
                            <span className={`business-badge status-${project.status}`}>{projectStatusLabels[project.status]}</span>
                            <span className={`business-badge priority-${project.priority}`}>{projectPriorityLabels[project.priority]}</span>
                          </div>
                          <p>{customer?.name ?? 'Ohne Kundenzuordnung'}</p>
                          {project.description && <small>{project.description}</small>}
                        </div>
                      </div>
                      <div className="business-project-meta">
                        <div><span>Auftragswert</span><b>{formatMoney(project.value_cents, project.currency)}</b></div>
                        <div className={overdue ? 'is-overdue' : ''}><span>Deadline</span><b>{formatDate(project.deadline)}</b></div>
                        <div><span>Fortschritt</span><b>{project.progress}%</b></div>
                      </div>
                      <div className="business-progress" aria-label={`${project.progress} Prozent abgeschlossen`}>
                        <i style={{ width: `${project.progress}%` }} />
                      </div>
                        <div className="business-card-actions">
                          <button onClick={() => openTasks(project.id)}><ListTodo size={14} /> Aufgaben {taskError ? '' : `(${projectTaskCounts.get(project.id)?.done ?? 0}/${projectTaskCounts.get(project.id)?.total ?? 0})`}</button>
                          {canEdit && <button onClick={() => setTemplateSource(project)}><Copy size={13} /> Als Vorlage speichern</button>}
                          {canEdit && <button onClick={() => openProject(project)}><SquarePen size={14} /> Bearbeiten</button>}
                          {canDelete && <button className="danger" onClick={() => void removeProject(project)}><Trash2 size={14} /> Löschen</button>}
                        </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : visibleCustomers.length === 0 ? (
            <div className="panel business-empty-state">
              <Building2 size={32} />
              <b>{customers.length ? 'Keine passenden Kunden' : 'Noch keine Kunden'}</b>
              <span>
                {customers.length
                  ? 'Ändere Suche oder Filter.'
                  : canCreate
                    ? 'Lege den ersten Kunden für diesen Workspace an.'
                    : 'Owner oder Admin können hier Kunden anlegen.'}
              </span>
              {!customers.length && canCreate && (
                <button className="primary" onClick={openNewCustomer}><Plus size={15} /> Erster Kunde</button>
              )}
            </div>
          ) : (
            <div className="business-customer-grid">
              {visibleCustomers.map((customer) => {
                const url = websiteUrl(customer.website);
                return (
                  <article className="business-customer-card panel" key={customer.id}>
                    <div className="business-customer-top">
                      <div className="business-customer-avatar">{customer.name.slice(0, 2).toUpperCase()}</div>
                      <span className={`business-badge customer-${customer.status}`}>{customerStatusLabels[customer.status]}</span>
                      <button className="customer-chat-button" type="button" aria-label={`Chat mit ${customer.name} öffnen`} title="Kundenchat öffnen" disabled={Boolean(openingChat)} onClick={() => void openCustomerChat(customer)}><MessageCircle size={19} /></button>
                    </div>
                    <h3>{customer.name}</h3>
                    {customer.contact_name && <p><UserRound size={14} /> {customer.contact_name}</p>}
                    {customer.email && <p><Mail size={14} /> {customer.email}</p>}
                    {customer.phone && <p><Phone size={14} /> {customer.phone}</p>}
                    {url && <a href={url} target="_blank" rel="noreferrer"><Globe2 size={14} /> Website öffnen</a>}
                    {customer.notes && <small>{customer.notes}</small>}
                    <div className="business-customer-projects"><FolderKanban size={14} /> {projectCounts.get(customer.id) ?? 0} Projekte</div>
                    {(canEdit || canDelete) && (
                      <div className="business-card-actions">
                        {canEdit && <button onClick={() => openCustomer(customer)}><SquarePen size={14} /> Bearbeiten</button>}
                        {canDelete && <button className="danger" onClick={() => void removeCustomer(customer)}><Trash2 size={14} /> Löschen</button>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {customerEditor && (
        <div
          className="business-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setCustomerEditor(null);
          }}
        >
          <div className="business-modal" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title">
            <div className="business-modal-head">
              <div><small>KUNDENVERWALTUNG</small><h2 id="customer-dialog-title">{customerEditor === 'new' ? 'Neuen Kunden anlegen' : 'Kunden bearbeiten'}</h2></div>
              <button aria-label="Dialog schließen" onClick={() => setCustomerEditor(null)} disabled={saving}><X size={19} /></button>
            </div>
            {error && <div className="data-alert business-modal-alert">{error}</div>}
            <form onSubmit={(event) => void saveCustomer(event)}>
              <div className="business-form-grid">
                <label className="wide"><span>Kundenname / Firma *</span><input autoFocus required minLength={2} maxLength={120} value={customerDraft.name} onChange={(event) => setCustomerDraft((current) => ({ ...current, name: event.target.value }))} placeholder="z. B. Autohaus Müller" /></label>
                <label><span>Ansprechpartner</span><input maxLength={120} value={customerDraft.contactName} onChange={(event) => setCustomerDraft((current) => ({ ...current, contactName: event.target.value }))} placeholder="Vor- und Nachname" /></label>
                <label><span>Status</span><select value={customerDraft.status} onChange={(event) => setCustomerDraft((current) => ({ ...current, status: event.target.value as CustomerStatus }))}>{customerStatuses.map((status) => <option key={status} value={status}>{customerStatusLabels[status]}</option>)}</select></label>
                <label><span>E-Mail</span><input type="email" maxLength={254} value={customerDraft.email} onChange={(event) => setCustomerDraft((current) => ({ ...current, email: event.target.value }))} placeholder="kontakt@firma.de" /></label>
                <label><span>Telefon</span><input type="tel" maxLength={60} value={customerDraft.phone} onChange={(event) => setCustomerDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="+49 …" /></label>
                <label className="wide"><span>Website</span><input type="text" maxLength={500} value={customerDraft.website} onChange={(event) => setCustomerDraft((current) => ({ ...current, website: event.target.value }))} placeholder="www.firma.de" /></label>
                <label className="wide"><span>Notizen</span><textarea maxLength={4000} value={customerDraft.notes} onChange={(event) => setCustomerDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Wichtige Kundendetails…" /></label>
                <label className="wide"><span>Nexus-Kontakt für Kundenchat</span><select aria-label="Nexus-Kontakt für Kundenchat" value={customerDraft.chatUserId} disabled={contactsLoading || Boolean(contactsError)} onChange={event => setCustomerDraft(current => ({ ...current, chatUserId: event.target.value }))}>
                  <option value="">Noch nicht verknüpft</option>
                  {customerDraft.chatUserId && !contacts.some(contact => contact.contact_user_id === customerDraft.chatUserId) && <option value={customerDraft.chatUserId}>Verknüpfter Kontakt (nicht in deiner Kontaktliste)</option>}
                  {contacts.map(contact => <option key={contact.contact_user_id} value={contact.contact_user_id}>{contact.full_name || contact.username || 'Nexus-Kontakt'}{contact.username ? ` (@${contact.username})` : ''}</option>)}
                </select><small className="customer-chat-hint">{contactsLoading ? 'Kontakte werden geladen…' : contactsError || 'Wähle einen bestätigten Nexus-Kontakt. Neue Kontakte kannst du im Bereich Kontakte verbinden.'}</small></label>
              </div>
              <div className="business-modal-actions"><button type="button" className="secondary" onClick={() => setCustomerEditor(null)} disabled={saving}>Abbrechen</button><button className="primary" disabled={saving}>{saving ? 'Speichert…' : customerEditor === 'new' ? 'Kunde anlegen' : 'Änderungen speichern'}</button></div>
            </form>
          </div>
        </div>
      )}

      {projectEditor && (
        <div
          className="business-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setProjectEditor(null);
          }}
        >
          <div className="business-modal" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
            <div className="business-modal-head">
              <div><small>PROJEKTVERWALTUNG</small><h2 id="project-dialog-title">{projectEditor === 'new' ? 'Neues Projekt anlegen' : 'Projekt bearbeiten'}</h2></div>
              <button aria-label="Dialog schließen" onClick={() => setProjectEditor(null)} disabled={saving}><X size={19} /></button>
            </div>
            {error && <div className="data-alert business-modal-alert">{error}</div>}
            <form onSubmit={(event) => void saveProject(event)}>
              {projectEditor === 'new' && workspaceId && <ProjectTemplatePicker workspaceId={workspaceId} disabled={saving} hasDraft={Boolean(projectDraft.title || projectDraft.description || initialTasks.length)} onApply={draft => {
                setProjectDraft(current => ({ ...current, title: draft.title, description: draft.description, priority: draft.priority, deadline: draft.deadline, status: 'planning', progress: '0' }));
                setInitialTasks(draft.tasks); setError(null);
              }} />}
              <div className="business-form-grid">
                <label className="wide"><span>Projekttitel *</span><input autoFocus={projectEditor !== 'new'} required minLength={2} maxLength={160} value={projectDraft.title} onChange={(event) => setProjectDraft((current) => ({ ...current, title: event.target.value }))} placeholder="z. B. Neue Unternehmenswebsite" /></label>
                <label><span>Kunde</span><select value={projectDraft.customerId} onChange={(event) => setProjectDraft((current) => ({ ...current, customerId: event.target.value }))}><option value="">Ohne Kundenzuordnung</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                <label><span>Status</span><select value={projectDraft.status} onChange={(event) => setProjectDraft((current) => ({ ...current, status: event.target.value as ProjectStatus }))}>{projectStatuses.map((status) => <option key={status} value={status}>{projectStatusLabels[status]}</option>)}</select></label>
                <label><span>Priorität</span><select value={projectDraft.priority} onChange={(event) => setProjectDraft((current) => ({ ...current, priority: event.target.value as ProjectPriority }))}>{projectPriorities.map((priority) => <option key={priority} value={priority}>{projectPriorityLabels[priority]}</option>)}</select></label>
                <label><span>Auftragswert (€)</span><input type="number" min="0" max="9999999999.99" step="0.01" value={projectDraft.value} onChange={(event) => setProjectDraft((current) => ({ ...current, value: event.target.value }))} placeholder="0,00" /></label>
                <label><span>Deadline</span><input type="date" value={projectDraft.deadline} onChange={(event) => setProjectDraft((current) => ({ ...current, deadline: event.target.value }))} /></label>
                <label><span>Fortschritt (%)</span><input type="number" min="0" max="100" step="1" value={projectDraft.progress} onChange={(event) => setProjectDraft((current) => ({ ...current, progress: event.target.value }))} /></label>
                <label className="wide"><span>Beschreibung / Notizen</span><textarea maxLength={4000} value={projectDraft.description} onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Leistungsumfang, nächste Schritte, Besonderheiten…" /></label>
              </div>
              {projectEditor === 'new' && <div className="project-task-drafts">
                <h3>Aufgaben verteilen</h3><p>Plane die ersten Schritte. Projekt und Aufgaben werden gemeinsam gespeichert.</p>
                {initialTasks.map((task, index) => <fieldset className="project-task-draft" key={task.id} disabled={saving}>
                  <legend>Aufgabe {index + 1}</legend><div className="business-form-grid">
                    <label className="wide"><span>Aufgabentitel *</span><input required minLength={2} maxLength={180} value={task.title} onChange={event => updateInitialTask(task.id, { title: event.target.value })} /></label>
                    <label><span>Verantwortlich</span><select aria-label="Verantwortlich" value={task.assigned_to || ''} onChange={event => updateInitialTask(task.id, { assigned_to: event.target.value || null })}><option value="">Nicht zugewiesen</option>{members.filter(member => member.role !== 'guest').map(member => <option key={member.user_id} value={member.user_id}>{taskMemberName(member)}</option>)}</select></label>
                    <label><span>Fällig am</span><input type="date" value={task.due_date || ''} onChange={event => updateInitialTask(task.id, { due_date: event.target.value || null })} /></label>
                    <label><span>Priorität der Aufgabe</span><select aria-label="Priorität der Aufgabe" value={task.priority} onChange={event => updateInitialTask(task.id, { priority: event.target.value as ProjectPriority })}>{projectPriorities.map(priority => <option key={priority} value={priority}>{projectPriorityLabels[priority]}</option>)}</select></label>
                    <label className="wide"><span>Aufgabendetails</span><textarea maxLength={4000} value={task.description || ''} onChange={event => updateInitialTask(task.id, { description: event.target.value })} /></label>
                    <label className="wide"><span>Checkliste (ein Punkt pro Zeile)</span><textarea aria-label="Checkliste (ein Punkt pro Zeile)" value={(task.checklist || []).join('\n')} onChange={event => updateInitialTask(task.id, { checklist: event.target.value.split('\n') })} placeholder="z. B. Inhalte sammeln" /></label>
                  </div><button type="button" className="secondary" onClick={() => setInitialTasks(current => current.filter(item => item.id !== task.id))}><Trash2 size={14} /> Aufgabe entfernen</button>
                </fieldset>)}
                <button type="button" className="secondary" disabled={saving || initialTasks.length >= 50 || Boolean(taskError)} onClick={() => setInitialTasks(current => [...current, { id: crypto.randomUUID(), title: '', status: 'todo', priority: 'medium', assigned_to: null, due_date: null, description: '' }])}><Plus size={15} /> Aufgabe hinzufügen</button>
                {taskError && <p role="alert">Das Team konnte nicht vollständig geladen werden. Bitte vor dem Verteilen von Aufgaben aktualisieren.</p>}
              </div>}
              <div className="business-modal-actions"><button type="button" className="secondary" onClick={() => setProjectEditor(null)} disabled={saving}>Abbrechen</button><button className="primary" disabled={saving}>{saving ? 'Speichert…' : projectEditor === 'new' ? 'Projekt anlegen' : 'Änderungen speichern'}</button></div>
            </form>
          </div>
        </div>
      )}
      {canEdit && templateSource && <SaveProjectTemplate key={templateSource.id} project={templateSource} onClose={() => setTemplateSource(null)} onSaved={name => { setTemplateSource(null); setFeedback(`Vorlage „${name}“ gespeichert. Beim nächsten Projekt kannst du sie auswählen.`); }} />}
    </section>
  );
}
