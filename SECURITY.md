# Security Policy

Onyx Utility Core runs real WhatsApp accounts. A bug here isn't a to-do-app bug: it can hand an attacker a live session, a second-hand account, or someone's chats. Please read this before reporting anything.

## Reporting a vulnerability

**Do not open a public issue for a security problem.** This project is genuinely attacked through public disclosures — a published session leak is worse than the underlying bug.

Report privately instead:

- GitHub private vulnerability reporting: [security/advisories/new](https://github.com/direcrace/Onyx-utility-core/security/advisories/new)
- If you can't use GitHub for some reason, DM the maintainer (discord `directorace`) with a one-line summary; you'll be pointed at the private channel.

## What counts as a vulnerability here

Roughly, anything that can be used against someone *other than yourself*:

- Session or auth-state compromise (`sessions/`, `database.db`, Baileys creds)
- Token leaks or bypass around the admin HTTP surface (`ADMIN_HTTP_TOKEN`, `ADMIN_OPERATOR_TOKEN`, invite tokens)
- Data exposure (BotKV settings, chat index, message log, media cache, audit trails)
- Abuse of operator power through the dashboard/terminal/command bus
- Anything that lets a random group participant escalate or de-rail the bot (spam loops, panic bypasses, ban evasion)

Minor annoyances (wrong spelling in a `#tr` string, a menu typo) are regular issues, not this.

## What a good report looks like

- **Where:** file / endpoint / command, as precise as you can be
- **How to trigger it:** minimal repro steps — no real accounts needed please
- **Impact:** what could happen worst-case, and to whom
- **What you already redacted/checked:** confirm you didn't include live session data, `.env` contents, tokens, or full phone numbers

If your repro needs a number, invent a fake one (`4915000000000`). Nobody here needs a real phone number to reproduce a parser bug.

## What happens next

- I maintain this alone, in my spare time. You get an *answer*, not an auto-reply, but give it a few days.
- On confirmation: I acknowledge you, fix it, and ship it in a release. You get credit in the changelog unless you'd rather stay anonymous.
- I keep the window between notification and public fix as short as I can manage — a public write-up *before* the fix is out makes a running WhatsApp bot genuinely more dangerous, so please hold it until the release lands.
- If a report looks intentional or destructive (exfiltrating sessions, nuking data), it's treated as an active incident — the affected instances get stopped and the matter goes to WhatsApp abuse as appropriate.

## What the code already does to keep a bad day rare

These are deliberate trade-offs, so a report that suggests weakening them needs a hard justification:

- Admin HTTP binds to `127.0.0.1` by default and refuses to run with a token on any port — nothing listens publicly unauthenticated.
- Two token tiers (creator/operator) and a watchdog that locks an operator out after sustained dangerous actions.
- Generic error messages in chats; stacks, traces and diagnostics stay in the system log group.
- Global ban, private mode, and per-group controls all gate who can reach the bot.
- ToS/flag data is purged on a 30-day GDPR retention cap; message log and media cache are RAM-only and never persisted.
- Every dangerous path (sessions, `.env`, DBs, media, logs, watchdogs) is gitignored, so a sloppy push can't ship a session file.

## Last updated

2026-09-16