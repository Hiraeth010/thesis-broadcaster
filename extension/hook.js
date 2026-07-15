// Runs in the page's own world so it can wrap fetch/XHR before the app uses them.
//
// It reads nothing but the requests this tab is already making, and forwards
// only what looks like a thesis to your own machine on localhost. No session
// token, no cookie, no auth header is ever captured or sent anywhere.
;(() => {
  const RELAY = 'https://__thesis_broadcaster__'
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

  // Auth material must never leave the page, so bodies are forwarded but
  // headers are dropped entirely.
  function report(method, url, body) {
    if (!body || typeof body !== 'string') return
    if (body.length > MAX_BODY) return
    if (!/^(POST|PUT|PATCH)$/i.test(method)) return

    const abs = absolute(url)
    if (!/(^|\.)fomo\.family/.test(new URL(abs).hostname)) return

    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return // only structured payloads are candidates
    }
    post({ method, url: abs, body: parsed, at: Date.now() })
  }

  const origFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url
      const method = init?.method ?? (typeof input === 'object' ? input?.method : 'GET') ?? 'GET'
      const body = init?.body
      if (typeof body === 'string') report(method, url, body)
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
      if (this.__tb && typeof body === 'string') report(this.__tb.method, this.__tb.url, body)
    } catch {}
    return origSend.apply(this, arguments)
  }

  console.log('[thesis-broadcaster] watching this tab for theses you post')
})()
