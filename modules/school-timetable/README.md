# Stundenplan für Yuvomi

Eigenständiges Modul nach `MODULES.md`: Fächer mit Lehrkraft, Raum und Farbe je
Familienmitglied, Wochenplan mit Drag-and-drop oder Klick/Tastatur, nummerierte
Unterrichtsstunden und frei anpassbare Pausen. Deutsch und Englisch sind enthalten.

**Das Modul benötigt zusätzlich den Stundenplan-Dienst.** Eine ZIP- oder
GitHub-Installation lädt nur die Browserdateien; Yuvomi führt darin keinen Servercode
aus. Die offizielle Yuvomi-Version kann weiterverwendet werden. Ein eigener
Yuvomi-Build und Änderungen an Yuvomis Kerndateien sind nicht erforderlich.

## Einrichtung

1. Den separaten Dienst aus `services/school-timetable/` starten. Die vollständige
   Anleitung einschließlich Docker Compose und Nginx Proxy Manager steht in
   `services/school-timetable/README.md` im Repository bzw. Installationspaket.
2. Den Dienst auf derselben Adresse wie Yuvomi unter
   `/api/extensions/school-timetable/` bereitstellen. Der Proxy muss diesen ganzen
   Pfad unverändert an Port 3100 des Dienstes weitergeben.
3. Den Ordner `school-timetable` in Yuvomis eingebundenes `modules/`-Verzeichnis
   kopieren. Alternativ das mitgelieferte ZIP unter **Einstellungen → Module →
   Eigenes Modul hinzufügen** hochladen, sofern Web-Installation eingeschaltet ist.
4. Nach Web-Installation das Modul in **Aktive Module** freigeben. Bei manueller
   Kopie ist es gemäß Yuvomis Modulvertrag sofort aktiv. Es erscheint als
   **Stundenplan**, Route `/m/school-timetable`.
5. Für die gewünschten Mitglieder `ext:school-timetable` freigeben. Die API liest
   die Mitgliederliste über `/api/v1/family/members`; diese muss für die Sitzung
   lesbar sein. Schreibrecht am Modul erlaubt die Bearbeitung des eigenen Plans;
   Administratoren können alle Pläne bearbeiten. Leserecht erlaubt keine Änderungen.

Danach Mitglied wählen, **Fach hinzufügen** anklicken, Name und optional Lehrkraft,
Raum und Farbe eintragen und speichern. Das Fach erscheint links und kann mehrfach
in freie Unterrichtsstunden gezogen werden. Die Schaltflächen **Auswählen** und
**Hier einsetzen** bieten denselben Ablauf ohne Drag-and-drop.

## Technische Grenzen

- Maximal 60 Fächer, 30 Zeitabschnitte und 5–7 Wochentage pro Mitglied.
- Pläne und Revisionen liegen ausschließlich in der Datenbank des separaten
  Dienstes. Dieses Volume zusätzlich zur Yuvomi-Sicherung sichern.
- Eine Modulaktualisierung ersetzt nur Browserdateien; die Pläne bleiben im Dienst.
- Das Modul braucht eine Verbindung zum Dienst. Es führt keine Offline-Schreibzugriffe
  aus. Bei konkurrierenden Änderungen muss der aktuelle Plan neu geladen werden.
- Die frühere fest eingebaute Variante verwendete eine andere Datenbank. Vor dem
  Umstieg vorhandene Pläne über die alte API exportieren; Anleitung und Übernahme-
  Skript liegen beim Dienst. Die Legacy-Migration 283 bleibt für bestehende
  Fork-Installationen erhalten; deren Rückkehr zum offiziellen Image benötigt
  eine gesonderte Datenbankprüfung (siehe Dienstanleitung). Das Modul öffnet
  Yuvomis Datenbank nicht.
- Bereits vorhandene Pläne deaktivierter/entfernter Mitglieder werden nicht mehr
  angeboten. Sie verbleiben in der Dienstsicherung; es gibt keinen automatischen
  Zugriff auf Yuvomis private Löschmechanismen.

## Build und Abhängigkeiten

Alle Browserdateien sind fertig enthalten. Auf dem Yuvomi-Server sind weder
`npm install` noch ein Build nötig. Zur Laufzeit werden nur `/i18n.js` und
`/utils/html.js` als öffentliche Yuvomi-Fassaden importiert. Der Dienst spricht
ausschließlich `/api/v1/auth/me` und `/api/v1/family/members` an.

Die dokumentierten Seitenhelfer aus `public/utils/page-layout.js` sind als
`page-layout.js` mit MIT-Lizenz enthalten; lediglich ihr Escape-Import wurde auf
die öffentliche Fassade umgestellt. Grund: Der produktive Vite-Build veröffentlicht
`/utils/page-layout.js` derzeit nicht als stabile Datei. So bleibt das Modul auch
gegen den ausgelieferten Produktionsbuild lauffähig, ohne einen Core-Patch.

Drag-and-drop nutzt die mitgelieferte MIT-Version von SortableJS 1.15.7, ohne CDN.
Dialoge und ihre Lebensdauer gehören dem Modul. Beim Verlassen der Route werden
Anfragen, Listener, Dialoge und Sortable-Instanzen aufgeräumt. Zufällige IDs
funktionieren auch auf LAN-Adressen mit HTTP ohne `crypto.randomUUID()`.
