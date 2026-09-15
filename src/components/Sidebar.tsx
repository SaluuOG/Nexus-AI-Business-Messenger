import {
  Bell,
  Bot,
  BriefcaseBusiness,
  ContactRound,
  House,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { routes } from '../app/routes';
import type { NexusWorkspace, WorkspaceRole } from '../features/data/nexusData';
import type { IdentityMode } from '../types';

type SidebarProps = {
  unreadNotifications?: number | null;
  notificationsLoading?: boolean;
  workspaces: NexusWorkspace[];
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  workspaceRole?: WorkspaceRole;
  workspaceLoading?: boolean;
  workspaceSwitchDisabled?: boolean;
  identity: IdentityMode;
  accountName?: string;
  accountSubtitle?: string;
};

const navigation = [
  [routes.briefing, House, 'Briefing'],
  [routes.chats, MessageCircle, 'Chats'],
  [routes.groups, UsersRound, 'Gruppen'],
  [routes.search, Search, 'Suche'],
  [routes.contacts, ContactRound, 'Kontakte'],
  [routes.business, BriefcaseBusiness, 'Business'],
  [routes.ai, Bot, 'AI Assistent'],
  [routes.settings, Settings, 'Einstellungen'],
] as const;

const roleLabel: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

export function Sidebar({
  unreadNotifications = 0,
  notificationsLoading,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
  workspaceRole,
  workspaceLoading,
  workspaceSwitchDisabled,
  identity,
  accountName,
  accountSubtitle,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const fallbackSubtitle = identity === 'business' ? 'Business-Profil einrichten' : 'Privates Profil';
  const initials = (accountName || 'Nexus')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  return (
    <aside className="side">
      <div className="brand">
        <span className="logo">
          <Sparkles />
        </span>
        <div>
          <b>Nexus</b>
          <small>AI Business Messenger</small>
        </div>
        <Link to={routes.notifications} className={'notification-bell' + (location.pathname === routes.notifications ? ' active' : '')} aria-label={unreadNotifications === null ? 'Benachrichtigungen: Aktualisierung fehlgeschlagen' : 'Benachrichtigungen: ' + unreadNotifications + ' ungelesen'} aria-current={location.pathname === routes.notifications ? 'page' : undefined} aria-busy={notificationsLoading} title="Benachrichtigungen">
          <Bell size={19} />{(unreadNotifications === null || unreadNotifications > 0) && <span className="notification-badge" aria-hidden="true">{unreadNotifications === null ? '!' : unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
        </Link>
      </div>

      <nav aria-label="Hauptnavigation">
        {navigation.map(([path, Icon, label]) => (
          <button
            type="button"
            key={path}
            className={location.pathname === path ? 'active' : ''}
            onClick={() => navigate(path)}
            aria-current={location.pathname === path ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="workspace">
        <small>WORKSPACE</small>
        <select
          value={selectedWorkspaceId ?? ''}
          onChange={(event) => onWorkspaceChange(event.target.value || null)}
          disabled={workspaceLoading || workspaceSwitchDisabled || workspaces.length === 0}
        >
          {workspaces.length === 0 && <option value="">Noch kein Workspace</option>}
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <span>
          {workspaceLoading
            ? 'Workspaces werden geladen…'
            : selectedWorkspace
              ? `${workspaceRole ? roleLabel[workspaceRole] : 'Mitglied'} · Supabase`
              : 'In Einstellungen Workspace anlegen'}
        </span>
      </div>

      <div className="profile">
        <div className="avatar">{initials}</div>
        <div>
          <b>{accountName || 'Nexus Nutzer'}</b>
          <small>{accountSubtitle || fallbackSubtitle}</small>
        </div>
      </div>
    </aside>
  );
}
