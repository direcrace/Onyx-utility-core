

export function createTtlCache({ ttlMs = 5 * 60 * 1000, max = 50 } = {}) {
  const store = new Map();

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  function evictOverflow() {
    while (store.size > max) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }

      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },

    set(key, value) {
      evictExpired();
      store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      evictOverflow();
    },

    delete(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },

    get size() {
      return store.size;
    },
  };
}

export const groupCache = createTtlCache({
  ttlMs: 3 * 60 * 1000,
  max: 50,
});

export const msgCache = createTtlCache({
  ttlMs: 5 * 60 * 1000,
  max: 100,
});
