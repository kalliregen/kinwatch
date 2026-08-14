// Funding-link tracing (milestone 2, in progress).
//
// Goal: for a set of wallets, walk each wallet's earliest incoming SOL
// transfers to find who funded it, then compare funders across the set.
// Wallets funded by the same source ("kin" wallets) get flagged — this is
// the strongest practical signal of a coordinated cluster.
import { sendAlert } from './telegram.mjs';

export async function checkSharedFunder(wallets) {
  // TODO (M2):
  //  1. getSignaturesForAddress(wallet, until: genesis) — oldest page
  //  2. getTransaction for the earliest incoming transfer, extract sender
  //  3. group wallets by funder; alert when a funder covers >= 2 wallets
  console.log('funding trace queued for:', wallets.join(', '));
  await sendAlert(`funding trace queued for ${wallets.length} wallets (M2 — in progress)`);
}
