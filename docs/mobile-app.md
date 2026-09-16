# Nexus auf dem Handy

Nexus ist als installierbare Web-App für iPhone/iPad und Android vorbereitet.
Adresse: https://saluuog.github.io/Nexus-AI-Business-Messenger/

- iPhone/iPad: In Safari öffnen, Teilen → Zum Home-Bildschirm. „Als Web-App öffnen“ aktivieren, falls angeboten, und hinzufügen.
- Android: In Chrome öffnen, Menü → App installieren bzw. Zum Startbildschirm hinzufügen. Wenn verfügbar, gibt es auch in Nexus einen Installationsbutton.
- Anschließend über das Nexus-Symbol starten und mit dem vorhandenen Konto anmelden. Eine Anmeldung kann in der installierten App erneut nötig sein.
- Anleitung auch auf der Anmeldung und unter Einstellungen → Allgemein.

## Technischer Umfang

Diese Veröffentlichung basiert auf Phase 3.8 (main 94cab678). Der Entwurf von Phase 3.9 bleibt in PR #2; seine Datenbankmigration ist weiterhin nicht veröffentlicht. Keine Datenbankänderung oder kostenpflichtige KI-Aktivierung für die mobile Installation.

Manifest mit stabilem ID/Scope/Startpfad unter dem GitHub-Pages-Unterverzeichnis, Standalone-Darstellung, PNG-Symbolen in 192/512 px, Apple-Touch-Icon in 180 px und skalierbarem Favicon. Mobil: Safe-Area-Abstände und 16-px-Eingaben gegen automatisches iOS-Fokuszoomen. Kein Zoom-Verbot.

Service Worker: nur die öffentliche Offline-Hinweisseite wird in CacheStorage gespeichert. App-HTML, JS, API-Antworten und Nutzerdaten werden nicht durch den Worker zwischengespeichert; es gibt keine Offline-Schreibwarteschlange. Bestehende Anmeldung/Entwürfe bleiben durch die bisherigen App-Funktionen verwaltet. App-Updates werden regulär aus dem Netz geladen, ohne erzwungenes Neuladen während der Eingabe.

Internet wird für Chats und Aufgaben benötigt. Eine Veröffentlichung im Apple App Store oder Google Play Store sowie System-Push bei geschlossener App sind nicht Teil dieses Umfangs.

## Prüfung

`npm run typecheck`, `npm test`, `npm run build`; CI in Chromium und WebKit mit dem Produktionsbuild: Manifest/Pfade, echte PNG-Maße, Apple-Icon, Anmeldung, 320/390-px-Breiten, Eingabegröße, Installationshinweise, simulierte Installationsereignisse, ausschließlich öffentlicher Offline-Cache, Offline-Neuladen und Wiederverbindung. Bestehende Workspace-, Nachrichten-, Aufgaben- und Einstellungsabläufe bleiben CI-Pflicht. Nach Veröffentlichung wird das genaue Build-Asset einschließlich Manifest, Symbolen, Service Worker und mobiler Anmeldung auf der echten URL geprüft. Eine physische iPhone-/Android-Installation kann nur auf dem jeweiligen Handy bestätigt werden.

Quellen: [Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
