// Funder watch: once a kin cluster's funding source is known, watch the
// funder itself. When it sends SOL to an address we have not seen before,
// that is an early warning — a new cluster member may be getting
// provisioned before it ever trades.
import { rpc } from './rpc.mjs';
import { fetchFresh } from './sigfetch.mjs';
import { sendAlert } from './telegram.mjs';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MAX_FUNDERS = 10; // RPC budget guard
const ALERTED_MAX = 1000;

const cursors = new Map(); // funder -> newest processed signature (null until baselined)
const alerted = new Set(); // destinations already reported — one alert per address

export function watchFunder(funder) {
  if (cursors.has(funder)) return false;
  if (cursors.size >= MAX_FUNDERS) {
    console.log(`note: funder watch is full (${MAX_FUNDERS}), not adding ${short(funder)}`);
    return false;
  }
  cursors.set(funder, null); // baselined on the next poll — no alerts for history
  console.log(`funder watch: now watching ${short(funder)}`);
  return true;
}

export async function pollFunders(knownWallets) {
  for (const [funder, newest] of cursors) {
    try {
      if (newest === null) {
        const sigs = await rpc('getSignaturesForAddress', [funder, { limit: 1 }]);
        if (sigs.length) cursors.set(funder, sigs[0].signature);
        continue;
      }
      const { sigs, complete } = await fetchFresh(funder, newest);
      if (!sigs.length) continue;
      cursors.set(funder, sigs[0].signature);
      if (!complete) console.log(`note: funder ${short(funder)} had more new txs than the page cap; oldest were skipped`);
      for (const s of sigs.reverse()) {
        if (s.err) continue;
        await checkFundingTx(funder, s.signature, knownWallets);
      }
    } catch (e) {
      console.error(`funder poll failed for ${short(funder)}:`, e.message);
    }
  }
}

async function checkFundingTx(funder, signature, knownWallets) {
  const tx = await rpc('getTransaction', [signature, {
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
  }]);
  if (!tx?.transaction) return;
  for (const dest of solRecipients(tx, funder)) {
    if (dest === funder || knownWallets.has(dest) || cursors.has(dest) || alerted.has(dest)) continue;
    if (alerted.size >= ALERTED_MAX) alerted.clear();
    alerted.add(dest); // one alert per destination, even if the owner check fails
    if (!(await isPlainWallet(dest))) continue; // program/token accounts are not fresh wallets
    await sendAlert(
      `🕸 funder activity: ${short(funder)} sent SOL to new wallet ${short(dest)} — possible cluster member being provisioned\n` +
      `https://solscan.io/account/${dest}\nhttps://solscan.io/tx/${signature}`
    );
  }
}

// A freshly provisioned wallet is a plain system-owned account; transfers
// to program-owned accounts (token accounts, pool PDAs) are the funder's
// own trading, not wallet provisioning.
async function isPlainWallet(address) {
  try {
    const info = await rpc('getAccountInfo', [address, { encoding: 'base64' }]);
    return info?.value?.owner === SYSTEM_PROGRAM;
  } catch (e) {
    console.error(`owner check failed for ${short(address)}:`, e.message);
    return false;
  }
}

// System-program transfers/account creations funded by `from`, including
// ones nested inside inner instructions.
export function solRecipients(tx, from) {
  const out = new Set();
  const groups = [
    tx.transaction.message.instructions ?? [],
    ...(tx.meta?.innerInstructions ?? []).map((g) => g.instructions ?? []),
  ];
  for (const list of groups) {
    for (const ins of list) {
      if (ins.program !== 'system') continue;
      const { type, info } = ins.parsed ?? {};
      if (type === 'transfer' && info?.source === from && info.destination) out.add(info.destination);
      if (type === 'createAccount' && info?.source === from && info.newAccount) out.add(info.newAccount);
    }
  }
  return out;
}

export function dumpFunderState() {
  return { cursors: Object.fromEntries(cursors), alerted: [...alerted] };
}

export function loadFunderState(st) {
  for (const [k, v] of Object.entries(st?.cursors ?? {})) cursors.set(k, v);
  for (const a of st?.alerted ?? []) alerted.add(a);
}

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
