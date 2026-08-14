// Cursor-based signature fetching, shared by wallet and funder polling.
import { rpc } from './rpc.mjs';

export const PAGE_LIMIT = 25;
export const MAX_POLL_PAGES = 4; // per address per poll; a deeper burst is reported as truncated

// Pages back through an address's signatures until the stored cursor is
// found, so a burst larger than one page is not silently dropped.
export async function fetchFresh(address, newest) {
  const sigs = [];
  let before;
  for (let page = 0; page < MAX_POLL_PAGES; page++) {
    const batch = await rpc('getSignaturesForAddress', [address, { limit: PAGE_LIMIT, before }]);
    for (const s of batch) {
      if (s.signature === newest) return { sigs, complete: true };
      sigs.push(s);
    }
    if (batch.length < PAGE_LIMIT) return { sigs, complete: true };
    before = batch[batch.length - 1].signature;
  }
  return { sigs, complete: false };
}
