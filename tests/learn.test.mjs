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
// Noise is retained so it can be picked by hand, but it must never be *offered*
// as a guess — that's the distinction the picker rests on.
check('noise is never offered as a prose guess', (await listCandidates()).every((c) => c.fields.length === 0))

const thesisReq = {
  method: 'POST',
  url: 'https://abc.prod-edge.fomo.family/v2/trades/9f2a1b3c4d5e/thesis',
  body: { tradeId: '9f2a1b3c4d5e', mint: MINT, body: 'Reflexive floor while the story is still being told.' },
  at: Date.now(),
}
await record(thesisReq)
const candidates = await listCandidates()
const thesisCandidate = candidates.find((c) => c.fields.length)
check('a thesis payload is surfaced as a guess', Boolean(thesisCandidate), JSON.stringify(candidates.map((c) => c.pattern)))
check('and it is the only guess among the noise', candidates.filter((c) => c.fields.length).length === 1)
check('the prose field is found', thesisCandidate?.fields?.[0]?.path === 'body', JSON.stringify(thesisCandidate?.fields))
check('ids and mints are not offered as prose', thesisCandidate?.fields?.length === 1)
check('the mint is captured for trade matching', thesisCandidate?.mint === MINT)

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

// Deliberately reversed: a learned field is obeyed, not re-guessed. "ok" is a
// perfectly valid thesis, and re-running the picker's heuristic here was
// silently dropping short ones on the correct endpoint.
check(
  'a short value on the learned endpoint IS accepted',
  match(learned, { ...thesisReq, body: { ...thesisReq.body, body: 'ok' } })?.thesis === 'ok'
)
check(
  'an empty value on the learned endpoint is not',
  match(learned, { ...thesisReq, body: { ...thesisReq.body, body: '  ' } }) === null
)

console.log('\nProse detection\n')
const proseOf = (v) => describe({ method: 'POST', url: 'https://x.fomo.family/a', body: { f: v } }).fields.length
check('rejects a bare address', proseOf(MINT) === 0)
check('rejects a hash', proseOf('a8f3c1d2e4b5a6f7a8f3c1d2e4b5a6f7a8f3c1d2') === 0)
check('rejects a url', proseOf('https://example.com/some/long/path/here') === 0)
check('rejects a single long token', proseOf('supercalifragilisticexpialidocious') === 0)
check('accepts a sentence', proseOf('small size, invalidation below launch VWAP') === 1)

console.log('\nA learned field is believed, not re-guessed\n')
{
  const learned = { pattern: 'prod-api.fomo.family/trades/comment', field: 'comment' }
  const req = (comment) => ({
    method: 'POST',
    url: 'https://prod-api.fomo.family/trades/comment',
    body: { tradeId: 'abc123', comment },
  })

  // The reported failure: the picker's heuristic was re-applied after learning,
  // so a short thesis on the correct endpoint was silently dropped.
  check('a short thesis still matches once learned', match(learned, req('dip buy'))?.thesis === 'dip buy')
  check('a single word matches too', match(learned, req('sending'))?.thesis === 'sending')
  check('"gm" matches', match(learned, req('gm'))?.thesis === 'gm')
  check('a long thesis still matches', Boolean(match(learned, req('Reflexive floor while the story is told'))))
  check('but empty does not', match(learned, req('   ')) === null)
  check('and a missing field does not', match(learned, { ...req('x'), body: { tradeId: 'a' } }) === null)
}

console.log('\nShort theses are offered in the picker\n')
{
  const fieldsOf = (v) => describe({ method: 'POST', url: 'https://x.fomo.family/a', body: { f: v } })
  check('"adding more" is now a candidate', fieldsOf('adding more').fields.length === 1)
  check('"dip buy" is now a candidate', fieldsOf('dip buy').fields.length === 1)
  check('an rpc method name is not', fieldsOf('getBalance').fields.length === 0)
  check('a uuid is not', fieldsOf('9f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8').fields.length === 0)

  // Even when the heuristic offers nothing, the field must be pickable by hand.
  const rpc = describe({ method: 'POST', url: 'https://x.fomo.family/a', body: { method: 'getBalance', jsonrpc: '2.0' } })
  check('non-prose fields are still offered for manual picking', rpc.allFields.some((f) => f.path === 'method'))
  check('but ids are excluded even from manual picking', !fieldsOf('9f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8').allFields.length)
}

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
  check('but is never offered as a guess', (await listCandidates()).every((c) => c.fields.length === 0))
  check('recent traffic records the body keys to report', seen.recent[0]?.keys?.includes('mint'), JSON.stringify(seen.recent[0]))

  // a websocket frame, which fetch/xhr hooking would never have seen
  await record({ transport: 'ws', method: 'SEND', url: 'wss://x.prod-edge.fomo.family/v2/socket', body: { op: 'thesis', text: 'reflexive floor while the story is told' }, at: Date.now() })
  check('websocket frames are counted', (await getSeen()).byTransport.ws === 1)
  const wsGuesses = (await listCandidates()).filter((c) => c.transport === 'ws' && c.fields.length)
  check('and a websocket thesis IS offered as a guess', wsGuesses.length === 1, JSON.stringify(wsGuesses))
  check('with the right field', wsGuesses[0]?.fields[0]?.path === 'text')
}


console.log(`
${pass} passed, ${fail} failed
`)
process.exit(fail ? 1 : 0)
