# thesis-broadcaster

Broadcast your trade thesis to Discord, Telegram and X — triggered by your own on-chain swaps.

You trade (on fomo, or anywhere else on Solana). The swap lands on-chain. A Helius
webhook fires, the trade shows up in a local dashboard, you write why you took it,
and it fans out to your channels with your referral link attached.

## Why it works this way

fomo has **no public API**. Every `/api/*` path returns the SPA shell, `api.`/`docs.`
don't resolve, the real data sits behind `*.prod-edge.fomo.family` under Privy auth,
and their ToS prohibits automated access.

So this doesn't read fomo at all. It reads **the chain**, which is public — and the
thesis text originates with you, not from scraping. That has some real advantages:

- **Nothing to break.** No dependency on private endpoints changing under you.
- **No ToS problem.** Public chain data plus your own words.
- **Portable.** Works on fomo, Axiom, Phantom, or anything else that swaps on Solana.
- **Self-monetizing.** Every broadcast carries your referral link.

If fomo ever ships a blessed endpoint, drop it in as an extra trigger source. The
architecture doesn't change.

## Setup

```bash
npm install
cp .env.example .env      # fill in WALLET_ADDRESS at minimum
npm run dev               # http://localhost:3031
```

Then point Helius at your webhook URL:

```bash
npm run webhook:register  # needs HELIUS_API_KEY + WEBHOOK_URL
npm run webhook:list
```

In development, `WEBHOOK_URL` needs a public tunnel. In production, use the Railway URL.

### Channels

Configured channels are auto-detected from env — anything unset is skipped, not failed.

| Channel | Setup | Cost |
| --- | --- | --- |
| Discord | Server Settings → Integrations → Webhooks | free |
| Telegram | `@BotFather` → bot token + channel chat id | free |
| X | needs OAuth 1.0a + paid Basic tier | ~$100/mo, ~3k posts |

X is stubbed on purpose (`src/broadcast/x.js`). Discord and Telegram are free and
prove the loop; wire X in once it's worth paying for.

## How it works

```
your wallet (Solana)
  → Helius webhook  POST /webhook
  → parse swap from net balance deltas
  → queue as pending
  → you write the thesis in the dashboard
  → approve → fan out to Discord / Telegram / X
```

**Nothing is sent until you approve it.** These are public posts under your name, so
the queue is approve-before-send by default, not fire-and-forget.

### The parser

`src/parse.js` derives the swap from **net wallet balance deltas**, not from the
router that produced it — so it works for Jupiter, Relay, or whatever fomo routes
through this month, without a per-venue adapter.

- The mint with a negative delta was sold, positive was bought.
- SOL/USDC/USDT are treated as the quote side; the other leg is the asset.
- Quote-to-quote swaps (SOL→USDC) are ignored — no asset leg worth a thesis.
- Native SOL moves under 0.001 are ignored so ATA rent (~0.002 SOL) isn't mistaken
  for the quote leg.
- Replayed signatures dedupe, so a webhook retry can't double-post.

## Testing without a real trade

```bash
npm run dev
node scripts/sample-webhook.mjs   # posts a synthetic Helius SWAP payload
```

## Status

Working end to end: parse → queue → approve → Discord delivery, verified against a
mock receiver. Telegram is implemented but unverified against a live bot. X is a
deliberate stub.

Not yet done: persistent draft sync to the server (drafts are in-memory in the
browser), thesis templates, and a Railway deploy config.
