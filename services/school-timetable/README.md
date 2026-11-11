# Stundenplan: separater Dienst und Installation

Der Browserteil liegt unter `modules/school-timetable/`, dieser Dienst unter
`services/school-timetable/`. Beide bilden die eigenständige Erweiterung gemäß
Yuvomis `MODULES.md`. Keine Core-Datei muss verändert werden. Der Dienst verwendet
Node.js ab 24.12, `node:http` und `node:sqlite`, ohne npm-Laufzeitabhängigkeiten.

## Docker Compose mit vorhandenem Yuvomi

Im entpackten Installationspaket oder im Repository-Hauptverzeichnis ausführen:

```bash
export PUBLIC_ORIGIN=https://yuvomi.example.de
export YUVOMI_NETWORK=yuvomi_default
export YUVOMI_URL=http://yuvomi:3000
docker compose -f services/school-timetable/compose.yml up -d --build
```

`PUBLIC_ORIGIN` ist die vom Browser verwendete Yuvomi-Adresse **ohne abschließenden
Slash und ohne Pfad**. Für einen lokalen Test beispielsweise
`http://192.168.100.50:8080`. Wenn beide Adressen benutzt werden, wird jeweils die
konfigurierte Adresse zum Schreiben vorausgesetzt. `YUVOMI_URL` ist dagegen die
interne Adresse des vorhandenen Yuvomi-Containers. `YUVOMI_NETWORK` muss dessen
vorhandenes Docker-Netzwerk bezeichnen; beim Teststack kann es z.B.
`yuvomi-test_default` heißen. Mit `docker network ls` den tatsächlichen Namen
ermitteln. Nginx Proxy Manager und der Dienst müssen ein gemeinsames Netzwerk
haben, wenn der Proxy den Namen `school-timetable` verwendet.

Der Dienst ist mit Node.js auch auf ARM64/Raspberry Pi nutzbar. Das Compose-Beispiel
veröffentlicht Port 3100 nur auf Loopback des Docker-Hosts; über Docker-Netzwerk
ist er als `school-timetable:3100` erreichbar. Die Anwendung nutzt weiter das
offizielle Yuvomi-Image. `Dockerfile` und Compose sind vorbereitet; ein Docker-
Daemon ist für die automatischen Node-/Browserprüfungen nicht erforderlich.

## Reverse Proxy / Nginx Proxy Manager

Im bestehenden Yuvomi-Proxyhost eine gesonderte Location einfügen. Alle anderen
Pfade gehen weiterhin an den vorhandenen Yuvomi-Container:

```nginx
location ^~ /api/extensions/school-timetable/ {
    proxy_pass http://school-timetable:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Bei Nginx Proxy Manager kann der Block im Feld **Advanced** des Proxyhosts stehen.
`proxy_pass` hat absichtlich **keinen Slash hinter der Portnummer**: andernfalls
würde der benötigte Pfad abgeschnitten. Cookie-, Origin- und CSRF-Header müssen
unverändert weitergereicht werden. Browser und Dienst verwenden dieselbe öffentliche
Origin; CORS-Freigaben und ein zweiter öffentlicher Host sind nicht nötig. Ein
vorhandener Cloudflare-Tunnel zeigt weiterhin auf diesen Proxyhost.

Anschließend den Browserteil wie in `modules/school-timetable/README.md` installieren.
Der Web-Installer benötigt `MODULES_ALLOW_WEB_INSTALL=true` und ein dauerhaft
eingebundenes, beschreibbares `/app/modules`. Bei manueller Kopie wird der Ordner
nach `modules/school-timetable` kopiert. Ein Yuvomi-Neubuild ist nicht erforderlich.

Das vollständige Yuvomi-Repository überschreitet je nach Stand die 20-MB-Grenze
des Web-Installers. Deshalb für die Web-Installation das kleine mitgelieferte
Installations-ZIP verwenden. Dessen einziges Manifest liegt im Modulordner; der
Installer kopiert nur diesen. Den Dienst aus demselben entpackten Paket betreiben.

## Ohne Docker

Aus dem Hauptverzeichnis des Pakets mit Node.js ab 24.12:

```bash
YUVOMI_URL=http://127.0.0.1:3000 \
PUBLIC_ORIGIN=https://yuvomi.example.de \
TIMETABLE_DB=/var/lib/school-timetable/timetable.db \
node services/school-timetable/server.js
```

Der Prozess braucht Schreibrechte auf sein eigenes Datenverzeichnis. Keine
Zugangsdaten oder API-Tokens sind erforderlich: Die Browser-Sitzung wird intern
über Yuvomi überprüft. Die interne Adresse muss das richtige Yuvomi derselben
Installation erreichen. Ein Dienst/Datenvolume wird jeweils genau einem Haushalt
zugeordnet; beim Wechsel auf eine andere Yuvomi-Instanz ein neues Volume verwenden.

## Rechte und Speicherung

- Jede Anfrage benötigt einen Yuvomi-Sitzungscookie. Identität und Rollen stammen
  aus `/api/v1/auth/me`, nicht aus Browserfeldern oder Proxy-Identitätsheadern.
- Positive Identitätsauskünfte werden je Sitzung maximal drei Sekunden zwischengespeichert,
  damit parallele Aufrufe das Yuvomi-Limit nicht verbrauchen. Änderungen an
  Rollen, Modulsperren und Abmeldungen gelten daher spätestens nach drei Sekunden.
- Fehlendes/gesperrtes `ext:school-timetable` verweigert alle Modulzugriffe;
  `read` verweigert alle Änderungen. Auch Administratoren brauchen ein aktives Modul.
- Änderungen erfordern zusätzlich exakte `Origin`, einen signierten, an die Sitzung
  gebundenen Double-submit-Cookie und `X-Timetable-CSRF`. Yuvomis eigener CSRF-Token
  wird dafür nicht verwendet. Der Schlüssel entsteht pro Dienststart neu; der
  Browser erneuert seinen Token bei Bedarf automatisch.
- Die Mitgliederliste kommt bei Zugriff über `/api/v1/family/members` aus Yuvomi.
  Deaktivierte oder entfernte Mitglieder können nicht mehr gelesen/beschrieben werden.
- Pläne liegen im Volume `timetable_data`, mit atomarer Revisionsprüfung gegen
  konkurrierendes Überschreiben. Es wird nie `yuvomi.db` geöffnet.

Das Dienstvolume zusätzlich sichern. Für eine einfache konsistente Dateisicherung
den Dienst stoppen und **das ganze Volume** einschließlich etwaiger WAL-Dateien
sichern. Eine Yuvomi-Sicherung umfasst diese separate Datenbank nicht automatisch.

## Übernahme aus dem bisherigen Stundenplan-Branch

Vor dem Wechsel auf die modulare Variante den bisherigen Container noch laufen
lassen. Beide Dienste müssen erreichbar sein. Das Skript verwendet nur deren
HTTP-APIs und überschreibt keine bereits vorhandenen Modulpläne:

```bash
export LEGACY_URL=https://bisheriges-yuvomi.example.de
export TIMETABLE_URL=http://127.0.0.1:3100
export PUBLIC_ORIGIN=https://yuvomi.example.de
read -rs YUVOMI_SESSION_COOKIE
export YUVOMI_SESSION_COOKIE
node services/school-timetable/migrate-legacy.js
unset YUVOMI_SESSION_COOKIE
```

Bei der verdeckten Eingabe einen gültigen Administrator-Sitzungscookie im Format
`yuvomi.sid=...` eingeben; nicht den CSRF-Cookie. Beide Yuvomi-Adressen müssen
dieselbe laufende Instanz und dieselbe Sitzung betreffen. Das Modul muss dort
bereits aktiviert sein. Der alte Branch kann parallel Modulordner laden; erst
nach erfolgreicher Übernahme den Yuvomi-Container auf den neuen Stand dieses
Branches umstellen. Die bereits veröffentlichte Legacy-Migration 283 bleibt im
Branch erhalten; vorhandene Datenbanktabellen werden nicht gelöscht.

**Bestehende Fork-Datenbank nicht unverändert auf das offizielle Image umstellen:**
Sie enthält die zusätzliche Migration 283. Ein offizieller Build, der diese nicht
kennt, verweigert den Start; eine spätere offizielle Migration mit derselben Nummer
wäre ebenfalls ein Konflikt. Das erfordert einen gesondert geprüften Rückweg für
die Bestandsdatenbank. Der Notfallschalter `DB_ALLOW_NEWER_SCHEMA` ist keine
Datenmigration. Für bereits offizielle/frische Yuvomi-Installationen ist dieser
Punkt nicht relevant; dort einfach Modul und Dienst installieren.

## Prüfungen

Im Repository-Hauptverzeichnis:

```bash
npm --prefix services/school-timetable test
npm run build
npm --prefix services/school-timetable run test:browser
```

Die Browserprüfung benötigt die Entwicklungsabhängigkeiten des Yuvomi-Repositorys
und Chrome/Chromium. Für einen vorhandenen Headless-Shell-Browser kann
`PUPPETEER_EXECUTABLE_PATH` auf dessen Programm zeigen. Die Tests betreiben Yuvomi
mit isolierten Demo-Daten, den echten Dienst und einen lokalen Reverse Proxy.
Wetterrouten liefern ausschließlich lokale Testantworten; externe Browseraufrufe
sind gesperrt. Alternativ direkt `node --test services/school-timetable/test/browser.js`.
