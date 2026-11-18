import test from "node:test";
import assert from "node:assert/strict";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const HTML = Buffer.from("<html><body>not an image</body></html>");
const PUBLIC_DNS = async () => ["93.184.216.34"];
const PRIVATE_DNS = async () => ["10.0.0.5"];

function fakeResponse({ status = 200, body = Buffer.alloc(0), headers = {} } = {}) {
  const store = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => store.get(String(key).toLowerCase()) ?? null,
      entries: () => store.entries(),
    },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new Uint8Array(body) };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
      async cancel() {},
    },
  };
}

const pngFetch = async () => fakeResponse({ body: PNG, headers: { "content-type": "image/png" } });

function pinSearch(results) {
  return fakeResponse({
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify({ resource_response: { data: { results } } })),
  });
}

function pinterestFetch(searchResponse, { landingOk = true } = {}) {
  return async (url, init) => {
    if (url === "https://www.pinterest.com/") {
      return landingOk
        ? fakeResponse({ headers: { "set-cookie": "csrftoken=testcsrf; Path=/" }, body: HTML })
        : fakeResponse({ status: 503, body: HTML });
    }
    if (url.includes("BaseSearchResource")) {
      assert.equal(init.headers["X-CSRFToken"], "testcsrf");
      return searchResponse;
    }
    return pngFetch();
  };
}

const openverseEmpty = () =>
  fakeResponse({ headers: { "content-type": "application/json" }, body: Buffer.from('{"results":[]}') });
const commonsEmpty = () =>
  fakeResponse({ headers: { "content-type": "application/json" }, body: Buffer.from('{"query":{"pages":{}}}') });

const {
  resolveImage,
  resolveImageUrl,
  ImageError,
  IMAGE_ERRORS,
} = await import("../src/modules/imageResolver/index.js");

test("direct image URL downloads and normalizes metadata", async () => {
  const hit = await resolveImageUrl("https://images.example.com/photo.png", {
    fetchImpl: pngFetch,
    dnsLookup: PUBLIC_DNS,
  });
  assert.equal(hit.mimeType, "image/png");
  assert.equal(hit.provider, "Direct link");
  assert.ok(hit.buffer.equals(PNG));
  assert.equal(hit.size, PNG.length);
});

test("Pinterest search query yields a Pinterest hit with attribution", async () => {
  const fetchImpl = pinterestFetch(
    pinSearch([
      {
        images: { orig: { url: "https://i.pinimg.com/pin.jpg" } },
        title: "Cozy room",
        link: "https://www.pinterest.com/pin/1/",
      },
    ])
  );
  const hit = await resolveImage("cozy room", { fetchImpl, dnsLookup: PUBLIC_DNS });
  assert.equal(hit.provider, "Pinterest");
  assert.equal(hit.credit, "Cozy room");
  assert.ok(hit.buffer.equals(PNG));
});

test("blocked Pinterest search falls back to the next provider", async () => {
  const fetchImpl = async (url, init) => {
    if (url === "https://www.pinterest.com/") {
      return fakeResponse({ headers: { "set-cookie": "csrftoken=x" }, body: HTML });
    }
    if (url.includes("BaseSearchResource")) {
      return fakeResponse({ headers: { "content-type": "text/html" }, body: Buffer.from("px-captcha") });
    }
    if (url.includes("api.openverse.org")) {
      return fakeResponse({
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          results: [{ url: "https://images.example.com/o.jpg", thumbnail: "https://images.example.com/t.jpg", license: "cc0", creator: "Alice" }],
        })),
      });
    }
    return pngFetch();
  };
  const hit = await resolveImage("cats", { fetchImpl, dnsLookup: PUBLIC_DNS });
  assert.equal(hit.provider, "Openverse");
  assert.equal(hit.credit, "Alice");
});

test("explicit Pinterest link with CAPTCHA fails with SOURCE_BLOCKED", async () => {
  const fetchImpl = async () =>
    fakeResponse({ headers: { "content-type": "text/html" }, body: Buffer.from("Please verify you are human - captcha") });
  await assert.rejects(
    resolveImageUrl("https://www.pinterest.com/pin/123/", { fetchImpl, dnsLookup: PUBLIC_DNS }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.SOURCE_BLOCKED
  );
});

test("explicit Pinterest link with login wall fails with AUTH_REQUIRED", async () => {
  const fetchImpl = async () =>
    fakeResponse({ headers: { "content-type": "text/html" }, body: Buffer.from("Please log in to continue") });
  await assert.rejects(
    resolveImageUrl("https://www.pinterest.com/pin/456/", { fetchImpl, dnsLookup: PUBLIC_DNS }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.AUTH_REQUIRED
  );
});

test("direct pinimg CDN link keeps the Pinterest provider", async () => {
  const hit = await resolveImageUrl("https://i.pinimg.com/abc.jpg", {
    fetchImpl: pngFetch,
    dnsLookup: PUBLIC_DNS,
  });
  assert.equal(hit.provider, "Pinterest");
});

test("unsafe URLs are rejected before any request", async () => {
  const cases = [
    "file:///etc/passwd",
    "https://user:secret@example.com/a.png",
    "http://127.0.0.1/a.png",
    "http://169.254.169.254/latest/meta-data/",
    "https://images.example.com:8080/a.png",
    "http://[::1]/a.png",
  ];
  for (const value of cases) {
    await assert.rejects(
      resolveImageUrl(value, { fetchImpl: pngFetch, dnsLookup: PUBLIC_DNS }),
      (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.INVALID_URL,
      value
    );
  }
});

test("hostnames resolving to private addresses are rejected", async () => {
  await assert.rejects(
    resolveImageUrl("https://evil.example.com/a.png", { fetchImpl: pngFetch, dnsLookup: PRIVATE_DNS }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.INVALID_URL
  );
});

test("safe redirects are followed and validated", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://images.example.com/start.png") {
      return fakeResponse({ status: 302, headers: { location: "https://cdn.example.com/final.png" } });
    }
    if (url === "https://cdn.example.com/final.png") return pngFetch();
    throw new Error(`unexpected URL ${url}`);
  };
  const hit = await resolveImageUrl("https://images.example.com/start.png", {
    fetchImpl,
    dnsLookup: PUBLIC_DNS,
  });
  assert.equal(hit.url, "https://cdn.example.com/final.png");
});

test("redirects into private networks are rejected", async () => {
  const fetchImpl = async () =>
    fakeResponse({ status: 302, headers: { location: "http://127.0.0.1/admin" } });
  await assert.rejects(
    resolveImageUrl("https://images.example.com/start.png", { fetchImpl, dnsLookup: PUBLIC_DNS }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.INVALID_URL
  );
});

test("unsupported content is rejected", async () => {
  await assert.rejects(
    resolveImageUrl("https://images.example.com/page.html", {
      fetchImpl: async () => fakeResponse({ body: HTML, headers: { "content-type": "image/png" } }),
      dnsLookup: PUBLIC_DNS,
    }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.UNSUPPORTED_FORMAT
  );
});

test("oversized downloads are stopped while streaming", async () => {
  await assert.rejects(
    resolveImageUrl("https://images.example.com/big.png", {
      fetchImpl: async () => fakeResponse({ body: Buffer.alloc(500, 1) }),
      dnsLookup: PUBLIC_DNS,
      maxBytes: 64,
    }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.FILE_TOO_LARGE
  );
});

test("network timeouts map to REQUEST_TIMEOUT", async () => {
  await assert.rejects(
    resolveImageUrl("https://images.example.com/slow.png", {
      fetchImpl: async () => { throw new DOMException("aborted", "TimeoutError"); },
      dnsLookup: PUBLIC_DNS,
    }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.REQUEST_TIMEOUT
  );
});

test("no provider result maps to IMAGE_NOT_FOUND", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://www.pinterest.com/") {
      return fakeResponse({ headers: { "set-cookie": "csrftoken=x" }, body: HTML });
    }
    if (url.includes("BaseSearchResource")) return pinSearch([]);
    if (url.includes("api.openverse.org")) return openverseEmpty();
    if (url.includes("commons.wikimedia.org")) return commonsEmpty();
    return pngFetch();
  };
  await assert.rejects(
    resolveImage("something obscure", { fetchImpl, dnsLookup: PUBLIC_DNS }),
    (err) => err instanceof ImageError && err.code === IMAGE_ERRORS.IMAGE_NOT_FOUND
  );
});

test("#img command still sends the image through the WhatsApp pipeline", async () => {
  const store = new Map();
  const backend = {
    async get(key) { return store.has(key) ? structuredClone(store.get(key)) : null; },
    async set(key, value) { store.set(key, structuredClone(value)); },
    async del(key) { store.delete(key); },
  };
  const { attachBotKv } = await import("../src/database/botKv.js");
  attachBotKv(backend);
  const { findCommand } = await import("../src/plugins.js");
  await import("../src/plugins/search.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => pngFetch();
  try {
    const cmd = findCommand("#img");
    assert.ok(cmd, "#img command missing");
    const sent = [];
    const conn = {
      sendPresenceUpdate: async () => {},
      sendMessage: async (_jid, content) => {
        sent.push(content);
        return { key: { id: "X1" } };
      },
    };
    const message = {
      body: "#img https://93.184.216.34/pic.png",
      from: "120363424186792881@g.us",
      sender: "4916095344704@s.whatsapp.net",
      key: { fromMe: false, id: "M1", remoteJid: "120363424186792881@g.us" },
      message: { conversation: "#img https://93.184.216.34/pic.png" },
    };
    await cmd.function(message, conn);
    assert.equal(sent.length, 1);
    assert.ok(Buffer.isBuffer(sent[0].image));
    assert.ok(sent[0].image.equals(PNG));
    assert.match(sent[0].caption, /Direct link/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
