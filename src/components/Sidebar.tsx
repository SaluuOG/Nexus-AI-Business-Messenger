import {
  Bot,
  BriefcaseBusiness,
  ContactRound,
  House,
  MessageCircle,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { IdentityMode, Tab, Workspace } from '../types';

type SidebarProps = {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  workspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
  identity: IdentityMode;
};

const navigation = [
  ['briefing', House, 'Briefing'],
  ['chats', MessageCircle, 'Chats'],
  ['contacts', ContactRound, 'Kontakte'],
  ['business', BriefcaseBusiness, 'Business'],
  ['ai', Bot, 'AI Assistent'],
  ['settings', Settings, 'Einstellungen'],
] as const;

export function Sidebar({
  tab,
  onTabChange,
  workspace,
  onWorkspaceChange,
  identity,
}: SidebarProps) {
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
        {navigation.map(([key, Icon, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => onTabChange(key)}
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
