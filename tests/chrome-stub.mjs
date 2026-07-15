// Minimal chrome.storage.local so extension modules can be tested in node.
// Only the surface we actually use.
const store = new Map()

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const wanted = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {})
        const out = {}
        for (const k of wanted) if (store.has(k)) out[k] = structuredClone(store.get(k))
        return out
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v))
      },
      async clear() {
        store.clear()
      },
    },
  },
}

export const reset = () => store.clear()
