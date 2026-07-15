import { parseRpcSwap } from '../extension/lib/parse.js'

const WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL = 'So11111111111111111111111111111111111111112'
const PUNCH = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'

let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

const tx = ({ pre, post, lamports = [1_000_000_000, 1_000_000_000] }) => ({
  blockTime: 1784000000,
  meta: {
    err: null,
    preBalances: [lamports[0]],
    postBalances: [lamports[1]],
    preTokenBalances: pre.map(([mint, uiAmount]) => ({ owner: WALLET, mint, uiTokenAmount: { uiAmount } })),
    postTokenBalances: post.map(([mint, uiAmount]) => ({ owner: WALLET, mint, uiTokenAmount: { uiAmount } })),
  },
  transaction: { message: { accountKeys: [{ pubkey: WALLET }] }, signatures: ['sigTest'] },
})

console.log('\nSwap parsing from raw RPC balance deltas\n')

const buy = parseRpcSwap(tx({ pre: [[USDC, 500], [PUNCH, 0]], post: [[USDC, 250], [PUNCH, 41666.67]] }), WALLET, 'sigBuy')
check('BUY detected', buy?.side === 'BUY')
check('asset leg is the non-quote token', buy?.asset.mint === PUNCH)
check('quote leg is USDC', buy?.quote.mint === USDC && buy?.quote.amount === 250)
check('price = quote / asset', Math.abs(buy.price - 250 / 41666.67) < 1e-9, String(buy?.price))

const sell = parseRpcSwap(tx({ pre: [[PUNCH, 41666.67], [USDC, 0]], post: [[PUNCH, 0], [USDC, 410]] }), WALLET, 'sigSell')
check('SELL detected', sell?.side === 'SELL')
check('SELL asset leg correct', sell?.asset.mint === PUNCH)

// SOL->USDC has no asset leg worth a thesis.
const q2q = parseRpcSwap(tx({ pre: [[SOL, 1], [USDC, 0]], post: [[SOL, 0], [USDC, 150]] }), WALLET, 'sigQ2Q')
check('quote-to-quote ignored', q2q === null)

// ATA rent (~0.002 SOL) must not be read as the quote leg of a USDC buy.
const withRent = parseRpcSwap(
  tx({ pre: [[USDC, 500], [PUNCH, 0]], post: [[USDC, 250], [PUNCH, 41666.67]], lamports: [1_000_000_000, 997_960_720] }),
  WALLET,
  'sigRent'
)
check('ATA rent dust is not mistaken for the quote leg', withRent?.quote.mint === USDC, withRent?.quote.mint)

// A failed tx moved nothing.
const failed = parseRpcSwap(
  { ...tx({ pre: [[USDC, 500]], post: [[USDC, 250]] }), meta: { err: { InstructionError: [0, 'x'] } } },
  WALLET,
  'sigFail'
)
check('failed transactions ignored', failed === null)

// Balances belonging to someone else in the same tx must not count.
const otherOwner = parseRpcSwap(
  {
    ...tx({ pre: [[USDC, 500]], post: [[USDC, 250]] }),
    meta: {
      err: null,
      preBalances: [1_000_000_000],
      postBalances: [1_000_000_000],
      preTokenBalances: [{ owner: 'SomeoneElse', mint: USDC, uiTokenAmount: { uiAmount: 500 } }],
      postTokenBalances: [{ owner: 'SomeoneElse', mint: PUNCH, uiTokenAmount: { uiAmount: 10 } }],
    },
  },
  WALLET,
  'sigOther'
)
check("another wallet's legs in the same tx are ignored", otherOwner === null)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
