# Deployment

Onyx Utility Core läuft ohne PM2, ohne TTY und ohne Shell-Befehle. Es unterstützt
Docker, Pterodactyl-artige Panels (bot-hosting.net), systemd und lokale Windows-
Installationen.

## Plattform-Erkennung

Beim Start meldet der Bot seine Umgebung:

```
🌐 Platform: linux/x64 · node 22.14.0 · supervisor Hosting-Panel (container) · tty no
```

Die Klammer ist der Container-Hinweis (`bare`, `docker`, `container`), der
Supervisor-Name ist `PM2`, `Docker`, `Hosting-Panel`, `systemd` oder `none`.

`src/system/platform.js` erkennt `pm2` (via `pm2_env`/`PM2_HOME`), `panel`
(Pterodactyl, via `PTERODACTYL`, `SERVER_JARFILE` oder 16-stellige `HOSTNAME`),
`docker`, `systemd` und `none`. Davon hängt ab, wie `.reboot` und `.shutdown` sich
verhalten:

| Supervisor | `.reboot` / `.shutdown` |
| --- | --- |
| `pm2` | `pm2 restart` / `pm2 stop` — sauberer Neustart ohne Reconnect-Race |
| `docker` | `process.exit(0)` — der Container-Restart-Poller startet neu |
| `panel` | `process.exit(0)` — das Panel startet den Server neu |
| `systemd` | `process.exit(0)` — `Restart=` übernimmt |
| `none` | `process.exit(0)` — manueller Neustart nötig |

Ohne Supervisor gibt der Bot im Chat explizit aus, was zu tun ist.

## Wartung ohne TTY (`clear.js`)

Eine interaktive Terminal-Konsole gibt es nicht mehr. Auf Servern ohne TTY laufen
alle Wartungsaufgaben über `clear.js` oder die Owner-Chatbefehle.

```bash
node clear.js --status               # Plattform, DB, größte Settings-Keys
node clear.js --prune --dry-run      # Vorschau: Cache-/Verlaufs-Keys
node clear.js --prune --yes          # Cache leeren, Session + Settings bleiben
node clear.js --reset-settings --yes # alle Settings löschen, Session bleibt
node clear.js --reset-settings --local --yes    # nur lokale SQLite-Settings
node clear.js --reset-settings --external --yes # nur Postgres-Settings
node clear.js --auth                 # WhatsApp-Session löschen (Einstellungen bleiben)
node clear.js --wipedb --yes         # Datenbank + alle Einstellungen löschen
node clear.js --platform             # erkannte Umgebung / Supervisor / Runtime
node clear.js --restart --app X      # pm2 restart (nur mit PM2)
node clear.js --shutdown --app X     # pm2 stop    (nur mit PM2)
node clear.js --help                 # Übersicht
```

`--auth`, `--prune`, `--reset-settings` und `--wipedb` fragen interaktiv nach
Bestätigung; mit `--yes` entfällt die Abfrage (nötig in Skripten ohne TTY).
`--dry-run` zeigt bei `--prune`/`--reset-settings` nur, welche Keys betroffen
wären, und schreibt nichts. `--prune` löscht ausschließlich automatisch
nachwachsende Cache-/Verlaufs-Keys (`aihist:*`, `ai:message_ids`, `audit_log`,
`chat_index`, `chatbot_users`, `community:stats`, `community:registerCooldown`,
`corepanic:at`, `log_capture_level`, `mini_flags`, `rc_flags`, `stats_hourly`,
`stats_series`). Auth-State, Prefix, Sprache, Rollen, Ränge, Bans, Wallets,
Notizen, Erinnerungen und Gruppeneinstellungen bleiben erhalten.
`--reset-settings` löscht alle BotKV-Keys und lässt den Auth-State unangetastet;
die Defaults werden beim nächsten Start neu geseedet. Beide Befehle arbeiten
mit SQLite und Postgres. `--local` bzw. `--external` begrenzen die Aktion auf
die lokalen SQLite-Settings bzw. die Postgres-Settings; ohne Angabe werden
beide Seiten bearbeitet. Ohne Postgres-Konfiguration hat `--external` nichts
zu tun. `--restart`/`--shutdown` funktionieren nur bei PM2;
bei Docker/Panel/systemd den jeweiligen Neustart-Button bzw. `systemctl`
verwenden oder aus dem laufenden Bot die Chatbefehle nutzen.

Die gleichen Aktionen gibt es als Owner-Chatbefehle:

| CLI | Chat-Befehl | Wirkung |
| --- | --- | --- |
| `--auth` | `.logout` | Auth-State löschen, Bot ist nicht mehr angemeldet |
| `--wipedb` | `.wipedb` | Datenbank komplett löschen (doppelte Bestätigung) |
| `--restart` | `.reboot` | Prozess sauber beenden, Supervisor startet neu |

Zusätzlich: `.control` (Statusübersicht), `.platform` (Plattformdetails),
`.wipekey` (einzelnen KV-Schlüssel löschen). Alle destruktiven Befehle sind auf
Owner/Creator beschränkt, `fromMe: false`, protokollieren eine Auditspur und
verlangen eine Bestätigung.

`SIGINT`, `SIGTERM` und `SIGHUP` führen immer zu einem graceful Shutdown
(`connection.end()`), auch ohne TTY. Das ist wichtig für `docker stop` und für
Panel-Neustarts.

## Node-Version

`better-sqlite3` und `sharp` sind native Module und brauchen Prebuilds oder eine
C-Toolchain.

- **Node 22** — empfohlen, volle Prebuild-Abdeckung.
- **Node 20/23/24** — ebenfalls unterstützt.
- **Node ≥ 25 oder exotische Architektur** — es wird aus dem Quellcode gebaut und
  benötigt `python3`, `make` und `g++`.

`better-sqlite3` ist bewusst auf `^12.4.1` gepinnt. Version 11 hat keine Prebuilds
für Node 24 und baut dort immer aus dem Quellcode.

## Docker

```bash
docker compose up -d --build
docker compose logs -f onyx
```

Details:

- `node:22-bookworm-slim`, `tini` als PID 1, `stop_grace_period: 45s`.
- FFmpeg ist im Image enthalten (`FFMPEG_PATH=/usr/bin/ffmpeg`); Voice-Effekte
  funktionieren ohne Zusatzschritte.
- Daten liegen im Named Volume `onyx-data` unter `/app/data`
  (`DATABASE_URL=/app/data/database.db`). Ohne dieses Volume ist der Auth-State
  nach jedem `docker compose down` weg.
- Läuft als `node` (UID 1000), nicht als root.
- Kein TTY, kein stdin — die Terminal-Konsole bleibt zuverlässig aus.

Erstmalig koppeln, da im Container kein QR-Terminal verfügbar ist:

```env
PAIRING_NUMBER=4915201234567
```

`docker compose logs onyx` zeigt danach den Pairing-Code. Nach erfolgreichem
Koppeln `PAIRING_NUMBER` entfernen und neu starten.

### Healthcheck

Nur aktiv, wenn `ADMIN_HTTP_PORT` gesetzt ist. Der Check fragt `/health`, das
ohne Token erreichbar ist und nie mit 500 antwortet — auch wenn BotKV noch nicht
initialisiert ist. Details: `name`, `version`, `mode`, `ffmpeg`, `setup`,
`logGroup`, `queue`, `uptime`.

```bash
curl -s localhost:3000/health
```

## bot-hosting.net / Pterodactyl

Das Panel startet `npm install` bei Bedarf und führt den Prozess ohne Shell aus.
Deshalb:

1. **Node 22 wählen**, nicht die neueste Version.
2. **FFmpeg installieren.** Fehlt es, meldet der Bot das beim Start und Voice-
   Effekte, Ton- und Video-Konvertierung sind deaktiviert. Ohne Root hilft ein
   Build über `apk add ffmpeg`/`apt install ffmpeg`, falls das Panel Shell-
   Befehle erlaubt — sonst bleiben diese Funktionen aus.
3. **Start-Datei:** `node index.js` (oder `npm start`).
4. **Auto-Restart aktivieren**, damit `.reboot`/`.shutdown` und Panel-Neustarts
   funktionieren. Ohne Auto-Restart bleibt der Bot nach einem Neustartbefehl aus.
5. **Kein TTY**, also funktioniert der Terminal-Shortcut nicht — die Chatbefehle
   sind der Ersatz.
6. **Datenbank:** `DATABASE_URL` auf einen Pfad im persistenten Serververzeichnis
   setzen. Bei SQLite-Installationsproblemen hilft ein Verzeichnis mit Schreibrechten
   für den Node-User.

Optional das Web-Dashboard:

```env
ADMIN_HTTP_PORT=3000
ADMIN_HTTP_TOKEN=<langes zufälliges Token>
```

Dashboard unter `/ui`. Port nach außen nur über TLS/Reverse-Proxy freigeben.

## systemd (eigener Server)

```ini
[Unit]
Description=Onyx Utility Core
After=network-online.target

[Service]
Type=simple
User=onyx
WorkingDirectory=/opt/onyx
ExecStart=/usr/bin/node index.js
Environment=NODE_ENV=production
Environment=DATABASE_URL=/var/lib/onyx/database.db
Environment=FFMPEG_PATH=/usr/bin/ffmpeg
Restart=always
RestartSec=10
TimeoutStopSec=30
KillMode=mixed

[Install]
WantedBy=multi-user.target
```

`.reboot` funktioniert dann über `Restart=always` nach `process.exit(0)`.

## .env

`config.js` liest `DATABASE_URL` (Standard `./database.db`, alternativ eine
Postgres-URL). Bei einer Postgres-URL ist der Hybridmodus standardmäßig aktiv:
Die WhatsApp-Session liegt immer in der lokalen SQLite-Datei (`ONYX_LOCAL_DB_PATH`,
Standard `./database.db`), Einstellungen gehen zuerst an Postgres und werden
lokal als Fallback gespiegelt. Ist die lokale Datei leer, werden vorhandene
Postgres-Auth-Daten beim ersten Start dorthin kopiert. `ONYX_HYBRID=off` stellt
das alte Verhalten wieder her (alles in Postgres). Für Onyx und YumBot bitte
getrennte Datenbanken verwenden — beide nutzen dieselben Tabellennamen und
würden sich sonst gegenseitig die Session überschreiben.

**Postgres selbst einrichten (optional, 0 €):** Es ist kein anbieterspezifischer
Code nötig — `pg`/Sequelize reichen. Bei Neon zum Beispiel: kostenloses Projekt
anlegen, die **pooled** Connection String aus der Branch-Übersicht kopieren,
`sslmode=verify-full` im Query-String belassen und als `DATABASE_URL` in `.env`
bzw. in die Umgebung des Hosting-Panels eintragen. Danach Bot neu starten;
`node clear.js --status` zeigt `Mode: hybrid` und die Settings-Keys in Postgres.
Ohne `DATABASE_URL` bleibt alles lokal in SQLite.

`src/config/constants.js` setzt den Prefix aus `BOT_PREFIX` —
**Standard ist `#`**, auf dem Server steht `BOT_PREFIX=.`. Der Prefix wird beim
Bauen der Kommandoregex escaped und verankert, sodass `.` keine Falschtreffer mehr
auslöst: `#platform` oder `Hello platform` lösen nichts mehr aus.