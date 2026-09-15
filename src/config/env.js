import 'dotenv/config';

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env: ${key}`);
  return val;
}

export const env = {
  TELEGRAM_BOT_TOKEN: requireEnv('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_ADMIN_ID: requireEnv('TELEGRAM_ADMIN_ID'),
  PRIVATE_KEY: requireEnv('PRIVATE_KEY'),
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || '',
  JUPITER_API_KEY: process.env.JUPITER_API_KEY || '',
  JUPITER_API_URL: process.env.JUPITER_API_URL || 'https://api.jup.ag',
  MOBULA_DEMO_URL: 'https://demo-api.mobula.io/api/2/token/details?blockchain=solana&address=',
  MOBULA_API_URL: process.env.MOBULA_API_URL || 'https://api.mobula.io/api/2/token/details?blockchain=solana&address=',
  MOBULA_API_KEY: process.env.MOBULA_API_KEY || '',
  DRY_RUN: process.env.DRY_RUN !== 'false',
};

/**
 * Get RPC URL: Helius primary, public fallback
 */
export function getRpcUrl() {
  if (env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  }
  if (env.SOLANA_RPC_URL) {
    return env.SOLANA_RPC_URL;
  }
  return 'https://api.mainnet-beta.solana.com';
}
