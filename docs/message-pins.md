# Angeheftete Nachrichten

Im Nachrichtenmenü gibt es „Anheften“ und bei bereits angehefteten Nachrichten
„Anheftung lösen“. Beide Teilnehmer eines Direktchats dürfen Anheftungen verwalten.
In Gruppen sehen alle aktuellen Mitglieder die Anheftungen; nur Owner und Admins
dürfen sie verändern. Eine Anheftung gilt für den ganzen Chat, nicht nur privat.

Die kompakte, aufklappbare Übersicht steht unter dem Chatkopf. „Zur Nachricht“
öffnet die vorhandene zugriffsgeschützte Nachrichten-Kontextansicht, auch wenn die
Nachricht älter als der aktuell geladene Verlauf ist. Texte werden verkürzt und
als Text gerendert; reine Anhänge erscheinen als „Anhang / Sprachnachricht“.
Bearbeitungen aktualisieren die Vorschau, gelöschte Nachrichten verschwinden.

Die Übersicht wird online neu geladen und nicht zusätzlich im Offline-Speicher
abgelegt. Bestehende Offline-Nachrichten bleiben unverändert verfügbar. Bei
Konten-/Chatwechsel, Zugriffsfehlern oder Offline-Zustand werden Pin-Vorschauen
ausgeblendet; verspätete Antworten dürfen sie nicht wieder einblenden.

## Speicherung und Rechte

Migration: `20260930222545_message_pins.sql`.

- Separate Direkt-/Gruppen-Pin-Tabellen, RLS aktiviert; eine Zeile pro Nachricht.
- Lesezugriff erfordert Zugriff auf die nicht gelöschte Nachricht im richtigen Chat.
- Gruppenrollen werden aus aktuellen Mitgliedschaften geprüft, auch bei direkten
  Tabellenänderungen außerhalb der Benutzeroberfläche.
- Nur der Pin-Zustand darf geändert werden. Chat- und Nachrichten-ID sind unveränderlich.
- RPCs sind `SECURITY INVOKER`; keine anonymen Tabellen- oder Funktionsrechte.
- Wiederholungen setzen denselben gewünschten Zustand und erzeugen keine Duplikate.
- Loslösen ist ein UPDATE. Realtime abonniert chatbezogene INSERT/UPDATE-Ereignisse;
  die physische Löschidentität ist eine zufällige ID, keine Chat-/Nachrichten-ID.
- Rückkehr zur App, Wiederverbindung und ein sichtbarer 30-Sekunden-Abgleich laden
  die Liste neu. Fehlgeschlagene Schreibvorgänge melden einen Fehler statt Erfolg.

## Prüfungen

- `tests/sql/message-pins-rls.sql`: vollständig zurückgerollte synthetische Konten
  auf der verbundenen Datenbank; Teilnehmer, Member, Admin, Rollenentzug, fremde
  Chats, anonyme Rechte, Löschen und wiederholtes Anheften/Loslösen.
- `tests/message-pins.test.mjs`: Nutzdatenvalidierung, Chatbindung, Wiederholung,
  Fehler und Realtime-Filter.
- `tests/browser/message-pins.mjs`: Direkt-/Gruppenmenü, Sprung zur älteren
  Nachricht, mobile Breiten, Rollen, Neuladen, Offline, Änderungen/Löschung,
  fehlgeschlagene Speicherung und verspätete Antworten nach Kontowechsel.
- Bestehende Nachrichtenoptionen und Reaktionen werden separat erneut geprüft.

Automatisierte Browserprüfungen verwenden Testdaten. Der Nutzer hat die Bedienung
der Anheftungen nach dem App-Update am 01.10.2026 mit „okey es funktioniert“ bestätigt.
Dies ist die Nutzerabnahme auf seinem iPhone, kein zusätzlicher automatisierter Live-Test.
