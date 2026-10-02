# Nachrichtentext kopieren

Im Drei-Punkte-Menü einer Einzel- oder Gruppennachricht gibt es **Text kopieren**.
Der sichtbare Nachrichtentext wird unverändert in die Zwischenablage geschrieben:
Zeilenumbrüche, Leerzeichen, Links und Emojis bleiben erhalten. Bei beschrifteten
Anhängen wird nur der Text kopiert, nicht die Datei oder eine private Datei-URL.
Reine Anhänge und gelöschte Nachrichten haben keinen Kopier-Eintrag.

Die Aktion funktioniert ohne Netzwerk auch für bereits geladene oder lokal
gespeicherte Textnachrichten, einschließlich der Offline-Leseansicht ohne gültige
Online-Sitzung. Dort enthält das Menü ausschließlich die lokale Kopieraktion.
Es entstehen keine Serverabfragen, neuen Dienste oder Abhängigkeiten.

Erfolg wird erst nach bestätigtem Schreiben angezeigt. Bei abgelehntem Zugriff
steht eine verständliche Fehlermeldung statt einer Erfolgsmeldung. Die Aktion liest
die Zwischenablage niemals aus. Nachrichtentext, Entwurf und Chat-Lesestatus werden
nicht verändert. Wechsel der Nachricht oder Verlassen der Ansicht verwerfen späte
Rückmeldungen; ein laufender Versuch kann nicht doppelt gestartet werden.

Die moderne Clipboard API wird direkt aus der Nutzeraktion aufgerufen. Nur wenn
sie in einer eingebetteten Ansicht fehlt, kommt ein temporäres Textfeld mit
`execCommand('copy')` zum Einsatz. Das Feld wird immer entfernt, der Fokus und die
vorherige Textauswahl werden wiederhergestellt. Ein verweigerter API-Zugriff wird
nicht als Erfolg behandelt oder durch diesen Kompatibilitätsweg umgangen.

## Gezielte Prüfung

- `tests/browser/message-copy.mjs`: Einzel-/Gruppenchats, eigene/fremde Texte,
  Unicode und Zeilenumbrüche, unveränderter Entwurf, Fokus, verweigerte und
  ausstehende Clipboard-Aufrufe, echter Browser-Copy-Event im Kompatibilitätsweg,
  fehlgeschlagener Kompatibilitätsweg, Offline, leere/gelöschte Texte und Menü bei
  320/390/1440 Pixeln. Ausschließlich synthetische Nachrichten.
- `tests/browser/offline-cache.mjs`: gespeicherte Nachrichten nach Neustart und
  abgelaufener Online-Sitzung kopieren, ohne Schreibaktionen oder Lesebestätigungen.
- `tests/browser/message-tasks.mjs`: bestehende Nachrichtenoptionen, Tastatur,
  Antworten, Bearbeiten, Löschen und Aufgabenübernahme bleiben bedienbar.
- Die Menüprüfung deckt zusätzlich das horizontale Scrollen eines langen
  Composer-Textes beim Fokuswechsel ab: Nur Scrollen von Vorfahren des Menüankers
  bei tatsächlicher Ankerbewegung schließt das Menü; das interne Scrollen eines
  anderen Eingabefeldes und vor dem Öffnen eingereihte Scroll-Ereignisse nicht.

Die iPhone-Bestätigung dieser Funktion sowie die Geräteprüfung der vorherigen
Medien-/Datei-/Linkübersicht sind weiterhin offen. Der Nutzer hat letztere am
02.10.2026 auf später verschoben.
