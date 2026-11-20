# AGENTS.md — Onyx Utility Core

Kontext für Agenten/Sessions, die in diesem Ordner arbeiten. Stand: **18.11.2026**.
Bitte vor Änderungen lesen. Wenn etwas hier veraltet ist: aktualisieren.

---

## 1. Grundsatz: Onyx ist der Core, keine Community-Distro

Onyx folgt dem Linux-Prinzip: **ein schlanker Kern, alles andere kommt als
Plugin/Addon/Provider dazu.** Der User will ausdrücklich, dass Onyx *nicht*
zum Community-Bot wird.

**Gehört in den Core:** Auth/RBAC, Dashboard/Dev-Console, Logging/Audit,
Moderation, Multi-Session („Onyx Mini"), AI-Grundgerüst, Games/Economy,
Ops/Update, Image-Resolver, Search-Provider, generische Utils.

**Gehört NICHT in den Core (bleibt YumBot):**
Ränge/Teams/XP/`#whois`-Details, Tickets/Support/SLA, Karma/Badges,
`#mydata`/`#forgetme`, ToS/Impressum/Kontaktdaten, globaler Nachrichten-Footer
(„… | Built on Onyx"), `config:botname`, AUTOFLAG/`#fulllog`-Community-Logik.

YumBot ist die *Distro*/Referenzimplementierung und ein **eigenes Repo**. Ohne
explizite Freigabe hier nicht hineinpushen.

---

## 2. Identität — NIEMALS verändern

- Package-/Interner Name: `onyx-utility-core`
- Repo: `https://github.com/direcrace/Onyx-utility-core.git`
- Bot-Name zur Laufzeit: `ONYX UTILITY CORE` (runtime-changeable)
- „Onyx Mini" (Multi-Account), historisches „Onyx Core" — genau so lassen
- Docker-Image-Name `onyx-utility-core:<version>`, PM2/systemd-Namen unverändert
- AUTHOR/LICENSE-Rechtlicher Name und Repo-URLs nicht antasten
- Keine Secrets, `.env`, Tokens oder Session-Daten committen
- Keine kostenpflichtigen APIs, kein Hosting, keine neuen npm-Pakete ohne Freigabe

---

## 3. Aktueller Stand

### Branch / Commits
```
main … origin/main   (sauber, nichts ausstehend)
1174569  chore: clear npm audit findings (0 vulnerabilities)
41e0aab  release: v5.0.5 core-only backports
57aa302  Clarify usage prohibition for user 'herzogjerome551-max'
```

### Version
`5.0.5-A1` konsistent in: `package.json`, `package-lock.json`,
`index.js` (Banner), `src/enterprise/devConsole.js` (Snapshot),
`README.md`, `CHANGELOG.md`, `docker-compose.yml` (`onyx-utility-core:5.0.5-A1`),
`src/config/constants.js` (`BOT_INFO.VERSION`),
`src/modules/imageResolver/constants.js` (`BOT_UA`).
`yarn.lock` (v1) enthält keine Root-Version.

### Verifikation
- `npm test` → 17/17 (`test/imageResolver.test.mjs`, gemockt, kein Live-Network)
- `npm audit` → 0 Vulnerabilities
- GitHub-Dependabot zeigt noch ~96 Alerts, aber **alle `state: fixed`**
  (API geprüft) – Anzeige-Artefakt, keine offenen Findings.
- Vor jedem Commit: `node --check` geänderter Dateien, Imports prüfen,
  `npm test`, `git diff --check`.

### Deploy
```bash
git pull origin main
npm install --no-fund --no-audit
```
danach Panel-Restart / `pm2 restart onyx-utility-core`.
`#update` funktioniert auch ohne Upstream-Tracking (siehe `src/utils/gitUpdate.js`).

---

## 4. Was mit 5.0.5 in den Core gekommen ist

- **Dashboard/Panel:** `SERVER_PORT` (vom Panel injiziert) hat Vorrang vor
  `ADMIN_HTTP_PORT`; Bind auf `0.0.0.0`, außer `ADMIN_HTTP_HOST` ist gesetzt.
  `getAdminHttpConfig()` in `adminHttp.js` wird von `#control`, Fleet und
  Startup-Banner genutzt. `/ui?token=<ADMIN_HTTP_TOKEN>`, `/health` tokenfrei.
  Anleitung: `DASHBOARD-TUNNEL.md`.
- **Update:** `src/utils/gitUpdate.js` (`gitPull`, `npmInstall`) für `#update`
  und Dev-Console, explizites `git pull --ff-only <remote> <branch>`.
- **Bilder:** `src/modules/imageResolver/` mit Providern
  (`pinterest`, `openverse`, `commons`, `directUrl`), `guardedFetch` mit
  SSRF-/Redirect-/MIME-/Size-Prüfung, Fehlercodes, 10-Min-Cooldown bei
  401/403/429/CAPTCHA. `#img <query|url>`. Docs: `IMAGE-RESOLVER.md`.
- **Search:** `#anime` Jikan → AniList-Fallback; `#img` mit Quellen-/Lizenz-Caption.
- **Chatbot:** `#chatbot off` unterdrückt normale Auto-Replies; Antworten auf
  gemerkte AI-Nachrichten setzen den Thread fort; `#chatbot status`.
  AI-Message-IDs in `src/utils/aiHistory.js` (bounded, 500).
- **Security (1174569):** `npm audit` 0. Updates u. a. axios 1.21.1, sharp
  0.35.5, follow-redirects 1.16.3, brace-expansion 1.1.22, moment 2.31.0,
  music-metadata 11.16.1. Overrides: `axios: "$axios"` (entfernt alte
  verschachtelte Kopie aus `translate-google-api`) und `uuid: ^11.1.1`
  (Sequelize). `baileys`/`better-sqlite3` bewusst unangetastet.

### YumBot-Separatestand
YumBot (`https://github.com/direcrace/YumBot-NN_2.git` →
`open-source-yumbot.git`) hat die 5.0.5-Community-Funktionen und den Hotfix
`49ac7bc` (`BOT_UA`-Import in `search.js`). **Die Security-Updates aus
`1174569` sind dort noch nicht portiert** — nur auf expliziten Wunsch machen.

---

## 5. Geplante nächste Schritte — andere Session

### 5.0.6 — „das WIRKLICHE Linux der WhatsApp-Bots"
Idee, noch nicht umgesetzt:
- Klare, **versionierte Plugin-/Addon-Schnittstelle** (Manifest, Registry,
  Hooks/Events, Lebenszyklus `register/enable/disable`). Core liefert nur
  Primitive; Features werden installiert, nicht eingebaut.
- `src/modules/` als echte Registry ausbauen (analog `registerProvider()` im
  Image-Resolver), Command-Registry mit Metadaten/Prioritäten.
- Addon-Install/Update ohne Core-Fork; Config-Schema + Migrationen.
- Versionspolitik klären: Core-Version vs. Addon-Versionen, Upgrade-Pfad 5.0.5 → 5.0.6.
- **Keine Community-Features in den Core.** YumBot bleibt die Demo-Distro.

### „Onyx from scratch" (eigener Branch, eigene Session)
- Branch-Vorschlag: `onyx-from-scratch` (noch **nicht** angelegt).
- Ziel: minimaler Bootstrap ohne X-Asena-Historie, gleiche Identität und
  Interfaces, nur Core. Kein Blind-Kopieren alter Dateien.
- Erst Scope/ABI/Test-Skelett definieren, dann Branch anlegen. Nicht in einer
  Session mit anderen grossen Refactors mischen.

### Offene Fragen an den User
1. Security-Updates auch nach YumBot zurückportieren? (aktuell: nein)
2. Exakter Scope + Branch-Name für „Onyx from scratch"?
3. Soll 5.0.6 ein Versionssprung mit Addon-ABI oder nur ein Refactor sein?

---

## 6. Praktische Fallen / Lessons learned

- `BOT_UA` in `src/plugins/search.js` muss importiert sein (in YumBot mit
  `49ac7bc` gefixt). Bei Ports nicht vergessen.
- npm 12 löst verschachtelte Overrides für `translate-google-api` nicht zuverlässig
  auf → globaler `axios: "$axios"`-Override verwenden.
- axios 1.x hat getrennte ESM-/CJS-Instanzen. Für Mocks in CJS-Paketen die
  **CJS**-Instanz patchen (`createRequire`), sonst geht der Call live raus.
- Hosting-IPs: Pinterest/Openverse liefern oft 403 → Cooldown greift,
  `PINTEREST_ENABLED=off` ist der saubere Notfall.
- `#chatbot off` darf nicht durch beliebige Reply-Heuristiken umgangen werden;
  nur gemerkte AI-Message-IDs dürfen die Tore passieren.
- Dashboard-Token nie in Chat/Screenshots posten; bei Verdacht neu setzen.
- Friend-/Device-Pairing ist historisch ungelöst (Session abgelaufen) und kein
  Core-Thema.
- Altes Repo `yumbot-nn` enthält Secrets in Zip-Artefakten → niemals öffentlich
  machen, nicht Löschen erzwingen (403 ohne Admin-Rechte).
