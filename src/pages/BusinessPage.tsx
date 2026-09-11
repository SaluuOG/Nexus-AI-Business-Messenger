import { Header } from '../components/Header';

const projects = [
  ['Autohaus Müller', 'In Arbeit', '2.400 €', 'Montag', '72%'],
  ['Restaurant Bella', 'Review', '1.850 €', 'Morgen', '91%'],
  ['Zahnarzt Meier', 'Wartet auf Kunde', '1.600 €', '28. Sep', '54%'],
] as const;

export function BusinessPage() {
  return (
    <section className="page">
      <Header
        kicker="BUSINESS"
        title="Projekte & Kunden"
        sub="Jeder Chat kann direkt mit Auftrag, Status, Wert und Deadline verbunden sein."
      />
      <div className="panel">
        <h3>Aktive Projekte</h3>
        {projects.map((project) => (
          <div className="project" key={project[0]}>
            <div>
              <b>{project[0]}</b>
              <span>{project[1]}</span>
            </div>
            <strong>{project[2]}</strong>
            <small>{project[3]}</small>
            <div className="bar">
              <i style={{ width: project[4] }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
