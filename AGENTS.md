# AGENTS.md — Onyx Utility Core Project Constitution

Verified against the repository on **2026-11-18**: `main` at `9625c29`, tag `v5.0.5`, GitHub release `v5.0.5`.

This file is read at the beginning of future OpenCode sessions. It is a persistent architectural constitution and an operational instruction set — not a feature wishlist. If the implementation contradicts a statement here, the implementation is the source of truth: inspect it, then update this file.

---

## 1. Identity — non-negotiable

- Package name: `onyx-utility-core`
- Repository: `https://github.com/direcrace/Onyx-utility-core.git`
- Runtime identity: `ONYX UTILITY CORE` (runtime-changeable via `config:botname`)
- Multi-account naming: **Onyx Mini** (sub-sessions). Historical name: **Onyx Core**. Keep both exactly as they are.
- Docker image / container: `onyx-utility-core:<version>` / `onyx-utility-core`
- PM2/systemd/Panel identities: `PM2_APP_NAME`, `PM2_ID`, `name`, `onyx-utility-core` — unchanged
- Author: `Nero Venero <Puma.yt11@gmail.com>`
- License: **N-SAL-1.0**
- Upstream: **X-Asena v4.0.0**, originally MIT-licensed. Preserve all applicable upstream notices and attribution obligations.

No changes to legal terms, attribution, repository identity, ownership or historical names without explicit authorization.

## 2. Architectural objective

ONYX UTILITY CORE is a modular WhatsApp bot platform. Its long-term goal is to be the Linux-like foundation of the WhatsApp bot ecosystem.

The analogy is architectural, not literal:

| Analogy | Meaning in this project |
|---|---|
| Onyx Core | Platform foundation — runtime, primitives, infrastructure |
| Addons | Optional functionality installed on top of the platform |
| Providers | Replaceable integrations behind a stable interface |
| Distribution | A complete bot built on Onyx |
| YumBot | Reference distribution (separate repository) |

Onyx must **not** become a community-specific bot. It provides a stable base on which independent WhatsApp bots can be built.

Intended layering:

- **Core:** runtime, session management, authentication/RBAC, logging/audit, event handling, configuration, command infrastructure, addon lifecycle, update infrastructure, generic utilities.
- **Core services:** reusable capabilities — AI interfaces, image resolution, search, media handling, storage abstractions.
- **Providers:** standardized external integrations, replaceable without unrelated core changes.
- **Addons:** optional functionality — games, economy, extra AI integrations, music, custom moderation, analytics, distribution-specific commands.
- **Distributions:** independent bot configurations and feature collections.

**Current implementation is not yet the target architecture.** Games/economy, AI, search, legal and other features are currently bundled as ordinary plugins under `src/plugins/`. `src/modules/` currently contains only `imageResolver/`. There is no addon manifest, addon ABI, lifecycle manager or general addon registry yet. Do not describe existing modules as independent addons.

YumBot is a separate repository. Never modify, backport into, or synchronize with YumBot without explicit approval.

## 3. Actual repository map

| Path | Actual responsibility |
|---|---|
| `index.js` (root) | Real entry point: platform report, auth init, plugin loading, signal handlers, admin HTTP, WhatsApp connect, Mini respawn, core panic, system watch |
| `config.js`, `.env.example` | Database/backend configuration and documented environment variables |
| `src/plugins/` | All command files; each file calls `command(...)` at import time |
| `src/plugins.js` | The one command registry: `CommandBuilder`, `command()`, `getCommands()`, `findCommand()`, `getMenuCommands()`, `rebuildCommandPatterns()` |
| `src/messages/` | Inbound pipeline: `serialize.js`, `handler.js` (command execution chain), `groupGuards.js` |
| `src/multi/` | Onyx Mini sub-sessions (`sessionManager.js`) and ToS/flag engine (`miniMonitor.js`) |
| `src/enterprise/` | Dashboard, dev console/action bus, audit, flags, policy, RBAC, queue, metrics, invites, fleet, backups, message log, media cache, RBAC watchdog |
| `src/system/` | Core Panic, Watchdog, System Watch, platform/supervisor detection |
| `src/database/` | Baileys auth state (SQLite/Postgres), BotKV settings store, JSON buffer helpers |
| `src/utils/` | Shared helpers plus zeroth-tier guards (`access.js`, `guard.js`, `group.js`, `lid.js`, `message.js`, etc.) |
| `src/modules/` | Core services; currently only `imageResolver/` |
| `src/config/` | Runtime prefix/name, constants, media limits |
| `src/events/`, `src/socket/`, `src/onboarding/` | Group participant events, Baileys connection, setup flow |
| `src/terminal/` | Signal/shutdown handlers only — **no interactive TTY console**; maintenance is `clear.js`, chat commands or web console |
| `clear.js` | Maintenance CLI (`--prune`, `--reset-settings`, `--auth`, `--wipedb`, `--status`, `--platform`, `--restart`, `--shutdown`) |
| `test/` | `test/imageResolver.test.mjs` — mocked `node:test` suite |

`src/index.js` is a thin re-export shim (`commands`, `command`), not the application entry point.

## 4. Established mechanisms — respect, do not replace casually

### 4.1 Command registration and dispatch

- The only registration API is `command(commandInfo, handler)` from `src/plugins.js`. Registration happens as a side effect of importing `src/plugins/*.js` from the root `index.js`.
- The registry holds pattern/name, description, type, `fromMe`, `groupOnly`, `adminOnly`, `botAdminRequired`, `dontAddCommandList` and the handler. `commandIndex` maps lowercased names for fast lookup; `rebuildCommandPatterns()` recompiles regexes after a prefix change.
- `src/messages/handler.js` is the single dispatch chain: user ToS monitor → prefix check → global ban → `findCommand()` → Mini command blocklist (`SUB_BLOCKED_COMMANDS`) → `checkCommandAccess()` → feature flags → policy → per-group disabled plugins → `validateCommand()` → group permissions → ack/metrics → handler → audit for `AUDIT_ACTIONS`.
- Errors are degraded to short bilingual chat messages; diagnostics go to `systemLog()` and `logger`, never to end users.
- Do **not** introduce a second command registration system or patch the command list from outside. Any future registry must have an explicit migration plan.

### 4.2 Bootstrap

Root `index.js`: console ring install → platform description → `useMultiDbAuthState()` → FFmpeg check → runtime config load → role hydration → credential check → plugin import → signal handlers → `startAdminHttp()` → WhatsApp connect → Mini respawn → Core Panic → System Watch. Keep this order and the failure-tolerant `try/catch` structure.

### 4.3 Image resolver (existing core service)

- `src/modules/imageResolver/`: `index.js` (public API + orchestration), `constants.js`, `errors.js`, `providers/{pinterest,openverse,commons,directUrl}.js`, `utils/{validator,normalizer,download}.js`.
- Public API: `resolveImage()`, `resolveImageUrl()`, `registerProvider(provider, { kind })`, `listProviders()`, `resetProviderCooldowns()`, `ImageError`, `IMAGE_ERRORS`, `imageUserText`.
- Search providers are an ordered array; URL providers are a separate array. `registerProvider()` appends at runtime; there is no general registry outside this module.
- `guardedFetch()` validates every hop (http/https only, no credentials, allowed ports, DNS/private-IP checks), follows redirects manually with per-hop revalidation, streams with a hard byte cap and applies a hard timeout. Magic-byte MIME detection is in `normalizer.js`.
- Stable error codes: `IMAGE_NOT_FOUND`, `SOURCE_BLOCKED`, `AUTH_REQUIRED`, `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`, `REQUEST_TIMEOUT`, `INVALID_URL`.
- Blocked providers get a cooldown (`PROVIDER_BLOCK_COOLDOWN_MS`, default 10 min); explicit URLs are exempt from cooldown skipping. No retries against blocked sources, no CAPTCHA bypass, no proxy/IP rotation, no API keys.
- Config: `IMAGE_MAX_BYTES`, `IMAGE_TIMEOUT_MS`, `IMAGE_MAX_REDIRECTS`, `IMAGE_MAX_CANDIDATES`, `IMAGE_ALLOWED_MIMES`, `PINTEREST_ENABLED`, `PROVIDER_BLOCK_COOLDOWN_MS`. Docs: `IMAGE-RESOLVER.md`.

### 4.4 Dashboard, dev console, RBAC

- `src/enterprise/adminHttp.js`: `getAdminHttpConfig()` gives `SERVER_PORT` precedence over `ADMIN_HTTP_PORT`; binds `0.0.0.0` unless `ADMIN_HTTP_HOST` is set. Starts only when a token exists. Auth via `?token=<TOKEN>` or `Authorization: Bearer <TOKEN>`; `/health` is token-free; canonical UI link is `/ui?token=<ADMIN_HTTP_TOKEN>`.
- Two tiers: **creator** (`ADMIN_HTTP_TOKEN`) and **operator** (`ADMIN_OPERATOR_TOKEN`). `CREATOR_ONLY_ACTIONS` is enforced at the action boundary with audit + system-log denial. `rcMonitor.js` applies rolling weights and can lock operators out; danger actions need server-side arming.
- `src/enterprise/dashboard/` SPA with `/api/*` and SSE `/api/events`, all driven by `runDevAction()` in `devConsole.js`. `fleet.js` proxies peers server-side so peer tokens never reach the browser.
- Role hierarchy: **creator > owner > admin > mod > user**. `src/utils/access.js` owns creators/owners and modes (`public | private | inbox | group`); `src/enterprise/rbac.js` owns `owner/admin/mod/user` roles and capabilities; `src/utils/guard.js` implements `requireCreator()` denials. Do not bypass these at the handler boundary.
- Audit is a bounded BotKV ring (`writeAudit`, max 500 rows), not an append-only plaintext log file. The WhatsApp system log group and the console ring are separate channels.

### 4.5 Database and sessions

- `authState.js` selects Postgres/Sequelize or better-sqlite3 and attaches the BotKV backend; `botKv.js` is the settings store used by roles, mode, flags, audit, AI history, group settings, etc. With a Postgres `DATABASE_URL` the default hybrid mode keeps the WhatsApp session in local SQLite and writes settings to Postgres first with a local cache fallback (`ONYX_HYBRID=off` restores all-Postgres).
- `src/database/kvMaintenance.js` backs `clear.js --prune` (cache keys only) and `--reset-settings` (all BotKV); both preserve the auth session. `--local`/`--external` restrict either operation to the local SQLite settings or the external Postgres settings, defaulting to both. Never add a flag that deletes `AuthState` for those operations.
- Main state lives in the auth DB; **Onyx Mini** sub-sessions use isolated `sessions/<number>.db` databases via `useStandaloneAuthState()` and must not attach BotKV.
- Mini lifecycle: `instances.json` index, auto-respawn on boot, exponential backoff, terminal handling of `401/403/failed`, no log-group creation, `conn.__isSub` gating and `SUB_BLOCKED_COMMANDS` in the handler.
- `src/terminal/handler.js` installs SIGINT/SIGTERM/SIGHUP handlers. Interactive console behaviour was removed; do not assume a TTY exists.

### 4.6 Self-protection

Core Panic, Watchdog, System Watch, `watchSwitch.js` and `platform.js` are established systems. Platform detection covers pm2 / hosting panel / Docker / systemd / none. Never write code that fights the guards (no full-history sync, no huge console dumps, no uncontrolled send bursts).

## 5. Code style — strict

### 5.1 Comment-free source policy

Onyx deliberately follows a comment-free source-code philosophy.

New application code must contain **no** inline comments, block comments, JSDoc, explanatory comments, TODO/FIXME markers or commented-out code. Do not add comments to make unclear code understandable. Instead:

- use descriptive function and variable names;
- keep functions focused;
- separate responsibilities;
- extract complex logic into appropriately named helpers;
- prefer explicit control flow over clever shortcuts.

Existing comments must not be removed indiscriminately during unrelated changes. Current reality: `//` line comments were removed from JavaScript sources on 2026-11-18; a small number of JSDoc blocks remain (mainly in `src/modules/imageResolver/` and `src/utils/gitUpdate.js`). The rule applies to new and meaningfully changed code.

### 5.2 Language and modules

- ESM only (`import`/`export`), Node >= 20.
- Match the style of the surrounding file; preserve existing import/export conventions.
- Keep user-facing messages bilingual (EN/DE) and reuse `tr(en, de)` from `src/utils/i18n.js`.
- Reuse existing helpers before inventing new ones: `reply`, `withTyping`, `sendError`, `ackCommand`, `systemLog`, `writeAudit`, `enqueueJob`, `logger`, `tr()`.
- Do not duplicate functionality that already exists.

### 5.3 Dependencies

- No new npm packages without explicit approval.
- No paid APIs, paid hosting, subscriptions, API keys or additional infrastructure costs without approval.
- Avoid unnecessary native dependencies. Prefer existing packages and native Node.js functionality.
- `allowScripts` already covers `baileys`, `better-sqlite3` and `protobufjs`; update it only with an approved new native dependency.

## 6. Documentation policy

Documentation and source code have separate responsibilities.

For the current `main` branch:

- No explanatory comments in source files.
- No new documentation files for minor implementation details without a reason.
- Update existing documentation when a public interface, configuration option or behaviour meaningfully changes.
- Keep `README.md` and `CHANGELOG.md` accurate. Do not document features that are not implemented.

Known documentation drift — verify before trusting it:

- `CONTRIBUTING.md` says there is "no automated suite yet"; this is outdated. `npm test` runs `test/imageResolver.test.mjs`.
- `CONTRIBUTING.md` says the codebase has "zero comments"; a few JSDoc blocks still exist. See section 5.1.
- `yarn.lock` is a v1 lockfile and has no project-version field; version stamps are listed in section 12.

For the future `onyx-from-scratch` branch, documentation-first development is required. Before implementing major systems, establish architecture documentation, public API specifications, addon ABI documentation, configuration specifications, lifecycle specifications, security model, testing strategy and migration strategy. The from-scratch project must not become an excuse to rewrite current `main`.

## 7. Testing policy

Tests are mandatory for meaningful changes.

- Command: `npm test`
- Script: `node --test test/*.test.mjs`
- Use Node.js native test functionality unless an alternative is explicitly approved.

Cover normal execution, invalid input, error handling, boundary conditions, permission restrictions, compatibility, regression scenarios and failure behaviour. For providers and external integrations: mock network requests, never require live third-party services, never depend on external availability, never depend on CAPTCHA/auth behaviour, and avoid real WhatsApp account interactions.

Tests must be deterministic and repeatable. Never report a test as successful unless it was actually executed. Do not weaken, delete, skip or modify existing tests simply to make a change pass. If a test cannot be executed, report why.

Before committing, run:

```bash
npm test
git diff --check
```

Also run `node --check` on changed JavaScript files where appropriate, and verify imports, exports, runtime compatibility, command registration, configuration compatibility and relevant failure paths. Run `npm audit` when dependency changes warrant it.

## 8. Security

- Validate user-controlled input at the boundary.
- Prevent SSRF; validate URLs, ports and every redirect target.
- Validate media types, magic bytes and file sizes.
- Protect session data, `.env`, tokens and dashboard credentials.
- Never log secrets, cookies, tokens or full chat content.
- Enforce authorization at the actual execution boundary, not only in metadata.
- Preserve Core Panic and Watchdog behaviour.
- Avoid untrusted dynamic code execution.
- Addon permission declarations are **not** execution sandboxing. Do not claim isolation unless a real technical isolation boundary exists.
- Treat third-party code as untrusted.
- Report vulnerabilities privately per `SECURITY.md`; redact logs before sharing.

## 9. Planned addon architecture — roadmap, not implemented

Target capabilities: versioned addon manifests, stable addon APIs, dependency declarations, compatibility checks, registration, enable/disable lifecycle, unregistration, provider registration, command registration, event subscriptions, configuration schemas, configuration migrations, permission declarations, failure handling, and upgrade/rollback strategies.

Build and verify each layer independently. Do not implement all components in one large refactor.

## 10. Versioning

Distinguish between:

- Core version
- Addon API version
- Addon version
- Distribution version

Breaking API changes require explicit versioning and migration documentation. Existing deployments must not be silently broken. Preserve existing versioning conventions until a replacement is explicitly approved.

## 11. Git and repository safety

- Do not force-push to `main`.
- Do not rewrite repository history.
- Do not commit secrets, `.env`, `database.db`, `sessions/`, tokens or credentials.
- Do not modify YumBot.
- Do not make unrelated changes.
- Do not silently discard user changes (including uncommitted local edits).
- Do not automatically merge large refactors.
- Keep changes focused and reviewable.
- Use feature branches for substantial changes; PRs go against `main`.
- Follow the existing conventional commit style (`feat:`, `fix:`, `docs:`, `chore:`, ...), saying what and why.

## 12. Current verified state, deployment and known limitations

### Current state

- Version `5.0.5` is stamped in `package.json`, `package-lock.json`, root `index.js` banner, `src/config/constants.js` (`BOT_INFO.VERSION`), `src/enterprise/devConsole.js` snapshot, `src/modules/imageResolver/constants.js` (`BOT_UA`), `README.md`, `CHANGELOG.md` and `docker-compose.yml` (`onyx-utility-core:5.0.5`). `yarn.lock` has no version field.
- `main` and `origin/main` are at `9625c29`; tag/release `v5.0.5` points at the same commit.
- `npm test` → 17/17 mocked cases; `npm audit` → 0 vulnerabilities.
- GitHub's Dependabot counter may still show a historical number, but the Dependabot API reported all reachable alerts as `state: fixed`.
- Security commit `1174569`: non-breaking updates plus overrides `axios: "$axios"` (removes the stale nested axios inside `translate-google-api`) and `uuid: ^11.1.1` (Sequelize). `baileys` and `better-sqlite3` were deliberately left unchanged.

### Deployment

```bash
git pull origin main
npm install --no-fund --no-audit
```

Then restart via the hosting panel or `pm2 restart onyx-utility-core`. `#update` uses `src/utils/gitUpdate.js` (`gitPull`, `npmInstall`) and works on panel clones without upstream tracking. No new `#register <Name> accept` is required for 5.0.5.

Panel notes: do not set `SERVER_PORT` manually — the panel injects it. Set `ADMIN_HTTP_TOKEN`; without it the HTTP server refuses to start. See `DASHBOARD-TUNNEL.md` and `DEPLOYMENT.md`.

### Lessons learned / known limitations

- `BOT_UA` must be imported in `src/plugins/search.js`; a missing import was fixed in YumBot as `49ac7bc`. Check when porting search code.
- npm 12 does not reliably resolve nested overrides for `translate-google-api`; use the global `axios: "$axios"` override.
- axios 1.x has separate ESM and CJS instances. To mock a CJS dependency, patch the CJS instance (`createRequire`), otherwise the call goes live.
- Hosting IPs often get 403 from Pinterest/Openverse; the cooldown handles it, and `PINTEREST_ENABLED=off` is the clean fallback.
- `#chatbot off` must not be bypassed by generic reply heuristics; only remembered AI message IDs may pass the gate.
- Never post dashboard tokens in chat or screenshots; rotate on suspicion.
- Historically reported friend/device pairing failures (expired sessions) are unresolved and outside core scope; verify before acting on them.
- The old private `yumbot-nn` repository contains secrets in tracked zip artifacts. Never make it public and do not force-delete it (403 without admin rights).

### Open decisions — require user approval

1. Backport the security updates from `1174569` into YumBot? (Currently: not done.)
2. Exact scope and branch name for `onyx-from-scratch`.
3. Whether 5.0.6 is a version jump with an addon ABI or only a refactor.

## 13. Agent workflow

Every session:

1. Read `AGENTS.md`.
2. Inspect the relevant implementation.
3. Understand existing conventions.
4. Identify dependencies and affected subsystems.
5. Establish the smallest viable change.
6. Implement.
7. Test.
8. Inspect the final diff.
9. Report results and limitations.

For large architectural changes: produce an implementation plan first, identify breaking changes and migration requirements, and wait for approval where required.

The agent must not independently decide on licensing, project identity, repository boundaries, paid services, new dependencies, public API compatibility or major architectural direction.

## 14. 5.0.6 roadmap

The next major milestone is the transition toward a genuinely extensible platform. Proposed priorities:

1. Audit existing module architecture.
2. Define the addon API.
3. Define the addon manifest.
4. Establish API compatibility rules.
5. Improve registries.
6. Implement addon lifecycle management.
7. Define permission handling.
8. Implement configuration schemas.
9. Introduce migrations.
10. Build a reference addon.
11. Validate the architecture through tests.

Do not implement this roadmap during a documentation task. The `onyx-from-scratch` branch is a separate, documentation-first effort and must not be mixed with other large refactors.

## 15. Final principle

Onyx is the foundation, not the finished bot experience. Keep the core stable and maintainable. Keep providers replaceable. Keep addons independently maintainable. Keep distributions independent.

Build the platform once. Build different WhatsApp bots on top of it.
