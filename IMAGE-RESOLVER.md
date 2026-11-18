# Image Resolver — free image retrieval for `#img`

The image logic used to live inline in `src/plugins/search.js`. It is now a
small, standalone module at `src/modules/imageResolver/`. **No paid API, no API
key, no extra hosting, no CAPTCHA service and no new npm dependency were added.**
Everything uses dependencies already in the project (`fetch`, `file-type`).

## What changed for users

Nothing broke. `#img <query>` still searches the same three sources in the same
order and still sends the same image with a source/license caption. One addition:

```text
#img cats                              → search (Pinterest → Openverse → Commons)
#img https://i.pinimg.com/abc.jpg      → resolve a direct image link
#img https://www.pinterest.com/pin/…/  → resolve a public pin page
```

## Module layout

```text
src/modules/imageResolver/
  index.js                  public API, provider orchestration, fallbacks
  constants.js              shared user agent + header helpers
  errors.js                 stable error codes + short user-facing messages
  providers/
    pinterest.js            pin search metadata, pin pages, pinimg CDN links
    openverse.js            Openverse CC search (free, no key)
    commons.js              Wikimedia Commons (free, no key)
    directUrl.js            plain http(s) image links
  utils/
    validator.js            URL/SSRF/MIME/size validation helpers
    download.js             guarded fetch: timeout, redirect checks, size cap
    normalizer.js           magic-byte MIME detection + normalized hit shape
test/imageResolver.test.mjs  mocked tests (no live network, no CAPTCHA bypass)
```

## How resolution works

1. `resolveImage(input)` decides whether the input is a URL or a search query.
2. Providers run in order. Each returns **candidates** (`{ url, provider,
   credit, license, page, ua }`) — multiple candidates allow failover if the
   first image is dead.
3. Every candidate URL goes through the shared guarded downloader:
   - `http`/`https` only, no credentials, ports `80`/`443` only,
   - hostname DNS resolution checked against private/loopback/link-local/
     reserved ranges (including `169.254.169.254` and IPv6 equivalents),
   - redirects are followed manually (max 3 by default) and **each target is
     re-validated** before it is requested,
   - the body is streamed with a hard byte cap, so an oversized file is aborted
     instead of being buffered,
   - hard timeout via `AbortSignal.timeout`,
   - the real MIME type is sniffed from magic bytes with `file-type` — a fake
     `Content-Type: image/png` on an HTML page is rejected.
4. The first valid image becomes `{ buffer, mimeType, size, provider, credit,
   license, page, url }`, which is exactly the shape `#img` already used.
5. If a source is blocked/auth-walled, that is logged internally and the next
   provider is tried. If nothing works and one source was blocked, the clear
   `SOURCE_BLOCKED` / `AUTH_REQUIRED` message is shown instead of a generic
   "no image found".

Technical details are logged through the normal console logger only (`logger.warn`).
Nothing is sent to the system log group, and no cookies, tokens or chat content
are logged.

## Supported sources

| Source | Input | Notes |
|---|---|---|
| Direct link | any public `http(s)` image URL | SSRF-checked, magic-byte validated |
| Pinterest | `pinterest.com/pin/…`, `pin.it/…`, `i.pinimg.com/…`, or a search query | public metadata only |
| Openverse | search query | CC0/PDM/BY, license + attribution in caption |
| Wikimedia Commons | search query | last fallback, thumbnail + license in caption |

Supported image formats: **JPEG, PNG, WEBP, GIF** (configurable via
`IMAGE_ALLOWED_MIMES`).

## Pinterest limitations (important)

- There is **no official Pinterest API access** in this project. Official API
  use requires an approved app/token, i.e. a credential we intentionally do not
  add. The resolver therefore uses only publicly readable pin metadata and the
  public pin search endpoint that the bot already used before this refactor.
- A CAPTCHA, login wall, `401`/`403` or "unusual traffic" response is treated as
  a **final, graceful failure for that request**. There are no retries against
  that source, no proxy/IP rotation, no browser fingerprint spoofing, no
  CAPTCHA-solving service and no attempt to bypass authentication.
- `#img <query>` will fall through to Openverse/Commons when Pinterest is
  blocked (existing behavior). `#img <pinterest-link>` reports the block
  directly, because there is no meaningful fallback for a specific pin.
- Pinterest markup and endpoints change without notice. If it stops working,
  set `PINTEREST_ENABLED=off` and the free search providers continue to work.
- Never paste private pins, authenticated board links or session cookies into
  the bot. The resolver strips cookies from logs, but it cannot read content
  that Pinterest only shows to a logged-in account.

## Error codes

| Code | Meaning | Short user message |
|---|---|---|
| `IMAGE_NOT_FOUND` | no provider returned a usable image | "No image found right now. Try a different search term." |
| `SOURCE_BLOCKED` | CAPTCHA / 403 / automated-access restriction | "Couldn't retrieve this Pinterest image. The source requires additional authentication or restricts automated access." |
| `AUTH_REQUIRED` | login wall / 401 | same as above (Pinterest wording) |
| `UNSUPPORTED_FORMAT` | bytes are not JPG/PNG/WEBP/GIF | "That source didn't return a supported image (JPG, PNG, WEBP or GIF)." |
| `FILE_TOO_LARGE` | body exceeded the byte cap | "That image is too large to send on WhatsApp." |
| `REQUEST_TIMEOUT` | timeout / connection failure | "The image source took too long to respond." |
| `INVALID_URL` | bad scheme, private host, bad port/redirect | "That's not a valid or allowed image URL." |

German equivalents live in `errors.js` and are selected through the bot's
existing `tr()` language helper.

## Configuration

All settings are optional. Add them to the panel `.env` / environment:

```env
# Image resolver (all optional)
IMAGE_MAX_BYTES=10485760       # per-image cap, default 10 MiB (WhatsApp limit)
IMAGE_TIMEOUT_MS=15000         # per-request timeout
IMAGE_MAX_REDIRECTS=3          # redirects followed, each one re-validated
IMAGE_MAX_CANDIDATES=5         # max image URLs tried per command
IMAGE_ALLOWED_MIMES=image/jpeg,image/png,image/webp,image/gif
PINTEREST_ENABLED=on           # set to off to skip Pinterest entirely
PROVIDER_BLOCK_COOLDOWN_MS=600000  # pause a 403/429/captcha source for 10 min
```

If a provider answers `401`, `403`, `429` or shows a CAPTCHA, it gets a
**cooldown** (default 10 minutes, `0` disables it). Subsequent commands skip
that source instead of hammering it, so the free fallbacks answer immediately.
Explicit image links are exempt — they always report their block reason
directly. On a datacenter/hosting IP, Pinterest and Openverse commonly answer
`403`; setting `PINTEREST_ENABLED=off` plus the cooldown means `#img` goes
straight to Wikimedia Commons without wasting requests.

No restart-specific setup is needed beyond the normal panel restart after an
`.env` change.

## Adding a future provider

1. Create a file in `src/modules/imageResolver/providers/`.
2. Export `async function myProvider(value, ctx)` returning an array of
   candidates: `{ url, provider, credit?, license?, page?, ua? }`.
3. Use `guardedFetch(url, { ...ctx, headers, maxBytes })` for all network access —
   this keeps SSRF, timeout and size protections in one place.
4. Throw `ImageError(IMAGE_ERRORS.…)` for expected failures; never throw raw
   fetch errors with URLs/tokens in them.
5. Register it in `index.js`:
   `registerProvider({ name: "my-provider", handle: myProvider }, { kind: "search" })`
   (use `kind: "url"` for explicit-URL providers).
6. Add mocked cases to `test/imageResolver.test.mjs`.

Search providers run before the fallback chain; URL providers only run for an
explicit link. Registration order is the priority order.

## Tests

```bash
npm test
# or
node --test test/imageResolver.test.mjs
```

The suite mocks `fetch` and DNS and covers: valid direct URLs, Pinterest search,
CAPTCHA/login blocks with fallback, pin links, invalid/private URLs, private
redirects, unsupported formats, oversized bodies, timeouts, empty results and
the real `#img` command sending a buffer through a mocked `conn.sendMessage`.
It never contacts a live service and contains no CAPTCHA bypass logic.
