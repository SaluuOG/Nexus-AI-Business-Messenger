# Erwähnungen in Aufgabenkommentaren

Unter **Projekte → Aufgaben → Details & Zusammenarbeit** können Owner, Admins
und Member Personen mit `@` in einem Kommentar erwähnen. Die Auswahl zeigt
aktuelle Mitglieder des geöffneten Workspace; auch Gäste sind auswählbar, weil
sie Aufgaben und Kommentare lesen dürfen. Die eigene Person und bereits
ausgewählte Personen werden nicht erneut angeboten. Pro Kommentar sind höchstens
20 Empfänger möglich.

Eine Erwähnung erzeugt einen gezielten Hinweis und – falls auf dem Gerät erlaubt –
einen Push. Erwähnte Personen erhalten für denselben Kommentar nicht zusätzlich
den allgemeinen Kommentarhinweis. Der Hinweis öffnet den exakten Kommentar,
auch wenn er außerhalb der zunächst geladenen Seite liegt. Nach Rollen- oder
Mitgliedschaftsentzug verschwinden Quelle und Navigation aus dem Hinweiszentrum;
gelöschte Kommentare entfernen ihre Hinweise.

## Daten und Berechtigungen

- Der sichtbare `@Name`-Text bleibt im Kommentar. Maßgeblich sind unveränderliche
  Benutzer-IDs in `task_comments.mentioned_user_ids`; gleiche Namen oder spätere
  Profiländerungen ändern den Empfänger nicht.
- Der Browser darf die Empfängerspalte nur beim Anlegen schreiben. Ein Trigger
  normalisiert Duplikate und lehnt Eigen-, Außenstehenden- und zu große Listen ab.
- Der Server prüft bei Erstellung und Abruf die aktuelle Workspace-Mitgliedschaft.
  Das Erwähnen verleiht keinen neuen Zugriff auf eine Aufgabe.
- Hinweise enthalten keine Kopie des Kommentars. Push-Vorschauen werden erst kurz
  vor dem Versand aus der weiterhin zugänglichen Quelle gelesen und bleiben von
  der vorhandenen Kommentar-/Vorschau-Einstellung abhängig.
- Eine Wiederholung nach verlorener Antwort verwendet dieselbe Vorgangs-ID, denselben
  Text und dieselben Empfänger. Eine abweichende Wiederholung gilt nicht als Erfolg.
- Die Erweiterung benötigt keine KI-API und verursacht keine OpenAI- oder
  Anthropic-Aufrufe.

Migration: `20260923005035_task_comment_mentions.sql`. Die Migration ist auf der
Produktivdatenbank aktiv. Der vollständige Postgres-Abnahmetest arbeitet nur mit
synthetischen Identitäten und schließt mit `ROLLBACK`; reale Konten oder Hinweise
werden dabei nicht verändert. Die bestehende Deadline-Pushlogik wurde beim
Erweitern der Versandfunktion ausdrücklich erhalten. `mobile-push` Version 4 ist
aktiv.

## Gezielte Prüfung

- `tests/task-mentions.test.mjs`: sichere Tokens, Suche, Auswahl und Entfernung.
- `tests/sql/task-mentions-rls.sql`: exakte Empfänger, Gastzugriff, keine doppelte
  Kommentarbenachrichtigung, Präferenzen, Unveränderlichkeit, Außenstehende,
  Rechteentzug und Löschbereinigung; alle Änderungen werden zurückgerollt.
- `tests/browser/task-mentions.mjs`: mobile Auswahl von Member und Guest,
  Entfernen/erneutes Setzen, Wiederholung nach verlorener Antwort, Empfänger-IDs,
  Badges, Sprung zu einem älteren exakten Kommentar und 320-Pixel-Darstellung.
- Direkt betroffene Tests für Zusammenarbeit, Hinweiszentrum, Push und Service
  Worker sowie TypeScript und Produktionsbuild.

