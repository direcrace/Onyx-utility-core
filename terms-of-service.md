# Terms of Service

**Last updated:** 18.11.2026

These Terms of Service ("Terms") govern your use of this WhatsApp bot ("the Bot," "we," "us"), including its community features, group tools, personal utilities, and the optional linked-account feature ("Onyx Mini," accessed via `#pair`).

**Registration is required.** To use commands, register once with `#register <Name> accept`. Registering records your explicit acceptance of these Terms and the Privacy Policy. If you do not agree, do not register or use the Bot.

---

## 1. The Service

The Bot provides automated WhatsApp functionality, including:

* **Community access** — registration (`#register`, `#unregister`), staff ranks and role-based permissions, the TEAM menu (`#team`, `#teamlist`, `#teamstatus`, `#teamset`), member XP/levels and cosmetic member titles (`#level`, `#mystats`, `#leaderboard`), badges (`#badges`), thanks (`#thanks`, `#tophelpers`), profile lookup (`#whois`, self or Mod+), deletion of your own counters (`#resetstats`) and self-service data export/deletion (`#mydata`, `#forgetai`, `#forgetme`).
* **Support & reports** — `#ticket` / `#support` to open a ticket, `#report` to escalate an issue, and owner configuration via `#setsupportgroup` / `#setticketdelivery` (`group`, `dm`, `both`, `off`), `#setticketroute` (per-category groups) and `#setsla` (unanswered-ticket reminders). Support staff reply with `#answer <text>` in the support or routed category group; the answer goes to the reporter and is reposted there with the ticket content and the responder's registered name. Users can check `#mytickets` and close with `#closeticket`.
* **Group moderation** — `#antilink`, `#antispam`, `#antibot`, `#warn`, `#mute`, `#kick`, `#ban`, welcome/goodbye and other group management tools.
* **AI chat** (`#chat`, `#aiclear`, `#aiprompt`) via a connected AI backend.
* **Media processing** (`#sticker`, `#toimg`, `#tomp3`, `#removebg`, `#tiktok`, `#ig`, `#fb`, `#yt`, `#vv`) and search/utilities (`#anime`, `#github`, `#movie`, `#lyrics`, `#translate`, `#img`).
* **Personal utilities** — notes, to-dos, reminders, polls.
* **Onyx Mini** (`#pair`) — optional linking of your own WhatsApp number as a bot-controlled sub-session.

The Bot is provided **"as is" and on a best-effort basis**. Third-party-dependent commands may break, be rate-limited, or stop working without notice.

---

## 2. Eligibility

You must be able to lawfully use WhatsApp and this Bot in your jurisdiction, and meet WhatsApp's own minimum age requirement. Group admins are responsible for how they configure and use the Bot's moderation tools in their groups. You must not use the Bot if you are not legally allowed to accept these Terms.

---

## 3. Registration, Consent & Version Changes

* `#register <Name>` stores your display name, your WhatsApp number and a timestamp, together with the **version hashes** of these Terms and the Privacy Policy.
* `#register <Name> accept` is your explicit declaration that you have read and accepted both documents.
* `#unregister` deletes your registration (and, on request, your consent record). A **30-day cooldown** applies before you can register again.
* We may update these Terms or the Privacy Policy as the Bot changes. Because consent is tied to document version hashes, **material updates require you to re-accept**: the Bot will treat previously stored consents as outdated and ask you to renew them. Continued use after an update constitutes acceptance of the revised documents.
* Registration does not create a paid account. The Bot is currently free.

---

## 4. Acceptable Use

You agree **not** to use the Bot to:

* Send, request, or generate illegal content, including child sexual abuse material (CSAM) in any form — prohibited absolutely and without exception.
* Harass, threaten, defame, stalk, or abuse other users or community members.
* Send spam, phishing links, malware, or unsolicited bulk messages.
* Circumvent moderation features a group admin has enabled, or evade a ban/warning using another number or account.
* Impersonate other users, operators, or support staff; file false reports or abuse the ticket/support system.
* Use media/download commands to infringe copyright or redistribute content you do not have rights to.
* Use owner/administrative commands without authorization, or attempt to exploit, overload, or disrupt the Bot or its infrastructure.
* Use an Onyx Mini session for any activity violating WhatsApp's own Terms of Service.

Group admins remain responsible for moderation decisions made with the Bot's tools in their own groups.

---

## 5. Community Features

* **Ranks** are assigned by the operator and grant tier-dependent permissions. Ranks can be reviewed and changed by the operator; having a rank is a privilege, not a right.
* **Reports** (`#report`) and **support tickets** are forwarded to the configured support group or a routed category group. You must provide truthful information; repeatedly submitting false or abusive reports is a violation of Section 4. Unanswered tickets may trigger one automated SLA reminder to that support/category group; it contains only the ticket ID, category, age and subject.
* **Community statistics / leaderboard** (`#mystats`, `#leaderboard`) are derived from activity counters (messages, commands, reports, tickets, points). They are informational only and may be inaccurate or reset at any time. You can delete your own counters with `#resetstats`. See the Privacy Policy for what is stored.
* **Thanks & badges** are cosmetic: `#thanks @user` can be used once per recipient within 24 hours and grants the recipient 8 helpful XP. `#tophelpers` and `#badges` only display derived counters. They never grant staff permissions and may be reset or removed at any time.
* **Your data** can be exported with `#mydata` (private chat only) and deleted with `#mydata delete` / `#forgetme` (`#forgetai` for AI history only). Registration/consent proof and append-only audit logs remain; use `#unregister` for registration.
* The operator may disable, limit, or reshape any community feature at any time.

---

## 6. Onyx Mini (`#pair`) — Specific Terms

Using `#pair` to link your own WhatsApp number is **optional** and adds the following terms:

* **Your own session:** linking creates a dedicated session/database tied to your number, separate from other users.
* **Operational visibility:** because the Bot operates as your linked account, it necessarily sees activity passing through that session.
* **Continuous automated monitoring:** an always-on automated system watches linked sessions for abuse, spam, illegal activity, and violations of WhatsApp's Terms of Service. It is not occasional. The operator can switch this monitoring off (`#autoflag off`); while it is off, no flags, notices, auto-suspensions or auto-bans are produced.
* **Consequences of a flag:** related activity may be logged for review and/or reviewed by the operator to verify a violation.
* **Termination without notice:** we may suspend or terminate a linked session at any time, at our sole discretion, without guaranteed notice or explanation.
* **No guaranteed uptime or retention:** linked sessions and their data may be lost.
* **Your responsibility:** you remain responsible for your WhatsApp account and any action WhatsApp takes against your number.
* **Consent:** running `#pair` is your explicit agreement to the above.

---

## 7. Monitoring, Logging & Enforcement

To enforce these Terms and to keep audit proof for moderation actions, the Bot processes data as follows:

* **Audit logging (default):** moderation and safety events are written to append-only **plaintext log files** under `logs/` (one file per day). Ban/kick audit records include the actor, target, chat/group, reason, message body and message ID so an action can be proven.
* **Log levels:** the operator chooses between `off`, `audit` (default), `messages` and `raw` via `#log level` / `#fulllog on|off`. `messages` additionally covers message, call, edit and delete events; `raw` adds truncated raw JSON metadata.
* **No media download:** at no level does the Bot download media for logging. `raw` stores metadata and truncated JSON only — never attachment bytes or thumbnails.
* **System log group:** only important safety/system notices are sent there; mere "logged that" confirmations are never posted.
* **No routine chat reading by the operator:** logging exists for enforcement and audit, not for browsing conversations. Where full logging is enabled by the operator, it is an explicit configuration choice and is described transparently in the Privacy Policy.
* **Non-persistent safety snapshot:** in addition to log files, a short RAM-only snapshot of recent messages supports automated checks; it is cleared on restart.

---

## 8. Third-Party Services

Commands may call third-party APIs and platforms (AI backend, GitHub, IMDb-linked sources, Pinterest, lyrics and translation providers, background-removal API, YouTube, TikTok, Instagram, Facebook, file hosting). We do not control them, do not guarantee their availability or accuracy, and are not responsible for their content or policy changes. Their own terms apply to data once it reaches them.

---

## 9. Intellectual Property

Media you send for processing remains yours; we claim no ownership over it. You are responsible for having the right to submit, convert, and redistribute it. AI-generated output is provided for convenience and may be inaccurate or non-original.

---

## 10. Disclaimers

The Bot is provided **without warranties of any kind**. AI responses may be inaccurate, outdated, or inappropriate; do not rely on them for legal, medical, financial, or safety-critical decisions. Community statistics and leaderboard data are informational and may be wrong or reset.

---

## 11. Limitation of Liability

To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages arising from use of the Bot — including loss of data, loss of a linked account, moderation outcomes, or reliance on AI/statistics. Our total liability for any claim is limited to the amount (if any) you paid, which is currently free.

---

## 12. Privacy

Our collection, storage and use of data — including registration data, plaintext log files, report/ticket contents, statistics and the Onyx Mini monitoring system — is described in the [Privacy Policy](./privacy-policy.md). By registering and using the Bot you also agree to that policy.

If you operate a self-hosted main instance yourself, you are the data controller of that instance (Privacy Policy, Section 1.1).

---

## 13. Enforcement & Termination

We may, at our sole discretion and without prior notice:

* Require re-registration or re-acceptance of updated documents.
* Disable commands for a group (`#disable`) or globally (`#flag`).
* Warn, mute, kick, or ban a user (via admin-configured moderation tools).
* Globally ban a user from the Bot (`#ban`).
* Suspend or terminate an Onyx Mini session (Section 6).
* Reject, close, or ignore reports/tickets that are abusive or false.
* Remove ranks, leaderboard entries, or stored user data where permitted.
* Refuse service to anyone for any lawful reason.

---

## 14. Changes to These Terms

We may update these Terms as features change. Material changes are reflected by the "Last updated" date. Because consent is version-hashed, you will be asked to re-accept when documents change. Continued use after changes take effect constitutes acceptance.

---

## 15. Governing Law

These Terms are governed by the laws of Germany/EU, without regard to conflict-of-law principles, except where mandatory consumer-protection law in your country of residence provides otherwise.

---

## 16. Impressum & Contact

Questions about these Terms can be sent to:

WhatsApp: +49 15679 830332 · email: Meros.Basement@gmx.net

Postal address: available on request. For privacy reasons, no publicly listed/actionable postal address is published; it can be requested via the email address above.
