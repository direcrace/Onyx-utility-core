# Contributing to X-Asena

Thanks for your interest in improving X-Asena. This guide covers how to set up the project, make changes, and open a pull request.

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful and constructive.

## Before you start

1. Search [existing issues](https://github.com/Neeraj-x0/X-Asena/issues) and PRs to avoid duplicates.
2. For larger features, open an issue first so we can agree on scope.
3. Read the [README](README.md) for architecture, env vars, and command overview.
4. Never commit secrets (`.env`, session DBs, API keys, admin tokens).

## Development setup

**Requirements:** Node.js ≥ 20, FFmpeg on `PATH`, Git.

```bash
git clone https://github.com/Neeraj-x0/X-Asena.git
cd X-Asena
npm install
cp .env.example .env
# Edit .env — at least set OWNER_NUMBER
npm run dev
```

Login via QR in the terminal, or set `PAIRING_NUMBER` for pairing-code login.

Useful paths:

| Path | Role |
|------|------|
| `src/plugins/` | Commands (side-effect `command()` registration) |
| `src/socket/connection.js` | Baileys socket |
| `src/messages/` | Serialize + handler + group guards |
| `src/enterprise/` | Audit, flags, RBAC, policies, metrics, queue |
| `src/database/` | Auth + BotKV |
| `src/utils/` | Shared helpers |

## Branching and commits

1. Fork the repo (or create a branch from `main`).
2. Create a focused branch:

   ```bash
   git checkout -b feat/short-description
   ```

3. Keep commits small and meaningful. Prefer messages like:

   - `feat: add warn reset for all members`
   - `fix: handle missing FFmpeg in status`
   - `docs: clarify pairing login`

4. Do not mix unrelated refactors with feature work in the same PR.

## Coding guidelines

- **ESM only** (`import` / `export`). Match existing style in nearby files.
- Prefer existing helpers (`reply`, `withTyping`, `writeAudit`, `systemLog`) over new one-offs.
- **User chats:** short, friendly errors only. Stacks and diagnostics go to the **system log group** (`systemLog`).
- **Plugins:** register with `command({ pattern, desc, type, ... }, handler)` from `src/plugins.js`.
- **Heavy work** (YouTube downloads, big media): use `enqueueJob` from `src/enterprise/queue.js` when appropriate.
- Avoid new native dependencies unless necessary; document them in the README.
- Do not re-enable full WhatsApp history sync or dump large objects to the console.

## Testing your change

There is no full automated suite yet. Before opening a PR:

1. Bot starts with `npm start` / `npm run dev`.
2. Your command appears in `#menu` (unless `dontAddCommandList`).
3. Happy path works in a test chat/group.
4. Failure paths return a clear message (no crash).
5. Owner-only / private-mode behaviour still holds if you touched ACL.
6. For media: confirm FFmpeg behaviour if relevant.

## Pull requests

1. Push your branch and open a PR against **`main`**.
2. Fill in the PR template: what / why / how tested.
3. Link related issues (`Fixes #123`).
4. Keep the diff reviewable. Split huge changes if asked.
5. Expect feedback; force-pushes on your feature branch are fine while reviewing.

Legacy history before Baileys v7 lives on the `pre-v7` branch. New work targets **`main`**.

## Reporting bugs

Use a bug issue (or the bug template) and include:

- X-Asena / Node / OS versions
- Baileys version (`package.json`)
- Steps to reproduce
- Expected vs actual behaviour
- Whether the failure shows in the **system log group**
- Redacted logs only (no session keys, tokens, or phone numbers you must not share)

Security issues: see [SECURITY.md](SECURITY.md) — do not open a public issue for vulnerabilities.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
