// Minimal JSON-RPC client for Solana.
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

const MAX_ATTEMPTS = 4; // public RPCs rate-limit aggressively; back off instead of failing
let id = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`RPC ${method}: HTTP ${res.status}`);
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
    return body.result;
  }
}
