# Privacy Policy

**Last updated:** 18.11.2026

> **Using `#pair` (Onyx Mini)?** Read Section 3.3 before linking your number — it explains the monitoring, logging, and termination that come with a linked session.
> **Using a self-hosted "main" instance?** Read Section 1.1 — the operator of the instance you use is the controller responsible for it.
> **Registered as a community member?** Sections 3.2, 3.5, 3.6 and 3.7 describe the data stored about you.

This Privacy Policy explains how this WhatsApp bot ("the Bot," "we," "us") collects, uses, stores, and protects information when you interact with it — in groups, private chat, through registration, support tickets, reports, and the linked-account ("pairing") feature.

By registering (`#register`), sending commands, adding the Bot to a group, or using `#pair`, you agree to the practices described here.

---

## 1. Who Operates the Bot

The Bot is operated by Nero.

Contact: WhatsApp +49 160 95344704 · discord: directorace · email: teamtestdevteam@gmx.net

If you are subject to the EU General Data Protection Regulation (GDPR) or similar law, this section identifies the data controller.

### 1.1 Self-hosted "main" instances

"Main" instances are full, independently configured installations of the Bot's software — as opposed to paired "Mini" sessions (Section 3.3). When you or a third party run a main instance, **the person operating that instance is the controller** — not Nero — even if the software originated from this project. Nero has no access to, and takes no responsibility for, instances Nero does not operate.

Whoever runs a main instance controls what it stores, logs, and retains, including the log level (`off` / `audit` / `messages` / `raw`) and whether the ToS monitor is enabled. The commitments in this policy apply to whichever operator runs the instance you actually use.

---

## 2. What the Bot Does

* **Community** — registration (`#register`, `#unregister`), ranks/roles, activity statistics (`#mystats`, `#leaderboard`) and `#resetstats`.
* **Support & reports** — `#ticket` / `#support` and `#report`, with delivery configured by the operator via `#setsupportgroup` / `#setticketdelivery` (`group`, `dm`, `both`, `off`). Replies use `#answer <text>` in the support group.
* **Moderation** — `#antilink`, `#antispam`, `#antibot`, `#warn`, `#mute`, `#kick`, `#ban`, welcome/goodbye and other group tools.
* **AI chat** (`#chat`, `#aiprompt`) via a connected backend, plus media processing and search/utilities.
* **Personal utilities** — notes, to-dos, reminders, polls.
* **Onyx Mini** (`#pair`) — optional linking of your own WhatsApp number as a sub-session.

---

## 3. Information We Collect

### 3.1 Standard usage data

Depending on the features you use:

* Your WhatsApp ID / number, as needed to attribute a command or respond to you.
* Command text and, where required to execute a command, the message content (e.g. text to translate, a caption to convert, a replied-to message).
* Media you deliberately send to media-processing commands — processed only as long as needed to return the result, **never stored for logging**.
* Group metadata for groups the Bot is in: group name, ID, member/admin lists, and moderation settings the Bot manages.
* Data you deliberately store: notes, to-dos, reminders, polls, AI chat history (until you clear it with `#aiclear`).
* Basic operational metadata (timestamps, command names, error states) for debugging and abuse prevention.

### 3.2 Registration data (community members)

When you run `#register <Name> accept` we store:

* your WhatsApp number (digits only),
* the name you chose (max. 32 characters),
* the timestamp of registration,
* the **version hashes** of the Terms of Service and this Privacy Policy at the time you accepted,
* and, where applicable, the sender number of the confirming message.

`#unregister` deletes the registration and starts a **30-day cooldown** before you can register again. Consent records are kept so we can show when and to which document version you agreed.

### 3.3 Data specific to paired accounts (`#pair`)

If you link your own WhatsApp number:

* You receive a **separate, dedicated database/session** used only for your linked account.
* Because the Bot operates *as* your account, it necessarily sees activity passing through that session.
* **Automated monitoring:** an always-on system watches linked sessions for defined abuse/spam/illegal-activity/ToS triggers. The operator can disable it entirely with `#autoflag off`; while off, no flags, log-group notices, auto-suspensions or auto-bans occur.
* **On a flag:** related messages/events may be logged for review, and/or the operator may review the flagged activity to verify a violation.
* **Termination:** the operator may suspend or terminate any linked session at any time, at sole discretion, without guaranteed notice or justification.
* **Consent:** running `#pair` is your consent to this monitoring, logging, review and possible termination.

### 3.4 Short-lived safety snapshot (RAM only)

The Bot keeps a short, capped, heavily truncated snapshot of recent messages in working memory so automated safety checks can judge context.

* It lives **only in RAM**, is never written to disk, and is cleared on the next restart — irrecoverably.
* It contains no full history, no attachment bytes and no thumbnails.
* It is captured identically for everyone; it is not a "who talked to whom" archive.
* Only when a defined trigger fires may related context be written to the log files described below.

### 3.5 Plaintext audit and message logs (persistent)

In addition to the RAM snapshot, the Bot can write **append-only plaintext log files** under `logs/` (or the configured `AUDIT_LOG_DIR`), one file per day:

| Level | What is written |
|---|---|
| `off` | nothing |
| `audit` **(default)** | moderation and safety events only |
| `messages` | audit plus message/call/edit/delete events |
| `raw` | everything above plus truncated raw JSON metadata |

* **Audit proof:** ban/kick and similar actions record actor, target, chat/group, reason, message body and message ID so an action can be verified.
* **No media download:** at no level does the Bot download media for logging. `raw` stores metadata and truncated JSON only — never attachment bytes, thumbnails, or full media.
* **Operator control:** the level is chosen by the operator via `#log level` or `#fulllog on|off` and can be changed at runtime. The default is `audit`.
* **System log group:** only important safety/system notices are sent there; no per-log "logged that" confirmations.
* **Access:** the files are local to the instance and intended for the operator/auditor.

If you run a main instance yourself, you are responsible for these files, their protection, and their deletion (Section 7).

### 3.6 Reports and support tickets

When you use `#report`, `#ticket` / `#support`, or manage them via `#mytickets` / `#closeticket` we store:

* your number, the subject and message text/description you provide, any mentioned/replied-to target, the chat/group context, and a timestamp,
* the ticket status (open/answered/closed), any answer text, the registered name of the support member who answered, and who closed it,
* the delivery destination and mode configured by the operator (`#setsupportgroup`, `#setticketdelivery`). With `dm`, full ticket content goes only to you; the support group receives just a short notice with the ticket ID and sender. An `#answer` reply is sent to you and reposted in the support group with the original ticket content and the responder's registered name (no mention/number).

This data is used only to handle your request and to keep an audit trail. False or abusive reports may be rejected (Terms, Sections 4 and 5).

### 3.7 Community statistics and leaderboard

The Bot keeps activity counters (messages, commands, reports, tickets, points) to build `#mystats` and `#leaderboard`. These are derived from operational metadata only — no message text is stored for this purpose — and are informational, may be inaccurate or reset. They are associated with your WhatsApp number and/or registered name. You can delete your own counters with `#resetstats` or ask us under Section 10.

---

## 4. Why We Process This Data (Purpose & Legal Basis)

* **To provide the requested feature** — executing a command you send is necessary to deliver the service (performance of a requested service / legitimate interest).
* **Registration & consent records** — to know who accepted which document version (legal compliance / legitimate interest in proving consent).
* **To secure the service and enforce the Terms** — the ToS monitor, the RAM snapshot and `audit`-level logs exist to detect and prove abuse. `audit` is the default; higher levels are an explicit operator choice.
* **To handle reports/tickets** — to respond to your request and keep an audit trail (legitimate interest / performance of a requested service).
* **To run community features** — ranks, statistics and leaderboard (legitimate interest in operating the community; you may request deletion under Section 10).
* **Consent** — where no other basis applies (e.g. voluntary `#pair`, storing notes/reminders).

---

## 5. Third-Party Services

Commands may send only the data needed for the specific request to external services, including:

* AI inference backend (LM Studio) for `#chat` / `#aiprompt`
* GitHub (public profile lookups)
* IMDb-linked sources (`#movie`), Pinterest (`#img`), lyrics providers, translation services
* Background-removal API (`#removebg`)
* YouTube, TikTok, Instagram, Facebook (media commands — best-effort, subject to their terms)
* Media/file hosting used by `#toururl`

Once data reaches a third party, that party's own privacy policy applies. We do not control their practices.

---

## 6. Data Retention

* **Transient data** (e.g. a one-off sticker conversion) is not retained beyond delivering the result.
* **Your stored data** (notes, to-dos, reminders, AI chat history, group settings) stays until you delete it, you clear it via the relevant command, or the operator removes it (e.g. after a ban).
* **Registration** stays until `#unregister`; a 30-day cooldown record remains after deletion.
* **Consent records** are kept as proof of acceptance; we may prune them when no longer needed for legal/audit purposes.
* **Plaintext log files** are append-only daily files. They are retained until the operator deletes or rotates them. Where technically feasible, entries tied to a flag that was **not** a violation are removed after **30 days**; entries tied to a confirmed case are kept for its resolution and then deleted, or as law requires. The RAM snapshot itself is never written to disk.
* **Report/ticket data** is kept as long as needed to resolve the case and for audit, then deleted or as law requires.
* **Statistics/leaderboard** entries are kept until you request deletion, you unregister, or the operator resets them.

For self-hosted instances, the local operator controls all retention and is responsible for deleting logs and stored data.

---

## 7. Data Security

We use reasonable technical measures (operator/owner-only tools, restricted access). No system is completely secure; data sent over WhatsApp or third-party APIs cannot be guaranteed absolutely secure. Plaintext log files are only as secure as the machine and filesystem they live on — self-hosters should restrict filesystem access accordingly.

---

## 8. Children

The Bot is not directed at children and is not knowingly used to collect data from children under WhatsApp's minimum age (13, or higher where local law requires). Contact us if you believe a child used the Bot in a concerning way.

---

## 9. Your Rights

Under the GDPR or similar law you may have the right to:

* **Access** the data we hold about you (registration, consent version, notes, reminders, report/ticket entries, log entries tied to your number, statistics).
* **Correction** of inaccurate data.
* **Deletion** of your data — use `#unregister` for registration, `#aiclear` for chat history, and contact us for notes, tickets, statistics or log entries.
* **Object/restrict** certain processing — e.g. stop using `#pair` to end that session's monitoring; `#autoflag off` (operator) disables the ToS monitor entirely.
* **Portability** of your data where technically feasible.
* **Complaint** to your local data protection authority.

To exercise these rights, contact us using Section 1. Because we now have a registration system, we will normally verify you through the WhatsApp number on the registration.

---

## 10. International Data Transfers

Some features use third-party services that may operate outside your country. Data sent to those commands may be processed abroad; use of those commands implies acceptance of that transfer.

---

## 11. Changes to This Policy

We update this policy as the Bot's features change, reflected by the "Last updated" date. **Consent is bound to document version hashes.** When this policy or the Terms change materially, existing consents become outdated and you will be asked to re-accept via `#register <Name> accept`. Continued use after changes take effect constitutes acceptance.

---

## 12. Contact

Questions about this policy or your data:

WhatsApp +49 160 95344704 · discord: directorace · email: teamtestdevteam@gmx.net
