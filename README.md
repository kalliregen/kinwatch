# Kinwatch

Kinwatch is a read-only Solana watchdog. It monitors a configured wallet list, detects activity within the same time window, and sends Telegram alerts with transaction links.

The watcher and baseline coordination alerts work now. Funding-chain tracing and broader coordination heuristics are in progress.

## Quickstart

```bash
git clone https://github.com/kalliregen/kinwatch
cd kinwatch
cp config.example.json config.json
cp .env.example .env
npm start
```

Node.js only. No runtime dependencies.

## Configuration

`config.json`:

- `wallets`: Solana addresses to monitor
- `pollIntervalSec`: RPC polling interval, in seconds
- `alerts.coordinatedWindowSec`: time window for coordination detection
- `alerts.newTransaction`, `alerts.sharedFunder`: alert toggles

`.env`:

- `RPC_URL`: any Solana RPC endpoint
- `TELEGRAM_BOT_TOKEN`: optional
- `TELEGRAM_CHAT_ID`: optional

Without Telegram credentials, alerts are written to the console.

## Roadmap

- M1: Wallet watcher and Telegram alerts — complete
- M2: Funding-chain tracing and shared-funder "kin" clusters — in progress
- M3: Expanded coordination heuristics, documentation, and demo — in progress

## License

MIT
