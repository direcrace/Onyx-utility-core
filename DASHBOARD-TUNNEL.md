# Dashboard-Tunnel / Reverse-Proxy — Anleitung (VPS & Hosting-Panel)

Ziel: Das Web-Dashboard `/ui` sicher erreichbar machen — entweder über den
**Panel-Proxy** (empfohlen, HTTPS ist schon da) oder über einen **cloudflared
Quick-Tunnel**.

> **Wichtig:** Seit dem Fix liest der Bot `SERVER_PORT` automatisch und bindet
> im Panel-Modus auf `0.0.0.0`. Die Meldung
> *„We forwarded the request to your app and got nothing back on its port"*
> kam daher, dass vorher auf `ADMIN_HTTP_PORT` und `127.0.0.1` gehört wurde.

---

## 0. Vorbereitung (einmalig)

Im Panel **Files → .env** (oder in der Web-Konsole) setzen:

```env
ADMIN_HTTP_TOKEN=<LANGES_ZUFÄLLIGES_TOKEN>
ADMIN_HTTP_HOST=0.0.0.0
```

- `SERVER_PORT` **nicht selbst setzen** — das Panel injiziert ihn automatisch.
- `ADMIN_HTTP_PORT` darf bleiben, wird aber ignoriert, wenn `SERVER_PORT` da ist.
- Token ist **pflicht**: ohne Token startet der HTTP-Server gar nicht.

Code aktualisieren (Web-Konsole):

```bash
cd /home/container
git pull
npm install --no-fund --no-audit
```

Startbefehl im Panel (*Startup Command*):

```bash
cd /home/container && { [ -d node_modules/better-sqlite3 ] || npm install --no-fund --no-audit; } && exec node ${STARTUP_FILE}
```

`STARTUP_FILE=index.js` setzen, dann **Restart** im Panel.

---

## 1. Variante A — Panel-Proxy (empfohlen)

1. Obenstehende `.env` setzen und neu starten.
2. Prüfen, dass die App auf dem vom Panel vergebenen Port lauscht:

```bash
echo "Port: $SERVER_PORT"
curl -s "http://127.0.0.1:${SERVER_PORT}/health"
```

Erwartung (JSON, ohne Token erreichbar):

```json
{"ok":true,"name":"YumBot","version":"...","mode":"public","ffmpeg":true,"setup":true,"logGroup":true,"queue":...,"uptime":...}
```

3. Im Bot (Owner) prüfen:

```text
#control
```

Zeigt jetzt z. B. `Web dashboard: port 3000 @ 0.0.0.0 (panel)`.

4. Dashboard öffnen:

```text
https://<DEINE-PANEL-DOMAIN>/ui?token=<ADMIN_HTTP_TOKEN>
```

Die HTTPS-Domain und das Zertifikat stellt das Panel bereit — du brauchst
keinen cloudflared-Tunnel, wenn dieser Weg funktioniert.

---

## 2. Variante B — cloudflared Quick-Tunnel

Nutzen, wenn der Panel-Port nicht erreichbar ist oder du eine separate URL willst.
Der Tunnel zeigt auf den lokalen Dashboard-Port.

### 2.1 cloudflared herunterladen (Web-Konsole)

```bash
cd /home/container
case "$(uname -m)" in
  x86_64|amd64) CF_ARCH=amd64 ;;
  aarch64|arm64) CF_ARCH=arm64 ;;
  *) CF_ARCH=amd64 ;;
esac
curl -L --fail -o cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
chmod +x cloudflared
./cloudflared --version
```

### 2.2 Tunnel starten

Vordergrund (URL sofort sichtbar, Terminal darf nicht geschlossen werden):

```bash
./cloudflared tunnel --url "http://127.0.0.1:${SERVER_PORT}" --no-autoupdate
```

Hintergrund (überlebt das Schließen des Terminals, falls das Panel Prozesse nicht killt):

```bash
nohup ./cloudflared tunnel --url "http://127.0.0.1:${SERVER_PORT}" --no-autoupdate > cloudflared.log 2>&1 &
echo $! > cloudflared.pid
sleep 10
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cloudflared.log | head -1
```

Output ist eine URL wie `https://abc-def-ghi.trycloudflare.com`. Dashboard:

```text
https://abc-def-ghi.trycloudflare.com/ui?token=<ADMIN_HTTP_TOKEN>
```

Tunnel stoppen:

```bash
kill "$(cat cloudflared.pid)" 2>/dev/null || pkill -f 'cloudflared tunnel'
```

Hinweise:
- Die `trycloudflare.com`-URL ändert sich **bei jedem Start**.
- Quick-Tunnels brauchen ausgehenden UDP-Port 7844 — manche Panels blockieren das.
- Wenn das Panel Hintergrundjobs beim Trennen beendet: Tunnel als zweiten
  Startprozess / Service eintragen oder `screen`/`tmux` nutzen (falls vorhanden).

---

## 3. Fehlerbehebung

| Symptom | Command | Lösung |
|---|---|---|
| „got nothing back on its port" | `echo $SERVER_PORT; curl -s http://127.0.0.1:$SERVER_PORT/health` | App lauscht nicht auf dem Panel-Port → `git pull`, `ADMIN_HTTP_HOST=0.0.0.0`, Restart |
| `/health` antwortet auf 9000, aber nicht auf `$SERVER_PORT` | `curl -s http://127.0.0.1:9000/health` | Alte Version / `ADMIN_HTTP_PORT` hartgesetzt → `git pull` + Restart |
| Nichts hört auf dem Port | `ss -ltnp \| grep -E 'node\|SERVER_PORT'` | Bot-Crash? Letzte Console-Zeilen prüfen; Token fehlt? |
| `HTTP port set but ADMIN_HTTP_TOKEN missing` | `grep ADMIN_HTTP .env` | `ADMIN_HTTP_TOKEN` setzen und neu starten |
| Panel-Proxy sieht nichts, lokales curl geht | `grep ADMIN_HTTP_HOST .env` | Host auf `0.0.0.0` setzen (nicht `127.0.0.1`) |
| `401 unauthorized` im Browser | — | Token in `?token=…` stimmt nicht mit `ADMIN_HTTP_TOKEN` überein |
| cloudflared startet, keine URL | `tail -50 cloudflared.log` | UDP 7844 blockiert → Panel-Proxy (Variante A) nutzen |

Umgebung auf einmal anzeigen:

```bash
env | grep -E 'SERVER_PORT|ADMIN_HTTP|STARTUP_FILE'
```

Prozess prüfen:

```bash
ps aux | grep -E 'node|cloudflared' | grep -v grep
```

---

## 4. Sicherheit

- `/health` ist bewusst **ohne** Token erreichbar (für Healthchecks).
- `/ui` und alle `/api/...`-Routes brauchen `?token=…` oder `Authorization: Bearer …`.
- Token nie in Chats, Screenshots oder öffentliche Repos posten. Bei Verdacht auf
  Weitergabe: neues Token setzen und neu starten.
- `ADMIN_HTTP_HOST=0.0.0.0` ist nur sicher, weil der Token-Schutz greift — nie
  Token entfernen, während der Port aktiv ist.
- Es gibt zwei Token-Tiers: `ADMIN_HTTP_TOKEN` (Creator, alles) und
  `ADMIN_OPERATOR_TOKEN` (eingeschränkt, z. B. kein Reboot/Terminal/Panic).

---

## 5. Relevante Bot-Befehle (Owner)

```text
#update               → git pull + npm install + Neustart (Creator)
#control              → Runtime, Supervisor, Dashboard-Port/-Host anzeigen
#status               → Bot-/Verbindungsstatus
#minilog              → Letzte Konsolen-Einträge (falls verfügbar)
#reboot               → Prozess sauber neu starten (Auto-Restart an oder Pterodactyl Client API gesetzt)
```

`#update` benutzt jetzt `git pull --ff-only origin <branch>` und funktioniert
damit auch auf Panel-Clones ohne Upstream-Tracking. Falls du manuell pullst:

```bash
cd /home/container
git pull origin main
npm install --no-fund --no-audit
```

Nach jeder Änderung an `.env` gilt: **Panel-Restart**, nicht nur Bot-Reboot.

---

## 6. Schnellkopie (Panel-Variante)

```bash
cd /home/container
git pull
npm install --no-fund --no-audit
echo "Port: $SERVER_PORT"
curl -s "http://127.0.0.1:${SERVER_PORT}/health"
```

`.env`:

```env
ADMIN_HTTP_TOKEN=<langes-token>
ADMIN_HTTP_HOST=0.0.0.0
```

Dann: Restart → `https://<PANEL-DOMAIN>/ui?token=<TOKEN>`.
