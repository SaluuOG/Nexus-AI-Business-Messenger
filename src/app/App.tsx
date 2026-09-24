import { useNetworkStatus } from '../features/connection/useNetworkStatus';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { retryRead } from '../features/data/readRetry';
import { useAuth } from '../features/auth/AuthProvider';
import { openDirectConversation, touchUserPresence } from '../features/data/chatData';
import {
  acceptWorkspaceInvitation,
  createBusinessProfile,
  createWorkspace,
  createWorkspaceInvitation,
  deleteWorkspace,
  leaveWorkspace,
  loadBusinessProfiles,
  loadOwnProfile,
  loadWorkspaceInvitations,
  loadWorkspaceMemberships,
  loadWorkspaceMembers,
  loadWorkspaces,
  removeWorkspaceMember,
  renameWorkspace,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
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
import { useAccountPreferences } from '../features/settings/useAccountPreferences';
import { startRoute } from '../features/settings/preferences';
import { useNotifications } from '../features/notifications/useNotifications';

type ManageableRole = Exclude<WorkspaceRole, 'owner'>;
type WorkspaceLifecycleFeedback = {
  workspaceId: string;
  message: string;
  error: boolean;
};

const OfflineChatsPage = lazy(() => import('../pages/OfflineChatsPage').then(module => ({ default: module.OfflineChatsPage })));

const AIPage = lazy(() => import('../pages/AIPage').then((module) => ({ default: module.AIPage })));
const AuthPage = lazy(() => import('../pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const BriefingPage = lazy(() => import('../pages/BriefingPage').then((module) => ({ default: module.BriefingPage })));
const BusinessPage = lazy(() => import('../pages/BusinessPage').then((module) => ({ default: module.BusinessPage })));
const ChatsPage = lazy(() => import('../pages/ChatsPage').then((module) => ({ default: module.ChatsPage })));
const ContactsPage = lazy(() => import('../pages/ContactsPage').then((module) => ({ default: module.ContactsPage })));
const GroupChatsPage = lazy(() => import('../pages/GroupChatsPage').then((module) => ({ default: module.GroupChatsPage })));
const MessageSearchPage = lazy(() => import('../pages/MessageSearchPage').then((module) => ({ default: module.MessageSearchPage })));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));

function AppLoading() {
  return <div className="app-loading"><div className="auth-logo">N</div><b>Nexus wird sicher geladen…</b></div>;
}

export function App() {
  const auth = useAuth();
  const online = useNetworkStatus();
  if (!online && !auth.session && auth.offlineAccountId && !auth.recoveryMode) {
    return <Suspense fallback={<AppLoading />}><OfflineChatsPage key={auth.offlineAccountId} account={auth.offlineAccountId} onClear={auth.clearOfflineChats} /></Suspense>;
  }
  if (auth.configured && auth.loading) return <AppLoading />;
  return (
    <Suspense fallback={<AppLoading />}>
      <Routes>
        {/* Keep the recovery page mounted when success clears recoveryMode. */}
        <Route path={routes.resetPassword} element={<ResetPasswordPage />} />
        <Route path={routes.auth} element={auth.recoveryMode ? (
          <Navigate to={routes.resetPassword} replace />
        ) : <AuthPage />} />
        <Route path="*" element={auth.recoveryMode ? (
          <Navigate to={routes.resetPassword} replace />
        ) : <AppShell key={auth.user?.id ?? 'anonymous'} />} />
      </Routes>
    </Suspense>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { preferences, updatePreferences, ready: preferencesReady, error: preferencesError } = useAccountPreferences(auth.user?.id);
  const notifications = useNotifications(auth.user?.id, location.pathname + location.search);
  const identity = preferences.identity;
  const setIdentity = (value: IdentityMode) => updatePreferences({ identity: value });
  const defaultRoute = startRoute(preferences.startView);
  const [profile, setProfile] = useState<NexusProfile | null>(null);
  const [businessProfiles, setBusinessProfiles] = useState<NexusBusinessProfile[]>([]);
  const [workspaces, setWorkspaces] = useState<NexusWorkspace[]>([]);
  const [memberships, setMemberships] = useState<NexusWorkspaceMembership[]>([]);
  const [preferredWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<NexusWorkspaceMember[]>([]);
  const [workspaceInvitations, setWorkspaceInvitations] = useState<NexusWorkspaceInvitation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataReload, setDataReload] = useState(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamWorkspaceId, setTeamWorkspaceId] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamRefreshVersion, setTeamRefreshVersion] = useState(0);
  const [workspaceLifecycleBusy, setWorkspaceLifecycleBusy] = useState(false);
  const [workspaceLifecycleFeedback, setWorkspaceLifecycleFeedback] = useState<WorkspaceLifecycleFeedback | null>(null);
  const workspaceLifecycleLock = useRef(false);
  const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
  const linkedWorkspaceId = location.pathname === routes.business ? new URLSearchParams(location.search).get('workspace') : null;
  const selectedWorkspaceId = linkedWorkspaceId
    ? workspaces.some(workspace => workspace.id === linkedWorkspaceId) ? linkedWorkspaceId : null
    : preferredWorkspaceId;
  const selectedWorkspaceRef = useRef(selectedWorkspaceId);
  selectedWorkspaceRef.current = selectedWorkspaceId;
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
          retryRead(() => loadOwnProfile(userId), () => active),
          retryRead(loadBusinessProfiles, () => active),
          retryRead(loadWorkspaces, () => active),
          retryRead(() => loadWorkspaceMemberships(userId), () => active),
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
  }, [auth.configured, auth.user?.id, dataReload]);

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
    if (!workspaceId || !auth.user?.id) { setWorkspaceMembers([]); setWorkspaceInvitations([]); setTeamWorkspaceId(null); setTeamError(null); setTeamLoading(false); return; }
    let active = true; setTeamLoading(true); setTeamError(null);
    void (async () => {
      const memberResult = await loadWorkspaceMembers(workspaceId);
      const invitationResult = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin' ? await loadWorkspaceInvitations(workspaceId) : { data: [] as NexusWorkspaceInvitation[], error: null };
      if (!active) return;
      setTeamWorkspaceId(workspaceId); setWorkspaceMembers(memberResult.data); setWorkspaceInvitations(invitationResult.data); setTeamError(memberResult.error || invitationResult.error || null); setTeamLoading(false);
    })();
    return () => { active = false; };
  }, [auth.user?.id, currentWorkspaceRole, selectedWorkspaceId, teamRefreshVersion]);

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
    navigate(routes.chats + '?' + new URLSearchParams({ conversation: result.data }));
    return { error: null };
  };

  const refreshWorkspaceTeam = async () => {
    if (!selectedWorkspaceId) { setWorkspaceMembers([]); setWorkspaceInvitations([]); return; }
    setTeamLoading(true); setTeamError(null);
    const memberResult = await loadWorkspaceMembers(selectedWorkspaceId);
    const invitationResult = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin' ? await loadWorkspaceInvitations(selectedWorkspaceId) : { data: [] as NexusWorkspaceInvitation[], error: null };
    if (selectedWorkspaceRef.current !== selectedWorkspaceId) return;
    setTeamWorkspaceId(selectedWorkspaceId); setWorkspaceMembers(memberResult.data); setWorkspaceInvitations(invitationResult.data); setTeamError(memberResult.error || invitationResult.error || null); setTeamLoading(false);
  };

  const clearWorkspaceScopedState = (nextWorkspaceId: string | null) => {
    selectedWorkspaceRef.current = nextWorkspaceId;
    setSelectedWorkspaceId(nextWorkspaceId);
    setWorkspaceMembers([]);
    setWorkspaceInvitations([]);
    setTeamWorkspaceId(null);
    setTeamError(null);
    setTeamLoading(Boolean(nextWorkspaceId));
    setRequestedConversationId(null);
  };

  const selectWorkspace = (workspaceId: string | null) => {
    if (workspaceLifecycleLock.current) return false;
    setWorkspaceLifecycleFeedback(null);
    if (workspaceId === selectedWorkspaceRef.current) return true;
    clearWorkspaceScopedState(workspaceId);
    return true;
  };

  const reloadWorkspaceState = async (preferredId: string | null = selectedWorkspaceRef.current) => {
    const userId = auth.user?.id;
    if (!userId) return { error: 'Du bist nicht angemeldet.', nextWorkspaceId: null as string | null };

    setDataLoading(true);
    setDataError(null);
    try {
      const [workspaceResult, membershipResult] = await Promise.all([
        loadWorkspaces(),
        loadWorkspaceMemberships(userId),
      ]);
      const error = workspaceResult.error || membershipResult.error;
      if (error) {
        setDataError(error);
        return { error, nextWorkspaceId: selectedWorkspaceRef.current };
      }

      const membershipIds = new Set(membershipResult.data.map((membership) => membership.workspace_id));
      const availableWorkspaces = workspaceResult.data.filter((workspace) => membershipIds.has(workspace.id));
      const nextWorkspaceId = preferredId && availableWorkspaces.some((workspace) => workspace.id === preferredId)
        ? preferredId
        : availableWorkspaces[0]?.id ?? null;

      setWorkspaces(availableWorkspaces);
      setMemberships(membershipResult.data);
      clearWorkspaceScopedState(nextWorkspaceId);
      setTeamRefreshVersion((version) => version + 1);

      return { error: null, nextWorkspaceId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace-Daten konnten nicht neu geladen werden.';
      setDataError(message);
      return { error: message, nextWorkspaceId: selectedWorkspaceRef.current };
    } finally {
      setDataLoading(false);
    }
  };

  const runWorkspaceLifecycle = async (
    action: (workspaceId: string) => Promise<{ error: string | null }>,
    successMessage: string,
    applyLocalSuccess?: (workspaceId: string) => string | null,
  ) => {
    if (workspaceLifecycleLock.current) return { error: 'Eine Workspace-Aktion läuft bereits.' };
    const workspaceId = selectedWorkspaceRef.current;
    if (!workspaceId) return { error: 'Bitte zuerst einen Workspace auswählen.' };

    workspaceLifecycleLock.current = true;
    setWorkspaceLifecycleBusy(true);
    setWorkspaceLifecycleFeedback(null);
    try {
      const result = await action(workspaceId);
      if (result.error) {
        setWorkspaceLifecycleFeedback({ workspaceId, message: result.error, error: true });
        return result;
      }

      const preferredId = applyLocalSuccess ? applyLocalSuccess(workspaceId) : workspaceId;
      const reloadResult = await reloadWorkspaceState(preferredId);
      setWorkspaceLifecycleFeedback({
        workspaceId,
        message: reloadResult.error
          ? `${successMessage} Die aktualisierten Workspace-Daten konnten noch nicht geladen werden: ${reloadResult.error}`
          : successMessage,
        error: Boolean(reloadResult.error),
      });

      // Die Mutation war erfolgreich. Ein anschließender Ladefehler wird separat
      // angezeigt und darf nicht dazu führen, dass eine destruktive Aktion erneut
      // abgesendet wird.
      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Die Workspace-Aktion ist fehlgeschlagen.';
      setWorkspaceLifecycleFeedback({ workspaceId, message, error: true });
      return { error: message };
    } finally {
      workspaceLifecycleLock.current = false;
      setWorkspaceLifecycleBusy(false);
    }
  };

  const renameSelectedWorkspace = async (name: string) => runWorkspaceLifecycle(
    (workspaceId) => renameWorkspace(workspaceId, name),
    'Workspace umbenannt.',
    (workspaceId) => {
      setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId
        ? { ...workspace, name: name.trim() }
        : workspace));
      return workspaceId;
    },
  );

  const leaveSelectedWorkspace = async () => runWorkspaceLifecycle(
    (workspaceId) => leaveWorkspace(workspaceId),
    'Workspace verlassen.',
    (workspaceId) => {
      const nextWorkspaceId = workspaces.find((workspace) => workspace.id !== workspaceId)?.id ?? null;
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setMemberships((current) => current.filter((membership) => membership.workspace_id !== workspaceId));
      clearWorkspaceScopedState(nextWorkspaceId);
      return nextWorkspaceId;
    },
  );

  const transferSelectedWorkspaceOwnership = async (newOwnerId: string) => runWorkspaceLifecycle(
    (workspaceId) => transferWorkspaceOwnership(workspaceId, newOwnerId),
    'Ownership übertragen.',
    (workspaceId) => {
      setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId
        ? { ...workspace, owner_id: newOwnerId }
        : workspace));
      setMemberships((current) => current.map((membership) => membership.workspace_id === workspaceId && membership.user_id === auth.user?.id
        ? { ...membership, role: 'admin' }
        : membership));
      return workspaceId;
    },
  );

  const deleteSelectedWorkspace = async (confirmation: string) => runWorkspaceLifecycle(
    (workspaceId) => deleteWorkspace(workspaceId, confirmation),
    'Workspace gelöscht.',
    (workspaceId) => {
      const nextWorkspaceId = workspaces.find((workspace) => workspace.id !== workspaceId)?.id ?? null;
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setMemberships((current) => current.filter((membership) => membership.workspace_id !== workspaceId));
      clearWorkspaceScopedState(nextWorkspaceId);
      return nextWorkspaceId;
    },
  );

  const saveProfile = async (patch: Partial<Pick<NexusProfile, 'full_name' | 'username' | 'bio'>>) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };
    const result = await updateOwnProfile(auth.user.id, patch); if (result.data) setProfile(result.data); return { error: result.error };
  };
  const addWorkspace = async (name: string) => {
    if (!auth.user) return { error: 'Du bist nicht angemeldet.' };
    const result = await createWorkspace(name, auth.user.id);
    if (result.data) { setWorkspaces((current) => [...current, result.data!]); selectWorkspace(result.data.id); const membershipResult = await loadWorkspaceMemberships(auth.user.id); if (!membershipResult.error) setMemberships(membershipResult.data); }
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
    setWorkspaces(workspaceResult.data); setMemberships(membershipResult.data); selectWorkspace(result.data.workspace_id); return { error: null, workspaceName: result.data.workspace_name };
  };
  const signOut = async () => {
    const result = await auth.signOut();
    if (!result.error) navigate(routes.auth, { replace: true });
    return result;
  };
  const deleteAccount = async (confirmation: string) => {
    const result = await auth.deleteAccount(confirmation);
    if (!result.error) navigate(routes.auth, { replace: true });
    return result;
  };

  return <div className="app">
    <Sidebar unreadNotifications={notifications.error ? null : notifications.unread_count} notificationsLoading={notifications.loading} workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onWorkspaceChange={workspaceId => {
      const changed = selectWorkspace(workspaceId);
      if (changed && location.pathname === routes.business) navigate(routes.business + '?' + businessSearch(workspaceId));
    }} workspaceRole={currentWorkspaceRole} workspaceLoading={dataLoading} workspaceSwitchDisabled={workspaceLifecycleBusy} identity={identity} accountName={accountName} accountSubtitle={accountSubtitle} />
    <main><Suspense key={location.pathname} fallback={<div className="page" role="status">Bereich wird geladen…</div>}><Routes>
      <Route path="/" element={preferencesReady ? <Navigate to={defaultRoute} replace /> : <AppLoading />} />
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
            onRetryWorkspace={() => setDataReload(value => value + 1)}
          />
        }
      />
      <Route path={routes.chats} element={<ChatsPage key={auth.user?.id} workspaceId={selectedWorkspaceId} currentUserId={auth.user?.id} requestedConversationId={requestedConversationId} onRequestedConversationHandled={() => setRequestedConversationId(null)} />} />
      <Route path={routes.groups} element={<GroupChatsPage key={auth.user?.id} workspaceId={selectedWorkspaceId} currentUserId={auth.user?.id} />} />
      <Route path={routes.search} element={<MessageSearchPage />} />
      <Route path={routes.contacts} element={<ContactsPage onStartChat={startContactChat} />} />
      <Route
        path={routes.business}
        element={
          <BusinessPage
            onStartChat={startContactChat}
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
      <Route path={routes.notifications} element={<NotificationsPage model={notifications} />} />
      <Route path={routes.settings} element={<SettingsPage key={auth.user?.id} notifications={notifications} identity={identity} setIdentity={setIdentity} startView={preferences.startView} onStartViewChange={startView => updatePreferences({ startView })} preferencesError={preferencesError} onWorkspaceChange={selectWorkspace} backendConfigured={auth.configured} accountEmail={auth.user?.email} currentUserId={auth.user?.id} profile={profile} businessProfiles={businessProfiles} workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} currentWorkspaceRole={currentWorkspaceRole} workspaceMembers={teamWorkspaceId === selectedWorkspaceId ? workspaceMembers : []} workspaceInvitations={teamWorkspaceId === selectedWorkspaceId ? workspaceInvitations : []} teamLoading={teamLoading || teamWorkspaceId !== selectedWorkspaceId} teamError={teamWorkspaceId === selectedWorkspaceId ? teamError : null} dataLoading={dataLoading} dataError={dataError} workspaceLifecycleBusy={workspaceLifecycleBusy} workspaceLifecycleFeedback={workspaceLifecycleFeedback} onSaveProfile={saveProfile} onCreateWorkspace={addWorkspace} onCreateBusinessProfile={addBusinessProfile} onInviteWorkspaceMember={inviteWorkspaceMember} onUpdateWorkspaceMemberRole={changeWorkspaceMemberRole} onRemoveWorkspaceMember={deleteWorkspaceMember} onRevokeWorkspaceInvitation={revokeInvitation} onRefreshWorkspaceTeam={refreshWorkspaceTeam} onAcceptWorkspaceInvitation={acceptInvitation} onRenameWorkspace={renameSelectedWorkspace} onLeaveWorkspace={leaveSelectedWorkspace} onTransferWorkspaceOwnership={transferSelectedWorkspaceOwnership} onDeleteWorkspace={deleteSelectedWorkspace} onUpdatePassword={auth.configured ? auth.updatePassword : undefined} onRequestPasswordReset={auth.configured ? auth.requestPasswordReset : undefined} onSignOut={auth.configured ? signOut : undefined} onDeleteAccount={auth.configured ? deleteAccount : undefined} />} />
      <Route path={routes.auth} element={<Navigate to={routes.briefing} replace />} /><Route path="*" element={<Navigate to={routes.briefing} replace />} />
    </Routes></Suspense></main>
  </div>;
}
