# KI-Auswertung eines gesamten Chats

Die Auswertung wird im jeweiligen Einzel- oder Gruppenchat über „Chat auswerten“ geöffnet. Eine Statusabfrage überträgt keine Chattexte an einen KI-Anbieter. Erst „Gesamten Chat auswerten“ startet den ausdrücklich beschriebenen Verarbeitungsschritt.

## Aktivierungsstand

Die Anbindung ist vorbereitet und bleibt ohne Server-Konfiguration ausgeschaltet. Eine Prüfung mit einem echten KI-Modell steht bis zur Einrichtung eines Anbieterzugangs aus. Automatisierte Tests verwenden synthetische Nachrichten und simulierte Anbieterantworten.

Der vorbereitete Adapter verwendet OpenAI. Modell, Anbieterzugang und Kostenrahmen müssen vor der Aktivierung festgelegt werden. Ein ChatGPT-Abonnement ersetzt die Konfiguration dieses serverseitigen API-Zugangs nicht. Keine Zugangsschlüssel in Chatnachrichten, GitHub, `VITE_*`-Variablen oder Browser-Speicher eintragen.

## Einrichtung auf dem Server

1. Die Migration `supabase/migrations/20260915044932_chat_scan.sql` anwenden und die Edge Function `supabase/functions/chat-scan` bereitstellen.
2. In den Supabase Edge Function Secrets `OPENAI_API_KEY` und `NEXUS_AI_MODEL` konfigurieren. Das ausgewählte Modell muss strukturierte JSON-Ausgaben im implementierten API-Aufruf unterstützen.
3. Erst nach Festlegung des Kostenrahmens `NEXUS_AI_ENABLED=true` setzen. Ohne vollständige Konfiguration meldet die Oberfläche „KI noch nicht eingerichtet“.
4. Mit einem eigenen, ausdrücklich für den Test bestimmten Chat die komplette Kette prüfen: Status, Start, Ergebnis, Quellen, Abbruch und Fehler. Keine privaten fremden Chats für technische Tests verwenden.

Supabase-Projekt: `mwptfpzhnnkondverggi`. API-Schlüssel bleiben ausschließlich als Server-Secrets hinterlegt. Die Funktion verwendet den JWT des angemeldeten Kontos und die bestehenden Zugriffsrechte für den Chatabruf.

## Umfang und Grenzen

- Die Auswertung liest den gesamten zugänglichen Textverlauf über einen eigenen seitenweisen Abruf, unabhängig von den letzten 200 im Chatfenster geladenen Nachrichten.
- Ergebnisse: Zusammenfassung, wichtige Informationen, Entscheidungen, Aufgabenvorschläge und offene Fragen, mit überprüfbaren Quellenauszügen.
- Bilder, Dokumentinhalte und Sprachnachrichten werden in diesem Teil noch nicht gelesen bzw. transkribiert. Die Oberfläche zeigt diese Ausnahmen an.
- Sehr große Verläufe oberhalb der serverseitigen Grenzen werden mit einer verständlichen Fehlermeldung abgewiesen. Es wird kein gekürzter Verlauf als vollständig ausgewertet dargestellt.
- Es werden keine Aufgaben automatisch angelegt, keine Nachrichten automatisch verschickt und keine vom Chattext angeforderten Werkzeuge ausgeführt.
- Ergebnisse bleiben vorübergehend im geöffneten Dialog. Konten-/Chatwechsel sowie erkannte Änderungen des Verlaufs verwerfen veraltete Ergebnisse. Es gibt noch kein gespeichertes Archiv der KI-Auswertungen.

## Prüfungen

`npm run typecheck`, `npm test` und `npm run build` prüfen den Anwendungscode und die simulierte KI-Verarbeitung. `tests/sql/chat-scan-rls.sql` prüft den vollständigen Abruf und die Zugriffsrechte in einer zurückgerollten Transaktion. `tests/browser/chat-scan.mjs` prüft die Bedienung mit isolierten Daten in Chromium und WebKit innerhalb von GitHub Actions.

Anbieterfehler, unvollständige Ausgaben und nicht mehr zugängliche Quellen führen zu einem Fehlerzustand; sie werden nicht als erfolgreiche Auswertung angezeigt. Eine bestandene Simulation ersetzt den noch ausstehenden Test mit dem eingerichteten KI-Modell nicht.
