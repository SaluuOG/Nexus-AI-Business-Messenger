import {
  Building2,
  CheckCircle2,
  LockKeyhole,
  LogOut,
  Plus,
  ServerCog,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import type {
  NexusBusinessProfile,
  NexusProfile,
  NexusWorkspace,
  WorkspaceRole,
} from '../features/data/nexusData';
import type { IdentityMode } from '../types';

type ProfilePatch = Partial<Pick<NexusProfile, 'full_name' | 'username' | 'bio'>>;

type SettingsPageProps = {
  identity: IdentityMode;
  setIdentity: (identity: IdentityMode) => void;
  backendConfigured: boolean;
  accountEmail?: string;
  profile: NexusProfile | null;
  businessProfiles: NexusBusinessProfile[];
  workspaces: NexusWorkspace[];
  selectedWorkspaceId: string | null;
  currentWorkspaceRole?: WorkspaceRole;
  dataLoading: boolean;
  dataError?: string | null;
  onSaveProfile: (patch: ProfilePatch) => Promise<{ error: string | null }>;
  onCreateWorkspace: (name: string) => Promise<{ error: string | null }>;
  onCreateBusinessProfile: (name: string, handle: string) => Promise<{ error: string | null }>;
  onSignOut?: () => void;
};

const roleLabel: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

export function SettingsPage({
  identity,
  setIdentity,
  backendConfigured,
  accountEmail,
  profile,
  businessProfiles,
  workspaces,
  selectedWorkspaceId,
  currentWorkspaceRole,
  dataLoading,
  dataError,
  onSaveProfile,
  onCreateWorkspace,
  onCreateBusinessProfile,
  onSignOut,
}: SettingsPageProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessHandle, setBusinessHandle] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [businessFeedback, setBusinessFeedback] = useState<string | null>(null);

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setUsername(profile?.username ?? '');
    setBio(profile?.bio ?? '');
  }, [profile]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
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

  return (
    <section className="page">
      <Header
        kicker="ACCOUNT"
        title="Einstellungen"
        sub="Echte Profile, Workspaces, Rollen und Supabase-Sicherheitsgrundlage."
      />

      {dataError && <div className="data-alert">Backend: {dataError}</div>}

      <div className="panel">
        <h3>Deine Identität</h3>
        <div className="identity">
          <button
            className={identity === 'private' ? 'active' : ''}
            onClick={() => setIdentity('private')}
          >
            <Users />
            <span>
              <b>Privat</b>
              <small>Persönliches Supabase-Profil</small>
            </span>
          </button>
          <button
            className={identity === 'business' ? 'active' : ''}
            onClick={() => setIdentity('business')}
          >
            <Building2 />
            <span>
              <b>Business</b>
              <small>Geschäftliche Identität</small>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel">
          <Users />
          <h3>Persönliches Profil</h3>
          <form className="settings-form" onSubmit={submitProfile}>
            <label>
              Name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Dein Name" />
            </label>
            <label>
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="z. B. samet" />
            </label>
            <label>
              Bio
              <textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Kurze Beschreibung" rows={3} />
            </label>
            <button className="primary" disabled={profileSaving || dataLoading}>
              {profileSaving ? 'Speichert…' : 'Profil speichern'}
            </button>
            {profileFeedback && <small className="form-feedback">{profileFeedback}</small>}
          </form>
        </div>

        <div className="panel">
          <Building2 />
          <h3>Business-Identität</h3>
          {businessProfile ? (
            <div className="data-card">
              <b>{businessProfile.name}</b>
              <span>{businessProfile.handle ? `@${businessProfile.handle}` : 'Noch kein Handle'}</span>
              <small>Echt in Supabase gespeichert</small>
            </div>
          ) : (
            <form className="settings-form" onSubmit={submitBusiness}>
              <label>
                Business-Name
                <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="z. B. WebWorkBalance" />
              </label>
              <label>
                Handle
                <input value={businessHandle} onChange={(event) => setBusinessHandle(event.target.value)} placeholder="z. B. webworkbalance" />
              </label>
              <button className="primary" disabled={businessSaving || dataLoading}>
                <Plus size={15} /> {businessSaving ? 'Erstellt…' : 'Business-Profil erstellen'}
              </button>
              {businessFeedback && <small className="form-feedback">{businessFeedback}</small>}
            </form>
          )}
        </div>

        <div className="panel">
          <ShieldCheck />
          <h3>Workspace & Rollen</h3>
          <p>
            {selectedWorkspace
              ? `${selectedWorkspace.name} · ${currentWorkspaceRole ? roleLabel[currentWorkspaceRole] : 'Mitglied'}`
              : 'Noch kein Workspace ausgewählt.'}
          </p>
          <div className="workspace-list">
            {workspaces.map((workspace) => (
              <span key={workspace.id}>{workspace.name}</span>
            ))}
            {workspaces.length === 0 && <small>Noch keine echten Workspaces.</small>}
          </div>
          <form className="settings-form compact" onSubmit={submitWorkspace}>
            <label>
              Neuer Workspace
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace-Name" />
            </label>
            <button className="secondary" disabled={workspaceSaving || dataLoading}>
              <Plus size={15} /> {workspaceSaving ? 'Erstellt…' : 'Workspace erstellen'}
            </button>
            {workspaceFeedback && <small className="form-feedback">{workspaceFeedback}</small>}
          </form>
          <button className="secondary" disabled title="Einladungen folgen im nächsten Rollen-Schritt">
            <UserPlus size={15} /> Mitglied einladen
          </button>
        </div>

        <div className="panel">
          <ServerCog />
          <h3>Account & Backend</h3>
          <p>
            {backendConfigured
              ? `Supabase Auth und Datenbank sind verbunden${accountEmail ? ` · ${accountEmail}` : ''}.`
              : 'Nexus läuft aktuell im Demo-Modus.'}
          </p>
          <span className={backendConfigured ? 'ok' : 'setup-status'}>
            <CheckCircle2 size={15} />
            {backendConfigured ? 'Authentifizierung & Datenbank aktiv' : 'Wartet auf Supabase'}
          </span>
          {onSignOut && (
            <button className="secondary signout" onClick={onSignOut}>
              <LogOut size={15} /> Abmelden
            </button>
          )}
        </div>

        <div className="panel">
          <LockKeyhole />
          <h3>Sicherheit & Geräte</h3>
          <p>
            Row Level Security schützt Profile, Business-Identitäten, Workspaces und Rollen auf Datenbankebene.
          </p>
          <span className="ok">
            <CheckCircle2 size={15} /> RLS aktiv · keine privaten Server-Secrets im Frontend
          </span>
        </div>
      </div>
    </section>
  );
}
