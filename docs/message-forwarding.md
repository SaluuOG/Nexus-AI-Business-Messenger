# Textnachrichten weiterleiten

Im Drei-Punkte-Menü einer Textnachricht führt **Weiterleiten** zur Zielauswahl.
Bestehende Einzel- und Gruppenchats lassen sich nach Namen suchen. Nach der
Auswahl zeigt **Vorschau** den Zielchat und den vollständigen Text. Erst
**Jetzt weiterleiten** sendet die Kopie. Anschließend lässt sich der Zielchat
direkt an der neuen Nachricht öffnen.

Die Kopie trägt **Weitergeleitet**, auch nach Neuladen und in gespeicherten
Offline-Chats. Absender ist die weiterleitende Person. Ursprünglicher Absender,
Quellchat, Antwortbezug und Quellen-IDs werden nicht mitgeteilt. Zeilenumbrüche,
Leerzeichen, Links und Emojis bleiben erhalten. In dieser ersten Version sind
Anhänge einschließlich beschrifteter Anhänge ausgeschlossen. Zum Weiterleiten
ist eine Internetverbindung erforderlich; es gibt keinen automatischen Versand
nach Wiederverbindung. Entwürfe bleiben unverändert.

Die Vorschau ist an Quelle, Ziel und Konto gebunden. Ändert sich die Quelle vor
dem Versand, muss eine neue Vorschau geöffnet werden. Der Server prüft die
aktive Sitzung sowie den aktuellen Zugriff auf beide Chats. Fremde und inzwischen
entzogene Chats sind ausgeschlossen. Das Weiterleiten markiert vorhandene
Nachrichten im Zielchat nicht als gelesen.

Eine verlorene Antwort nach erfolgreichem Speichern lässt sich über **Erneut
versuchen** im selben Dialog auflösen. Quelle, Ziel und Vorgangs-ID bleiben dabei
gleich, sodass keine zweite Kopie entsteht. Doppeltippen während des Versands ist
gesperrt. Ein neuer Dialog ist ein neuer Weiterleitungsvorgang.

## Datenbank

`20261002211151_message_forwarding.sql` ergänzt ein boolesches Kennzeichen in
beiden Nachrichtentabellen und zwei öffentliche RPCs mit `SECURITY INVOKER`.
Die eigentlichen Funktionen liegen im privaten Schema, verwenden einen leeren
`search_path` und prüfen Sitzung und Teilnahme serverseitig. Eine private Tabelle
ohne Client-Rechte hält Vorgangs-IDs und Text-Hashes für sichere Wiederholungen;
sie speichert keine zweite Textkopie. Nachrichtentabellen bleiben für direkte
Client-Schreibzugriffe gesperrt. Bestehende Realtime- und Benachrichtigungstrigger
werden durch den regulären Nachrichteneintrag ausgelöst.

## Gezielte Prüfung

- `tests/message-forwarding.test.mjs`: Zielvalidierung, unveränderter Text,
  stabile Wiederholungsparameter, Transportfehler und Offline-Kennzeichnung.
- `tests/sql/message-forwarding-rls.sql`: alle vier Kombinationen von Einzel-
  und Gruppenchat, Quellenprivatsphäre, Sitzung, Berechtigungen, Anhänge,
  geänderte/gelöschte Quellen, Wiederholung und unveränderter Lesestatus.
  Ausschließlich synthetische Identitäten in einer zurückgerollten Transaktion.
- `tests/sql/run-forward-local.mjs`: isolierte lokale Ausführung der relevanten
  Migrationen und SQL-Prüfung mit PGlite. `NEXUS_PGLITE_MODULE` zeigt auf ein
  separat installiertes `@electric-sql/pglite/dist/index.js` (geprüft: 0.5.8).
- `tests/browser/message-forwarding.mjs`: Vorschau/Abbruch, alle vier Wege,
  Zielsuche, lange/mehrzeilige Texte, Entwürfe, verlorene Antwort, Doppeltippen,
  Quellenänderung, verweigerter Zugriff, Kontowechsel, Neuladen und Offline.
  Ansichten mit 320/390/1440 Pixeln, synthetischer Dienst, keine echten Empfänger.
  Teil der Chromium-/WebKit-Prüfung in GitHub Actions.
- `tests/browser/message-tasks.mjs`: bestehendes Nachrichtenmenü und
  Aufgabenübernahme bleiben bedienbar.

Der Test auf dem physischen iPhone steht nach Installation des neuen Builds aus.
Er kann zusammen mit den bereits verschobenen Prüfungen von **Text kopieren**
und der Medien-/Datei-/Linkübersicht erfolgen.

Am 02.10.2026 wurden TypeScript-Prüfung, alle 199 Unit-Prüfungen, Web-Build mit
iOS-Synchronisierung, der neue Chromium-Ablauf und die bestehende
Aufgabenübernahme-Prüfung erfolgreich ausgeführt. Die Migration ist im
zugehörigen Supabase-Projekt eingerichtet; die zurückgerollte SQL-Abnahme bestand
auch dort. Die Sicherheitsprüfung meldete gegenüber dem vorherigen Stand keine
zusätzlichen Befunde.
