import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { initialMessages, seedContacts } from '../data/mockData';
import { useAuth } from '../features/auth/AuthProvider';
import {
  acceptWorkspaceInvitation,
  createBusinessProfile,
  createWorkspace,
  createWorkspaceInvitation,
  loadBusinessProfiles,
  loadOwnProfile,
  loadWorkspaceInvitations,
  loadWorkspaceMemberships,
  loadWorkspaceMembers,
  loadWorkspaces,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  updateOwnProfile,
  updateWorkspaceMemberRole,
  type NexusBusinessProfile,
  type NexusProfile,
  type NexusWorkspace,
  type NexusWorkspaceInvitation,
  type NexusWorkspaceMember,
  type NexusWorkspaceMembership,
  type WorkspaceRole,
} from '../features/data/nexusData';
import { AIPage } from '../pages/AIPage';
import { AuthPage } from '../pages/AuthPage';
import { BriefingPage } from '../pages/BriefingPage';
import { BusinessPage } from '../pages/BusinessPage';
import { ChatsPage } from '../pages/ChatsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { Contact, IdentityMode } from '../types';
import { routes } from './routes';

type ManageableRole = Exclude<WorkspaceRole, 'owner'>;

export function App() {
  const auth = useAuth();

  if (auth.configured && auth.loading) {
    return (
      <div className="app-loading">
        <div className="auth-logo">N</div>
        <b>Nexus wird sicher geladen…</b>
      </div>
    );
  }

  return (
    <Routes>
      <Route path={routes.auth} element={<AuthPage />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [selected, setSelected] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>(seedContacts);
  const [identity, setIdentity] = useState<IdentityMode>('business');
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const [profile, setProfile] = useState<NexusProfile | null>(null);
  const [businessProfiles, setBusinessProfiles] = useState<NexusBusinessProfile[]>([]);
  const [workspaces, setWorkspaces] = useState<NexusWorkspace[]>([]);
  const [memberships, setMemberships] = useState<NexusWorkspaceMembership[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<NexusWorkspaceMember[]>([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState<NexusWorkspaceInvitation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  useEffect(() => {
    const userId = auth.user?.id;
    if (!auth.configured || !userId) {
      setProfile(null);
      setBusinessProfiles([]);
      setWorkspaces([]);
      setMemberships([]);
      setSelectedWorkspaceId(null);
      setDataLoading(false);
      setDataError(null);
      return;
    }

    let active = true;
    setDataLoading(true);
    setDataError(null);

    void (async () => {
      try {
        const [profileResult, businessResult, workspaceResult, membershipResult] =
          await Promise.all([
            loadOwnProfile(userId),
            loadBusinessProfiles(),
            loadWorkspaces(),
            loadWorkspaceMemberships(userId),
          ]);

        if (!active) return;

        setProfile(profileResult.data);
        setBusinessProfiles(businessResult.data);
        setWorkspaces(workspaceResult.data);
        setMemberships(membershipResult.data);
        setSelectedWorkspaceId((current) =>
          current && workspaceResult.data.some((workspace) => workspace.id === current)
            ? current
            : workspaceResult.data[0]?.id ?? null,
        );
        setDataError(
          profileResult.error ||
            businessResult.error ||
            workspaceResult.error ||
            membershipResult.error ||
            null,
        );
      } catch (error) {
        if (!active) return;
        setDataError(error instanceof Error ? error.message : 'Nexus-Daten konnten nicht geladen werden.');
      } finally {
        if (active) setDataLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [auth.configured, auth.user?.id]);

  const currentWorkspaceRole = memberships.find(
    (membership) => membership.workspace_id === selectedWorkspaceId,
  )?.role;

  useEffect(() => {
    const workspaceId = selectedWorkspaceId;
    const userId = auth.user?.id;

    if (!workspaceId || !userId) {
      setWorkspaceMembers([]);
      setWorkspaceInvitations([]);
      setTeamError(null);
      setTeamLoading(false);
      return;
    }

    let active = true;
    setTeamLoading(true);
    setTeamError(null);

    void (async () => {
      const memberResult = await loadWorkspaceMembers(workspaceId);
      const invitationResult =
        currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'
          ? await loadWorkspaceInvitations(workspaceId)
          : { data: [] as NexusWorkspaceInvitation[], error: null };

      if (!active) return;

      setWorkspaceMembers(memberResult.data);
      setWorkspaceInvitations(invitationResult.data);
      setTeamError(memberResult.error || invitationResult.error || null);
      setTeamLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [auth.user?.id, currentWorkspaceRole, selectedWorkspaceId]);

  useEffect(() => {
    if (!auth.user) return;

    const pendingInvite = localStorage.getItem('nexus_pending_invite');
    const currentInvite = new URLSearchParams(location.search).get('invite');

    if (pendingInvite && (location.pathname !== routes.settings || !currentInvite)) {
      navigate(`${routes.settings}?invite=${encodeURIComponent(pendingInvite)}`, { replace: true });
    }
  }, [auth.user, location.pathname, location.search, navigate]);

  if (auth.configured && !auth.user) {
    return <Navigate to={routes.auth} replace />;
  }

  const businessProfile = businessProfiles[0] ?? null;
  const accountName =
    profile?.full_name ||
    (auth.user?.user_metadata?.full_name as string | undefined) ||
    auth.user?.email?.split('@')[0] ||
    'Nexus Nutzer';
  const accountSubtitle =
    identity === 'business'
      ? businessProfile?.handle
        ? `@${businessProfile.handle}`
        : businessProfile?.name || 'Business-Profil einrichten'
      : profile?.username
        ? `@${profile.username}`
        : auth.user?.email || 'Privates Profil';

  const send = () => {
    const nextMessage = msg.trim();
    if (!nextMessage) return;

    setMessages((current) => [...current, { me: true, text: nextMessage }]);
    setMsg('');
  };

  const openChat = (index: number) => {
    setSelected(index);
    navigate(routes.chats);
  };

  const refreshWorkspaceTeam = async () => {
    if (!selectedWorkspaceId) {
      setWorkspaceMembers([]);
      setWorkspaceInvitations([]);
      return;
    }

    setTeamLoading(true);
    setTeamError(null);

    const memberResult = await loadWorkspaceMembers(selectedWorkspaceId);
    const invitationResult =
      currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin'
        ? await loadWorkspaceInvitations(selectedWorkspaceId)
        : { data: [] as NexusWorkspaceInvitation[], error: null };

    setWorkspaceMembers(memberResult.data);
    setWorkspaceInvitations(invitationResult.data);
    setTeamError(memberResult.error || invitationResult.error || null);
    setTeamLoading(false);
  };

  const saveProfile = async (
    patch: Partial<Pick<NexusProfile, 'full_name' | 'username' | 'bio'>>,
  ) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };

    const result = await updateOwnProfile(auth.user.id, patch);
    if (result.data) setProfile(result.data);
    return { error: result.error };
  };

  const addWorkspace = async (name: string) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };

    const result = await createWorkspace(name, auth.user.id);
    const createdWorkspace = result.data;

    if (createdWorkspace) {
      setWorkspaces((current) => [...current, createdWorkspace]);
      setSelectedWorkspaceId(createdWorkspace.id);

      const membershipResult = await loadWorkspaceMemberships(auth.user.id);
      if (!membershipResult.error) {
        setMemberships(membershipResult.data);
      }
    }

    return { error: result.error };
  };

  const addBusinessProfile = async (name: string, handle: string) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };

    const result = await createBusinessProfile(name, auth.user.id, handle);
    const createdBusinessProfile = result.data;
    if (createdBusinessProfile) {
      setBusinessProfiles((current) => [...current, createdBusinessProfile]);
    }
    return { error: result.error };
  };

  const inviteWorkspaceMember = async (email: string, role: ManageableRole) => {
    if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' };

    const result = await createWorkspaceInvitation(selectedWorkspaceId, email, role);
    if (!result.error) await refreshWorkspaceTeam();
    return { error: result.error };
  };

  const changeWorkspaceMemberRole = async (userId: string, role: ManageableRole) => {
    if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' };

    const result = await updateWorkspaceMemberRole(selectedWorkspaceId, userId, role);
    if (!result.error) await refreshWorkspaceTeam();
    return result;
  };

  const deleteWorkspaceMember = async (userId: string) => {
    if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' };

    const result = await removeWorkspaceMember(selectedWorkspaceId, userId);
    if (!result.error) await refreshWorkspaceTeam();
    return result;
  };

  const revokeInvitation = async (invitationId: string) => {
    const result = await revokeWorkspaceInvitation(invitationId);
    if (!result.error) await refreshWorkspaceTeam();
    return result;
  };

  const acceptInvitation = async (token: string) => {
    if (!auth.user) return { error: 'Bitte zuerst anmelden.' };

    const result = await acceptWorkspaceInvitation(token);
    if (result.error || !result.data) {
      return { error: result.error || 'Einladung konnte nicht angenommen werden.' };
    }

    const [workspaceResult, membershipResult] = await Promise.all([
      loadWorkspaces(),
      loadWorkspaceMemberships(auth.user.id),
    ]);

    if (workspaceResult.error || membershipResult.error) {
      return {
        error: workspaceResult.error || membershipResult.error || 'Workspace konnte nicht neu geladen werden.',
      };
    }

    setWorkspaces(workspaceResult.data);
    setMemberships(membershipResult.data);
    setSelectedWorkspaceId(result.data.workspace_id);

    return { error: null, workspaceName: result.data.workspace_name };
  };

  const signOut = async () => {
    await auth.signOut();
    navigate(routes.auth, { replace: true });
  };

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onWorkspaceChange={setSelectedWorkspaceId}
        workspaceRole={currentWorkspaceRole}
        workspaceLoading={dataLoading}
        identity={identity}
        accountName={accountName}
        accountSubtitle={accountSubtitle}
      />

      <main>
        <Routes>
          <Route path="/" element={<Navigate to={routes.briefing} replace />} />
          <Route
            path={routes.briefing}
            element={<BriefingPage openChat={() => openChat(0)} displayName={accountName} />}
          />
          <Route
            path={routes.chats}
            element={
              <ChatsPage
                selected={selected}
                setSelected={setSelected}
                messages={messages}
                msg={msg}
                setMsg={setMsg}
                send={send}
              />
            }
          />
          <Route
            path={routes.contacts}
            element={<ContactsPage contacts={contacts} setContacts={setContacts} />}
          />
          <Route path={routes.business} element={<BusinessPage />} />
          <Route path={routes.ai} element={<AIPage />} />
          <Route
            path={routes.settings}
            element={
              <SettingsPage
                identity={identity}
                setIdentity={setIdentity}
                backendConfigured={auth.configured}
                accountEmail={auth.user?.email}
                currentUserId={auth.user?.id}
                profile={profile}
                businessProfiles={businessProfiles}
                workspaces={workspaces}
                selectedWorkspaceId={selectedWorkspaceId}
                currentWorkspaceRole={currentWorkspaceRole}
                workspaceMembers={workspaceMembers}
                workspaceInvitations={workspaceInvitations}
                teamLoading={teamLoading}
                teamError={teamError}
                dataLoading={dataLoading}
                dataError={dataError}
                onSaveProfile={saveProfile}
                onCreateWorkspace={addWorkspace}
                onCreateBusinessProfile={addBusinessProfile}
                onInviteWorkspaceMember={inviteWorkspaceMember}
                onUpdateWorkspaceMemberRole={changeWorkspaceMemberRole}
                onRemoveWorkspaceMember={deleteWorkspaceMember}
                onRevokeWorkspaceInvitation={revokeInvitation}
                onRefreshWorkspaceTeam={refreshWorkspaceTeam}
                onAcceptWorkspaceInvitation={acceptInvitation}
                onSignOut={auth.configured ? signOut : undefined}
              />
            }
          />
          <Route path={routes.auth} element={<Navigate to={routes.briefing} replace />} />
          <Route path="*" element={<Navigate to={routes.briefing} replace />} />
        </Routes>
      </main>
    </div>
  );
}
