import { getPrisma, getConfig } from '../db/index.js';
import { getCurrentPrice } from '../core/trade.js';
import { sellToken } from './sell.js';
import { logInfo, logError } from '../utils/logger.js';

const activeMonitors = new Map();

export async function startPriceMonitor(positionId, mint) {
  if (activeMonitors.has(positionId)) return;

  await logInfo(`Starting price monitor for position #${positionId}`);

  const poll = async () => {
    try {
      const db = getPrisma();
      const position = await db.position.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'open') {
        stopPriceMonitor(positionId);
        return;
      }

      // --- Max Position Time (independent of price) ---
      const maxMinutes = parseFloat((await getConfig('max_position_minutes')) || '30');
      const ageMinutes = (Date.now() - new Date(position.createdAt).getTime()) / 60000;
      if (ageMinutes >= maxMinutes) {
        await sellToken(positionId, `Max position time reached (${maxMinutes}m)`);
        // Check if sell succeeded — if not, keep monitoring
        const still = await db.position.findUnique({ where: { id: positionId } });
        if (still?.status !== 'open') return;
      }

      // --- Get price ---
      const currentPrice = await getCurrentPrice(mint);

      // If price available, check SL and trailing
      if (currentPrice && currentPrice > 0) {
        const trailingActivationPct = parseFloat((await getConfig('trailing_activation_pct')) || '10');
        const trailingPct = parseFloat((await getConfig('trailing_stoploss_pct')) || '5');

        // --- Main Stoploss ---
        if (position.mainStoploss && currentPrice <= position.mainStoploss) {
          await sellToken(positionId, `Main stoploss hit (${position.mainStoploss.toFixed(12)})`);
          const still = await db.position.findUnique({ where: { id: positionId } });
          if (still?.status !== 'open') return;
        }

        // --- Trailing Stop ---
        const gainPct = position.buyPrice > 0
          ? ((currentPrice - position.buyPrice) / position.buyPrice) * 100
          : 0;

        // Update trailing high/stop when price makes new high (requires activation)
        if (gainPct >= trailingActivationPct && currentPrice > (position.trailingHigh || 0)) {
          const newTrailingStop = currentPrice * (1 - trailingPct / 100);

          await db.position.update({
            where: { id: positionId },
            data: { trailingHigh: currentPrice, trailingStop: newTrailingStop },
          });

          position.trailingHigh = currentPrice;
          position.trailingStop = newTrailingStop;

          await logInfo(`New high for #${positionId}: ${currentPrice.toFixed(12)} SOL (+${gainPct.toFixed(2)}%), trailing stop: ${newTrailingStop.toFixed(12)}`);
        }

        // ALWAYS check trailing stop if it's been set (independent of activation)
        if (position.trailingStop && currentPrice <= position.trailingStop) {
          await sellToken(positionId, `Trailing stoploss hit (${position.trailingStop.toFixed(12)})`);
          const still = await db.position.findUnique({ where: { id: positionId } });
          if (still?.status !== 'open') return;
        }
      }
      // If price is null, skip SL/trailing checks but keep polling
    } catch (err) {
      await logError(`Monitor error for #${positionId}: ${err.message}`);
    }

    // Always schedule next poll (unless position was sold above)
    if (activeMonitors.has(positionId)) {
      const pollMs = parseInt((await getConfig('monitor_poll_ms')) || '5000');
      activeMonitors.set(positionId, setTimeout(poll, pollMs));
    }
  };

  const pollMs = parseInt((await getConfig('monitor_poll_ms')) || '5000');
  activeMonitors.set(positionId, setTimeout(poll, pollMs));
}

export function stopPriceMonitor(positionId) {
  const timer = activeMonitors.get(positionId);
  if (timer) {
    clearTimeout(timer);
    activeMonitors.delete(positionId);
    console.log(`[Monitor] Stopped for position #${positionId}`);
  }
}

export async function resumeAllMonitors() {
  const db = getPrisma();
  const openPositions = await db.position.findMany({ where: { status: 'open' } });

  for (const pos of openPositions) {
    await startPriceMonitor(pos.id, pos.token);
  }

  await logInfo(`Resumed ${openPositions.length} position monitors`);
}
