# Changelog: X-Asena → Onyx Core

This changelog documents **everything that is different in `onyx-core`** compared to its upstream base **X-Asena v4.0.0**. Onyx Core is a heavily extended fork of X-Asena: it renames the project, adds multi-account ("Onyx Mini") support, a web dashboard / dev console, self-protection ("core panic") systems, AI chat, games/economy, expanded moderation, and replaces the language set with English + German.

**Project identity changes**

|                      | X-Asena                                   | Onyx Core                                                                                         |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| package name         | `x-asena`                                 | `onyx-utility-core`                                                                               |
| version              | `4.0.0`                                   | `5.0.3`                                                                                           |
| description          | Open Source WhatsApp Bot (Baileys ^7.x.x) | "Onyx Utility Core - WhatsApp Bot Using Baileys 7.x.x with LM Studio AI integration AND groq API" |
| bot name             | `X-Asena`                                 | `ONYX UTILITY CORE` (runtime-changeable)                                                          |
| default sticker pack | `X-Asena`                                 | `Onyx`                                                                                            |
| languages            | `en` / `id` / `hi`                        | `en` / `de`                                                                                       |

---

## 1. New core systems

### 1.1 Onyx Mini — multi-account sub-sessions (`src/multi/`)
Friends can link **their own independent bot** without sharing the main number:
- `#pair <number>` (DM only) — main bot spawns an in-process sub-session, requests a WhatsApp pairing code, and DMs it. New export: `useStandaloneAuthState()` in `src/database/authState.js` / `authSqlite.js` (isolated auth DB per number under `sessions/<number>.db`, **never** attaches BotKV).
- `#instances` (owner) — list linked Minis; `#unpair <number>` (owner) — remove/logout one.
- `#reboot` / `#shutdown` — Mini's own user can reboot (reconnect in place) or shut down (remove + logout) their Mini.
- Minis **cannot** run ~22 owner/management commands (`SUB_BLOCKED_COMMANDS` in `messages/handler.js`), never create a log group, and never count as owner.
- Respawn logic in `src/multi/sessionManager.js`: auto-respawn on boot, exponential backoff, immediate reconnect on WhatsApp `515 restartRequired`, terminal handling for `401 logged_out` / `403 forbidden` / `failed` states, zombie-socket fixes.
- Banned users cannot get a pairing code.
- Env: `CRASHED_WHITELIST` (for the crashed plugin).

### 1.2 Core Panic — self-protection safety mechanism (`src/system/corePanic.js`)
Three-layer "kernel panic" that does a real `pm2 stop` to protect the backend and prevent self-spam:
1. **In-process monitor** (every ~5 s): event-loop delay > 2000 ms, heap > 900 MB, inbound rate > 150 msgs/min, and a new **outbound send-burst** condition (> 4 text messages in 2 s → runaway reply loop), each sustained over N checks.
2. **External watchdog** (`src/system/watchdog.js`, detached child process): force-stops the bot if the heartbeat file goes stale > 12 s even when the main loop is fully wedged (`taskkill` fallback; logs to `panic-watchdog.log`).
3. **Hard kill deadline**: if `pm2 stop` fails the process force-kills itself within ~8 s.
- 10-minute grace period after a panic prevents boot-loops. `watchSwitch.js` persists a runtime on/off (`#syswatch on/off`).
- Env: `CORE_PANIC`, `CORE_PANIC_EL_DELAY`, `CORE_PANIC_MEMORY_MB`, `CORE_PANIC_MSG_RATE`, `CORE_PANIC_SEND_BURST`, `CORE_PANIC_SEND_WINDOW_MS`, `CORE_PANIC_SUSTAINED`, `CORE_PANIC_GRACE_MS`, `CORE_PANIC_SETTLE_MS`, `WATCHDOG`, `CORE_PANIC_HB_DIR`.

### 1.3 System Watch — host health monitor (`src/system/systemWatch.js`)
Samples host/bot CPU, RAM, disk, RSS every 15 s. Warn (log-group 🟡, once, deduped) and panic escalation:
- Bot CPU warn 70% / panic 160%; host CPU warn-only 92% (a busy desktop must never false-trigger a stop); RAM warn 90% / panic 99%; disk warn 1 GB / panic 300 MB; RSS warn 1 GB.
- Env: `SYSTEM_WATCH`, `SYSTEM_WATCH_INTERVAL_MS`, `SYSTEM_WATCH_CPU_WARN/PANIC`, `SYSTEM_WATCH_HOST_CPU_WARN`, `SYSTEM_WATCH_RAM_WARN/PANIC`, `SYSTEM_WATCH_DISK_WARN_MB/PANIC_MB`, `SYSTEM_WATCH_RSS_WARN_MB`, `SYSTEM_WATCH_SUSTAINED`, `SYSTEM_WATCH_COOLDOWN_MS`.

### 1.4 Dev Console — terminal + chat + web (`src/enterprise/devConsole.js`, `devTerm.js`, `src/utils/consoleRing.js`)
- **Terminal** (`src/terminal/handler.js` overhaul): full command bus — `status`, `minis` (+ suspend/unsuspend/remove/respawn), `flags`, `flags clear`, `logs`, `logsgrep`, `sendtest`, `panic`, `reboot`, `shutdown`. Old `Q/R/A` shortcuts kept.
- **Chat**: `#dev` (overview), `#minilog <number> [lines]` (tail a Mini's console).
- **Web**: `src/enterprise/dashboard/` SPA at `GET /ui`, JSON API (`GET /api/status`, `/api/dashboard`, `/api/stats`, `/api/bans`, `/api/help`) and SSE live log stream (`GET /api/events`), all driven by one `runDevAction(action, params)` action bus (40 actions).
- `consoleRing.js` intercepts `console.*` into a bounded ring (default 2000 lines, env `DEV_CONSOLE_LOG_MAX`).
- New action-bus commands: `mode.set`, `flags.set`, `bans.list/add/remove`, `dev.term`, `config.set`, `roles.set`, `chats.list`, `send.chat`, `messages.recent`, `main.reconnect`, `pair.request`, `invite.create/list/revoke`, `git.update`, `relink`, `backup.now`, `syswatch.set`.

### 1.5 Web Dashboard v2 (`src/enterprise/dashboard/`)
Replaces the old single-page HTML console with a real static dashboard (7 "sections"):
- **Overview** (live cards + SVG sparklines, stats from `statsStore.js`), **Minis**, **Flags**, **Logs** (SSE), **Audit**, **Terminal** (in-browser, "arm danger" gate for panic/reboot/shutdown), **Settings** (mode, flags, global bans).
- **Fleet view** (`src/enterprise/fleet.js`): one dashboard shows N main instances (`FLEET_PEERS=name:port:TOKEN`), with `/api/fleet` and `/api/proxy/<name>/<api>/*` server-side proxy switching (peer token never sent to browser).
- **Remote** pane: connection lifecycle, "send a message as the bot" composer (from `chatIndex.js`), temporal **message log** (`src/enterprise/messageLog.js`, RAM-only, env `MSGLOG_CAP` 250) with **media cache** (`src/enterprise/mediaCache.js`, `media/<session>/`, `MEDIA_MAX_MB` 25 / `MEDIA_TOTAL_MB` 256, served at `GET /media/<session>/<logId>`, creator-only).
- **Stats**: `statsStore.js` — in-memory sparkline series + BotKV-persisted hourly aggregates (`stats_hourly`, 7-day retention). Env: `STATS_SAMPLE_MS`, `STATS_SERIES_MAX`, `STATS_HOURLY_RETENTION_HOURS`.
- **Invite onboarding** (`src/enterprise/invites.js`): public `GET /invite/<token>` page + `POST /invite/<token>/pair` to provision a Mini without DMing (env `INVITE_TTL_MS` 24 h, `INVITE_MAX_USES` 3, IP rate limits; persists to `sessions/invites.json`).

### 1.6 Admin HTTP auth tiering (`src/enterprise/adminHttp.js`, 22 → 661 lines)
- Two tiers: **creator** (`ADMIN_HTTP_TOKEN`) and **operator** (`ADMIN_OPERATOR_TOKEN`, restricted: no reboot/shutdown/terminal/panic — enforced by `CREATOR_ONLY_ACTIONS`).
- **Remote-control watchdog** (`src/enterprise/rcMonitor.js`): every operator action carries a weight; high rolling score warns then **locks** the operator out (like a mini suspend), with audit + creator DM notification. Danger actions require an armed server-side confirm (90 s TTL). Env: `RC_MONITOR`, `RC_FLAG_WARN` (30), `RC_FLAG_LOCK` (80), `RC_FLAG_WINDOW_MS`, `RC_FLAG_LOCKOUT_MS`, `RC_FLAG_RETENTION_DAYS`.
- `group-wide sends` (group/broadcast) can never fire without explicit arming.

### 1.7 ToS monitoring / enforcement (`src/multi/miniMonitor.js`)
Always-on rule engine to protect against WhatsApp ToS violations, in **two scopes**:
- **Mini scope**: monitors a linked Mini's *outbound* messages → warn (score 30) / suspend (score 80) on a 5-min rolling window.
- **User scope**: monitors normal users' *inbound* messages on the main connection → warn (50) / **global bot ban** (120).
- 8 rules (bilingual EN/DE wordlists): `repeat_flood` (20), `dm_fan_out` (30), `mass_mention` (25), `link_blast` (15), `scam_phish` (40), `harassment` (30/10), `illegal_sale` (critical 120), `csam` (critical 100 — immediate suspend/ban).
- Flags persist to BotKV (`mini_flags`) with 30-day GDPR retention purge.
- Owner commands: `#flags <number>`, `#resolveflag <number> <id|all>`, `#suspend <number> [reason]`, `#unsuspend <number>`.
- Env: `MINI_MONITOR`, `MINI_FLAG_WARN/SUSPEND/WINDOW_MS/RETENTION_DAYS`, `USER_MONITOR`, `USER_FLAG_WARN/BAN/WINDOW_MS/RETENTION_DAYS`.

### 1.8 Creator tier + runtime roles (`src/utils/access.js`, `guard.js`)
- New tier: **creator > owner > admin > mod > user**. All creators are owners.
- `CREATOR_NUMBERS` env + persisted runtime creators/owners in BotKV (`config:owners` / `config:creators`), hydrated at boot (`hydrateRoleNumbers()`) and managed via `#setcreator` / `#setowner`.
- `requireCreator()` gate logs denials (`creator:deny` audit), round-robin playful warning lines ("I'm watching you"), and DMs every creator.
- 4 bot modes now: `public | private | inbox | group` (`inbox` blocks groups, `group` blocks DMs).

---

## 2. New commands

### AI / chatbot (`src/plugins/ai.js`) — LM Studio primary, Groq fallback
- `#chat` (chat with per-user history + system prompt), `#chatbot` (owner, auto-reply toggle), `#aiprompt` (owner, set system prompt), `#aiclear` (clear your history), `#aiuser` (owner, chatbot allowlist).
- Backed by `src/utils/aiHistory.js` (20-message history per user, BotKV persisted).
- `.env`: `LM_STUDIO_MODEL=local-model`, `GROQ_API_KEY`, `GROQ_MODEL`.

### Legal (`src/plugins/legal.js`)
- `#terms` / `#terms full` and `#privacy` / `#privacy full` — bilingual summaries or the complete documents (`terms-of-service.md`, `privacy-policy.md` at repo root), chunked + paced to avoid send-burst panics. Includes no-warranty wording and contact info.

### Ops & system (`src/plugins/ops.js`, `src/plugins/system.js`, `src/plugins/settings.js`)
- `#uptime`, `#version`, `#update` (creator: git pull + npm install + restart), `#restart`, `#logs`, `#health`, `#config` (runtime prefix/botname/mode/policies), `#permissions`, `#whoami`, `#session`, `#sessions`, `#ratelimit`, `#diagnostics`, `#debug`, `#setcreator`, `#creatormenu`, `#setowner`.
- `#reboot`, `#shutdown`, `#sys` (host snapshot + thresholds), `#dev`, `#minilog`, `#syswatch`, `#corepanic` (force a panic / `pm2 stop`).
- `#anticall` (global, auto-reject calls with a DM reply) and `#alwaysonline` (global presence).

### Games & economy (`src/plugins/games.js`, `src/utils/economy.js`, `src/utils/gameCore.js`)
- Economy: `#job`, `#daily`, `#balance`/`#bal`, `#rob`, `#gamble`, `#rich` (top-10 leaderboard). No-signup wallets in BotKV with serialized writes.
- Games: `#dice`, `#coin`, `#rps`, `#ttt` (tic-tac-toe vs bot or PvP), `#guess`, `#hangman`, `#stopgame`. Turn-based play routed from plain (non-command) messages via `routeGameTurn()`.

### Search (`src/plugins/search.js`)
`#movie` (OMDB), `#anime` (Jikan), `#lyrics`, `#github`, `#translate` (translate-google-api), `#qr` (qrcode), `#img` (Pinterest legacy search API → real `i.pinimg.com` URLs), `#weather` (Open-Meteo), `#wiki`, `#reddit`, `#npm`, `#define`, `#news` (NEWS_API_KEY), `#search` (DuckDuckGo).

### Fun & novelty (`src/plugins/fun.js`, `src/plugins/bloat.js`, `src/plugins/voice.js`)
- `#cal`, `#solve`, `#ebinary`, `#dbinary`, `#mock`, `#flirt`, `#emix`, plus 25 anime reaction images from waifu.pics (`#cry`, `#hug`, `#slap`, `#bonk`, …).
- "BLOAT CORE" (hidden from menu): `#rate`, `#ship`, `#dice`, `#flip`, `#say`, `#screm`, `#how`, `#pp`, `#mood`, `#8ball`, `#rng`, `#boo`, `#sus`, `#vibe`, `#amogus`, `#time`, `#date`, `#bloatmode`.
- Voice changer (FFmpeg audio filters, reply to audio): `#bass`, `#blown`, `#deep`, `#earrape`, `#fast`, `#fat`, `#nightcore`, `#reverse`, `#robot`, `#slow`, `#smooth`, `#tupai`.

### Utility extra (`src/plugins/utility-extra.js`)
- `#fetch` (owner, URL/API, 4 MB cap), `#vv` (recover view-once media), `#del` (admin, delete a message).

### Misc
- `#todo` (productivity.js) — per-user to-do lists (`src/utils/todos.js`).
- `#bot on|off|status` (menu.js) — **per-group kill-switch** (admin-gated) via `processGroupMessageGate()` in `groupGuards.js`.
- `#1` … `#22` (meropic.js) — send bundled MeroPic images (`src/assets/meropic/`).
- `#bot` menu type, image-based menu header (`src/assets/menu.png` with box-drawn header, uptime/command-count/owner/mode footer).

### Crashed plugin (`src/plugins/crashed/`) — isolated "update" command set
- Hooks `messages.upsert` directly, bypassing the normal command system; whitelist via `CRASHED_WHITELIST` env; plays `dms.mp3` / `take.mp3` audio before destructive ops.
- `#crashed ping|menu|ip|ipsafe|listgroups|listcoms|setcom|setloggroup|nuke|selfpromote|take|seetaken|groupinfo|blacklist`.
- **Pre-existing, not new in this fork:** the crash/X-Asena family plugin lineage — kept here for completeness.

---

## 3. Moderation & group features (changed files)

### 3.1 `src/utils/groupSettings.js` — massively expanded per-group defaults
New default settings: `antilinkAction`, `antispamAction` (now `delete|warn|strict|kick|ban`), `antitag`, `antitagAction`, `antibot`/`antibotAction`, `antisticker`/`antistickerAction`, `antidelete`, `autoread`, `autoreact`, `autotyping`, `alwaysonline`, `onlyadmin`, `nsfw`, `autoapprove`, `chatbot`, `botDisabled`, `banned[]` (per-group ban list), `muted`.

### 3.2 `src/messages/groupGuards.js` — rewritten guard pipeline
- New checks: global/group **ban**, **onlyadmin** gate, expanded **punishment engine** (`runPunishment()` with warn/strict/kick/ban actions), **antibot** detection (`isSenderBot()`), post-message automation (auto-react/auto-read/auto-typing).
- New `processGroupMessageGate()` for the `#bot off/on/status` kill-switch.

### 3.3 `src/plugins/moderation.js` — new commands (all type "moderation")
`#antitag`, `#antibot`, `#antisticker` (`on|off|delete|warn|strict|kick|ban`), `#antidelete`, `#onlyadmin`, `#nsfw`, `#autoapprove` / `#autoaccept`, `#autoread`, `#autoreact`, `#autotyping`, `#alwaysonline`, `#ban` / `#unban` / `#banlist` (global bot ban, owner), `#gcstatus`.
`#antilink`/`#antispam` upgraded with action modes; `#kick`/`#warn` now LID-safe via new `kickUser()` / `resolveParticipantJid()` in `src/utils/group.js` (fixes "kick at N strikes").

### 3.4 `src/utils/moderation.js` — new `hasEveryoneMention()` (anti-@everyone) and anti-sticker blocking.

### 3.5 `src/events/groupParticipants.js` — auto-approve pending join requests when `autoapprove` is on.

---

## 4. Behavior / plumbing changes

- **Global user ban check** + **ToS user scoring** silently stop banned/flagged users in `messageHandler()`.
- **Selfbot always on** — bot DMs are no longer ignored (only bot messages *in groups* are skipped).
- `tryChatbotReply()` exported from `handler.js`; non-command messages go `game turn → chatbot reply`.
- Anti-delete listener in `connection.js` (recover deleted messages when `antidelete` on), anti-call auto-reject, per-group/global always-online, chat-index harvesting (`chats.upsert` / `contacts.upsert` / group sync for the Remote picker).
- Runtime prefix / bot name — `src/config/constants.js` now exposes `getPrefix()`, `getBotName()`, `loadRuntimeConfig()`, `saveRuntimePrefix()`, `saveRuntimeBotName()`; `BOT_INFO.PREFIX`/`NAME` became getters; `rebuildCommandPatterns()` in `src/plugins.js` recompiles regexes after a prefix change.
- `#tts` (Google TTS) **removed** (replaced by `#translate` + TTS inside voice plugin); `youtubei.js` downgraded `^18` → `^17.2.0` and `ytdl.js` **rewritten** to use the library's built-in `yt.download()` (manual chunked client-fetch + ffmpeg merge removed).
- `i18n.js`: `id`/`hi` dictionaries removed, complete German (`de`) dictionary added; new `tr(en, de)` helper everywhere; `sendError()` translates i18n keys. BotKV lang whitelist updated to `["en","de"]`.
- `validation.js` returns error keys instead of resolved messages (translation moved to callers).
- All user-facing strings across plugins wrapped in `tr()` (bilingual EN/DE).
- `src/enterprise/queue.js`: added pause/resume (`setQueuePaused()`, `queueStats().paused`).
- `config.js` unchanged; `serialize.js`, `cache.js`, `lid.js`, `notes.js`, `reminders.js`, `media.js`, `logGroup.js`, `logger.js`, plus `audit.js`, `backup.js`, `flags.js`, `metrics.js`, `policy.js`, `rbac.js`, `authPostgres.js`, `bufferJson.js` are **byte-identical** (only line-ending differences).

---

## 5. Dependencies (package.json)

| Change         | Package                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Added**      | `node-fetch@^3.3.2`, `qrcode@^1.5.4`, `translate-google-api@^1.0.4`                                                                                           |
| **Removed**    | `google-tts-api@^2.0.2`                                                                                                                                       |
| **Downgraded** | `youtubei.js@^18.0.0` → `^17.2.0`                                                                                                                             |
| Unchanged      | baileys 7.0.0-rc13, better-sqlite3, sequelize, pg/pg-hstore, async-mutex, axios, dotenv, file-type, fluent-ffmpeg, node-webpmux, pino, qrcode-terminal, sharp |
| Added dev      | — (nodemon kept)                                                                                                                                              |
| Added meta     | `allowScripts` section (baileys/better-sqlite3/protobufjs install scripts)                                                                                    |

---

## 6. New / changed env vars

| Variable                                                                                                          | Purpose                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `CREATOR_NUMBERS`                                                                                                 | Creator (host) numbers — tier above owner    |
| `BOT_NAME`, `BOT_PREFIX`                                                                                          | Runtime-changeable bot display name + prefix |
| `LM_STUDIO_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`                                                                   | AI backend (LM Studio + Groq fallback)       |
| `ADMIN_OPERATOR_TOKEN`                                                                                            | Restricted operator tier for the dev console |
| `RC_MONITOR`, `RC_FLAG_WARN`, `RC_FLAG_LOCK`, `RC_FLAG_WINDOW_MS`, `RC_FLAG_LOCKOUT_MS`, `RC_FLAG_RETENTION_DAYS` | Remote-control watchdog                      |
| `MSGLOG_CAP`                                                                                                      | RAM-only message log capacity (250)          |
| `DEV_CONSOLE_LOG_MAX`                                                                                             | Console capture ring capacity (2000)         |
| `FLEET_PEERS`, `FLEET_TTL_MS`                                                                                     | Multibox fleet view                          |
| `STATS_SAMPLE_MS`, `STATS_SERIES_MAX`, `STATS_HOURLY_RETENTION_HOURS`                                             | Dashboard stats sampling                     |
| `MEDIA_MAX_MB`, `MEDIA_TOTAL_MB`                                                                                  | Temporal media cache budget                  |
| `INVITE_TTL_MS`, `INVITE_MAX_USES`, `INVITE_MAX_IP_ATTEMPTS`, `INVITE_IP_WINDOW_MS`                               | Invite-link onboarding                       |
| `CORE_PANIC*`, `WATCHDOG`, `SYSTEM_WATCH*`                                                                        | Safety monitors                              |
| `MINI_MONITOR*`, `USER_MONITOR*`                                                                                  | ToS monitor thresholds                       |
| `CRASHED_WHITELIST`                                                                                               | Crashed plugin access                        |

---

## 7. Bug fixes included in Onyx Core

- Re-pairing a previously-linked number reused stale creds and logged back out (401) — stale auth state is now wiped before a fresh pairing code.
- `#pair` surfaced "already linked" for suspended numbers — suspend index now checked first.
- Failed/logged-out/forbidden numbers stuck "already linked" forever — they can be re-linked; 403 gets a terminal `forbidden` status (no endless retry).
- `#unsuspend` produced a zombie socket — now drops it and respawns fresh creds.
- Flaky pairing timing (fixed 2.5 s wait) — now waits up to 12 s for the socket, roll-back for half-paired entries.
- `#instances` / web console show the full index (suspended/forbidden/failed/logged-out incl. reason); stale `linking` ghosts pruned on boot.
- `#kick` no longer collides with the fun "kick" reaction command.
- LID-safe member removal — all auto-kicks resolve the participant's phone JID.
- Warn/strict spam counters capped at threshold (no more "warning 15/2" floods).
- Group kill-switch `#bot off` actually turns the bot off (inverted state compare fixed).
- System watch no longer panics on **host** CPU (measured bot process CPU instead) — a busy desktop no longer force-stops the bot.
- `#tts` removed when a native effect set appeared; `#img` switched to Pinterest's legacy API returning real `i.pinimg.com` URLs.
- Selfbot always on; bot DMs are processed by command handling.

---

## 8. New root-level files / directories (not in X-Asena)

| Entry                                      | Type    | Notes                                                            |
| ------------------------------------------ | ------- | ---------------------------------------------------------------- |
| `terms-of-service.md`, `privacy-policy.md` | docs    | GDPR/legal documents served by `#terms` / `#privacy`             |
| `.env`                                     | config  | live environment (repo has `.env.example`)                       |
| `database.db*`                             | runtime | SQLite auth DB                                                   |
| `media/`                                   | runtime | temporal media cache (wipe on boot)                              |
| `sessions/`                                | runtime | per-Mini auth DBs + `instances.json` + `invites.json`            |
| `node_modules/`                            | runtime | installed deps                                                   |
| `panic-watchdog.log`                       | runtime | watchdog output                                                  |
| `src/assets/`                              | assets  | `menu.png`, `dms.mp3`, `take.mp3`, `meropic/1..22` images        |
| `.gitignore`                               | changed | added `sessions/`, `media/`, `desktop.ini`, `panic-watchdog.log` |
