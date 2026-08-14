// Expanded coordination heuristics (M3).
//
// Two signals on top of the base time-window check:
//   1. Same-token: watched wallets touching the same token mint inside one
//      window — the classic signature of coordinated trading.
//   2. Recurring pairs: the same two wallets landing in coordination
//      windows again and again. One co-occurrence can be chance; a
//      repeating pair is a pattern.
import { rpc } from './rpc.mjs';

// Mints whose presence in a tx says nothing about which token is traded.
const WSOL = 'So11111111111111111111111111111111111111112';

// Buffered events are re-analyzed across polls; cache per-signature mints
// so each transaction is fetched once. Bounded since buffers expire.
const mintCache = new Map();
const MINT_CACHE_MAX = 500;

export async function mintsTouched(signature) {
  if (mintCache.has(signature)) return mintCache.get(signature);
  const tx = await rpc('getTransaction', [signature, {
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
  }]);
  const balances = tx?.meta
    ? [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])]
    : [];
  const mints = [...new Set(balances.map((b) => b.mint).filter((m) => m && m !== WSOL))];
  if (mintCache.size >= MINT_CACHE_MAX) mintCache.clear();
  mintCache.set(signature, mints);
  return mints;
}

// events: [{ wallet, signature }]. Returns [{ mint, wallets }] for mints
// touched by 2+ distinct watched wallets. RPC cost is one getTransaction
// per event, so callers only pass events already inside a flagged window.
export async function sameTokenGroups(events) {
  const byMint = new Map();
  for (const ev of events) {
    let mints = [];
    try {
      mints = await mintsTouched(ev.signature);
    } catch (e) {
      console.error(`mint lookup failed for ${ev.signature.slice(0, 16)}…:`, e.message);
    }
    for (const mint of mints) {
      if (!byMint.has(mint)) byMint.set(mint, new Set());
      byMint.get(mint).add(ev.wallet);
    }
  }
  return [...byMint.entries()]
    .filter(([, wallets]) => wallets.size >= 2)
    .map(([mint, wallets]) => ({ mint, wallets: [...wallets] }));
}

// Counts how many coordination windows each wallet pair has shared.
export class PairTracker {
  #counts = new Map();

  // wallets: the distinct wallets of one flagged window.
  // Returns pairs that just reached the threshold (alert once per pair).
  record(wallets, threshold) {
    const reached = [];
    const sorted = [...wallets].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        const n = (this.#counts.get(key) ?? 0) + 1;
        this.#counts.set(key, n);
        if (n === threshold) reached.push({ wallets: [sorted[i], sorted[j]], count: n });
      }
    }
    return reached;
  }
}
