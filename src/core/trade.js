import {
  VersionedTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getConnection, getWallet, getTokenBalance, getTokenDecimals, SOL_MINT, getBalance } from './chain.js';
import { env } from '../config/env.js';
import { logError } from '../utils/logger.js';

const STONK_API = 'https://www.stonkfun.xyz/api/public/v1';

// Jupiter API headers (with API key if available)
function jupiterHeaders() {
  const headers = {};
  if (env.JUPITER_API_KEY) {
    headers['x-api-key'] = env.JUPITER_API_KEY;
  }
  return headers;
}

/**
 * Buy token with SOL via Jupiter /swap/v2/order + /swap/v2/execute
 * Returns { hash, tokensOut, confirmed }
 */
export async function buyWithSol(mint, solAmount, dryRun, slippageBps = 2000) {
  if (dryRun) {
    return { hash: 'DRY_RUN', tokensOut: 0, confirmed: true };
  }

  const wallet = getWallet();
  const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

  // 1. Get order (quote + assembled transaction)
  const orderUrl = `${env.JUPITER_API_URL}/swap/v2/order?` + new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: mint,
    amount: String(lamports),
    taker: wallet.publicKey.toBase58(),
    slippageBps: String(slippageBps),
  });

  const orderRes = await fetch(orderUrl, { headers: jupiterHeaders() });
  if (!orderRes.ok) {
    const text = await orderRes.text();
    throw new Error(`Jupiter order failed: ${orderRes.status} ${text}`);
  }
  const orderData = await orderRes.json();

  if (!orderData.transaction) {
    throw new Error(`Jupiter order returned no transaction: ${JSON.stringify(orderData).slice(0, 500)}`);
  }

  // 2. Sign the transaction
  const txBuf = Buffer.from(orderData.transaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  const signedTx = Buffer.from(tx.serialize()).toString('base64');

  // 3. Execute — Jupiter handles submission + confirmation
  const execRes = await fetch(`${env.JUPITER_API_URL}/swap/v2/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...jupiterHeaders() },
    body: JSON.stringify({
      signedTransaction: signedTx,
      requestId: orderData.requestId,
    }),
  });

  const result = await execRes.json();

  if (result.status === 'Success') {
    const decimals = await getTokenDecimals(mint);
    const tokensOut = result.outputAmountResult
      ? Number(result.outputAmountResult) / Math.pow(10, decimals)
      : Number(orderData.outAmount) / Math.pow(10, decimals);

    return {
      hash: result.signature,
      tokensOut,
      confirmed: true,
    };
  }

  throw new Error(`Buy failed: ${result.error || JSON.stringify(result).slice(0, 300)}`);
}

/**
 * Sell token for SOL via Jupiter /swap/v2/order + /swap/v2/execute
 * Returns { hash, solOut, confirmed }
 */
export async function sellForSol(mint, tokenAmount, dryRun, slippageBps = 2000) {
  if (dryRun) {
    return { hash: 'DRY_RUN', solOut: 0, confirmed: true };
  }

  const wallet = getWallet();
  const decimals = await getTokenDecimals(mint);
  const amountRaw = Math.floor(tokenAmount * Math.pow(10, decimals));

  // 1. Get order
  const orderUrl = `${env.JUPITER_API_URL}/swap/v2/order?` + new URLSearchParams({
    inputMint: mint,
    outputMint: SOL_MINT,
    amount: String(amountRaw),
    taker: wallet.publicKey.toBase58(),
    slippageBps: String(slippageBps),
  });

  const orderRes = await fetch(orderUrl, { headers: jupiterHeaders() });
  if (!orderRes.ok) {
    const text = await orderRes.text();
    throw new Error(`Jupiter order failed: ${orderRes.status} ${text}`);
  }
  const orderData = await orderRes.json();

  if (!orderData.transaction) {
    throw new Error(`Jupiter could not build sell transaction: ${JSON.stringify(orderData).slice(0, 300)}`);
  }

  // 2. Sign the transaction
  const txBuf = Buffer.from(orderData.transaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);
  const signedTx = Buffer.from(tx.serialize()).toString('base64');

  // 3. Execute — Jupiter handles submission + confirmation
  const execRes = await fetch(`${env.JUPITER_API_URL}/swap/v2/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...jupiterHeaders() },
    body: JSON.stringify({
      signedTransaction: signedTx,
      requestId: orderData.requestId,
    }),
  });

  const result = await execRes.json();

  if (result.status === 'Success') {
    const solOut = result.outputAmountResult
      ? Number(result.outputAmountResult) / LAMPORTS_PER_SOL
      : Number(orderData.outAmount) / LAMPORTS_PER_SOL;

    return {
      hash: result.signature,
      solOut,
      confirmed: true,
    };
  }

  throw new Error(`Sell failed: ${result.error || JSON.stringify(result).slice(0, 300)}`);
}

/**
 * Get current token price in SOL
 * Uses Jupiter price/v3 (cheap, batch) with stonk.fun fallback
 */
export async function getCurrentPrice(mint) {
  // 1. Jupiter price/v3 — cheap batch API, up to 50 tokens per call
  try {
    const res = await fetch(`${env.JUPITER_API_URL}/price/v3?ids=${mint},${SOL_MINT}`, {
      headers: jupiterHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      const tokenUsd = data?.[mint]?.usdPrice;
      const solUsd = data?.[SOL_MINT]?.usdPrice;
      if (tokenUsd > 0 && solUsd > 0) {
        return tokenUsd / solUsd;
      }
    }
  } catch {}

  // 2. Fallback: stonk.fun detail → priceUsd → SOL
  try {
    const info = await getTokenInfo(mint);
    const priceUsd = info?.token?.market?.priceUsd;
    if (priceUsd > 0) {
      const solRes = await fetch(`${env.JUPITER_API_URL}/price/v3?ids=${SOL_MINT}`, {
        headers: jupiterHeaders(),
      });
      if (solRes.ok) {
        const solData = await solRes.json();
        const solUsd = solData?.[SOL_MINT]?.usdPrice;
        if (solUsd > 0) return priceUsd / solUsd;
      }
    }
  } catch {}

  return null;
}

/**
 * Get token info from stonk.fun API (detail endpoint)
 */
export async function getTokenInfo(mint) {
  try {
    const res = await fetch(`${STONK_API}/tokens/${mint}`);
    if (!res.ok) return null;
    const { data } = await res.json();
    return data;
  } catch (err) {
    await logError(`[StonkAPI] Failed to get token info for ${mint}: ${err.message}`);
    return null;
  }
}
