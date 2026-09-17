import { buyWithSol, getCurrentPrice } from '../core/trade.js';
import { getWallet } from '../core/chain.js';
import { getPrisma } from '../db/index.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { env } from '../config/env.js';
import { startPriceMonitor } from './monitor.js';
import { logInfo, logWarn, logBuy, logError } from '../utils/logger.js';
import { formatBuyMsg } from '../utils/format.js';

// Telegram notify function - set by bot
let telegramNotify = null;
export function setTraderNotify(fn) { telegramNotify = fn; }

/**
 * Buy a token and open a position
 */
export async function buyToken(mint, meta, config) {
  const db = getPrisma();

  const buyAmountSol = parseFloat(config.buy_amount_sol || '0.01');
  const mainStoplossPct = parseFloat(config.main_stoploss_pct || '30');
  const trailingStoplossPct = parseFloat(config.trailing_stoploss_pct || '5');

  // Check max open positions
  const openPositions = await db.position.count({ where: { status: 'open' } });
  const maxPositions = parseInt(config.max_open_positions || '5');
  if (openPositions >= maxPositions) {
    await logInfo(`Max open positions (${maxPositions}) reached, skipping buy for ${meta.symbol}`);
    return;
  }

  await logInfo(`Buying ${meta.symbol} for ${buyAmountSol} SOL (${env.DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  try {
    // Execute buy via Jupiter
    const slippageBps = parseInt(config.slippageBps || '2000');
    const result = await buyWithSol(mint, buyAmountSol, env.DRY_RUN, slippageBps);

    // Check if transaction confirmed (skip for dry run)
    if (!env.DRY_RUN && !result.confirmed) {
      await logWarn(`Buy tx for ${meta.symbol} not confirmed, skipping position creation`);
      return;
    }

    // Get actual tokens received (from Jupiter execute or dry run estimate)
    let tokensReceived = result.tokensOut || 0;

    if (env.DRY_RUN && tokensReceived === 0) {
      const currentPrice = await getCurrentPrice(mint);
      if (currentPrice > 0) {
        tokensReceived = buyAmountSol / currentPrice;
      } else {
        await logWarn(`Cannot estimate price for ${meta.symbol}, skipping dry run buy`);
        return;
      }
    }

    // Calculate actual execution price
    const actualBuyPrice = tokensReceived > 0 ? buyAmountSol / tokensReceived : 0;

    // Calculate stoploss levels from actual execution price
    const mainStoplossPrice = actualBuyPrice ? actualBuyPrice * (1 - mainStoplossPct / 100) : null;
    const trailingHigh = actualBuyPrice || 0;

    // Save position to DB
    const position = await db.position.create({
      data: {
        token: mint,
        symbol: meta.symbol,
        status: 'open',
        buyPrice: actualBuyPrice || 0,
        buyAmountSol,
        tokensReceived,
        mainStoploss: mainStoplossPrice,
        trailingStop: null,
        trailingHigh,
      },
    });

    const txHash = env.DRY_RUN ? 'DRY_RUN' : result.hash;

    const buyData = {
      symbol: meta.symbol,
      token: mint,
      amount: buyAmountSol,
      tokens: tokensReceived,
      price: actualBuyPrice || 0,
      mainSL: mainStoplossPrice || 0,
      trailingPct: trailingStoplossPct,
      positionId: position.id,
      tx: txHash,
      dryRun: env.DRY_RUN,
    };

    await logBuy(`${meta.symbol} bought`, buyData);

    // Send formatted Telegram notification
    if (telegramNotify) {
      await telegramNotify(formatBuyMsg(buyData));
    }

    // Start price monitoring
    startPriceMonitor(position.id, mint);

    return position;
  } catch (err) {
    await logError(`Failed to buy ${meta.symbol}: ${err.message}`, { mint });
    throw err;
  }
}
