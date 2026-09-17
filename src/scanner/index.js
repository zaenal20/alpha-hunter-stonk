import { checkFilters, getHolders, getMobulaData } from './filter.js';
import { buyToken } from '../trader/buy.js';
import { getTokenInfo } from '../core/trade.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import { getAllConfig, getPrisma } from '../db/index.js';
import { env } from '../config/env.js';

const STONK_API = 'https://www.stonkfun.xyz/api/public/v1';

let running = false;
let pollTimer = null;

/**
 * Fetch tokens from stonk.fun API
 * @param {string} status - 'new' | 'aboutToGraduate' | 'graduated'
 * @param {string} sort - 'marketCap' | 'newest' | 'volume'
 * @param {number} page - Page number
 */
async function fetchTokens(status = 'new', sort = 'volume', page = 1, pageSize = 50) {
  const params = new URLSearchParams({
    sort,
    status,
    page: String(page),
    pageSize: String(pageSize),
  });

  const res = await fetch(`${STONK_API}/tokens?${params}`);
  if (!res.ok) {
    throw new Error(`Stonk API error: ${res.status}`);
  }

  const { data } = await res.json();
  return data?.tokens || [];
}

/**
 * Parse scan_mode config into status values
 * Supports: 'new', 'aboutToGraduate', 'graduated' or comma-separated combo
 * Case-insensitive mapping back to API-expected casing
 */
function parseScanMode(scanMode) {
  const validMap = {
    'new': 'new',
    'abouttograduate': 'aboutToGraduate',
    'graduated': 'graduated',
  };
  const modes = scanMode.split(',').map(s => s.trim().toLowerCase());
  return modes.map(m => validMap[m]).filter(Boolean);
}

export async function startScanner(notifyFn) {
  if (running) return;
  running = true;

  await logInfo('Scanner started');

  const poll = async () => {
    if (!running) return;

    try {
      const config = await getAllConfig();
      const pollMs = parseInt(config.scanner_poll_ms || '10000');
      const scanMode = config.scan_mode || 'new';
      const statuses = parseScanMode(scanMode);

      if (statuses.length === 0) {
        await logWarn(`Invalid scan_mode: ${scanMode}, defaulting to new`);
        statuses.push('new');
      }

      // Check max positions BEFORE API call
      const db = getPrisma();
      const openCount = await db.position.count({ where: { status: 'open' } });
      const maxPositions = parseInt(config.max_open_positions || '5');
      if (openCount >= maxPositions) {
        if (running) pollTimer = setTimeout(poll, pollMs);
        return;
      }

      // Fetch tokens for each configured status
      const scanSort = config.scan_sort || 'volume';
      const scanPageSize = parseInt(config.scan_pageSize || '50');

      for (const status of statuses) {
        const tokens = await fetchTokens(status, scanSort,1, scanPageSize);

        await logInfo(`[${status}] Fetched ${tokens.length} tokens`);

        for (const tokenData of tokens) {
          if (!running) return;

          const mint = tokenData.mint;
          if (!mint) continue;

          // No rebuy filter
          if (config.no_rebuy === 'true') {
            const existing = await db.position.findFirst({
              where: { token: mint },
            });
            if (existing) {
              continue;
            }
          }

          const symbol = tokenData.symbol || mint.slice(0, 8);
          const mcap = tokenData.market?.marketCapUsd || tokenData.marketCap;
          const volume24h = tokenData.market?.volume24hUsd || tokenData.volume24h;
          const graduationPct = (tokenData.graduationProgress || 0) * 100;

          // Graduation progress pre-filter (before expensive API calls)
          const minGradPct = parseFloat(config.min_graduation_pct || '0');
          const maxGradPct = parseFloat(config.max_graduation_pct || '100');
          if (graduationPct < minGradPct || graduationPct > maxGradPct) {
            continue; // skip silently
          }

          await logInfo(`${symbol} detected [${status}] Graduation: ${graduationPct.toFixed(1)}% MCap: $${mcap?.toLocaleString() || '?'}, Vol: $${volume24h?.toLocaleString() || '?'}`);

          // === STAGE 1: Basic filters (cheap APIs) ===

          // Fetch detail for creator address (dev hold check)
          let detail = tokenData;
          let creatorAddress = null;
          const needDetail = config.max_dev_hold_pct && parseFloat(config.max_dev_hold_pct) >0;

          if (needDetail) {
            const fullDetail = await getTokenInfo(mint);
            if (fullDetail) {
              detail = fullDetail;
              creatorAddress = fullDetail.launch?.creator || null;
            } else {
              await logWarn(`${symbol} could not fetch detail, using list data`);
            }
          }

          // Fetch holders if min_holders or max_dev_hold_pct is configured
          const needHolders = (parseInt(config.min_holders || '0') >0)
            || (parseFloat(config.max_dev_hold_pct || '0') >0);
          let holdersData = null;

          if (needHolders) {
            holdersData = await getHolders(mint, creatorAddress);
          }

          // Run basic filters first (social, holders, dev hold)
          const basicResult = await checkFilters(detail, config, holdersData, null);
          if (!basicResult.pass) {
            await logWarn(`${symbol} filtered out: ${basicResult.reason}`);
            continue;
          }

          // === STAGE 2: Mobula filters (only if basic passed) ===
          const needMobula = (parseInt(config.min_organicBuys1min || '0') >0)
            || (parseFloat(config.min_organicVolumeBuy1minUSD || '0') >0)
            || (parseFloat(config.max_bundlersHoldingsPercentage || '100') <100)
            || (parseFloat(config.max_snipersHoldingsPercentage || '100') <100)
            || (parseFloat(config.max_top10HoldingsPercentage || '100') <100)
            || (parseFloat(config.max_priceChange5minPercentage || '0') >0);

          let result = basicResult;
          let mobulaData = null;

          if (needMobula) {
            if (!env.MOBULA_API_KEY) {
              await logWarn(`${symbol} skipped: Mobula filter active but MOBULA_API_KEY not set`);
              continue;
            }
            mobulaData = await getMobulaData(mint);
            if (!mobulaData) {
              await logWarn(`${symbol} skipped: Mobula API failed (filter active, cannot verify)`);
              continue;
            }
            result = await checkFilters(detail, config, holdersData, mobulaData);
            if (!result.pass) {
              await logWarn(`${symbol} filtered out: ${result.reason}`);
              continue;
            }
          }

          // Re-check max positions before each buy
          const currentOpen = await db.position.count({ where: { status: 'open' } });
          if (currentOpen >= maxPositions) {
            await logInfo(`Max positions (${maxPositions}) reached during scan, stopping`);
            break;
          }

          const meta = result.meta;

          // Build detailed filter summary
          const filterParts = [];
          filterParts.push(`Graduation: ${graduationPct.toFixed(1)}%`);
          if (parseInt(config.min_holders || '0') >0) filterParts.push(`Holders: ${meta.holderCount}`);
          if (parseFloat(config.max_dev_hold_pct || '0') >0) filterParts.push(`DevHold: ${meta.devHoldPct.toFixed(1)}%`);
          if (config.require_social === 'true') filterParts.push(`Social: ✓`);
          if (parseInt(config.min_organicBuys1min || '0') >0) filterParts.push(`OrganicBuys1m: ${mobulaData?.organicBuys1min ?? '?'}`);
          if (parseFloat(config.min_organicVolumeBuy1minUSD || '0') >0) filterParts.push(`OrgVolBuy1m: $${(mobulaData?.organicVolumeBuy1minUSD ||0).toFixed(0)}`);
          if (parseFloat(config.max_bundlersHoldingsPercentage || '100') <100) filterParts.push(`Bundlers: ${(mobulaData?.bundlersHoldingsPercentage ||0).toFixed(1)}%`);
          if (parseFloat(config.max_snipersHoldingsPercentage || '100') <100) filterParts.push(`Snipers: ${(mobulaData?.snipersHoldingsPercentage ||0).toFixed(1)}%`);
          if (parseFloat(config.max_top10HoldingsPercentage || '100') <100) filterParts.push(`Top10: ${(mobulaData?.top10HoldingsPercentage ||0).toFixed(1)}%`);
          if (parseFloat(config.max_priceChange5minPercentage || '0') >0) filterParts.push(`PriceChg5m: ${(mobulaData?.priceChange5minPercentage ||0).toFixed(1)}%`);

          await logInfo(`${meta.symbol} passed filters [${filterParts.join(', ')}], buying...`);

          await buyToken(mint, meta, config);
        }
      }
    } catch (err) {
      await logError(`Scanner error: ${err.message}`);
    }

    if (running) {
      const config = await getAllConfig();
      const pollMs = parseInt(config.scanner_poll_ms || '10000');
      pollTimer = setTimeout(poll, pollMs);
    }
  };

  poll();
}

export function stopScanner() {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logInfo('Scanner stopped');
}


