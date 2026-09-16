# Contributing to Onyx Utility Core

Onyx Utility Core is a one-person, long-running WhatsApp bot project, not a company product. It is built around a few ideas that you should understand before you poke at the code:

- **Lean and self-protecting.** The runtime watches itself (core panic, system watch) and would rather stop than spam your phone. Respect that instinct; don't write code that fights the guards.
- **Defensive by default.** Errors degrade to a short, friendly message in the chat. Diagnostics, stacks and redacted traces go to the system log group — never to end users.
- **Deliberately boring under the hood.** Stochastic, whimsical, or "clever" one-liners are the fastest way to make the diff rejected. Prefer the boring, obvious implementation that the next person (me) can read at 3am.
- **Comment-free on purpose.** The codebase has zero comments. Comments rot and lie; code and commit messages get to live. If you think the code needs a comment, the code needs to be clearer.

Read the [README](README.md) (the changelog-style overview of what this fork changes) before opening anything.

## Ground rules

1. Search the [open issues](https://github.com/direcrace/Onyx-main/issues) and PRs first — duplicates get closed fast.
2. Big feature ideas deserve an issue first, so we can argue about scope before anyone writes code.
3. Never commit secrets. `.env`, `database.db`, `sessions/`, API keys and admin tokens stay out of git, always.
4. Don't re-enable WhatsApp full-history sync, and don't dump big objects into the console — that's how the panic guards get tripped.

## Getting it running

**Requirements:** Node.js ≥ 20, FFmpeg on `PATH`, Git.

```bash
git clone https://github.com/direcrace/Onyx-main.git
cd Onyx-main
npm install
cp .env.example .env   # then set at least OWNER_NUMBER
npm run dev
```

Login with the terminal QR, or set `PAIRING_NUMBER` to get a pairing code instead. If the bot greets you in a group named `* BOT_NAME · System *`, onboarding worked.

## Where things live

| Path | What it is |
|------|------------|
| `src/plugins/` | Every command — `command({ pattern, desc, type }, handler)` registration (side effects at import time) |
| `src/messages/` | Inbound pipeline: serialize, group guards, command handler |
| `src/multi/` | Onyx Mini sub-sessions + ToS monitor (the multi-account layer) |
| `src/enterprise/` | Dashboard, dev console, audit, flags, RBAC, policy, queue, metrics, invites, fleet, backups |
| `src/system/` | Core panic + watchdog + system watch (the self-protection layer) |
| `src/database/` | Baileys auth state (SQLite/Postgres) + BotKV settings store |
| `src/utils/` | Shared helpers and the zeroth-tier guards (`access`, `guard`, `lid`, `group`) |

## Branching and commits

- Work on a branch off `main`: `git checkout -b feat/short-description`.
- Commit messages follow conventional style and say *what and why*, not how:
  - `feat: allow per-group mute duration override`
  - `fix: stale resume flag revived suspended minis`
  - `docs: clarify first-run onboarding`
- Keep a PR to one coherent change. A PR that mixes a refactor with a feature is a PR I have to re-review from scratch.
- Force-pushes on your own feature branch are fine while it's under review.

## Code style that will get merged

- **ESM only** (`import`/`export`), matching the style of the file you're in.
- Reuse the existing helpers before inventing new ones: `reply`, `withTyping`, `writeAudit`, `systemLog`, `tr(en, de)`.
- User-facing strings should be bilingual (`tr()` with EN + DE, matching the file's pattern). This project is EN/DE by design.
- **Plugins:** add to `command()` in `src/plugins.js` — never soft-require files or patch the command list from afar.
- **Heavy work** (YouTube, big media): route through `enqueueJob` in `src/enterprise/queue.js`, don't block the event loop.
- Avoid new native dependencies; if one is truly required, document it in the README and make sure `allowScripts` covers its install.
- New code, zero comments. If a reviewer (me) can't follow it, the review feedback will say *what to rename*, not *what to explain*.

## Testing a change

There's no automated suite yet — it's on the horizon, honest. Until then, verify by hand before opening the PR:

1. `npm start` (or `npm run dev`) boots without errors.
2. Your command shows up in `#menu` (unless `dontAddCommandList`).
3. The happy path works in a normal group and in a DM.
4. Failure paths return a clean message; nothing crashes.
5. If you touched ACL/roles/mode: owner-only commands stay owner-only, private mode stays private.
6. Media work (stickers, YouTube) still behaves with FFmpeg as installed.

## Pull requests

1. Open the PR against **`main`** (that's where all new work goes; the `pre-v7` branch is a historical artifact before the Baileys 7 rewrite).
2. Fill out the template: what, why, how you tested.
3. Link related issues (`Fixes #123`).
4. Expect honest, sometimes blunt review — it's a personal project and I'd rather reject a PR than merge something I can't maintain.

## Reporting bugs

Open a bug report (use the template) and include:

- Onyx Utility Core version / commit, Node version, OS
- Baileys version as installed (`npm ls baileys`)
- Reproduce steps, expected vs actual
- Whether the failure shows up in the **system log group**
- **Redacted** logs only — no session keys, `.env` contents, tokens, or full phone numbers

## Reporting security issues

If you found a vulnerability — especially anything that could expose a session, a token, or someone else's data — **do not open a public issue**. This project handles real WhatsApp accounts and real people's chats; a public disclosure is itself a security incident.

- Report privately through GitHub's private vulnerability reporting: [Security advisory → new](https://github.com/direcrace/Onyx-main/security/advisories/new).
- Include: what's affected (file/endpoint/command), how to trigger it, impact, and a minimal repro. No live secrets, no full session files.
- I maintain this alone, in my spare time. You'll get a real (not automated) reply, but it may take a few days.
- One honest promise: a well-written private report gets acted on and credited. Ignoring or leaking a report gets the bot stopped and the matter treated as an active incident.

## License

By contributing, you agree that your contributions are licensed under the [N-SAL v1.0](LICENSE) — this project sources-available, not open-source-in-the-MIT-sense. Upstream MIT credit for the X-Asena origin is preserved in the license itself.