import { Sparkles } from 'lucide-react';
import { Header } from '../components/Header';

type BriefingPageProps = {
  openChat: () => void;
};

function Stat({ n, t }: { n: string; t: string }) {
  return (
    <div className="stat">
      <b>{n}</b>
      <span>{t}</span>
    </div>
  );
}

export function BriefingPage({ openChat }: BriefingPageProps) {
  return (
    <section className="page">
      <Header
        kicker="GUTEN ABEND, SAMET"
        title="Dein AI Briefing"
        sub="Nexus verbindet Nachrichten, Kunden, Aufgaben und Entscheidungen."
      />

      <div className="stats">
        <Stat n="3" t="Kunden warten" />
        <Stat n="2" t="Deadlines diese Woche" />
        <Stat n="1" t="Rechnung offen" />
        <Stat n="4" t="AI Aufgaben erkannt" />
      </div>

      <div className="grid">
        <div className="panel">
          <h3>Heute wichtig</h3>
          <button className="priority" onClick={openChat}>
            <div className="avatar">MM</div>
            <span>
              <b>Autohaus Müller</b>
              <small>Feedback seit 2 Tagen unbeantwortet</small>
            </span>
            <em>Öffnen</em>
          </button>
          <div className="priority">
            <div className="avatar">RB</div>
            <span>
              <b>Restaurant Bella</b>
              <small>Website morgen fällig</small>
            </span>
            <em>Deadline</em>
          </div>
          <div className="priority">
            <div className="avatar">ZM</div>
            <span>
              <b>Zahnarzt Meier</b>
              <small>1.600 € Rechnung offen</small>
            </span>
            <em>Finanzen</em>
          </div>
        </div>

        <div className="panel ai-card">
          <Sparkles />
          <h3>AI Insight</h3>
          <p>
            Im Chat mit Autohaus Müller wurde eine neue Aufgabe erkannt: Leasing-Seite
            ergänzen, Deadline Montag.
          </p>
          <button>Aufgabe prüfen</button>
        </div>
      </div>
    </section>
  );
}
