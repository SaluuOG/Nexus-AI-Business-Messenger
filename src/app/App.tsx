import { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { initialMessages, seedContacts } from '../data/mockData';
import { AIPage } from '../pages/AIPage';
import { BriefingPage } from '../pages/BriefingPage';
import { BusinessPage } from '../pages/BusinessPage';
import { ChatsPage } from '../pages/ChatsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { Contact, IdentityMode, Tab, Workspace } from '../types';

export function App() {
  const [tab, setTab] = useState<Tab>('briefing');
  const [selected, setSelected] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>(seedContacts);
  const [workspace, setWorkspace] = useState<Workspace>('WebWorkBalance');
  const [identity, setIdentity] = useState<IdentityMode>('business');
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState(initialMessages);

  const send = () => {
    const nextMessage = msg.trim();
    if (!nextMessage) return;

    setMessages((current) => [...current, { me: true, text: nextMessage }]);
    setMsg('');
  };

  const openChat = (index: number) => {
    setSelected(index);
    setTab('chats');
  };

  return (
    <div className="app">
      <Sidebar
        tab={tab}
        onTabChange={setTab}
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        identity={identity}
      />

      <main>
        {tab === 'briefing' && <BriefingPage openChat={() => openChat(0)} />}
        {tab === 'chats' && (
          <ChatsPage
            selected={selected}
            setSelected={setSelected}
            messages={messages}
            msg={msg}
            setMsg={setMsg}
            send={send}
          />
        )}
        {tab === 'contacts' && (
          <ContactsPage contacts={contacts} setContacts={setContacts} />
        )}
        {tab === 'business' && <BusinessPage />}
        {tab === 'ai' && <AIPage />}
        {tab === 'settings' && (
          <SettingsPage identity={identity} setIdentity={setIdentity} />
        )}
      </main>
    </div>
  );
}
