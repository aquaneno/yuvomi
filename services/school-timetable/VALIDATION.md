# Geprüfter Stand – 11.11.2026

Die Erweiterung wurde gegen den produktiven Vite-Build von Yuvomi 2.87.0
(Basis `3bd7a7a`) geprüft. `MODULES.md` war beim Abgleich unverändert gegenüber
`ulsklyc/yuvomi:main` vom 11.11.2026. Die Erweiterung liegt in `modules/school-timetable/` und
`services/school-timetable/`. Die bisherigen Core-Eingriffe für Navigation,
API, Berechtigungen und Frontend sind zurückgenommen. Ausschließlich die bereits
veröffentlichte Datenbankmigration 283 bleibt im bestehenden Fork erhalten:
Migrationen dürfen nach einer Veröffentlichung nicht entfernt werden, da
vorhandene Datenbanken sonst am Downgrade-Schutz scheitern. Die Modulinstallation
auf einer offiziellen Yuvomi-Version benötigt diese Legacy-Migration nicht.

- **28 API-/Modulprüfungen bestanden:** echter Manifest-Loader und Installer,
  Modulfreigabe, Fachanlage, dauerhaftes Speichern nach Dienstneustart,
  Mitglieder-/Rollenprüfung, `ext:school-timetable`, eigenes CSRF und Origin,
  parallele Schreibzugriffe/Revisionskonflikte, Eingabevalidierung, Dienstfehler
  und einmalige Übernahme alter Pläne ohne Überschreiben.
- **Sieben Browserprüfungen bestanden:** echter Yuvomi-Server, ausgelieferter
  Vite-Build, SQLite-Dienst und Reverse Proxy. Fach mit Lehrkraft/Raum anlegen,
  Werte nach Neuladen prüfen, HTML-Escaping, Tastatur-/Klickplatzierung,
  Ziehen bestehender Belegungen, Klonen aus der Fächerpalette, Zeitenprüfung,
  Mitgliederwechsel, Mobilansicht, Bearbeiten/Löschen und Aufräumen bei Navigation.
  `crypto.randomUUID` wurde dabei absichtlich entfernt, entsprechend dem
  ursprünglichen Fehlerfall beim Aufruf über eine LAN-Adresse mit HTTP.
- **Produktionsbuild erfolgreich** (`npm run build`).
- **36 zusätzliche Core-Prüfungen bestanden:** Static-Copy-Liste (5), öffentliche
  Modul-Fassaden (6), Service-Worker-Precache (13), Modulregister-Parität (12).
- Die mobile Ansicht wurde zusätzlich als Screenshot kontrolliert.

Der Browserlauf lieferte Wetterantworten lokal aus und verweigerte externe
Browseranfragen. Es wurde ausschließlich mit isolierten Demo-Daten gearbeitet.
Ein vorheriger Lauf wurde wegen einer Wetterabfrage von der automatischen
Freigabeprüfung gestoppt; die erfolgreichen Läufe enthielten diese Abfrage nicht.

Die Docker-/Nginx-Konfiguration ist mitgeliefert; ein Docker-Image-Build und der
Betrieb in der tatsächlichen Nutzerinstallation wurden hier nicht ausgeführt.
Browserseitige Installation startet keinen Dienst. Für die Inbetriebnahme müssen
der separate Dienst und die Proxy-Location eingerichtet sein.
