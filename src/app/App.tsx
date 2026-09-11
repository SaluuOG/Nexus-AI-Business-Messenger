import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { initialMessages, seedContacts } from '../data/mockData';
import { useAuth } from '../features/auth/AuthProvider';
import { AIPage } from '../pages/AIPage';
import { AuthPage } from '../pages/AuthPage';
import { BriefingPage } from '../pages/BriefingPage';
import { BusinessPage } from '../pages/BusinessPage';
import { ChatsPage } from '../pages/ChatsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { Contact, IdentityMode, Workspace } from '../types';
import { routes } from './routes';

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
  const auth = useAuth();
  const [selected, setSelected] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>(seedContacts);
  const [workspace, setWorkspace] = useState<Workspace>('WebWorkBalance');
  const [identity, setIdentity] = useState<IdentityMode>('business');
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState(initialMessages);

  if (auth.configured && !auth.user) {
    return <Navigate to={routes.auth} replace />;
  }

  const accountName =
    (auth.user?.user_metadata?.full_name as string | undefined) ||
    auth.user?.email?.split('@')[0] ||
    'Samet';
  const accountSubtitle = auth.user?.email ||
    (identity === 'business' ? '@webworkbalance' : '@samet');

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

  const signOut = async () => {
    await auth.signOut();
    navigate(routes.auth, { replace: true });
  };

  return (
    <div className="app">
      <Sidebar
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        identity={identity}
        accountName={accountName}
        accountSubtitle={accountSubtitle}
      />

      <main>
        <Routes>
          <Route path="/" element={<Navigate to={routes.briefing} replace />} />
          <Route
            path={routes.briefing}
            element={<BriefingPage openChat={() => openChat(0)} />}
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
