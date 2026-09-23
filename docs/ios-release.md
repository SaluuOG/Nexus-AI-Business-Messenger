# Nexus für iOS

Die native iOS-Hülle liegt unter `ios/` und verwendet Capacitor 8. Die Web-App
wird lokal in das App-Paket kopiert; private Server-Schlüssel bleiben weiterhin
ausschließlich in Supabase Edge Functions.

## Lokal aktualisieren

```bash
npm ci
npm run build:ios
npm run open:ios
```

`build:ios` erzeugt den Build mit relativen Asset-Pfaden und synchronisiert ihn
in das Xcode-Projekt. Der normale `npm run build` behält dagegen den Pfad für
GitHub Pages.

## Vor dem App-Store-Upload

- Xcode auf einem Mac verwenden und das Projekt `ios/App/App.xcodeproj` öffnen.
- Im Target `App` das eigene Apple-Developer-Team auswählen.
- Die Bundle-ID `com.saluuog.nexus` im Apple Developer Portal registrieren oder
  in `capacitor.config.ts` und Xcode gemeinsam auf eine eigene eindeutige ID ändern.
- App-Version und Buildnummer in Xcode setzen, anschließend auf einem echten
  iPhone Anmeldung, Passwort-Wiederherstellung, Chats, Dateien, Mikrofon und
  Kontolöschung prüfen.
- App-Datenschutzangaben und eine öffentliche Datenschutz-URL in App Store
  Connect hinterlegen. Der rechtliche Text benötigt die vollständigen Angaben
  des verantwortlichen Unternehmens bzw. Betreibers.

Die iOS-Hülle verwendet `capacitor://localhost`. Die Kontolöschungsfunktion und
KI-Funktion akzeptieren diese Origin ausdrücklich; das ist keine Freigabe für
beliebige Webseiten.
