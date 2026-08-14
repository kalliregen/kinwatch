# Kinwatch

Kinwatch is a read-only Solana watchdog. It monitors a configured wallet list, detects coordinated activity, traces funding links, and sends Telegram alerts with transaction links. No private keys, no transactions — observation only.

## Quickstart

```bash
git clone https://github.com/kalliregen/kinwatch
cd kinwatch
cp config.example.json config.json
cp .env.example .env
npm start
```

Node.js only. No runtime dependencies.

## How detection works

Kinwatch polls `getSignaturesForAddress` for each watched wallet. The first pass records a baseline; after that, every new transaction becomes an event. Four heuristics run on top:

1. **Time window.** Two or more watched wallets active within `coordinatedWindowSec` of each other trigger a coordination alert. Events are buffered across polling cycles, so coordination that straddles two polls is still caught; grouping splits on gaps larger than the window, so a chain of close events stays in one group. This is the base signal — cheap and unconditional.
2. **Same token.** For events inside a flagged window, Kinwatch fetches the transactions and extracts the token mints they touched (wrapped SOL excluded). Two or more wallets touching the same mint in one window is the classic signature of coordinated trading, and gets its own alert. Transaction lookups are capped per window to bound RPC cost.
3. **Recurring pairs.** One co-occurrence can be chance. Kinwatch counts how many coordination windows each wallet pair has shared and alerts once when a pair reaches `repeatPairThreshold`.
4. **Shared funder (kin clusters).** Each wallet's history is walked back to its earliest transaction, and that transaction's fee payer is taken as the funding source. Watched wallets sharing a funding source form a "kin" cluster. The attribution is a heuristic (fee payer of earliest credit) and alerts label it as such; wallets whose history is deeper than the pagination cap resolve to *unknown* rather than guessing.
5. **Funder watch (early warning).** A funder discovered through a kin cluster becomes a watched address itself. When it sends SOL to a plain wallet Kinwatch has not seen before, that is flagged as a possible new cluster member being provisioned — before the wallet ever trades. Transfers to program-owned accounts (token accounts, pool PDAs) are ignored as the funder's own trading, and each destination is reported once. Funder-watch lookups run under a per-poll budget so a busy funder cannot stall wallet polling; whatever does not fit defers to the next poll.

All alerts go to Telegram when a bot is configured, otherwise to the console. RPC calls retry with exponential backoff on rate limits, so the default public endpoint works out of the box.

## State

Kinwatch persists its cursors and counters to `data/state.json` after every poll (atomic write, gitignored). A restart resumes from the saved baseline: events that happened while the watcher was down are caught up instead of silently skipped, and pair counters and discovered funders carry over. Delete the file to start fresh.

## Demo

Replay a real coordinated buy from mainnet history — six wallets that bought the same pump.fun token within one second, traced back to their funding sources (five of them resolve to a single shared funder):

```bash
npm run demo
```

```
  ⚠ coordinated activity: 6 wallets within 0s (window 120s)
  🎯 same-token trading: 6 wallets touched one mint
     https://solscan.io/token/3Vq2…g2UU

  👥 kin cluster: 5 wallets share funding source BY4S…BEcx
     https://solscan.io/account/BY4S…BEcx
```

The demo uses public on-chain data and needs an RPC that serves historical transactions. The default public endpoint (`api.mainnet-beta.solana.com`) does; some free RPCs prune old history and will report the transactions as not found.

## Configuration

`config.json`:

- `wallets`: Solana addresses to monitor
- `pollIntervalSec`: RPC polling interval, in seconds
- `alerts.newTransaction`: alert on every new transaction
- `alerts.coordinatedWindowSec`: time window for coordination detection
- `alerts.sameToken`: check flagged windows for same-mint trading
- `alerts.repeatPairThreshold`: co-occurrence count that flags a recurring pair
- `alerts.sharedFunder`: trace funding links for wallets in flagged windows
- `alerts.funderWatch`: watch discovered funders and flag new wallets they provision (needs `sharedFunder`)

`.env`:

- `RPC_URL`: any Solana RPC endpoint
- `TELEGRAM_BOT_TOKEN`: optional
- `TELEGRAM_CHAT_ID`: optional

Without Telegram credentials, alerts are written to the console.

## Roadmap

- M1: Wallet watcher and Telegram alerts — complete
- M2: Funding-chain tracing and shared-funder "kin" clusters — complete
- M3: Expanded coordination heuristics (same-token, recurring pairs), documentation, and demo — complete
- Beyond the grant scope: funder watch (early warning on newly provisioned wallets) and persistent state across restarts — complete

## License

MIT
