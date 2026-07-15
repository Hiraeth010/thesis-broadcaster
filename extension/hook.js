// Runs in the page's own world so it can wrap fetch/XHR/WebSocket before the
// app uses them.
//
// It reads nothing but the requests this tab is already making, and forwards
// only what looks like a thesis to the extension. No session token, cookie or
// auth header is ever captured — headers are dropped entirely, bodies only.
;(() => {
  const MAX_BODY = 20_000

  const post = (payload) => {
    window.postMessage({ source: 'thesis-broadcaster', payload }, window.location.origin)
  }

  // Relative URLs ("/v2/thesis") carry no hostname, so they must be resolved
  // against the page before the host is checked — testing the raw string
  // silently drops every relative request the app makes.
  function absolute(url) {
    try {
      return new URL(url, window.location.href).href
    } catch {
      return String(url ?? '')
    }
  }

  function isFomo(absUrl) {
    try {
      return /(^|\.)fomo\.family$/.test(new URL(absUrl).hostname)
    } catch {
      return false
    }
  }

  /**
   * Everything fomo-bound is reported so the popup can tell "the hook isn't
   * running" apart from "the hook is running but nothing looks like a thesis".
   * Only JSON bodies can ever become candidates.
   */
  function report(transport, method, url, body) {
    if (typeof body !== 'string' || !body || body.length > MAX_BODY) return

    const abs = absolute(url)
    if (transport !== 'ws' && !isFomo(abs)) return

    let parsed = null
    try {
      parsed = JSON.parse(body)
    } catch {
      // not JSON — still counted, never a candidate
    }
    post({ transport, method, url: abs, body: parsed, at: Date.now() })
  }

  const origFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const isRequest = typeof Request !== 'undefined' && input instanceof Request
      const url = typeof input === 'string' ? input : input?.url
      const method = init?.method ?? (isRequest ? input.method : 'GET') ?? 'GET'

      if (/^(POST|PUT|PATCH)$/i.test(method)) {
        const body = init?.body

        if (typeof body === 'string') {
          report('fetch', method, url, body)
        } else if (body instanceof URLSearchParams) {
          report('fetch', method, url, String(body))
        } else if (isRequest && !body) {
          // fetch(new Request(url, {method, body})) puts the body INSIDE the
          // Request, leaving init undefined — the shape typed API clients use.
          // Reading it needs a clone (the original must stay unconsumed) and is
          // async, so this reports slightly late rather than not at all.
          input
            .clone()
            .text()
            .then((text) => {
              if (text) report('fetch', method, url, text)
            })
            .catch(() => {})
        }
      }
    } catch {}
    return origFetch.apply(this, arguments)
  }

  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tb = { method, url }
    return origOpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__tb && /^(POST|PUT|PATCH)$/i.test(this.__tb.method) && typeof body === 'string') {
        report('xhr', this.__tb.method, this.__tb.url, body)
      }
    } catch {}
    return origSend.apply(this, arguments)
  }

  // fomo's CSP allows wss://*.prod-edge.fomo.family, so a thesis may never
  // touch fetch at all. Without this the hook is structurally blind to it.
  const OrigWS = window.WebSocket
  if (OrigWS) {
    const Wrapped = function (url, protocols) {
      const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols)
      const origWsSend = ws.send.bind(ws)
      ws.send = function (data) {
        try {
          if (typeof data === 'string' && isFomo(absolute(url))) report('ws', 'SEND', url, data)
        } catch {}
        return origWsSend(data)
      }
      return ws
    }
    Wrapped.prototype = OrigWS.prototype
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = OrigWS[k]
    window.WebSocket = Wrapped
  }

  console.log('[thesis-broadcaster] watching this tab (fetch, xhr, websocket)')
})()
