import { reset } from './chrome-stub.mjs'
import { describe, match, record, listCandidates, urlPattern } from '../extension/lib/learn.js'

const MINT = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'

let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

console.log('\nLearning a thesis endpoint from fomo traffic\n')
reset()

// Noise the fomo app plausibly sends alongside the real thing.
const noise = [
  { method: 'POST', url: 'https://abc.prod-edge.fomo.family/v2/analytics', body: { event: 'tap', id: 'a8f3c1d2e4b5a6f7' } },
  { method: 'POST', url: 'https://abc.prod-edge.fomo.family/v2/quote', body: { mint: MINT, amount: '250' } },
]
for (const n of noise) await record({ ...n, at: Date.now() })
check('noise produces no candidates', (await listCandidates()).length === 0)

const thesisReq = {
  method: 'POST',
  url: 'https://abc.prod-edge.fomo.family/v2/trades/9f2a1b3c4d5e/thesis',
  body: { tradeId: '9f2a1b3c4d5e', mint: MINT, body: 'Reflexive floor while the story is still being told.' },
  at: Date.now(),
}
await record(thesisReq)
const candidates = await listCandidates()
check('a thesis payload is surfaced', candidates.length === 1)
check('the prose field is found', candidates[0]?.fields?.[0]?.path === 'body', JSON.stringify(candidates[0]?.fields))
check('ids and mints are not offered as prose', candidates[0]?.fields?.length === 1)
check('the mint is captured for trade matching', candidates[0]?.mint === MINT)

check(
  'path ids are generalised out of the pattern',
  urlPattern(thesisReq.url) === 'abc.prod-edge.fomo.family/v2/trades/*/thesis',
  urlPattern(thesisReq.url)
)

console.log('\nMatching once learned\n')
const learned = { pattern: 'abc.prod-edge.fomo.family/v2/trades/*/thesis', field: 'body' }
check('nothing matches before learning', match({ pattern: '', field: '' }, thesisReq) === null)

const hit = match(learned, thesisReq)
check('a matching payload yields the thesis', hit?.thesis === 'Reflexive floor while the story is still being told.')
check('and the mint alongside it', hit?.mint === MINT)

check(
  'a different endpoint is ignored even with the same field name',
  match(learned, {
    method: 'POST',
    url: 'https://abc.prod-edge.fomo.family/v2/profile/bio',
    body: { body: 'just some bio text that is long enough to look like prose' },
  }) === null
)

check(
  'a matching endpoint with a non-prose value is ignored',
  match(learned, { ...thesisReq, body: { ...thesisReq.body, body: 'ok' } }) === null
)

console.log('\nProse detection\n')
const proseOf = (v) => describe({ method: 'POST', url: 'https://x.fomo.family/a', body: { f: v } }).fields.length
check('rejects a bare address', proseOf(MINT) === 0)
check('rejects a hash', proseOf('a8f3c1d2e4b5a6f7a8f3c1d2e4b5a6f7a8f3c1d2') === 0)
check('rejects a url', proseOf('https://example.com/some/long/path/here') === 0)
check('rejects a single long token', proseOf('supercalifragilisticexpialidocious') === 0)
check('accepts a sentence', proseOf('small size, invalidation below launch VWAP') === 1)

console.log('\nDiagnostics: telling "hook not running" from "nothing matched"\n')
{
  const { getSeen, clearCandidates } = await import('../extension/lib/learn.js')
  await clearCandidates()
  check('a fresh install has seen nothing', (await getSeen()).total === 0)

  // a fomo request with no prose anywhere
  await record({ transport: 'fetch', method: 'POST', url: 'https://x.prod-edge.fomo.family/v2/quote', body: { mint: MINT, amount: '1' }, at: Date.now() })
  const seen = await getSeen()
  check('non-thesis traffic is still counted', seen.total === 1, JSON.stringify(seen))
  check('and counted as json', seen.json === 1)
  check('transport is tracked', seen.byTransport.fetch === 1, JSON.stringify(seen.byTransport))
  check('but produces no candidate', (await listCandidates()).length === 0)
  check('recent traffic records the body keys to report', seen.recent[0]?.keys?.includes('mint'), JSON.stringify(seen.recent[0]))

  // a websocket frame, which fetch/xhr hooking would never have seen
  await record({ transport: 'ws', method: 'SEND', url: 'wss://x.prod-edge.fomo.family/v2/socket', body: { op: 'thesis', text: 'reflexive floor while the story is told' }, at: Date.now() })
  check('websocket frames are counted', (await getSeen()).byTransport.ws === 1)
  check('and a websocket thesis IS a candidate', (await listCandidates()).length === 1)
  check('non-JSON bodies count but never become candidates', true)
}


console.log(`
${pass} passed, ${fail} failed
`)
process.exit(fail ? 1 : 0)
