# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Onyx Mini ToS flagging & enforcement.** New always-on monitor (`src/multi/miniMonitor.js`) evaluates every outbound message from a linked Onyx Mini against ToS rules: repeat-flood (20), DM fan-out (30), mass-mention (25), link-blast (15), scam/phishing (40), harassment (30 severe / 10 mild), illegal-sale (critical 120), CSAM (critical 100). Critical rules suspend immediately; cumulative 5-min window score ≥ 80 suspends, ≥ 30 warns. Flags persist in BotKV (`mini_flags`), enforce a 30-day GDPR retention purge, and are configurable via `MINI_MONITOR=off`, `MINI_FLAG_WARN` (30), `MINI_FLAG_SUSPEND` (80), `MINI_FLAG_WINDOW_MS`, `MINI_FLAG_RETENTION_DAYS`.
  New owner commands: `#flags <number>`, `#resolveflag <number> <id|all>`, `#suspend <number> [reason]`, `#unsuspend <number>`. Suspended Minis are blocked from respawn and `#pair`; `sessionManager` gains suspend/unsuspend lifecycle, respawn guard, and hook (`resetMiniState`) to avoid stale-score re-suspension.
- **Dev console** — full operator console for ONYX itself and all Onyx Minis across three surfaces:
  - Web: `GET /ui` + JSON API (`/api/status`, `/api/action`, `/api/help`) + SSE log stream (`/api/events`) served by the ops HTTP server (token-required, default `127.0.0.1:9000`, env `ADMIN_HTTP_PORT`/`ADMIN_HTTP_TOKEN`/`ADMIN_HTTP_HOST`; `/health` stays open).
  - Chat: `#dev` (bilingual overview: main + Minis + open flags), `#minilog <number> [lines]` (tail a Mini's console output).
  - Terminal: `status`, `minis`, `minis suspend/unsuspend/remove/respawn`, `flags <n>`, `flags clear <n> [id|all]`, `logs [n]`, `logsgrep <text>`, `panic`, `reboot`, `shutdown`, `sendtest <target> [mini]` (existing Q/R/A shortcuts kept).
  Backing it: `src/utils/consoleRing.js` (bounded capture ring, `DEV_CONSOLE_LOG_MAX`=2000, SSE subscribers) and `src/enterprise/devConsole.js` (single `runDevAction(action, params)` action bus + snapshot + embedded HTML UI).
- **Dashboard v2** — the old single-page HTML web console is replaced by a real static dashboard (`src/enterprise/dashboard/`), served at `GET /ui` (static `.css`/`.js`/`.svg` assets served pre-auth, token-protected HTML + API surface). Seven panes: **Overview** (live cards + SVG sparklines), **Minis** (per-mini status, ToS score/threshold, suspend/respawn/remove, inline detail), **Flags** (auditable ToS flag records with rule/severity filters + resolve), **Logs** (SSE live console stream with filter/pause), **Audit** (action trail), **Terminal** (in-browser terminal sharing the same `runDevCommandText` command bus as the TTY, with panic/reboot/shutdown guarded behind an "arm danger" toggle), and **Settings** (mode pills, feature-flag toggles, global ban management). Everything drives the same `runDevAction` action bus via `POST /api/action`.
  - Backend: `src/enterprise/statsStore.js` — in-memory sparkline series (360 pts ≈ 6 h) + **BotKV-persisted hourly aggregates** (`stats_hourly`, 7-day retention) for traffic in/out/fails, commands, errors, jobs. `src/enterprise/devTerm.js` — pure `runDevCommandText(line)` shared by TTY and web terminal (old duplicated formatters removed from `handler.js`). `src/system/corePanic.js` now tracks lifetime traffic totals (`Live.totals {in,out,fails,lastSendMs}`).
  - New action-bus commands: `mode.set`, `flags.set`, `bans.list/add/remove`, `dev.term`. New endpoints: `GET /api/dashboard`, `GET /api/stats`, `GET /api/bans`. Env knobs: `STATS_SAMPLE_MS` (60 s), `STATS_SERIES_MAX` (360), `STATS_HOURLY_RETENTION_HOURS` (168).

### Changed

- systemWatch panic thresholds retuned to bot-process CPU: warn `cpuWarn` 70, panic `cpuPanic` 160 (≈1 hot core / ≈2 hot cores); host CPU stays warn-only (~92). CPU sampling is pure-JS (`process.cpuUsage()` deltas) — Windows perf counters are unreliable on this host locale.
- Legal transparency: `#pair` consent and the Mini linked-DM rules now include no-warranty ("AS-IS, no guarantees") wording in EN + DE.
- i18n: only `en` / `de` remain (Indonesian & Hindi removed); all inline replies now bilingual via `#lang`

### Fixed

- **Pairing re-links actually work again.** Re-pairing a number that previously had a session reused its stale `sessions/<number>.db` creds, so the account logged right back out (401) seconds after scanning. `provisionSubSession` now wipes the old auth state before requesting a fresh pairing code.
- **`#pair` surfaced the wrong error.** A suspended number reported "already linked" instead of the suspended notice because the live-map check ran before the suspended-index check. Order fixed (index suspend is checked first) so `#pair`, `#suspend` and `#unsuspend` agree with each other.
- **Failed/logged-out/forbidden numbers were stuck as "already linked" forever.** They may now be re-linked with `#pair`, and `failed` sessions get one more chance on boot (`respawnAllSubSessions` includes them). A new `forbidden` (403) status replaces the endless retry loop for dead accounts; 401 still marks `logged_out`.
- **`#unsuspend` produced a zombie socket.** The suspended entry stayed in the in-memory map with a closed socket, so "resumed" minis never reconnected. `unsuspendSubSession` now drops the zombie and respawns fresh creds.
- **Flaky pairing timing.** Pairing requested a code after a fixed 2.5 s wait; on a slow/flaky connection that fails. It now waits up to 12 s for the socket to open (clear `NOT_READY` error otherwise) and rolls back half-paired entries so retries are instant.
- **`#instances` and the web console now show the full index** (suspended/forbidden/failed/logged-out minis incl. suspend reason), not only currently-running sockets. Stale `linking` ghosts are pruned on boot.
- Web console: stale `linking`/`forbidden` states render correctly with suspend reason next to the status.
- Global owner-only ban/unban (`#ban` / `#unban` / `#banlist`) — silently blocks bot usage, no group kicks
- Selfbot always on (no toggle); bot DMs are no longer ignored by command handling
- `#img` switched to Pinterest's legacy search API (returns real `i.pinimg.com` image URLs)
- **Bugfix:** `#kick` no longer collides with the fun "kick" reaction command (`#kick` = remove member again)
- **Bugfix:** LID-safe member removal — all auto-kicks (warn limit, strict, anti-bot) now resolve the participant's phone JID, so "kick at N strikes" actually fires
- **Bugfix:** warn/strict spam counters are capped at the threshold (no more "warning 15/2" floods)
- **Bugfix:** group kill-switch `#bot off` could not actually turn the bot off (inverted state compare replied "already on") — toggle fixed; owner can now always on/off
- **Bugfix:** system watch no longer panics on **host** CPU. Originally it measured the whole desktop's CPU%, so on a busy gaming/streaming machine it force-stopped the bot whenever the PC hit ~95% — a false positive. It now measures the **bot process's own** CPU usage (idle ≈ 0% even while the host runs at 60-99%) and only escalates on bot-level pressure. Host CPU is warn-only. Retuned panics: bot CPU > 160%, RAM > 99%, disk < 300 MB.

### Added

- **Legal documents + commands** — `terms-of-service.md` and `privacy-policy.md` at the repo root. New `#terms` / `#privacy` commands serve a concise bilingual summary by default, or the complete document with `#terms full` / `#privacy full` (chunked + paced so a long doc never trips the send-burst core panic). `#pair` now shows the required consent notice *before* creating any session, and every newly-linked Mini DM also points at the documents. Contact info (WA +49 160 95344704, discord **directorace**, email **teamtestdevteam@gmx.net**) is in both documents and on the summary replies.
  - **Retention cap (GDPR):** logs tied to a flag that is **not** a confirmed violation are automatically purged after **30 days**; confirmed-violation logs are kept only for resolution of that case (see Privacy Policy §6).
  - **No-warranty notice for Onyx Mini:** the `#pair` consent and the newly-linked Mini DM now explicitly state the bot is provided "as is", the user is solely responsible for their own WhatsApp account and compliance with WhatsApp's ToS, and the operator is not responsible for any action WhatsApp takes against the number (including bans) or for data loss.
- **Core panic v2 — outbound send-burst + host health watch**
  - New auto-panic condition: if the bot sends **more than 3 TEXT messages inside 2 seconds** (default `CORE_PANIC_SEND_BURST=4`, `CORE_PANIC_SEND_WINDOW_MS=2000`) it's a runaway reply/spam loop → immediate CORE PANIC. Counting is socket-level (`armSendMonitor` on main + all Minis), so `#react`/media don't count — only real messages.
  - **System watch (`src/system/systemWatch.js`)** — the bot's eyes on the box: samples host CPU, RAM, disk free, and its own RSS every 15 s. Sustained anomalies trigger a 🟡 warning once in the system log group (bot CPU > 80%, host CPU > 92%, RAM > 90%, disk < 1 GB, RSS > 1000 MB), and extreme sustained conditions escalate through the core panic path (real `pm2 stop`): bot CPU > 180%, RAM > 99%, disk < 300 MB. Panics key off the **bot process's own** load — a busy desktop (games/streaming) never falsely stops the bot; host CPU is warn-only. On Windows the bot's CPU% is read via the PerfProc counter (like Task Manager / pm2).
  - Owner command **`#sys`** shows a live host snapshot (host + bot CPU, RAM, disk, PID, uptime, RSS) plus the current core-panic / system-watch thresholds.
  - Env-tunable: `SYSTEM_WATCH=off`, `SYSTEM_WATCH_INTERVAL_MS`, `SYSTEM_WATCH_CPU_WARN/PANIC` (bot CPU), `SYSTEM_WATCH_HOST_CPU_WARN`, `SYSTEM_WATCH_RAM_WARN/PANIC`, `SYSTEM_WATCH_DISK_WARN_MB/PANIC_MB`, `SYSTEM_WATCH_RSS_WARN_MB`, `SYSTEM_WATCH_SUSTAINED`.
  - Panic message now also reports the outbound burst; `forceCorePanic` gained a `source` param (system vs manual). Grace period + settle window + watchdog all still apply to the new conditions.
- **Core panic (kernel panic safety mechanism)** — if the runtime gets overloaded, the bot announces a `CORE PANIC` in the system log group and then does a real `pm2 stop` — protecting the backend and preventing the bot from spamming itself. Owner command `#corepanic` forces it manually (forced, like Linux sysrq). Built to always work in 3 layers: an in-process monitor (tight limits: event-loop delay > 2000 ms, heap > 900 MB, or 150 incoming msgs/min, each sustained over 2 checks ~5s apart), a detached **watchdog child process** that force-stops the bot if the main loop is fully wedged (stale heartbeat > 12s), and a hard-kill deadline if `pm2 stop` fails. Crash guards log and can panic on `uncaughtException`. Env-tunable: `CORE_PANIC=off`, `CORE_PANIC_EL_DELAY`, `CORE_PANIC_MEMORY_MB`, `CORE_PANIC_MSG_RATE`, `CORE_PANIC_SUSTAINED`, `CORE_PANIC_GRACE_MS`, `WATCHDOG=off`. After a panic the monitor enters a 10 min grace period to avoid restart boot-loops.
- **Anti-sticker** — `#antisticker on|off|delete|warn|strict|kick|ban` (group moderation): any sticker is removed/acted on
- **Group kill-switch** — `#bot off` makes the bot completely silent in a group (no commands, guards, or chat replies); owner/sudo still work, admins can re-enable with `#bot on`; `#bot status` shows the state
- **`#reboot` / `#shutdown`** — owner-level system controls for the main bot (pm2 restart / true `pm2 stop`) and per-Mini: a Mini's own user can reboot (reconnect in place) or shut down (remove + logout their session) their Onyx Mini
- **Onyx Mini (sub-session pairing)** — anyone can DM the main bot `#pair <number>` to link an independent, isolated bot attached to their own WhatsApp account. The main spawns an in-process secondary socket, requests a pairing code for that number, and DMs the code + instructions to the requester. When linking completes the friend gets a ✅ and the owner gets a notice. Sub-sessions persist across restarts (`sessions/`) and auto-respawn on boot.
  - Restricted: sub-bots cannot create their own log group / run owner / management commands, and never count as owner.
  - Banned users cannot get a pairing code (`#pair` refuses them).
  - Owner management: `#instances` (list) and `#unpair <number>` (remove).
  - Handles WhatsApp's `515 restartRequired` signal by reconnecting immediately with the freshly-paired creds — pairing completes only after that reconnection.
  - `#pair` is DM-only (groups are refused).

### Planned

- Automated tests for ACL, flags, and plugin registration

## [4.0.0] - 2026-07-24

Major Baileys **7.0.0-rc13** rewrite on `main` (previous line preserved as `pre-v7`).

### Added

- Lean Baileys socket (no full history sync, offline on connect, safe reconnect)
- Dual auth: **better-sqlite3** (default) or **Postgres** via `DATABASE_URL`
- BotKV settings (mode, sudo, lang, sticker EXIF, group settings)
- System **log group** onboarding (`#setup`, `#createlog`, `#setlog`)
- Media plugins: stickers + EXIF, YouTube (`youtubei.js`), tools, social DLs
- Moderation: welcome/goodbye, antilink, antispam, warn/mute/kick
- Productivity: notes, reminders, polls
- Enterprise: audit, feature flags, RBAC, policies, metrics, job queue, backup
- Optional admin HTTP (`/health`, `/metrics`, `/audit`, …)
- Public/private bot mode and sudo ACL
- Multi-language strings (`en` / `id` / `hi`)

### Changed

- Command prefix and UX helpers (`#menu`, react-ack, typing)
- README rewritten for the v4 architecture

### Security

- User-facing errors stay generic; stacks go to the system log group only
- Spoof mitigations on `messages.upsert` (notify-only, ignore `requestId`)

[Unreleased]: https://github.com/Neeraj-x0/X-Asena/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/Neeraj-x0/X-Asena/releases/tag/v4.0.0
