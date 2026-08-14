// Funding-link tracing (M2).
//
// For each wallet, walk its signature history back to the earliest
// transaction that credited it, and take that transaction's fee payer as
// the funding source. Wallets sharing one funding source form a "kin"
// cluster — the strongest practical signal of a coordinated group.
//
// The funder attribution is a heuristic (fee payer of the earliest
// credit), and alerts label it as such.
import { rpc } from './rpc.mjs';
import { sendAlert } from './telegram.mjs';

const MAX_PAGES = 25; // pagination cap; very old/busy wallets resolve to unknown
const funderCache = new Map(); // wallet -> { funder, signature } | null

export async function traceFunder(wallet) {
  if (funderCache.has(wallet)) return funderCache.get(wallet);

  let before;
  let oldest;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 1000, before }]);
    // Short or empty page — we have reached the start of the history.
    // (Empty happens when the history is an exact multiple of the page size.)
    if (sigs.length) {
      oldest = sigs[sigs.length - 1];
      before = oldest.signature;
    }
    if (sigs.length < 1000) {
      const result = oldest ? await funderFromTx(wallet, oldest.signature) : null;
      funderCache.set(wallet, result);
      return result;
    }
  }
  funderCache.set(wallet, null); // history deeper than the cap — honest unknown
  return null;
}

async function funderFromTx(wallet, signature) {
  const tx = await rpc('getTransaction', [signature, {
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
  }]);
  if (!tx?.transaction) return null;
  const keys = tx.transaction.message.accountKeys;
  const feePayer = typeof keys[0] === 'string' ? keys[0] : keys[0]?.pubkey;
  if (!feePayer || feePayer === wallet) return null;
  return { funder: feePayer, signature };
}

export async function checkSharedFunder(wallets) {
  const byFunder = new Map();
  for (const wallet of wallets) {
    try {
      const traced = await traceFunder(wallet);
      if (!traced) continue;
      if (!byFunder.has(traced.funder)) byFunder.set(traced.funder, []);
      byFunder.get(traced.funder).push(wallet);
    } catch (e) {
      console.error(`funding trace failed for ${wallet}:`, e.message);
    }
  }

  for (const [funder, kin] of byFunder) {
    if (kin.length < 2) continue;
    const lines = kin.map(w => `  ${short(w)}`).join('\n');
    await sendAlert(
      `👥 kin cluster: ${kin.length} watched wallets share a funding source\n` +
      `funder (fee payer of earliest credit): ${short(funder)}\n${lines}\n` +
      `https://solscan.io/account/${funder}`
    );
  }
}

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
