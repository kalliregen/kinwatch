// Polling watcher: pulls new signatures for each wallet, hands them to analysis.
import { rpc } from './rpc.mjs';
import { checkSharedFunder } from './funding.mjs';
import { sendAlert } from './telegram.mjs';

const seen = new Map(); // wallet -> newest signature we already processed

export function startWatch(config) {
  const tick = async () => {
    try {
      await pollOnce(config);
    } catch (e) {
      console.error('poll error:', e.message);
    }
    setTimeout(tick, config.pollIntervalSec * 1000);
  };
  tick();
}

async function pollOnce(config) {
  const events = [];
  for (const wallet of config.wallets) {
    const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 10 }]);
    const newest = seen.get(wallet);
    const fresh = [];
    for (const s of sigs) {
      if (s.signature === newest) break;
      fresh.push(s);
    }
    if (sigs.length) seen.set(wallet, sigs[0].signature);
    // First pass only records the baseline — no alerts for history.
    if (newest === undefined) continue;
    for (const s of fresh.reverse()) {
      events.push({ wallet, signature: s.signature, blockTime: s.blockTime ?? null, err: s.err });
    }
  }

  for (const ev of events) {
    console.log(`tx ${ev.signature.slice(0, 16)}… on ${short(ev.wallet)}`);
    if (config.alerts.newTransaction) {
      await sendAlert(`new tx on ${short(ev.wallet)}\nhttps://solscan.io/tx/${ev.signature}`);
    }
  }

  // Coordination heuristic: several watched wallets acting inside one time window.
  const windowSec = config.alerts.coordinatedWindowSec ?? 120;
  const inWindow = groupByWindow(events, windowSec);
  for (const group of inWindow) {
    const wallets = [...new Set(group.map(e => e.wallet))];
    if (wallets.length < 2) continue;
    await sendAlert(`⚠ coordinated activity: ${wallets.length} watched wallets active within ${windowSec}s\n${wallets.map(short).join('\n')}`);
    if (config.alerts.sharedFunder) await checkSharedFunder(wallets);
  }
}

function groupByWindow(events, windowSec) {
  const timed = events.filter(e => e.blockTime).sort((a, b) => a.blockTime - b.blockTime);
  const groups = [];
  let cur = [];
  for (const e of timed) {
    if (cur.length && e.blockTime - cur[0].blockTime > windowSec) {
      groups.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
