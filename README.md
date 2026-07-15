# thesis-broadcaster

Broadcast your trade thesis to Discord, Telegram and X — triggered by your own on-chain swaps.

Runs entirely on your machine. Your keys never leave it.

You trade (on fomo, or anywhere else on Solana). The swap lands on-chain. A Helius
webhook fires, an alert posts to your channels **immediately**, and when you write a
thesis it **edits that same message in place**.

## Local-first, bring your own keys

Nothing is hosted. There's no server holding anyone's credentials, no accounts, no
database. You run it, you configure it in the dashboard, and your keys sit in
`data/config.json` on your own disk (gitignored).

This matters practically, not just philosophically:

- **X costs nothing.** X's API is priced per *app*, not per user — a hosted service
  would pay ~$100/mo and share one quota across everyone. Here each person brings
  their own X app and gets their own free-tier quota. Verify current limits at
  developer.x.com; they change often.
- **No custody risk.** Nobody has to hand credentials to a third party.
- **Secrets are never sent to the browser.** The API returns `''` plus a
  `configured: true` flag — the UI knows a key is *set*, never what it *is*.

## Why it doesn't touch fomo

fomo has **no public API**. Every `/api/*` path returns the SPA shell, `api.`/`docs.`
don't resolve, real data sits behind `*.prod-edge.fomo.family` under Privy auth, and
their ToS prohibits automated access.

So this reads **the chain** instead, which is public — and the thesis text originates
with you, not from scraping. That has real advantages:

- **Nothing to break.** No private endpoints changing under you.
- **No ToS problem.** Public chain data plus your own words.
- **Portable.** Works on fomo, Axiom, Phantom — anything that swaps on Solana.
- **Self-monetizing.** Every post carries your referral link.

If fomo ever ships a blessed endpoint, it slots in as an extra trigger source. The
architecture doesn't change.

## Setup

```bash
npm install
npm run dev        # http://localhost:3031
```

Open the dashboard and fill in the Setup panel — wallet, Discord, Telegram, X. No
`.env` editing required (though `.env` still works and takes precedence if you
prefer dotfiles).

Then point Helius at your webhook URL:

```bash
npm run webhook:register   # needs HELIUS_API_KEY + WEBHOOK_URL in .env
npm run webhook:list
```

`WEBHOOK_URL` must be publicly reachable — use a tunnel locally.

### Channels

| Channel | Setup | Thesis behaviour |
| --- | --- | --- |
| Discord | Server Settings → Integrations → Webhooks | edits the message in place |
| Telegram | `@BotFather` → token, add bot to channel as admin, hit **Find my channels** | edits the message in place |
| X | your own app at developer.x.com | posts as a **reply** (X has no edit API) |

## How it works

```
your wallet (Solana)
  → Helius webhook  POST /webhook
  → parse swap from net balance deltas
  → alert posts immediately            [automatic, no input needed]
  → you write a thesis
  → message is edited in place         [Discord/Telegram] or replied to [X]
```

Turn off **auto-broadcast** in Setup if you'd rather approve every post before it
goes out; trades then sit as `queued` until you write a thesis.

### The parser

`src/parse.js` derives the swap from **net wallet balance deltas**, not from the
router that produced it — so Jupiter, Relay, or whatever fomo routes through this
month all work without a per-venue adapter.

- Negative delta = sold, positive = bought.
- SOL/USDC/USDT are the quote side; the other leg is the asset.
- Quote-to-quote swaps (SOL→USDC) are ignored — no asset leg worth a thesis.
- Native SOL moves under 0.001 are ignored, so ATA rent (~0.002 SOL) isn't mistaken
  for the quote leg.
- Replayed signatures dedupe, so a webhook retry can't double-post.

## Testing without a real trade

```bash
npm run dev
node scripts/sample-webhook.mjs buy
node scripts/sample-webhook.mjs sell
```

## Status

**Verified end to end against a mock receiver:** setup → save → swap → instant alert
→ thesis → in-place edit. Plus: auto-broadcast toggle, empty-thesis rejection,
dedupe on replay, quote-to-quote filtering, ATA-rent dust handling, and secret
round-trip safety (a blank box can't clobber a stored key; `null` clears it).

**Not verified:** Telegram and X are implemented but have never run against live
credentials — no bot token or X app on hand. Treat both as untested until you point
real ones at them.

**Not done yet:** thesis templates, a packaged distribution for non-technical users,
and the optional browser extension for reading a thesis you wrote in fomo's own UI
(ToS-gray — see the discussion before shipping that).
