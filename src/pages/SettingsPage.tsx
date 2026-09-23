import { MobileInstall } from '../components/MobileInstall';
import '../account-deletion.css';
import {
  Bell,
  Building2,
  CheckCircle2,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { routes } from '../app/routes';
import { Header } from '../components/Header';
import { PasswordInput, PasswordStrengthHint } from '../components/PasswordInput';
import { WorkspaceLifecyclePanel } from '../components/WorkspaceLifecyclePanel';
import { WorkspaceTeamPanel } from '../components/WorkspaceTeamPanel';
import { NotificationPreferences } from '../components/NotificationPreferences';
import { PushPreferences } from '../components/PushPreferences';
import type { NotificationsModel } from '../features/notifications/useNotifications';
import { ACCOUNT_DELETION_CONFIRMATION } from '../features/auth/accountDeletion';
import { PASSWORD_MIN_LENGTH, RESET_REQUEST_CONFIRMATION, validateNewPassword } from '../features/auth/passwordPolicy';
import { startViews, type StartView } from '../features/settings/preferences';
import type {
  NexusBusinessProfile,
  NexusProfile,
  NexusWorkspace,
  NexusWorkspaceInvitation,
  NexusWorkspaceMember,
  WorkspaceRole,
} from '../features/data/nexusData';
import type { IdentityMode } from '../types';

type ProfilePatch = Partial<Pick<NexusProfile, 'full_name' | 'username' | 'bio'>>;
type ManageableRole = Exclude<WorkspaceRole, 'owner'>;
type WorkspaceLifecycleFeedback = {
  workspaceId: string;
  message: string;
  error: boolean;
};

type SettingsPageProps = {
  notifications?: NotificationsModel;
  identity: IdentityMode;
  setIdentity: (identity: IdentityMode) => void;
  startView: StartView;
  onStartViewChange: (view: StartView) => void;
  preferencesError?: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
  backendConfigured: boolean;
  accountEmail?: string;
  currentUserId?: string;
  profile: NexusProfile | null;
  businessProfiles: NexusBusinessProfile[];
  workspaces: NexusWorkspace[];
  selectedWorkspaceId: string | null;
  currentWorkspaceRole?: WorkspaceRole;
  workspaceMembers: NexusWorkspaceMember[];
  workspaceInvitations: NexusWorkspaceInvitation[];
  teamLoading: boolean;
  teamError?: string | null;
  workspaceLifecycleBusy?: boolean;
  workspaceLifecycleFeedback?: WorkspaceLifecycleFeedback | null;
  dataLoading: boolean;
  dataError?: string | null;
  onSaveProfile: (patch: ProfilePatch) => Promise<{ error: string | null }>;
  onCreateWorkspace: (name: string) => Promise<{ error: string | null }>;
  onCreateBusinessProfile: (name: string, handle: string) => Promise<{ error: string | null }>;
  onInviteWorkspaceMember: (email: string, role: ManageableRole) => Promise<{ error: string | null }>;
  onUpdateWorkspaceMemberRole: (
    userId: string,
    role: ManageableRole,
  ) => Promise<{ error: string | null }>;
  onRemoveWorkspaceMember: (userId: string) => Promise<{ error: string | null }>;
  onRevokeWorkspaceInvitation: (invitationId: string) => Promise<{ error: string | null }>;
  onRefreshWorkspaceTeam: () => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<{ error: string | null }>;
  onLeaveWorkspace: () => Promise<{ error: string | null }>;
  onTransferWorkspaceOwnership: (newOwnerId: string) => Promise<{ error: string | null }>;
  onDeleteWorkspace: (confirmation: string) => Promise<{ error: string | null }>;
  onAcceptWorkspaceInvitation: (
    token: string,
  ) => Promise<{ error: string | null; workspaceName?: string }>;
  onUpdatePassword?: (password: string) => Promise<{ error: string | null }>;
  onRequestPasswordReset?: (email: string) => Promise<{ error: string | null }>;
  onSignOut?: () => Promise<{ error: string | null }>;
  onDeleteAccount?: (confirmation: string) => Promise<{ error: string | null }>;
};

const categories = [
  { id: 'general', title: 'Allgemein', detail: 'Startansicht und Nutzung', icon: Settings2, description: 'Passe an, wie du Nexus auf diesem Gerät verwendest.' },
  { id: 'profile', title: 'Profil & Business', detail: 'Name, Username und Business-Profil', icon: UserRound, description: 'Verwalte dein persönliches Profil und deinen geschäftlichen Auftritt.' },
  { id: 'workspace', title: 'Workspace & Team', detail: 'Workspaces, Mitglieder und Rollen', icon: Users, description: 'Wähle deinen Workspace und organisiere die Zusammenarbeit im Team.' },
  { id: 'notifications', title: 'Benachrichtigungen', detail: 'Nachrichten, Anfragen und Aufgaben', icon: Bell, description: 'Wähle, welche Hinweise du in Nexus erhalten möchtest.' },
  { id: 'security', title: 'Datenschutz & Sicherheit', detail: 'Passwort, Wiederherstellung und Konto', icon: ShieldCheck, description: 'Ändere dein Passwort, fordere einen Wiederherstellungslink an oder melde dich ab.' },
] as const;

const roleLabel: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

export function SettingsPage({
  notifications,
  identity,
  setIdentity,
  startView,
  onStartViewChange,
  preferencesError,
  onWorkspaceChange,
  backendConfigured,
  accountEmail,
  currentUserId,
  profile,
  businessProfiles,
  workspaces,
  selectedWorkspaceId,
  currentWorkspaceRole,
  workspaceMembers,
  workspaceInvitations,
  teamLoading,
  teamError,
  workspaceLifecycleBusy,
  workspaceLifecycleFeedback,
  dataLoading,
  dataError,
  onSaveProfile,
  onCreateWorkspace,
  onCreateBusinessProfile,
  onInviteWorkspaceMember,
  onUpdateWorkspaceMemberRole,
  onRemoveWorkspaceMember,
  onRevokeWorkspaceInvitation,
  onRefreshWorkspaceTeam,
  onRenameWorkspace,
  onLeaveWorkspace,
  onTransferWorkspaceOwnership,
  onDeleteWorkspace,
  onAcceptWorkspaceInvitation,
  onUpdatePassword,
  onRequestPasswordReset,
  onSignOut,
  onDeleteAccount,
}: SettingsPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessHandle, setBusinessHandle] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [inviteAccepting, setInviteAccepting] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [businessFeedback, setBusinessFeedback] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const securityBusy = useRef(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetAvailableAt, setResetAvailableAt] = useState(0);
  const [resetRemaining, setResetRemaining] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [deleteExpanded, setDeleteExpanded] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const search = new URLSearchParams(location.search);
  const inviteToken = search.get('invite');
  const category = categories.find(item => item.id === search.get('category')) ?? categories[inviteToken ? 2 : 0];
  const categorySearch = (id: string) => {
    const next = new URLSearchParams(location.search);
    next.set('category', id);
    return '?' + next.toString();
  };

  useEffect(() => {
    if (!resetAvailableAt) return;
    const tick = () => setResetRemaining(Math.max(0, Math.ceil((resetAvailableAt - Date.now()) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [resetAvailableAt]);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setUsername(profile?.username ?? '');
    setBio(profile?.bio ?? '');
  }, [profile]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const businessProfile = businessProfiles[0] ?? null;

  const submitProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileFeedback(null);
    const result = await onSaveProfile({
      full_name: fullName.trim() || null,
      username: username.trim().replace(/^@/, '') || null,
      bio: bio.trim() || null,
    });
    setProfileFeedback(result.error ?? 'Profil gespeichert.');
    setProfileSaving(false);
  };

  const submitWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceName.trim()) return;
    setWorkspaceSaving(true);
    setWorkspaceFeedback(null);
    const result = await onCreateWorkspace(workspaceName.trim());
    setWorkspaceFeedback(result.error ?? 'Workspace erstellt.');
    if (!result.error) setWorkspaceName('');
    setWorkspaceSaving(false);
  };

  const submitBusiness = async (event: FormEvent) => {
    event.preventDefault();
    if (!businessName.trim()) return;
    setBusinessSaving(true);
    setBusinessFeedback(null);
    const result = await onCreateBusinessProfile(businessName.trim(), businessHandle.trim());
    setBusinessFeedback(result.error ?? 'Business-Profil erstellt.');
    if (!result.error) {
      setBusinessName('');
      setBusinessHandle('');
    }
    setBusinessSaving(false);
  };

  const acceptInvite = async () => {
    if (!inviteToken) return;
    setInviteAccepting(true);
    setInviteFeedback(null);
    const result = await onAcceptWorkspaceInvitation(inviteToken);
    setInviteAccepting(false);

    if (result.error) {
      setInviteFeedback(result.error);
      return;
    }

    localStorage.removeItem('nexus_pending_invite');
    setInviteFeedback(
      result.workspaceName
        ? `Einladung angenommen. Du bist jetzt Mitglied von ${result.workspaceName}.`
        : 'Einladung angenommen.',
    );
    navigate(routes.settings + '?category=workspace', { replace: true });
  };

  const dismissInvite = () => {
    localStorage.removeItem('nexus_pending_invite');
    setInviteFeedback(null);
    navigate(routes.settings + '?category=workspace', { replace: true });
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!onUpdatePassword || securityBusy.current) return;

    const validationError = validateNewPassword(newPassword, passwordConfirmation);
    if (validationError) {
      setPasswordError(validationError);
      setPasswordFeedback(null);
      return;
    }

    securityBusy.current = true;
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordFeedback(null);
    try {
      const result = await onUpdatePassword(newPassword);
      if (result.error) {
        setPasswordError(result.error);
        return;
      }

      setNewPassword('');
      setPasswordConfirmation('');
      setPasswordFeedback('Passwort erfolgreich geändert.');
    } catch {
      setPasswordError('Das Passwort konnte gerade nicht geändert werden. Bitte versuche es erneut.');
    } finally {
      securityBusy.current = false;
      setPasswordSaving(false);
    }
  };

  const requestReset = async () => {
    if (!onRequestPasswordReset || !accountEmail || securityBusy.current || Date.now() < resetAvailableAt) return;
    securityBusy.current = true; setResetSending(true); setResetError(null); setResetFeedback(null);
    try {
      const result = await onRequestPasswordReset(accountEmail);
      if (result.error) setResetError(result.error);
      else { setResetFeedback(RESET_REQUEST_CONFIRMATION); setResetRemaining(60); setResetAvailableAt(Date.now() + 60_000); }
    } catch { setResetError('Der Link konnte gerade nicht gesendet werden. Bitte versuche es erneut.'); }
    finally { securityBusy.current = false; setResetSending(false); }
  };

  const signOut = async () => {
    if (!onSignOut || securityBusy.current) return;
    securityBusy.current = true; setSigningOut(true); setSignOutError(null);
    try { const result = await onSignOut(); if (result.error) setSignOutError(result.error); }
    catch { setSignOutError('Die Abmeldung ist gerade nicht möglich. Bitte erneut versuchen.'); }
    finally { securityBusy.current = false; setSigningOut(false); }
  };

  const deleteAccount = async () => {
    if (!onDeleteAccount || securityBusy.current || deleteConfirmation !== ACCOUNT_DELETION_CONFIRMATION) return;
    securityBusy.current = true;
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      const result = await onDeleteAccount(deleteConfirmation);
      if (result.error) setDeleteError(result.error);
    } catch {
      setDeleteError('Das Konto konnte gerade nicht gelöscht werden. Bitte versuche es erneut.');
    } finally {
      securityBusy.current = false;
      setDeletingAccount(false);
    }
  };

  return (
    <section className="page settings-page">
      <Header kicker="DEIN NEXUS" title="Einstellungen" sub="Alles für dein Konto und dein Team – übersichtlich nach Themen geordnet." />
      {dataError && <div className="data-alert" role="alert">{dataError}</div>}
      {(inviteToken || inviteFeedback) && (
        <div className="panel invite-accept-card">
          <div><UserPlus /><span><b>Workspace-Einladung</b><small role="status">{inviteFeedback ?? 'Nimm die Einladung mit deinem angemeldeten Konto an, um dem Workspace beizutreten.'}</small></span></div>
          {inviteToken && <div className="invite-accept-actions">
            <button className="primary" onClick={() => void acceptInvite()} disabled={inviteAccepting}>{inviteAccepting ? 'Wird angenommen…' : 'Einladung annehmen'}</button>
            <button className="icon-button" type="button" onClick={dismissInvite} disabled={inviteAccepting} aria-label="Einladung schließen"><X size={16} /></button>
          </div>}
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-categories" aria-label="Einstellungskategorien">
          {categories.map(item => {
            const Icon = item.icon;
            return <Link key={item.id} to={routes.settings + categorySearch(item.id)} className={category.id === item.id ? 'settings-category active' : 'settings-category'} aria-current={category.id === item.id ? 'page' : undefined}>
              <Icon size={20} aria-hidden="true" /><span><b>{item.title}</b><small>{item.detail}</small></span>
            </Link>;
          })}
        </nav>

        <section className="settings-content" aria-labelledby="settings-category-title">
          <div className="settings-section-heading"><h2 id="settings-category-title">{category.title}</h2><p>{category.description}</p></div>

          {category.id === 'general' && <div className="settings-grid">
            <MobileInstall />
            <div className="panel">
              <Settings2 /><h3>Deine Startansicht</h3>
              <p>Wähle, wo du nach dem Anmelden und beim Öffnen der Nexus-Startseite beginnen möchtest.</p>
              <div className="settings-form">
                <label htmlFor="settings-start-view">Startansicht</label>
                <select id="settings-start-view" value={startView} onChange={event => onStartViewChange(event.target.value as StartView)}>
                  {startViews.map(view => <option key={view.id} value={view.id}>{view.label}</option>)}
                </select>
                <small className="settings-hint">Die Auswahl wird automatisch für dein Konto in diesem Browser gespeichert. Direkte Links öffnen weiterhin die verlinkte Seite.</small>
              </div>
            </div>
            <div className="panel">
              <Users /><h3>Deine Identität</h3>
              <p>Wähle, welches Profil dir Nexus in der Navigation anzeigt.</p>
              <div className="identity settings-identity">
                <button type="button" className={identity === 'private' ? 'active' : ''} aria-pressed={identity === 'private'} onClick={() => setIdentity('private')}>
                  <UserRound /><span><b>Privat</b><small>Persönliches Profil</small></span>
                </button>
                <button type="button" className={identity === 'business' ? 'active' : ''} aria-pressed={identity === 'business'} onClick={() => setIdentity('business')}>
                  <Building2 /><span><b>Business</b><small>Geschäftliches Profil</small></span>
                </button>
              </div>
              <p>Deine Auswahl bleibt auf diesem Gerät gespeichert. Deine Zugriffsrechte richten sich weiterhin nach deiner Rolle im jeweiligen Workspace.</p>
            </div>
            {preferencesError && <div className="data-alert settings-full-width" role="status">{preferencesError}</div>}
          </div>}

          {category.id === 'profile' && <div className="settings-grid">
            <div className="panel">
              <UserRound /><h3>Persönliches Profil</h3>
              <p>So erkennen dich deine Kontakte und dein Team.</p>
              <form className="settings-form" onSubmit={submitProfile}>
                <label>Name<input aria-label="Name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Dein Name" /></label>
                <label>Username<input aria-label="Username" value={username} onChange={event => setUsername(event.target.value)} placeholder="z. B. samet" /></label>
                <label>Bio<textarea aria-label="Bio" value={bio} onChange={event => setBio(event.target.value)} placeholder="Kurze Beschreibung" rows={3} /></label>
                <button className="primary" disabled={profileSaving || dataLoading}>{profileSaving ? 'Speichert…' : 'Profil speichern'}</button>
                {profileFeedback && <small className="form-feedback" role="status">{profileFeedback}</small>}
              </form>
            </div>
            <div className="panel">
              <Building2 /><h3>Business-Profil</h3>
              <p>Dein geschäftlicher Name und dein öffentlicher Handle.</p>
              {businessProfile ? <div className="data-card"><b>{businessProfile.name}</b><span>{businessProfile.handle ? '@' + businessProfile.handle : 'Noch kein Handle'}</span></div> : <form className="settings-form" onSubmit={submitBusiness}>
                <label>Business-Name<input aria-label="Business-Name" value={businessName} onChange={event => setBusinessName(event.target.value)} placeholder="z. B. WebWorkBalance" /></label>
                <label>Handle<input aria-label="Handle" value={businessHandle} onChange={event => setBusinessHandle(event.target.value)} placeholder="z. B. webworkbalance" /></label>
                <button className="primary" disabled={businessSaving || dataLoading}><Plus size={15} />{businessSaving ? 'Erstellt…' : 'Business-Profil erstellen'}</button>
                {businessFeedback && <small className="form-feedback" role="status">{businessFeedback}</small>}
              </form>}
            </div>
          </div>}

          {category.id === 'workspace' && <div className="settings-grid">
            <div className="panel">
              <Users /><h3>Aktiver Workspace</h3>
              <p>Hier wählst du das Team aus, dessen Projekte, Aufgaben und Mitglieder du verwalten möchtest.</p>
              <div className="settings-form">
                <label htmlFor="settings-workspace">Workspace auswählen</label>
                <select id="settings-workspace" value={selectedWorkspaceId ?? ''} disabled={dataLoading || workspaceLifecycleBusy || !workspaces.length} onChange={event => onWorkspaceChange(event.target.value)}>
                  <option value="" disabled>Workspace auswählen</option>
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
              </div>
              {selectedWorkspace && <p className="settings-role">Deine Rolle: <span className={'role-pill role-' + currentWorkspaceRole}>{currentWorkspaceRole ? roleLabel[currentWorkspaceRole] : 'Mitglied'}</span></p>}
              {!dataLoading && !workspaces.length && <p>Du hast noch keinen Workspace. Erstelle einen oder nimm eine Einladung an.</p>}
            </div>
            <div className="panel">
              <Plus /><h3>Workspace erstellen</h3>
              <p>Lege einen eigenen Arbeitsbereich für ein neues Team an.</p>
              <form className="settings-form" onSubmit={submitWorkspace}>
                <label>Neuer Workspace<input aria-label="Neuer Workspace" required value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} placeholder="Workspace-Name" /></label>
                <button className="primary" disabled={workspaceSaving || dataLoading || workspaceLifecycleBusy}><Plus size={15} />{workspaceSaving ? 'Erstellt…' : 'Workspace erstellen'}</button>
                {workspaceFeedback && <small className="form-feedback" role="status">{workspaceFeedback}</small>}
              </form>
            </div>
            <WorkspaceTeamPanel key={selectedWorkspaceId} workspace={selectedWorkspace} currentRole={currentWorkspaceRole} currentUserId={currentUserId} members={workspaceMembers} invitations={workspaceInvitations} loading={teamLoading} error={teamError} onInvite={onInviteWorkspaceMember} onUpdateRole={onUpdateWorkspaceMemberRole} onRemoveMember={onRemoveWorkspaceMember} onRevokeInvitation={onRevokeWorkspaceInvitation} onRefresh={onRefreshWorkspaceTeam} />
            <WorkspaceLifecyclePanel
              key={`lifecycle:${selectedWorkspaceId ?? 'none'}`}
              selectedWorkspace={selectedWorkspace}
              currentUserId={currentUserId}
              currentRole={currentWorkspaceRole}
              members={workspaceMembers}
              busy={workspaceLifecycleBusy}
              feedback={workspaceLifecycleFeedback}
              onRename={onRenameWorkspace}
              onLeave={onLeaveWorkspace}
              onTransfer={onTransferWorkspaceOwnership}
              onDelete={onDeleteWorkspace}
            />
          </div>}

          {category.id === 'notifications' && <div className="push-settings-stack">
            {currentUserId && <PushPreferences key={currentUserId} userId={currentUserId} />}
            {notifications && <NotificationPreferences model={notifications} />}
          </div>}

          {category.id === 'security' && <div className="settings-grid">
            <div className="panel">
              <LockKeyhole /><h3>Passwort ändern</h3>
              <p>Lege ein neues Passwort für dein angemeldetes Konto fest. Sonderzeichen wie ! sind erlaubt.</p>
              {onUpdatePassword ? <form className="settings-form password-settings-form" onSubmit={submitPassword}>
                <label>Neues Passwort<PasswordInput aria-label="Neues Passwort" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={PASSWORD_MIN_LENGTH} placeholder={'Mindestens ' + PASSWORD_MIN_LENGTH + ' Zeichen'} autoComplete="new-password" /></label>
                <PasswordStrengthHint password={newPassword} />
                <label>Passwort bestätigen<PasswordInput aria-label="Passwort bestätigen" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} required minLength={PASSWORD_MIN_LENGTH} placeholder="Noch einmal eingeben" autoComplete="new-password" /></label>
                {passwordError && <small className="form-feedback error" role="alert">{passwordError}</small>}
                {passwordFeedback && <small className="form-feedback success" role="status">{passwordFeedback}</small>}
                <button className="primary" disabled={passwordSaving || resetSending || signingOut}><LockKeyhole size={15} />{passwordSaving ? 'Wird geändert…' : 'Passwort aktualisieren'}</button>
              </form> : <p>Zum Ändern deines Passworts musst du angemeldet sein.</p>}
            </div>
            <div className="panel">
              <Mail /><h3>Passwort zurücksetzen</h3>
              <p>Fordere einen Wiederherstellungslink für die E-Mail-Adresse deines Kontos an.</p>
              <div className="data-card"><span>E-Mail-Adresse</span><b>{accountEmail || 'Keine E-Mail-Adresse verfügbar'}</b></div>
              <p>Öffne anschließend den neuesten Link aus der E-Mail, um ein neues Passwort festzulegen.</p>
              {onRequestPasswordReset && <button type="button" className="secondary settings-reset-button" disabled={!accountEmail || resetSending || passwordSaving || signingOut || resetRemaining > 0} onClick={() => void requestReset()}>
                <Mail size={15} />{resetSending ? 'Wird gesendet…' : resetRemaining > 0 ? 'Erneut senden in ' + resetRemaining + ' s' : 'Link zum Zurücksetzen senden'}
              </button>}
              {resetError && <p className="form-feedback error" role="alert">{resetError}</p>}
              {resetFeedback && <p className="form-feedback success" role="status">{resetFeedback}</p>}
            </div>
            <div className="panel settings-full-width">
              <ShieldCheck /><h3>Dein Konto</h3>
              <p>{accountEmail || 'Keine aktive Anmeldung'}</p>
              <span className={backendConfigured && currentUserId ? 'ok' : 'setup-status'}><CheckCircle2 size={15} />{backendConfigured && currentUserId ? 'Du bist angemeldet' : 'Anmeldung erforderlich'}</span>
              {onSignOut && <button type="button" className="secondary signout" disabled={signingOut || passwordSaving || resetSending} onClick={() => void signOut()}><LogOut size={15} />{signingOut ? 'Wird abgemeldet…' : 'Abmelden'}</button>}
              {signOutError && <p className="form-feedback error" role="alert">{signOutError}</p>}
            </div>
            {onDeleteAccount && <div className="panel settings-full-width account-danger-zone">
              <Trash2 /><h3>Konto dauerhaft löschen</h3>
              <p>Dein Nexus-Konto und deine persönlichen Daten werden dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.</p>
              <p>Eigene Workspaces und Gruppen musst du vorher löschen oder die Ownership übertragen. So gehen keine Team-Daten versehentlich verloren.</p>
              {!deleteExpanded ? (
                <button type="button" className="secondary danger-action" disabled={passwordSaving || resetSending || signingOut} onClick={() => setDeleteExpanded(true)}><Trash2 size={15} />Konto löschen</button>
              ) : (
                <div className="settings-form account-delete-confirmation">
                  <label>Zur Bestätigung <b>{ACCOUNT_DELETION_CONFIRMATION}</b> eingeben
                    <input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} autoComplete="off" spellCheck={false} aria-describedby="account-delete-warning" />
                  </label>
                  <small id="account-delete-warning" className="settings-hint">Nach dem Löschen wirst du auf allen Geräten abgemeldet.</small>
                  {deleteError && <small className="form-feedback error" role="alert">{deleteError}</small>}
                  <div className="account-delete-actions">
                    <button type="button" className="secondary" disabled={deletingAccount} onClick={() => { setDeleteExpanded(false); setDeleteConfirmation(''); setDeleteError(null); }}>Abbrechen</button>
                    <button type="button" className="danger-action" disabled={deletingAccount || deleteConfirmation !== ACCOUNT_DELETION_CONFIRMATION} onClick={() => void deleteAccount()}><Trash2 size={15} />{deletingAccount ? 'Wird gelöscht…' : 'Endgültig löschen'}</button>
                  </div>
                </div>
              )}
            </div>}
          </div>}
        </section>
      </div>
    </section>
  );
}
