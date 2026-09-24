# Nachrichtenprüfung – 24. September 2026

Diese Prüfung trennt technische Tests mit synthetischen Daten vom noch offenen
Durchlauf mit zwei echten angemeldeten Konten und einem physischen iPhone.

## Automatisierte Nachweise

- `tests/sql/message-history-rls.sql`: auf dem verbundenen Supabase-Projekt
  ausgeführt und vollständig zurückgerollt. Zwei synthetische Teilnehmer
  senden, antworten, bearbeiten eigene Nachrichten, löschen sie und setzen
  Lesebestätigungen in Direkt- und Gruppenchats. Der Empfänger darf fremde
  Nachrichten weder bearbeiten noch löschen. Außenstehende und anonyme
  Aufrufer erhalten keinen Zugriff. Zusätzlich: Verlauf, Suchfilter,
  Anhänge-Metadaten, gelöschte Zitate und doppelte Sendeversuche.
- `tests/browser/message-history.mjs`: Browserabläufe mit einem simulierten
  Backend; Verlauf, Suchtreffer, Änderungen/Löschungen, manuelle Sendewiederholung
  und fehlgeschlagene Uploads. Empfangene Testbilder werden tatsächlich im
  Browser dekodiert, eine synthetische WAV-Datei abgespielt und heruntergeladene
  Testdateien bytegenau verglichen. Das prüft keine echte Storage-Übertragung.
- `tests/browser/mobile-workflows.mjs`: Direkt- und Gruppenansichten bei
  320/390 Pixeln, Nachrichtenentwürfe, Senden und Aufräumen einer simulierten
  Mikrofonaufnahme beim Verlassen eines Chats. Keine echte Mikrofonaufnahme.
- `tests/browser/chat-connection.mjs` und `offline-cache.mjs`: Offline-Neustart,
  automatische Wiederverbindung, manuelle Wiederholung ohne doppelte Nachricht,
  Kontentrennung, Abmeldung und verspätete Antworten des vorherigen Kontos.

Lokal wurden Chromium und die Datenbank geprüft. WebKit benötigt auf diesem
Ausführungsrechner fehlende Systembibliotheken und wird über die verpflichtende
GitHub-Actions-Prüfung ausgeführt. Ein fehlgeschlagener oder noch laufender
Workflow ist keine vollständige Freigabe.

## Gefundene Korrektur

Ein Direktchat-Suchtreffer konnte vor der Chatliste eintreffen. Dann war die
Gesprächsansicht beim ersten Scrollversuch noch nicht vorhanden und die
Markierung fehlte. Die Positionierung wird jetzt beim Eintreffen der Liste
erneut ausgewertet; der Test verzögert diese Liste gezielt.

Der Briefingtest erwartete außerdem zwei alte Fehlermeldungen. Er prüft nun
die verständliche Sammelmeldung und weiterhin, dass nach Ladefehlern oder
Zugriffsverlust keine irreführenden Zahlen bzw. Aufgaben angezeigt werden.

## Nutzerbestätigung und verbleibende Geräteprüfung

Der Nutzer hat Anmeldung, Passwort-Wiederherstellung, Briefing-Aktualisierung,
automatisches Laden nach Wiederverbindung und gespeicherte Offline-Nachrichten
auf seinem iPhone als funktionierend bestätigt.

Für die aktuelle vollständige Abnahme fehlen zwei echte angemeldete Sitzungen.
Es wurden keine Anmeldungen fingiert und keine Nachrichten an vorhandene
Kontakte gesendet. Mit zwei eigenen Testkonten sind noch zu bestätigen:

1. Direkt- und Gruppennachricht samt Antwort, Bearbeitung, Löschung und
   Lesebestätigung auf der Gegenseite.
2. Ein Bild, eine Datei und eine echte Sprachnachricht hochladen und mit dem
   zweiten Konto öffnen bzw. anhören.
3. iPhone-App in den Hintergrund legen bzw. schließen, von Konto B eine neue
   Nachricht senden und nach Rückkehr die Aktualisierung prüfen. Dies ist
   keine Prüfung von System-Push bei geschlossener App.
4. Abmelden, mit Konto B anmelden und offline prüfen, dass keine gespeicherten
   Chats von Konto A angezeigt werden.

System-Push/APNs sowie eine Veröffentlichung im App Store sind weiterhin nicht
Teil dieser Abnahme. Die Tests benötigen keine kostenpflichtige KI-Funktion.
