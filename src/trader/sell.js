import { sellForSol, getCurrentPrice } from '../core/trade.js';
import { getWallet, getTokenBalance } from '../core/chain.js';
import { getPrisma } from '../db/index.js';
import { env } from '../config/env.js';
import { logInfo, logWarn, logSell, logError } from '../utils/logger.js';
import { formatSellMsg, htmlEsc } from '../utils/format.js';

let telegramNotify = null;
export function setSellerNotify(fn) { telegramNotify = fn; }

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Execute sell with retry
 */
async function executeSellWithRetry(token, balance, retries = MAX_RETRIES, slippageBps = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await sellForSol(token, balance, false, slippageBps);
    } catch (err) {
      if (attempt < retries) {
        await logWarn(`Sell attempt ${attempt}/${retries} failed: ${err.message}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Sell a token and close a position
 */
export async function sellToken(positionId, reason) {
  const db = getPrisma();
  const position = await db.position.findUnique({ where: { id: positionId } });
  if (!position || position.status !== 'open') return;

  const wallet = getWallet();

  await logInfo(`Selling position #${positionId} (${reason})`);

  try {
    // Dry run
    if (env.DRY_RUN) {
      // Estimate sell value from current price
      const currentPrice = await getCurrentPrice(position.token);
      const solReceived = position.tokensReceived > 0 && currentPrice > 0
        ? position.tokensReceived * currentPrice
        : position.buyAmountSol;
      const actualPnl = position.buyAmountSol > 0
        ? ((solReceived - position.buyAmountSol) / position.buyAmountSol) * 100
        : 0;

      const sellData = {
        symbol: position.symbol,
        token: position.token,
        positionId,
        reason,
        buyPrice: position.buyPrice,
        buyAmountSol: position.buyAmountSol,
        sellPrice: currentPrice || position.buyPrice,
        solReceived,
        pnl: actualPnl.toFixed(2),
        tx: 'DRY_RUN',
        dryRun: true,
      };

      await db.position.update({
        where: { id: positionId },
        data: { status: 'closed', sellPrice: currentPrice || position.buyPrice, sellAmountSol: solReceived, pnl: actualPnl, closedAt: new Date() },
      });

      await logSell(`Position #${positionId} sold (dry run)`, sellData);
      if (telegramNotify) await telegramNotify(formatSellMsg(sellData));
      return;
    }

    // Live mode - get token balance
    const balance = await getTokenBalance(position.token);

    if (balance === 0) {
      const sellData = {
        symbol: position.symbol,
        positionId,
        reason,
        buyPrice: position.buyPrice,
        buyAmountSol: position.buyAmountSol,
        sellPrice: 0,
        solReceived: 0,
        pnl: '-100.00',
        tx: 'N/A',
        dryRun: false,
      };

      await logSell(`Position #${positionId} has zero balance`, sellData);
      if (telegramNotify) await telegramNotify(formatSellMsg(sellData));
      await db.position.update({ where: { id: positionId }, data: { status: 'closed', pnl: -100, closedAt: new Date() } });
      return;
    }

    // Execute sell with retry
    const slippageBps = parseInt((await (await import('../db/index.js')).getConfig('slippageBps')) || '2000');
    const result = await executeSellWithRetry(position.token, balance,3, slippageBps);

    // Use Jupiter's actual output amount
    const solReceived = result.solOut || 0;

    // Calculate PnL from actual SOL amounts (not API price)
    const actualPnl = position.buyAmountSol > 0
      ? ((solReceived - position.buyAmountSol) / position.buyAmountSol) * 100
      : 0;

    // Calculate actual sell price from execution
    const actualSellPrice = balance > 0 ? solReceived / balance : 0;

    await db.position.update({
      where: { id: positionId },
      data: { status: 'closed', sellPrice: actualSellPrice, sellAmountSol: solReceived, pnl: actualPnl, closedAt: new Date() },
    });

    const sellData = {
      symbol: position.symbol,
      token: position.token,
      positionId,
      reason,
      buyPrice: position.buyPrice,
      buyAmountSol: position.buyAmountSol,
      sellPrice: actualSellPrice,
      solReceived,
      pnl: actualPnl.toFixed(2),
      tx: result.hash,
      dryRun: false,
    };

    await logSell(`Position #${positionId} sold via Jupiter`, sellData);
    if (telegramNotify) await telegramNotify(formatSellMsg(sellData));
  } catch (err) {
    await logError(`Failed to sell position #${positionId} after ${MAX_RETRIES} attempts: ${err.message}`, { positionId, reason });

    // Notify user only after all retries exhausted
    if (telegramNotify) {
      await telegramNotify({
        html: `<h3>⚠️ Sell Failed #${positionId}</h3><p>${htmlEsc(err.message)}</p><p>Retried ${MAX_RETRIES}x, all failed. Try /sell ${positionId} manually.</p>`,
        fallback: `⚠️ *Sell Failed #${positionId}*\n${err.message}\nRetried ${MAX_RETRIES}x. Try /sell ${positionId} manually.`,
      });
    }
  }
}
