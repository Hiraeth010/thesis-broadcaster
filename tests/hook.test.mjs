// The hook can only be truly exercised in a browser, but the body-extraction
// logic is where it silently failed — a shape it doesn't recognise is a request
// that never existed as far as the extension is concerned. Node has fetch,
// Request and URLSearchParams, so that logic is testable here.

let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

// Mirrors hook.js's fetch wrapper body extraction.
async function extract(input, init) {
  const isRequest = input instanceof Request
  const url = typeof input === 'string' ? input : input?.url
  const method = init?.method ?? (isRequest ? input.method : 'GET') ?? 'GET'
  if (!/^(POST|PUT|PATCH)$/i.test(method)) return null

  const body = init?.body
  if (typeof body === 'string') return { url, body }
  if (body instanceof URLSearchParams) return { url, body: String(body) }
  if (isRequest && !body) {
    const text = await input.clone().text()
    return text ? { url, body: text } : null
  }
  return null
}

const URL_ = 'https://prod-api.fomo.family/trades/comment'
const payload = JSON.stringify({ tradeId: 'abc123', comment: 'dip buy' })

console.log('\nEvery shape fomo could post a thesis in\n')

check('fetch(url, {body: string})', (await extract(URL_, { method: 'POST', body: payload }))?.body === payload)

// The reported failure: typed API clients build a Request, leaving init
// undefined, so `init.body` is never a string and the request vanished.
const req = new Request(URL_, { method: 'POST', body: payload })
check('fetch(new Request(url, {body}))', (await extract(req, undefined))?.body === payload)
check('the original Request is not consumed by our clone', (await req.text()) === payload)

check(
  'fetch(url, {body: URLSearchParams})',
  (await extract(URL_, { method: 'POST', body: new URLSearchParams({ comment: 'dip buy' }) }))?.body === 'comment=dip+buy'
)

check('GET is ignored', (await extract(URL_, { method: 'GET' })) === null)
check('a Request with no body is ignored', (await extract(new Request(URL_, { method: 'POST' }), undefined)) === null)
// Fresh Request: the one above was consumed by the not-consumed check, and a
// body can only be read once — which is why the hook clones before reading.
check(
  'method comes from the Request when init is absent',
  (await extract(new Request(URL_, { method: 'POST', body: payload }), undefined))?.url === URL_
)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
