# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `4.x` (`main`, Baileys 7) | Yes |
| `pre-v7` and older | Best-effort only |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Report privately to:

- **Email:** krishnaneeraj773@gmail.com
- Or use GitHub **Private vulnerability reporting** on this repository if enabled

Include:

1. Description of the issue and impact
2. Steps to reproduce or a proof of concept
3. Affected version / commit if known
4. Any suggested fix (optional)

You should receive an acknowledgement within **7 days**. We will work on a fix
and coordinate disclosure when appropriate.

## Please do not

- Share session files, `database.db`, auth keys, or `.env` contents
- Post exploit details in public issues, Discord, or PRs before a fix
- Use vulnerabilities against third-party WhatsApp accounts or bots

## Hardening tips for operators

- Keep `OWNER_NUMBER` set; use `#mode private` when the bot is not meant for the public
- Restrict `#broadcast`, `#backup`, and admin HTTP (`ADMIN_HTTP_TOKEN`, bind `127.0.0.1`)
- Never commit `.env`, session DBs, or backup JSON with secrets
- Rotate tokens if a log or backup may have leaked
