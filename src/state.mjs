// Persistent watcher state (data/state.json). Cursors and counters survive
// restarts: the baseline is kept, events missed while offline are caught up
// on the next poll, and pair counts carry over. Delete the file to reset.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = 'data/state.json';

export function loadState() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return null; // first run or unreadable state — start clean
  }
}

export function saveState(state) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, FILE); // atomic swap — a crash never leaves a torn file
  } catch (e) {
    console.error('state save failed:', e.message);
  }
}
