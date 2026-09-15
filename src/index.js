import { setupBot } from './bot/index.js';
import { initDefaults } from './db/index.js';
import { env } from './config/env.js';
import { getRpcUrl } from './config/env.js';

async function main() {
  console.log('🤖 Alpha Hunter - Stonk Sniper');
  console.log(`   Chain: Solana`);
  console.log(`   Data: Stonk.fun API`);
  console.log(`   Swap: Jupiter v6`);
  console.log(`   RPC: ${getRpcUrl()}`);
  console.log(`   Dry Run: ${env.DRY_RUN ? 'ON' : 'OFF'}`);

  // Initialize DB defaults
  await initDefaults();
  console.log('[DB] Initialized');

  // Start Telegram bot
  await setupBot();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
