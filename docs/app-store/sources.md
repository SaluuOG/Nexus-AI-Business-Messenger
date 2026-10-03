# Quellen und Abgrenzung

Am 3. Oktober 2026 für dieses Paket herangezogen. Anforderungen vor tatsächlicher Veröffentlichung erneut abgleichen. Die Einstufung von Nexus ist eine eigene Bewertung anhand des Repositorys; weder Apple noch eine Aufsichtsbehörde haben die App freigegeben.

## Apple

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): insbesondere 1.2, 1.5, 2.1, 2.3 und 5.1.
- [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/): Datenkategorien und Deklaration.
- [Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/): Kontolöschung.
- [Screenshot Specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications): aktuelle Displaygruppen und Maße.
- [Platform Version Information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/): Textgrenzen und Supportangaben.
- [EU Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/): Händlerstatus und öffentliche Kontakte. Kostenloser Download entscheidet nicht allein über den Händlerstatus.
- [Apple Developer Program](https://developer.apple.com/programs/): kostenloser Geräte-Test gegenüber Mitgliedschaft für Verteilung; Apple nennt aktuell 99 USD pro Jahr, lokale Konditionen und mögliche Befreiungen separat prüfen.
- [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/): am Prüfdatum Xcode 26+/iOS-26-SDK für Uploads; Mindestziel iOS 13+ seit September 2026. SDK und Deployment Target sind unterschiedliche Werte.

## Rechtliche Primärquellen

- [DSGVO, amtlicher Text](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679): insbesondere Art. 5/6, 12–22, 25/28/32 und 44 ff. Deutsche EUR-Lex-Fassung war beim Abruf nicht vollständig zugänglich; englische amtliche Fassung verwendet.
- [§ 5 DDG](https://www.gesetze-im-internet.de/ddg/__5.html): Anbieterinformationen.
- [§ 25 TDDDG](https://www.gesetze-im-internet.de/ttdsg/__25.html): Endgerätezugriffe; der amtliche URL-Pfad verwendet weiterhin `ttdsg`.
- [§ 307 BGB](https://www.gesetze-im-internet.de/bgb/__307.html): Inhaltskontrolle von AGB.
- [§ 327 BGB](https://www.gesetze-im-internet.de/bgb/__327.html): Anwendungsbereich digitaler Produkte; „kostenlos“ schließt Verbraucherschutz nicht pauschal aus.

Die Entwürfe setzen noch keine abschließend geprüfte Rechtsordnung, Zielgruppe, Vertragsgestaltung oder Diensteklassifizierung voraus. Sie enthalten bewusst keine pauschalen Haftungsausschlüsse, keinen frei erfundenen Gerichtsstand und keine bestätigte Zertifizierung.

## Dienstleister

- [Supabase Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum): Ausgangspunkt für AVV-/Empfängerprüfung. Annahme des Vertrags, konkrete Gesellschaft, Unterauftragnehmer, Transferinstrumente und Fristen im eigenen Konto bestätigen; nicht allein aus diesem Link als erledigt markieren.

## Technische Nachweise

- `ios/App/App/Info.plist`, `ios/App/App.xcodeproj/project.pbxproj`, `capacitor.config.ts`, AppIcon-Asset und `.github/workflows/validate-ios.yml`.
- `src/features/auth/AuthProvider.tsx`, `src/lib/supabase.ts`, `supabase/functions/delete-account`, Kontolöschmigration.
- `src/features/offline/chatCache.ts`, `src/features/drafts/chatDrafts.ts`, `src/features/notifications`, `src/features/data`.
- Kernmigrationen für Konten, Kontakte, Chats, Projekte, Aufgaben sowie spätere Migrationen für Zusammenarbeit, Anhänge, Bookmarks und Wiedervorlagen.
- `supabase/functions/chat-scan/README.md` und zugehöriger Code; Anbindung nach Projektstand deaktiviert, keine erneute Aktivierung vorgenommen.
- Supabase-Projektmetadaten am Prüfdatum: aktiver Zustand, Region `eu-central-1`. Keine Inhaltsdaten oder Zugangsschlüssel für dieses Dokumentationspaket abgerufen.
