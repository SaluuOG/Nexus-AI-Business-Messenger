import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { useAuth } from '../features/auth/AuthProvider';
import { openDirectConversation, touchUserPresence } from '../features/data/chatData';
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
import type { IdentityMode } from '../types';
import { routes } from './routes';
import { businessSearch } from './businessNavigation';

type ManageableRole = Exclude<WorkspaceRole, 'owner'>;

const AIPage = lazy(() => import('../pages/AIPage').then((module) => ({ default: module.AIPage })));
const AuthPage = lazy(() => import('../pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const BriefingPage = lazy(() => import('../pages/BriefingPage').then((module) => ({ default: module.BriefingPage })));
const BusinessPage = lazy(() => import('../pages/BusinessPage').then((module) => ({ default: module.BusinessPage })));
const ChatsPage = lazy(() => import('../pages/ChatsPage').then((module) => ({ default: module.ChatsPage })));
const ContactsPage = lazy(() => import('../pages/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const GroupChatsPage = lazy(() => import('../pages/GroupChatsPage').then((module) => ({ default: module.GroupChatsPage })));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));

function AppLoading() {
  return <div className="app-loading"><div className="auth-logo">N</div><b>Nexus wird sicher geladen…</b></div>;
}

export function App() {
  const auth = useAuth();
  if (auth.configured && auth.loading) return <AppLoading />;
  return (
    <Suspense fallback={<AppLoading />}>
      {auth.recoveryMode ? (
        <ResetPasswordPage />
      ) : (
        <Routes>
          <Route path={routes.auth} element={<AuthPage />} />
          <Route path={routes.resetPassword} element={<ResetPasswordPage />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      )}
    </Suspense>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [identity, setIdentity] = useState<IdentityMode>('business');
  const [profile, setProfile] = useState<NexusProfile | null>(null);
  const [businessProfiles, setBusinessProfiles] = useState<NexusBusinessProfile[]>([]);
  const [workspaces, setWorkspaces] = useState<NexusWorkspace[]>([]);
  const [memberships, setMemberships] = useState<NexusWorkspaceMembership[]>([]);
  const [preferredWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<NexusWorkspaceMember[]>([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState<NexusWorkspaceInvitation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
  const linkedWorkspaceId = location.pathname === routes.business ? new URLSearchParams(location.search).get('workspace') : null;
  const selectedWorkspaceId = linkedWorkspaceId
    ? workspaces.some(workspace => workspace.id === linkedWorkspaceId) ? linkedWorkspaceId : null
    : preferredWorkspaceId;
  useEffect(() => {
    if (linkedWorkspaceId && selectedWorkspaceId) setSelectedWorkspaceId(selectedWorkspaceId);
  }, [linkedWorkspaceId, selectedWorkspaceId]);


  useEffect(() => {
    const userId = auth.user?.id;
    if (!auth.configured || !userId) {
      setProfile(null); setBusinessProfiles([]); setWorkspaces([]); setMemberships([]); setSelectedWorkspaceId(null); setDataLoading(false); setDataError(null); return;
    }
    let active = true;
    setDataLoading(true); setDataError(null);
    void (async () => {
      try {
        const [profileResult, businessResult, workspaceResult, membershipResult] = await Promise.all([
          loadOwnProfile(userId), loadBusinessProfiles(), loadWorkspaces(), loadWorkspaceMemberships(userId),
        ]);
        if (!active) return;
        setProfile(profileResult.data); setBusinessProfiles(businessResult.data); setWorkspaces(workspaceResult.data); setMemberships(membershipResult.data);
        setSelectedWorkspaceId((current) => current && workspaceResult.data.some((workspace) => workspace.id === current) ? current : workspaceResult.data[0]?.id ?? null);
        setDataError(profileResult.error || businessResult.error || workspaceResult.error || membershipResult.error || null);
      } catch (error) {
        if (active) setDataError(error instanceof Error ? error.message : 'Nexus-Daten konnten nicht geladen werden.');
      } finally { if (active) setDataLoading(false); }
    })();
    return () => { active = false; };
  }, [auth.configured, auth.user?.id]);

  useEffect(() => {
    if (!auth.user?.id) return;

    const heartbeat = () => void touchUserPresence();
    heartbeat();
    const interval = window.setInterval(heartbeat, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [auth.user?.id]);

  const currentWorkspaceRole = memberships.find((membership) => membership.workspace_id === selectedWorkspaceId)?.role;

  useEffect(() => {
    const workspaceId = selectedWorkspaceId;
    if (!workspaceId || !auth.user?.id) { setWorkspaceMembers([]); setWorkspaceInvitations([]); setTeamError(null); setTeamLoading(false); return; }
    let active = true; setTeamLoading(true); setTeamError(null);
    void (async () => {
      const memberResult = await loadWorkspaceMembers(workspaceId);
      const invitationResult = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin' ? await loadWorkspaceInvitations(workspaceId) : { data: [] as NexusWorkspaceInvitation[], error: null };
      if (!active) return;
      setWorkspaceMembers(memberResult.data); setWorkspaceInvitations(invitationResult.data); setTeamError(memberResult.error || invitationResult.error || null); setTeamLoading(false);
    })();
    return () => { active = false; };
  }, [auth.user?.id, currentWorkspaceRole, selectedWorkspaceId]);

  useEffect(() => {
    if (!auth.user) return;
    const pendingInvite = localStorage.getItem('nexus_pending_invite');
    const currentInvite = new URLSearchParams(location.search).get('invite');
    if (pendingInvite && (location.pathname !== routes.settings || !currentInvite)) navigate(`${routes.settings}?invite=${encodeURIComponent(pendingInvite)}`, { replace: true });
  }, [auth.user, location.pathname, location.search, navigate]);

  if (auth.configured && !auth.user) return <Navigate to={routes.auth} replace />;

  const businessProfile = businessProfiles[0] ?? null;
  const accountName = profile?.full_name || (auth.user?.user_metadata?.full_name as string | undefined) || auth.user?.email?.split('@')[0] || 'Nexus Nutzer';
  const accountSubtitle = identity === 'business' ? businessProfile?.handle ? `@${businessProfile.handle}` : businessProfile?.name || 'Business-Profil einrichten' : profile?.username ? `@${profile.username}` : auth.user?.email || 'Privates Profil';

  const startContactChat = async (contactUserId: string) => {
    const result = await openDirectConversation(contactUserId);
    if (result.error || !result.data) return { error: result.error || 'Chat konnte nicht geöffnet werden.' };
    setRequestedConversationId(result.data);
    navigate(routes.chats);
    return { error: null };
  };

  const refreshWorkspaceTeam = async () => {
    if (!selectedWorkspaceId) { setWorkspaceMembers([]); setWorkspaceInvitations([]); return; }
    setTeamLoading(true); setTeamError(null);
    const memberResult = await loadWorkspaceMembers(selectedWorkspaceId);
    const invitationResult = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin' ? await loadWorkspaceInvitations(selectedWorkspaceId) : { data: [] as NexusWorkspaceInvitation[], error: null };
    setWorkspaceMembers(memberResult.data); setWorkspaceInvitations(invitationResult.data); setTeamError(memberResult.error || invitationResult.error || null); setTeamLoading(false);
  };

  const saveProfile = async (patch: Partial<Pick<NexusProfile, 'full_name' | 'username' | 'bio'>>) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };
    const result = await updateOwnProfile(auth.user.id, patch); if (result.data) setProfile(result.data); return { error: result.error };
  };
  const addWorkspace = async (name: string) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };
    const result = await createWorkspace(name, auth.user.id);
    if (result.data) { setWorkspaces((current) => [...current, result.data!]); setSelectedWorkspaceId(result.data.id); const membershipResult = await loadWorkspaceMemberships(auth.user.id); if (!membershipResult.error) setMemberships(membershipResult.data); }
    return { error: result.error };
  };
  const addBusinessProfile = async (name: string, handle: string) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };
    const result = await createBusinessProfile(name, auth.user.id, handle); if (result.data) setBusinessProfiles((current) => [...current, result.data!]); return { error: result.error };
  };
  const inviteWorkspaceMember = async (email: string, role: ManageableRole) => { if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' }; const result = await createWorkspaceInvitation(selectedWorkspaceId, email, role); if (!result.error) await refreshWorkspaceTeam(); return { error: result.error }; };
  const changeWorkspaceMemberRole = async (userId: string, role: ManageableRole) => { if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' }; const result = await updateWorkspaceMemberRole(selectedWorkspaceId, userId, role); if (!result.error) await refreshWorkspaceTeam(); return result; };
  const deleteWorkspaceMember = async (userId: string) => { if (!selectedWorkspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' }; const result = await removeWorkspaceMember(selectedWorkspaceId, userId); if (!result.error) await refreshWorkspaceTeam(); return result; };
  const revokeInvitation = async (invitationId: string) => { const result = await revokeWorkspaceInvitation(invitationId); if (!result.error) await refreshWorkspaceTeam(); return result; };
  const acceptInvitation = async (token: string) => {
    if (!auth.user) return { error: 'Bitte zuerst anmelden.' };
    const result = await acceptWorkspaceInvitation(token); if (result.error || !result.data) return { error: result.error || 'Einladung konnte nicht angenommen werden.' };
    const [workspaceResult, membershipResult] = await Promise.all([loadWorkspaces(), loadWorkspaceMemberships(auth.user.id)]);
    if (workspaceResult.error || membershipResult.error) return { error: workspaceResult.error || membershipResult.error || 'Workspace konnte nicht neu geladen werden.' };
    setWorkspaces(workspaceResult.data); setMemberships(membershipResult.data); setSelectedWorkspaceId(result.data.workspace_id); return { error: null, workspaceName: result.data.workspace_name };
  };
  const signOut = async () => { await auth.signOut(); navigate(routes.auth, { replace: true }); };

  return <div className="app">
    <Sidebar workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onWorkspaceChange={workspaceId => {
      setSelectedWorkspaceId(workspaceId);
      if (location.pathname === routes.business) navigate(routes.business + '?' + businessSearch(workspaceId));
    }} workspaceRole={currentWorkspaceRole} workspaceLoading={dataLoading} identity={identity} accountName={accountName} accountSubtitle={accountSubtitle} />
    <main><Routes>
      <Route path="/" element={<Navigate to={routes.briefing} replace />} />
      <Route
        path={routes.briefing}
        element={
          <BriefingPage
            key={auth.user?.id + ':' + selectedWorkspaceId}
            openBusiness={target => navigate(routes.business + '?' + businessSearch(selectedWorkspaceId, target))}
            displayName={accountName}
            workspaceId={selectedWorkspaceId}
            workspaceName={workspaces.find(workspace => workspace.id === selectedWorkspaceId)?.name}
            currentUserId={auth.user?.id}
            workspaceLoading={dataLoading}
            workspaceError={dataError}
          />
        }
      />
      <Route path={routes.chats} element={<ChatsPage key={auth.user?.id} workspaceId={selectedWorkspaceId} currentUserId={auth.user?.id} requestedConversationId={requestedConversationId} onRequestedConversationHandled={() => setRequestedConversationId(null)} />} />
      <Route path={routes.groups} element={<GroupChatsPage key={auth.user?.id} workspaceId={selectedWorkspaceId} currentUserId={auth.user?.id} />} />
      <Route path={routes.contacts} element={<ContactsPage onStartChat={startContactChat} />} />
      <Route
        path={routes.business}
        element={
          <BusinessPage
            key={auth.user?.id + ':' + selectedWorkspaceId}
            workspaceId={selectedWorkspaceId}
            workspaceName={workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name}
            workspaceRole={currentWorkspaceRole}
            workspaceLoading={dataLoading}
            workspaceError={dataError || (!dataLoading && linkedWorkspaceId && !selectedWorkspaceId ? 'Der verknüpfte Workspace ist nicht verfügbar oder du hast keinen Zugriff.' : null)}
            currentUserId={auth.user?.id}
          />
        }
      />
      <Route path={routes.ai} element={<AIPage />} />
      <Route path={routes.settings} element={<SettingsPage identity={identity} setIdentity={setIdentity} backendConfigured={auth.configured} accountEmail={auth.user?.email} currentUserId={auth.user?.id} profile={profile} businessProfiles={businessProfiles} workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} currentWorkspaceRole={currentWorkspaceRole} workspaceMembers={workspaceMembers} workspaceInvitations={workspaceInvitations} teamLoading={teamLoading} teamError={teamError} dataLoading={dataLoading} dataError={dataError} onSaveProfile={saveProfile} onCreateWorkspace={addWorkspace} onCreateBusinessProfile={addBusinessProfile} onInviteWorkspaceMember={inviteWorkspaceMember} onUpdateWorkspaceMemberRole={changeWorkspaceMemberRole} onRemoveWorkspaceMember={deleteWorkspaceMember} onRevokeWorkspaceInvitation={revokeInvitation} onRefreshWorkspaceTeam={refreshWorkspaceTeam} onAcceptWorkspaceInvitation={acceptInvitation} onUpdatePassword={auth.configured ? auth.updatePassword : undefined} onSignOut={auth.configured ? signOut : undefined} />} />
      <Route path={routes.auth} element={<Navigate to={routes.briefing} replace />} /><Route path="*" element={<Navigate to={routes.briefing} replace />} />
    </Routes></main>
  </div>;
}
