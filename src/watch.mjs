// Polling watcher: pulls new signatures for each wallet, hands them to analysis.
import { rpc } from './rpc.mjs';
import { checkSharedFunder, dumpFunderCache, loadFunderCache } from './funding.mjs';
import { sameTokenGroups, PairTracker } from './heuristics.mjs';
import { watchFunder, pollFunders, dumpFunderState, loadFunderState } from './funderwatch.mjs';
import { fetchFresh, PAGE_LIMIT, MAX_POLL_PAGES } from './sigfetch.mjs';
import { loadState, saveState } from './state.mjs';
import { sendAlert } from './telegram.mjs';

const seen = new Map(); // wallet -> newest signature we already processed
const pairs = new PairTracker();
const recent = []; // event buffer kept across polls, so windows spanning two polls are caught

export function startWatch(config) {
  restoreState();
  const tick = async () => {
    try {
      await pollOnce(config);
    } catch (e) {
      console.error('poll error:', e.message);
    }
    persistState();
    setTimeout(tick, config.pollIntervalSec * 1000);
  };
  tick();
}

function restoreState() {
  try {
    const st = loadState();
    if (!st) return;
    for (const [k, v] of Object.entries(st.seenSigs ?? {})) seen.set(k, v);
    pairs.load(st.pairCounts);
    loadFunderCache(st.funderCache);
    loadFunderState(st.funders);
    console.log(`state restored: ${seen.size} wallet cursor(s) — catching up, not re-baselining`);
  } catch (e) {
    console.error('state restore failed, starting clean:', e.message);
  }
}

function persistState() {
  saveState({
    seenSigs: Object.fromEntries(seen),
    pairCounts: pairs.dump(),
    funderCache: dumpFunderCache(),
    funders: dumpFunderState(),
  });
}

async function pollOnce(config) {
  const windowSec = config.alerts.coordinatedWindowSec ?? 120;
  const fresh = [];
  for (const wallet of config.wallets) {
    const newest = seen.get(wallet);
    // First pass only records the baseline — no alerts for history.
    if (newest === undefined) {
      const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 1 }]);
      if (sigs.length) seen.set(wallet, sigs[0].signature);
      continue;
    }
    const { sigs, complete } = await fetchFresh(wallet, newest);
    if (!sigs.length) continue;
    seen.set(wallet, sigs[0].signature);
    if (!complete) {
      console.log(`note: ${short(wallet)} had over ${PAGE_LIMIT * MAX_POLL_PAGES} new txs this poll; oldest were skipped`);
    }
    for (const s of sigs.reverse()) {
      fresh.push({ wallet, signature: s.signature, blockTime: s.blockTime ?? null });
    }
  }

  for (const ev of fresh) {
    console.log(`tx ${ev.signature.slice(0, 16)}… on ${short(ev.wallet)}`);
    if (config.alerts.newTransaction) {
      await sendAlert(`new tx on ${short(ev.wallet)}\nhttps://solscan.io/tx/${ev.signature}`);
    }
  }

  // Buffer events across polls; drop what has aged out of the window
  // (with slack for block times trailing the wall clock).
  recent.push(...fresh.filter(e => e.blockTime != null));
  const cutoff = Math.floor(Date.now() / 1000) - windowSec * 2;
  const kept = recent.filter(e => e.blockTime >= cutoff);
  recent.length = 0;
  recent.push(...kept);

  // Coordination heuristic: several watched wallets acting inside one time
  // window. Groups are re-derived from the whole buffer each poll; only
  // groups containing an event from this poll are reported.
  const freshSigs = new Set(fresh.map(e => e.signature));
  for (const group of groupByWindow(recent, windowSec)) {
    const wallets = [...new Set(group.map(e => e.wallet))];
    if (wallets.length < 2) continue;
    if (!group.some(e => freshSigs.has(e.signature))) continue; // already reported
    await sendAlert(`⚠ coordinated activity: ${wallets.length} watched wallets active within ${windowSec}s\n${wallets.map(short).join('\n')}`);

    // Same-token: did the wallets in this window touch one mint?
    if (config.alerts.sameToken) {
      const groups = await sameTokenGroups(group.slice(0, 10)); // cap RPC cost per window
      for (const g of groups) {
        await sendAlert(
          `🎯 same-token trading: ${g.wallets.length} watched wallets touched one mint within ${windowSec}s\n` +
          `${g.wallets.map(short).join('\n')}\nhttps://solscan.io/token/${g.mint}`
        );
      }
    }

    // Recurring pairs: same two wallets showing up in windows repeatedly.
    const threshold = config.alerts.repeatPairThreshold ?? 3;
    for (const p of pairs.record(wallets, threshold)) {
      await sendAlert(
        `🔁 recurring pair: ${p.wallets.map(short).join(' + ')} co-active in ${p.count} coordination windows`
      );
    }

    if (config.alerts.sharedFunder) {
      const clusters = await checkSharedFunder(wallets);
      // A discovered funder becomes a watched address itself: its future
      // SOL sends are early warnings of new wallets being provisioned.
      if (config.alerts.funderWatch) {
        for (const c of clusters) watchFunder(c.funder);
      }
    }
  }

  if (config.alerts.funderWatch) {
    await pollFunders(new Set(config.wallets));
  }
}

// Splits the timeline on gaps: a new group starts when the gap to the
// previous event exceeds windowSec. Chained events stay together, so a
// group can span more than windowSec end to end — for alerting we prefer
// over-inclusion to missing a link between adjacent events.
export function groupByWindow(events, windowSec) {
  const timed = events.filter(e => e.blockTime != null).sort((a, b) => a.blockTime - b.blockTime);
  const groups = [];
  let cur = [];
  for (const e of timed) {
    if (cur.length && e.blockTime - cur[cur.length - 1].blockTime > windowSec) {
      groups.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
