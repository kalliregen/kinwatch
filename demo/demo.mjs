// Kinwatch demo: replays a real coordinated launch-buy observed on Solana
// mainnet through the detection stack, then traces funding links.
//
// The example below is public on-chain data: six wallets bought the same
// pump.fun token within the same second (July 2026). Run:
//
//   npm run demo
//
// Stage 1 fetches the transactions and shows the time-window and
// same-token heuristics firing. Stage 2 traces each wallet's funding
// source and reports kin clusters (shared funder). The demo needs an RPC
// that serves historical transactions; the default public endpoint does.
import { rpc } from '../src/rpc.mjs';
import { groupByWindow } from '../src/watch.mjs';
import { mintsTouched } from '../src/heuristics.mjs';
import { traceFunder } from '../src/funding.mjs';

const EXAMPLE = [
  { wallet: 'DpGxaoQzvNnZsJaHWRrFXsPfiuZj6UdZ1om6eMJ3T4Cz', signature: '3s2BWU5Rat4AFZ7UtpZgPhUvHHMsNuXdpqfcDVK6dQoJoJNaVApxAT1UbqHc9WtE56APVRMfMCR52FyrQYsapUry' },
  { wallet: '5BzBjwiKz7tBn5sYA7KzqvwqCjYWdQKdFSirqFhNYJ3Q', signature: 'eCfg6ob5xQheeQkoo23MNny1fb5FZ6uPRwrdnQrtjP9RyewNXg6sxToXQxaZTduqMsjhVzJUMpT5k9YTBodNyFq' },
  { wallet: '2zWFWQA6fDqfMvfYifxzGMChFoCTpoZ2cMsfirbwprme', signature: '586gJn2mPihA4mVBHMiUoKCbd3NuHrwy8PeXZ6AMGmkD7U1pxgJhYwu3ZJmSWfVoiYYeVYrWmwtX9UuG3YX7extK' },
  { wallet: 'BeEN5iWBiEfJsNthuQnQKkKVWg9YkygcQHebNGoVUzik', signature: '5rxTi4Tc8NwPxGzgnauu1VehpiRfTLzC4ei2dd6BvSep8tJbt8e3ba5o26JuiYNoNfrPBhcHFT4Rk6ZWhhtv7UKD' },
  { wallet: 'EW6MZnTnvjgd4hpVnb5VnomSuto2Hok4mmp6Lsb33EhL', signature: '4oR9ZeViABXSDfUZz1MLmT5qubRXDdUrMFySaARMrckUjZY66Htc4ZaCfCLzvdG4XtSRHYzKtdPZMQFKTjQTz2x9' },
  { wallet: 'x1N2WNJW3KcfHSyLDHJwpNThpugD4SQVnGtehPJidV9', signature: '5PgEgq5VgWPySatrFJ8BWdR9Q3CCcxXxQAoTKCbVRZnKz7CDXCtwZSi12xHAJJxbGASoqAQH7FXvDrvcALEJ566T' },
];
const WINDOW_SEC = 120;

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);

console.log('kinwatch demo — replaying a real coordinated buy from mainnet history\n');

// Stage 1: time-window + same-token heuristics on the historical events.
console.log('stage 1: coordination heuristics');
const events = [];
for (const ex of EXAMPLE) {
  const tx = await rpc('getTransaction', [ex.signature, {
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
  }]);
  if (!tx) { console.log(`  tx not found (pruned by RPC): ${short(ex.signature)}`); continue; }
  events.push({ ...ex, blockTime: tx.blockTime });
  console.log(`  ${short(ex.wallet)} tx at blockTime ${tx.blockTime}`);
}

const windows = groupByWindow(events, WINDOW_SEC).filter((g) => new Set(g.map((e) => e.wallet)).size >= 2);
if (!windows.length) {
  console.log('  no coordination window — nothing to analyze');
  process.exit(0);
}
for (const group of windows) {
  const wallets = [...new Set(group.map((e) => e.wallet))];
  const spreadSec = group[group.length - 1].blockTime - group[0].blockTime;
  console.log(`\n  ⚠ coordinated activity: ${wallets.length} wallets within ${spreadSec}s (window ${WINDOW_SEC}s)`);
  const byMint = new Map();
  for (const ev of group) {
    for (const mint of await mintsTouched(ev.signature)) {
      if (!byMint.has(mint)) byMint.set(mint, new Set());
      byMint.get(mint).add(ev.wallet);
    }
  }
  for (const [mint, ws] of byMint) {
    if (ws.size < 2) continue;
    console.log(`  🎯 same-token trading: ${ws.size} wallets touched one mint`);
    console.log(`     https://solscan.io/token/${mint}`);
  }
}

// Stage 2: funding trace — do these wallets share a funding source?
console.log('\nstage 2: funding-chain tracing (fee payer of earliest credit — heuristic)');
const byFunder = new Map();
for (const ex of EXAMPLE) {
  const traced = await traceFunder(ex.wallet);
  console.log(`  ${short(ex.wallet)} <- ${traced ? traced.funder : 'unknown (history deeper than pagination cap)'}`);
  if (!traced) continue;
  if (!byFunder.has(traced.funder)) byFunder.set(traced.funder, []);
  byFunder.get(traced.funder).push(ex.wallet);
}
let found = false;
for (const [funder, kin] of byFunder) {
  if (kin.length < 2) continue;
  found = true;
  console.log(`\n  👥 kin cluster: ${kin.length} wallets share funding source ${short(funder)}`);
  console.log(`     https://solscan.io/account/${funder}`);
}
if (!found) console.log('\n  no shared funder among traced wallets');

console.log('\ndemo complete');
