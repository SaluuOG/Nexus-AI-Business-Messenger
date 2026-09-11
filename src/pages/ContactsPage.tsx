import { Plus } from 'lucide-react';
import { Header } from '../components/Header';
import type { Contact } from '../types';

type ContactsPageProps = {
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
};

export function ContactsPage({ contacts, setContacts }: ContactsPageProps) {
  const addContact = () => {
    const name = window.prompt('Name des Kontakts?');
    if (!name) return;

    setContacts([
      ...contacts,
      {
        name,
        username: `@${name.toLowerCase().replace(/\s+/g, '.')}`,
        type: 'Kunde',
      },
    ]);
  };

  return (
    <section className="page">
      <div className="title-row">
        <Header
          kicker="IDENTITÄT & NETZWERK"
          title="Kontakte"
          sub="Kunden, Team und private Kontakte sauber getrennt."
        />
        <button className="primary" onClick={addContact}>
          <Plus size={16} /> Kontakt hinzufügen
        </button>
      </div>

      <div className="contact-grid">
        {contacts.map((contact) => (
          <div className="contact" key={contact.username}>
            <div className="avatar big">
              {contact.name
                .split(' ')
                .map((value) => value[0])
                .join('')
                .slice(0, 2)}
            </div>
            <b>{contact.name}</b>
            <span>{contact.username}</span>
            <small>
              {contact.type}
              {contact.online ? ' · online' : ''}
            </small>
            <button>Chat öffnen</button>
          </div>
        ))}
      </div>
    </section>
  );
}
