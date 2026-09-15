import { Bot, MessageCircle, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { routes } from '../app/routes';

export function AIPage() {
  const navigate = useNavigate();
  return (
    <section className="page">
      <Header
        kicker="NEXUS AI"
        title="Dein Business-Assistent"
        sub="Wichtige Informationen aus einem ganzen Gespräch gesammelt prüfen."
      />
      <div className="ai-hero">
        <Bot size={38} />
        <h2>Den gesamten Chat auswerten</h2>
        <p>Öffne einen Einzel- oder Gruppenchat und wähle unten rechts „Chat auswerten“.
          Dort siehst du, ob die KI bereit ist, und startest die Auswertung des gesamten zugänglichen Textverlaufs.</p>
        <p>Informationen, Entscheidungen, Aufgaben und offene Fragen erscheinen mit Textstellen zum Nachprüfen.</p>
        <div>
          <button onClick={() => navigate(routes.chats)}><MessageCircle size={16} /> Einzelchat öffnen</button>
          <button onClick={() => navigate(routes.groups)}><UsersRound size={16} /> Gruppenchat öffnen</button>
        </div>
      </div>
    </section>
  );
}
