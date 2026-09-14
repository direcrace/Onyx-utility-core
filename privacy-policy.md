# Privacy Policy

**Last updated:** 14.09.2026

> **Using `#pair` (Onyx Mini)?** Read Section 3.2 before linking your number — it explains the monitoring, logging, and termination that come with a linked session. A short version of this is repeated below so it can be shown directly at pairing time.
> **Running or using a self-hosted "main" instance?** Read Section 1 and Section 3.3 — the privacy commitments there (non-persistent log, flag-driven logging, the operator not reading chats) apply to whoever operates the instance you use.

This Privacy Policy explains how this WhatsApp bot ("the Bot," "we," "us") collects, uses, stores, and protects information when you interact with it, including through group commands, private chat, and the linked-account ("pairing") feature.

By sending any command to the Bot, adding it to a group, or using `#pair` to link your own WhatsApp account, you agree to the practices described in this policy. There is no separate account registration (no `#register` step) — **use of the Bot constitutes your consent** to this policy.

---

## 1. Who Operates the Bot

The Bot is operated by Nero.
Contact: +49 160 95344704 (WhatsApp) · discord: directorace · email: teamtestdevteam@gmx.net

If you are subject to the EU General Data Protection Regulation (GDPR) or a similar law, this section identifies the data controller for that purpose.

### 1.1 Self-hosted "main" instances

"Main" instances are full, independently configured installations of the Bot's software — as opposed to the paired "Mini" sessions described in Section 3.2. When you or someone else run a main instance (on your own hardware, a VPS, or anywhere else), the person operating **that** instance is the data controller responsible for it — not Nero — even where components were copied from this project.

The privacy commitments in this policy — in particular the non-persistent safety snapshot (Section 3.3), flag-driven logging, and the statement that **the operator does not read chats** — apply to whichever person operates the instance you are actually using:

* If Nero runs the main instance for you, those commitments are Nero's.
* If you (or a third party) run the main instance yourself, those commitments are that operator's responsibility. Nero has no access to — and takes no responsibility for — instances Nero does not operate.

The code, configuration, and legal documents for a main instance travel with the instance itself, so whoever runs it is in full control of what it stores, logs, and does.

---

## 2. What the Bot Does

The Bot provides commands across several categories, including but not limited to:

* **AI chat** (`#chat`, `#aiclear`, `#aiprompt`) — conversational replies generated via a connected AI backend (LM Studio).
* **Moderation** (`#antilink`, `#antispam`, `#antibot`, `#warn`, `#mute`, `#kick`, etc.) — automated and manual group management tools for group admins.
* **Fun / utility commands** (reactions, voice effects, calculators, stickers).
* **Search** (`#anime`, `#github`, `#movie`, `#lyrics`, `#translate`, `#img`) — queries relayed to third-party APIs.
* **Media processing** (`#sticker`, `#toimg`, `#tomp3`, `#removebg`, `#tiktok`, `#ig`, `#fb`, `#yt`, `#vv`) — download, conversion, or extraction of media you or others in a group send.
* **Group management tools** (`#tagall`, `#promote`, `#demote`, `#groupinfo`).
* **Personal utilities** (`#note`, `#todo`, `#remind`, `#poll`).
* **Account linking** (`#pair`) — lets a user connect their own WhatsApp number as a bot-controlled session ("Onyx Mini" sub-session).
* **Owner/administrative tools** — used solely by the Bot operator to run, moderate, and secure the service (e.g. `#broadcast`, `#ban`, `#audit`, `#backup`, `#sudo`).

---

## 3. Information We Collect

Depending on which features you use, we may process:

### 3.1 Standard usage data
* Your WhatsApp ID / phone number, as needed to respond to you or attribute a command.
* The text of commands you send and, where a command requires it, the message content needed to execute that command (e.g., text to translate, a caption to convert to a sticker, a message you reply to for `#del` or `#vv`).
* Media you send to media-processing commands (images, video, audio, stickers), for the time needed to process and return the result.
* Group metadata for groups the Bot is added to: group name, ID, member list, admin list, and group settings the Bot manages (e.g., anti-link, anti-spam, welcome/goodbye configuration).
* Data you deliberately ask the Bot to store on your behalf: notes (`#note`), to-do items (`#todo`), reminders (`#remind`), poll data.
* AI chat history, where retained, until you clear it with `#aiclear` or it is otherwise purged.
* Basic operational logs (timestamps, command names, error states) used for debugging and abuse prevention.

### 3.2 Data specific to paired accounts (`#pair`)
If you use `#pair` to link your own WhatsApp number to the Bot:

* You receive a **separate, dedicated database/session** used only for your linked account and its activity.
* Because the Bot operates *as* your account in this mode, it necessarily has visibility into the messages and events passing through that session in order to function.
* **Automated monitoring:** an automated system continuously watches sessions created through `#pair` for specific events and behavioral triggers (for example, patterns consistent with abuse, spam, illegal activity, or violations of WhatsApp's own terms of service). This system is not a token gesture — it actively scans for defined trigger conditions on an ongoing basis.
* **What happens on a flag:** if the automated system flags a session, one or both of the following may occur:
  - Messages or events related to the flagged activity may be logged for review, and/or
  - A human operator (the Bot owner) may personally review the flagged activity to verify whether a violation occurred.
* **Termination:** the Bot operator may suspend or terminate any paired session at any time, at their sole discretion — including but not limited to cases where the monitoring system raises a flag. No prior notice or justification is guaranteed.
* There is no registration or identity-verification step beyond the WhatsApp pairing process itself. **Choosing to pair your account is your consent** to this monitoring and to the possibility of logging, review, and termination described above.

---

### 3.3 Safety log for ToS enforcement (general messages — non-persistent)

Beyond the paired-session monitoring above, the Bot automatically keeps a short, in-memory snapshot of the recent messages it processes — in normal chats **and** linked sessions — so its safety systems can judge, in context, whether a message or behaviour violated the Bot's Terms of Service. This snapshot is **not** a message archive and is **not** a way for anyone to read your chats:

* **What it is:** only the most recent messages the Bot has seen, capped in number and heavily truncated — short snippets only, no full history, no attachment bytes, no thumbnails.
* **Non-persistent by design:** the snapshot lives purely in the Bot's working memory (RAM). It is **never** written to disk, the database, or any other storage. **A single restart/reboot clears it completely — nothing survives, as if it never happened** — and it cannot be recovered afterwards.
* **Why it exists:** so the automated safety monitors can verify whether a message actually crossed a ToS line, and to record that enforcement. It is captured automatically and identically for every user; it is not a record of "who talked to whom" or "what was said."
* **When it becomes more than a snapshot:** only when a safety monitor **flags** a message or event may the related context be logged (see "Data Retention") so the flag can be investigated. Where enforcement requires it, the operator may review **that flagged activity, and only that**, to decide whether a violation occurred.
* **The operator does not read chats:** the operator does not read, browse, or export your conversations through the Bot — not routinely, not selectively, not as a service convenience. Nothing in this policy authorises the operator to observe who you talk to or what you say. Logging exists for the single purpose of enforcing the Terms when a defined trigger fires, and even then only the flagged activity is reviewable.
* **Your own stored data** (notes `#note`, to-dos `#todo`, reminders `#remind`, poll data, configured group settings) is a separate, persistent thing governed by "Data Retention" below — it is not part of this snapshot and never stored in it.

---

### 3.4 Onyx Mini Pairing Notice (short form)

This is a condensed version of Section 3.2, meant to be shown to a user at the moment they run `#pair` — before their session is created:

> **Before you link your number with `#pair`:**
> - Your linked account gets its own separate database/session.
> - Because the Bot runs as your account in this mode, it can see the activity in that session.
> - An automated system continuously monitors linked sessions for specific abuse/violation triggers — this is always on, not occasional.
> - If flagged: your messages related to the flag may be logged, and/or the operator may personally review the flagged activity.
> - The operator can suspend or terminate your linked session at any time, at their sole discretion, with no guaranteed notice.
> - There is no separate signup — **running `#pair` means you agree to this.**

---

## 5. Why We Process This Data (Purpose & Legal Basis)

* **To provide the service you request** — executing the command you sent is a contractual/functional necessity (legitimate interest / performance of a requested service).
* **To secure the Bot and its infrastructure** — the monitoring system for paired sessions exists to detect and stop abuse (spam, illegal content, ToS violations) that could compromise other users, the linked WhatsApp numbers, or the Bot itself (legitimate interest in platform safety and legal compliance).
* **To enforce the Terms of Service** — the non-persistent safety snapshot and the flag-driven logging in Section 3.3 exist solely so the automated safety systems can verify, in context, and record whether a message violated the Terms. This processing is automated and flag-driven only; **the operator does not read chats through the Bot**, and nothing in this policy provides a basis for systematically browsing conversations.
* **To operate group moderation features** that a group admin has explicitly enabled.
* **Consent** — where there is no other legal basis (e.g., voluntary use of `#pair`, storage of notes/reminders), your continued use of the feature is treated as consent.

---

## 6. Third-Party Services

Certain commands send data to external services to function. This may include, depending on the command used:

* AI inference backend (LM Studio) for `#chat` / `#aiprompt`
* GitHub (public profile lookups)
* IMDb-linked sources (`#movie`)
* Pinterest (`#img`)
* Lyrics data providers (`#lyrics`)
* Translation services (`#translate`)
* Background-removal API (`#removebg`)
* YouTube, TikTok, Instagram, Facebook (media download commands — best-effort, subject to those platforms' own availability and terms)
* Media/file hosting used by `#toururl` to generate a shareable link

Only the data necessary for the specific request (e.g., the search term, the media file, the text to translate) is sent to the relevant service. We do not control these third parties' own data practices; their own privacy policies apply to data once it reaches them.

---

## 7. Data Retention

* Command inputs/outputs that are not explicitly stored (e.g., a one-off sticker conversion) are processed transiently and not retained beyond what's needed to deliver the result.
* Data you explicitly ask to be stored (notes, to-dos, reminders, AI chat history) is kept until you delete it yourself, you clear it via the relevant command, or the Bot operator removes it (e.g., following a ban or termination).
* Logs from the automated monitoring system for paired sessions are retained only as long as needed to review a flag and resolve it, unless retention is legally required for longer. **Concrete cap:** logs tied to a flag that is **not** found to be a violation are **automatically purged after 30 days**; logs tied to a confirmed violation are kept for the resolution of that case and then deleted, or as required by law.
* Logs from a safety flag on **any** chat (not only paired sessions) follow the same rule: kept only as long as needed to resolve the flag, **automatically purged after 30 days** when no violation is found, and deleted once a confirmed case is resolved (or retained as law requires). The general non-persistent snapshot itself (Section 3.3) is **never written to disk at all** — it exists only in RAM and is gone on the next restart.
* Group settings persist for as long as the Bot remains in the group.

---

## 8. Data Security

We take reasonable technical measures to protect stored data (e.g., access restricted to the Bot operator/owner tools). No system is completely secure, and we cannot guarantee absolute security of data transmitted over WhatsApp or third-party APIs.

---

## 9. Children

The Bot is not directed at children and is not knowingly used to collect data from children under the minimum age required by WhatsApp's own terms of service (13, or higher where local law requires). If you believe a child has used the Bot in a way that raises concerns, contact us using the details above.

---

## 10. Your Rights

Depending on your jurisdiction (e.g., under GDPR), you may have the right to:

* Request access to the data we hold about you (e.g., stored notes, reminders, or logs tied to your number).
* Request correction or deletion of that data.
* Object to or restrict certain processing (e.g., disable AI chat with `#aiclear`, or stop using `#pair` to end monitoring of that session).
* Request a copy of your data in a portable format, where technically feasible.
* Lodge a complaint with your local data protection authority.

To exercise these rights, contact us using the details in Section 1. Because there is no account/registration system, we may need to verify your request through the WhatsApp number associated with it.

---

## 11. International Data Transfers

Because several features rely on third-party APIs (Section 6) that may operate outside your country, data sent to those commands may be processed abroad. Use of those specific commands implies acceptance of that transfer.

---

## 12. Changes to This Policy

We may update this policy as the Bot's features change. Material changes will be reflected by updating the "Last updated" date above. Continued use of the Bot after changes take effect constitutes acceptance of the revised policy.

---

## 13. Contact

Questions about this policy or your data can be sent to:
+49 160 95344704 (WhatsApp) · discord: directorace · email: teamtestdevteam@gmx.net