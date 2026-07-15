# thesis broadcaster

Post your trades to Discord, Telegram and X automatically — and add your thesis after.

Runs on your own computer. Your keys never leave it.

---

## Get started

**Download it** from [Releases](https://github.com/Hiraeth010/thesis-broadcaster/releases) —
one file, nothing to install. Double-click it. Your browser opens.

Then paste your wallet address in the Setup box and connect a channel. That's it.

There's nothing to host, no account to make, no port to open, and no Node.js to install.

<details>
<summary>Running from source instead</summary>

Install [Node.js](https://nodejs.org) (the green LTS button), then double-click
`start.bat` (Windows) or `start.sh` (Mac/Linux). First run installs dependencies and
takes a minute.

</details>

---

## Connecting your channels

**Discord** — Server Settings → Integrations → Webhooks → New Webhook → Copy URL. Paste it in.

**Telegram** — message [@BotFather](https://t.me/botfather), send `/newbot`, copy the token.
Add your bot to your channel **as an admin**, post any message there, then hit
**Find my channels** and it fills in the rest.

**X — optional, and it costs money.** X killed its free API tier in February 2026. It's
[pay-per-use](https://docs.x.com/x-api/getting-started/pricing): **$0.015 per post, or
$0.200 if the post contains a link.** No free tier, no subscription.

Because of that, your referral link is **off for X by default** and on everywhere else.
Same post, same CA, no link — `$0.015` instead of `$0.200`, about 13× cheaper. Tick the
X box under the referral link if you want it there anyway.

You bring your own app from [developer.x.com](https://developer.x.com), so the bill is
yours. That's also why there's no "log in with X" button: OAuth would put every user's
posts on *our* bill, which is a cost that grows with every new user.

Discord and Telegram are free. Start there — most people never need X.

You can connect one or all three. Anything you leave blank is simply skipped.

On X, a long thesis is trimmed to fit 280 characters — the CA is never trimmed.

---

## How it works

```
you make a trade  (on fomo, or anywhere else on Solana)
        ↓
  we spot it on-chain, within ~15 seconds
        ↓
  an alert goes out to your channels        ← automatic, no contract address
        ↓
  you write your thesis when you feel like it
        ↓
  a second post goes out with your reasoning + the CA
```

By default you write that thesis in the dashboard at `localhost:3031`. If you'd rather
write it in fomo itself and have it broadcast from there, there's an optional
[browser extension](extension/) — **read its warning first**, it's against fomo's terms
and the risk lands on your account.

**The contract address only ever appears on the thesis post.** The alert just says a
trade happened; the thesis is the one that invites people to act on it.

Every thesis is a **new message**, never an edit. Post again on the same trade and it
sends another one — useful for adding to a position, or updating your call.

Prefer to check before anything goes out? Turn off **auto-broadcast** in Setup and
nothing posts until you write a thesis and press the button.

---

## Common questions

**Do I need to leave it running?** No. Tick **"Keep running in the background"** in the
dashboard and it starts with your computer and stays running with no window — you only
open `localhost:3031` when you want to write a thesis. Untick it to stop.

It uses your OS's own mechanism: Task Scheduler on Windows, a LaunchAgent on macOS, a
systemd user service on Linux. All three restart it if it ever crashes. Nothing is
installed system-wide and no admin rights are needed.

You can also do it from a terminal:

```bash
thesis-broadcaster --install     # background mode on
thesis-broadcaster --status      # is it on?
thesis-broadcaster --uninstall   # off again
```

**Will it post my old trades?** No. The first time it sees your wallet it marks the
spot and only watches from then on.

**Do I need an API key?** No, but it helps. Without one it uses a free public Solana
node that gets rate-limited, and you may miss trades. A free key from
[helius.dev](https://helius.dev) takes a minute and makes it reliable. Setup →
Connection.

**Where are my keys stored?** In `data/config.json`, on your computer. Nothing is sent
anywhere except the channels you connect. The app never shows your keys back to you
in the browser — once saved, a field just says "configured".

**Does this connect to my fomo account?** No. It never touches fomo, never asks for
your fomo login, and can't move your money. It only reads public blockchain data.

---

## For developers

### Why it doesn't touch fomo

fomo has **no public API** — every `/api/*` path returns the SPA shell, `api.`/`docs.`
don't resolve, real data sits behind `*.prod-edge.fomo.family` under Privy auth, and
their ToS prohibits automated access.

So this reads **the chain**, which is public, and the thesis text originates with you.
Nothing to break, no ToS exposure, and it works identically on Axiom, Phantom, or
anything else that swaps on Solana. If fomo ever ships a real endpoint, it slots in as
an extra trigger source without changing the architecture.

### Why polling, not webhooks

Webhooks need a publicly reachable URL. Normal people don't have one, and "run a
tunnel" is worse than the problem. `src/poller.js` polls `getSignaturesForAddress`
instead, so it works from any laptop behind NAT with no inbound anything.

The `POST /webhook` endpoint still exists for anyone who wants to point Helius at it:

```bash
npm run webhook:register   # needs HELIUS_API_KEY + WEBHOOK_URL in .env
```

### The parser

`src/parse.js` derives swaps from **net wallet balance deltas**, not per-router
adapters — Jupiter, Relay, whatever fomo routes through this month all work unchanged.
Two input shapes feed one core: Helius enhanced payloads (webhook) and raw
`getTransaction` (poller, any RPC, no key required).

- Negative delta sold, positive bought; SOL/USDC/USDT are the quote side.
- Quote-to-quote (SOL→USDC) ignored — no asset leg worth a thesis.
- Native SOL under 0.001 ignored, so ATA rent (~0.002 SOL) isn't read as the quote leg.
- Replayed signatures dedupe.

### Cursor safety

The poller's cursor only advances past signatures it actually dealt with. A
**rate-limited** fetch is retriable: the walk stops and the next poll resumes there.
Only a permanently unreadable tx (non-archive node, "not found") is skipped. Getting
this wrong meant silently dropping every trade while looking healthy — see the tests.

### Config

`.env` takes precedence over the Setup UI, so dotfile users are unaffected. Anything
set in `.env` shows as locked in the UI.

### Building the binary

```bash
npm run build     # -> build/thesis-broadcaster[.exe], ~90 MB
```

Node's SEA support, so **it cannot cross-compile** — each platform builds its own.
CI (`.github/workflows/build.yml`) builds all three and smoke-tests that each binary
actually boots and serves before uploading. Tag `v*` to publish a release.

`src/paths.js` is the seam: packaged builds resolve `data/` next to the executable
and serve the dashboard from an embedded SEA asset; source runs read from disk.

### Testing without a real trade

```bash
npm run dev
node scripts/sample-webhook.mjs buy
node scripts/sample-webhook.mjs sell
```

### Testing Telegram

```bash
npm run test:telegram            # mock — no token needed, nothing is sent
npm run test:telegram -- --live  # real Telegram, POSTS TO YOUR CHANNEL
```

The mock (`scripts/mocks/telegram.mjs`) validates against the documented Bot API
contract — payload shape, HTML escaping, error handling — rather than accepting
anything. It catches most bugs, but only `--live` proves Telegram itself accepts what
we send.

---

## Status

**Verified:** setup → save → swap → alert (no CA) → thesis → separate post (with CA),
against a mock receiver — including posting a thesis twice and getting two distinct
messages. The standalone `.exe` was tested in an empty folder with no Node, no
`node_modules` and no source: it boots, serves the embedded dashboard, and writes
`data/` beside itself. Parser validated against **real mainnet blocks**. Cursor logic
tested across four RPC failure modes (healthy / rate-limited / not-found / partial).
Plus auto-broadcast toggle, empty-thesis rejection, dedupe, quote-to-quote filtering,
ATA-rent dust, X's 280-char clamp keeping the CA intact, and secret round-trip safety.

**Telegram** passes 12 contract tests against a mock that enforces the documented Bot
API — including that a thesis full of `<script>` tags gets escaped rather than
rejected. That is not the same as proving live Telegram accepts it: run
`npm run test:telegram -- --live` with a real token to close that gap.

**Background mode is verified on all three platforms, on real machines.**

- **Windows** — tested by hand, end to end: the task registers, the app runs hidden,
  killing it brings it back in ~15–20s, the 1-minute repetition doesn't stack
  duplicates, and uninstall stops it and it stays stopped. Also verified using the
  *published* binary from Releases, not just a local build. Three mechanisms were
  tried before one worked — see the comments in `src/service.js`.
- **macOS and Linux** — tested in CI on `macos-latest` and `ubuntu-latest`, which are
  real machines of each OS. Both register, actually serve HTTP, and uninstall
  cleanly: `launchctl list` shows `com.thesis-broadcaster` with a live PID, and
  `systemctl --user` reports `active (running)`.

Not covered by CI: reboot survival, and self-heal after a kill on macOS/Linux
(Windows has both).

**Not verified:** X has never run against live credentials. Treat as untested until
you point a real app at it.

**Not done:** thesis templates, code signing (Windows/macOS will warn on an unsigned
binary), and the optional browser extension for reading a thesis written in fomo's own
UI (ToS-gray — read the discussion before shipping that).
