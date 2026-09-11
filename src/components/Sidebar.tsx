import {
  Bot,
  BriefcaseBusiness,
  ContactRound,
  House,
  MessageCircle,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { IdentityMode, Workspace } from '../types';
import { routes } from '../app/routes';

type SidebarProps = {
  workspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
  identity: IdentityMode;
};

const navigation = [
  [routes.briefing, House, 'Briefing'],
  [routes.chats, MessageCircle, 'Chats'],
  [routes.contacts, ContactRound, 'Kontakte'],
  [routes.business, BriefcaseBusiness, 'Business'],
  [routes.ai, Bot, 'AI Assistent'],
  [routes.settings, Settings, 'Einstellungen'],
] as const;

export function Sidebar({
  workspace,
  onWorkspaceChange,
  identity,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

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
      </div>

      <nav>
        {navigation.map(([path, Icon, label]) => (
          <button
            key={path}
            className={location.pathname === path ? 'active' : ''}
            onClick={() => navigate(path)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="workspace">
        <small>WORKSPACE</small>
        <select
          value={workspace}
          onChange={(event) => onWorkspaceChange(event.target.value as Workspace)}
        >
          <option>WebWorkBalance</option>
          <option>Privat</option>
        </select>
        <span>
          {workspace === 'WebWorkBalance' ? '4 Mitglieder · Owner' : 'Nur du · Privat'}
        </span>
      </div>

      <div className="profile">
        <div className="avatar">S</div>
        <div>
          <b>Samet</b>
          <small>{identity === 'business' ? '@webworkbalance' : '@samet'}</small>
        </div>
      </div>
    </aside>
  );
}
