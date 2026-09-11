import { Bot } from 'lucide-react';
import { Header } from '../components/Header';

export function AIPage() {
  return (
    <section className="page">
      <Header
        kicker="NEXUS AI"
        title="Dein Business-Assistent"
        sub="Frage Nexus nach Kunden, Aufgaben, Deadlines oder Entscheidungen."
      />
      <div className="ai-hero">
        <Bot size={38} />
        <h2>Was möchtest du wissen?</h2>
        <p>„Was wollte Autohaus Müller noch geändert haben?“</p>
        <div>
          <button>Chats zusammenfassen</button>
          <button>Offene Aufgaben</button>
          <button>Follow-ups finden</button>
          <button>Angebot vorbereiten</button>
        </div>
      </div>
    </section>
  );
}
