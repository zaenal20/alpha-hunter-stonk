import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { env, getRpcUrl } from '../config/env.js';

// SOL mint address (native)
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

let connection;
let walletKeypair;

/**
 * Get Solana Connection (lazy init)
 */
export function getConnection() {
  if (!connection) {
    connection = new Connection(getRpcUrl(), 'confirmed');
  }
  return connection;
}

/**
 * Get wallet Keypair from private key (base58 or array)
 */
export function getWallet() {
  if (!walletKeypair) {
    const key = env.PRIVATE_KEY;
    let secretKey;

    // Try base58 first
    try {
      secretKey = bs58.decode(key);
    } catch {
      // Try JSON array format
      try {
        secretKey = Uint8Array.from(JSON.parse(key));
      } catch {
        throw new Error('Invalid PRIVATE_KEY: must be base58 or JSON array');
      }
    }

    walletKeypair = Keypair.fromSecretKey(secretKey);
  }
  return walletKeypair;
}

/**
 * Get wallet SOL balance
 */
export async function getBalance() {
  const conn = getConnection();
  const wallet = getWallet();
  const balance = await conn.getBalance(wallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Get SPL token balance for wallet
 * Returns human-readable amount (already decimal-adjusted)
 */
export async function getTokenBalance(mintAddress) {
  const conn = getConnection();
  const wallet = getWallet();
  const mint = new PublicKey(mintAddress);

  // Try Token-2022 first, then classic SPL
  for (const programId of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey, false, programId);
      const account = await getAccount(conn, ata, undefined, programId);
      const decimals = await getTokenDecimals(mintAddress);
      return Number(account.amount) / Math.pow(10, decimals);
    } catch {
      // Account doesn't exist for this program, try next
    }
  }

  return 0;
}

/**
 * Get token decimals from mint
 */
export async function getTokenDecimals(mintAddress) {
  const conn = getConnection();
  const mint = new PublicKey(mintAddress);
  const info = await conn.getParsedAccountInfo(mint);
  const data = info.value?.data;
  if (data && 'parsed' in data) {
    return data.parsed.info.decimals;
  }
  return 9; // default for SOL tokens
}
