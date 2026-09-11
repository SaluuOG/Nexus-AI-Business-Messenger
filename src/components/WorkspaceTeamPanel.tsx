import {
  Copy,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import type {
  NexusWorkspace,
  NexusWorkspaceInvitation,
  NexusWorkspaceMember,
  WorkspaceRole,
} from '../features/data/nexusData';

const roleLabel: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

type ManageableRole = Exclude<WorkspaceRole, 'owner'>;

type WorkspaceTeamPanelProps = {
  workspace: NexusWorkspace | null;
  currentRole?: WorkspaceRole;
  currentUserId?: string;
  members: NexusWorkspaceMember[];
  invitations: NexusWorkspaceInvitation[];
  loading: boolean;
  error?: string | null;
  onInvite: (email: string, role: ManageableRole) => Promise<{ error: string | null }>;
  onUpdateRole: (
    userId: string,
    role: ManageableRole,
  ) => Promise<{ error: string | null }>;
  onRemoveMember: (userId: string) => Promise<{ error: string | null }>;
  onRevokeInvitation: (invitationId: string) => Promise<{ error: string | null }>;
  onRefresh: () => Promise<void>;
};

function makeInviteLink(token: string) {
  return `${window.location.origin}${window.location.pathname}#/auth?invite=${encodeURIComponent(token)}`;
}

export function WorkspaceTeamPanel({
  workspace,
  currentRole,
  currentUserId,
  members,
  invitations,
  loading,
  error,
  onInvite,
  onUpdateRole,
  onRemoveMember,
  onRevokeInvitation,
  onRefresh,
}: WorkspaceTeamPanelProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ManageableRole>('member');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canManage = currentRole === 'owner' || currentRole === 'admin';
  const allowedRoles = useMemo<ManageableRole[]>(
    () => (currentRole === 'owner' ? ['admin', 'member', 'guest'] : ['member', 'guest']),
    [currentRole],
  );

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim() || !workspace || !canManage) return;

    setBusyAction('invite');
    setFeedback(null);
    const result = await onInvite(inviteEmail.trim(), inviteRole);
    setBusyAction(null);

    if (result.error) {
      setFeedback(result.error);
      return;
    }

    setInviteEmail('');
    setFeedback('Einladung erstellt. Du kannst den Einladungslink jetzt kopieren.');
  };

  const changeRole = async (userId: string, role: ManageableRole) => {
    setBusyAction(`role:${userId}`);
    setFeedback(null);
    const result = await onUpdateRole(userId, role);
    setBusyAction(null);
    setFeedback(result.error ?? 'Rolle aktualisiert.');
  };

  const removeMember = async (userId: string) => {
    setBusyAction(`remove:${userId}`);
    setFeedback(null);
    const result = await onRemoveMember(userId);
    setBusyAction(null);
    setFeedback(result.error ?? 'Mitglied aus dem Workspace entfernt.');
  };

  const revokeInvitation = async (invitationId: string) => {
    setBusyAction(`invite:${invitationId}`);
    setFeedback(null);
    const result = await onRevokeInvitation(invitationId);
    setBusyAction(null);
    setFeedback(result.error ?? 'Einladung widerrufen.');
  };

  const copyInvitation = async (token: string) => {
    try {
      await navigator.clipboard.writeText(makeInviteLink(token));
      setFeedback('Einladungslink kopiert.');
    } catch {
      setFeedback('Link konnte nicht automatisch kopiert werden.');
    }
  };

  if (!workspace) {
    return (
      <div className="panel team-panel">
        <Users />
        <h3>Team & Rollen</h3>
        <p>Erstelle oder wähle zuerst einen Workspace.</p>
      </div>
    );
  }

  return (
    <div className="panel team-panel">
      <div className="team-panel-head">
        <div>
          <Users />
          <h3>Team & Rollen</h3>
          <p>
            {workspace.name} · {currentRole ? roleLabel[currentRole] : 'Mitglied'}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          title="Team neu laden"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div className="data-alert">Team: {error}</div>}

      <div className="team-section">
        <div className="team-section-title">
          <span>Mitglieder</span>
          <small>{members.length}</small>
        </div>

        <div className="member-list">
          {members.map((member) => {
            const isSelf = member.user_id === currentUserId;
            const canEditMember =
              !isSelf &&
              member.role !== 'owner' &&
              (currentRole === 'owner' ||
                (currentRole === 'admin' && ['member', 'guest'].includes(member.role)));
            const memberName =
              member.full_name || member.username || `Nexus Nutzer ${member.user_id.slice(0, 6)}`;
            const subtitle = member.username
              ? `@${member.username}${isSelf ? ' · Du' : ''}`
              : isSelf
                ? 'Du'
                : `ID ${member.user_id.slice(0, 8)}`;

            return (
              <div className="member-row" key={member.user_id}>
                <div className="avatar small-avatar">
                  {memberName
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="member-main">
                  <b>{memberName}</b>
                  <small>{subtitle}</small>
                </div>

                {canEditMember ? (
                  <select
                    className="role-select"
                    value={member.role}
                    disabled={busyAction === `role:${member.user_id}`}
                    onChange={(event) =>
                      void changeRole(member.user_id, event.target.value as ManageableRole)
                    }
                  >
                    {(currentRole === 'owner'
                      ? (['admin', 'member', 'guest'] as ManageableRole[])
                      : (['member', 'guest'] as ManageableRole[])
                    ).map((role) => (
                      <option key={role} value={role}>
                        {roleLabel[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`role-pill role-${member.role}`}>{roleLabel[member.role]}</span>
                )}

                {canEditMember && (
                  <button
                    className="danger-icon"
                    type="button"
                    title="Mitglied entfernen"
                    disabled={busyAction === `remove:${member.user_id}`}
                    onClick={() => void removeMember(member.user_id)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}

          {!loading && members.length === 0 && (
            <small className="empty-state">Noch keine Teamdaten geladen.</small>
          )}
        </div>
      </div>

      <div className="team-section">
        <div className="team-section-title">
          <span>Mitglied einladen</span>
          <ShieldCheck size={14} />
        </div>

        {canManage ? (
          <form className="invite-form" onSubmit={submitInvite}>
            <label>
              E-Mail-Adresse
              <div className="invite-input">
                <Mail size={15} />
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="team@firma.de"
                />
              </div>
            </label>
            <label>
              Rolle
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as ManageableRole)}
              >
                {allowedRoles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel[role]}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" disabled={busyAction === 'invite'}>
              <UserPlus size={15} />
              {busyAction === 'invite' ? 'Erstellt…' : 'Einladung erstellen'}
            </button>
          </form>
        ) : (
          <p>Nur Owner und Admins können neue Mitglieder einladen.</p>
        )}
      </div>

      {canManage && (
        <div className="team-section">
          <div className="team-section-title">
            <span>Offene Einladungen</span>
            <small>{invitations.length}</small>
          </div>
          <div className="invitation-list">
            {invitations.map((invitation) => {
              const expired = new Date(invitation.expires_at).getTime() <= Date.now();
              return (
                <div className="invitation-row" key={invitation.id}>
                  <div>
                    <b>{invitation.email}</b>
                    <small>
                      {roleLabel[invitation.role]} · {expired ? 'abgelaufen' : '7 Tage gültig'}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="Einladungslink kopieren"
                    onClick={() => void copyInvitation(invitation.token)}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="danger-icon"
                    type="button"
                    title="Einladung widerrufen"
                    disabled={busyAction === `invite:${invitation.id}`}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
            {!loading && invitations.length === 0 && (
              <small className="empty-state">Keine offenen Einladungen.</small>
            )}
          </div>
        </div>
      )}

      {feedback && <small className="form-feedback team-feedback">{feedback}</small>}
    </div>
  );
}
