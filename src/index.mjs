// Kinwatch entry point: load config, start the watch loop.
import { readFileSync } from 'node:fs';
import { startWatch } from './watch.mjs';
import { sendAlert } from './telegram.mjs';

const configPath = process.argv[2] || 'config.json';
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${configPath}. Copy config.example.json to config.json and fill it in.`);
  process.exit(1);
}

if (!config.wallets?.length) {
  console.error('config.wallets is empty — nothing to watch.');
  process.exit(1);
}

console.log(`kinwatch: watching ${config.wallets.length} wallet(s), poll every ${config.pollIntervalSec}s`);
await sendAlert(`kinwatch started: watching ${config.wallets.length} wallet(s)`);
startWatch(config);
