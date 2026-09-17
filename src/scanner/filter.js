import { env } from '../config/env.js';

/**
 * Get token data from Mobula API
 * Try demo first (free, no key), fallback to premium (API key)
 * Returns security, organic metrics, holder distribution
 */
export async function getMobulaData(mint) {
  // 1. Try demo API (free, no key)
  try {
    const res = await fetch(`${env.MOBULA_DEMO_URL}${mint}`);
    if (res.ok) {
      const { data } = await res.json();
      if (data) return data;
    }
  } catch {}

  // 2. Fallback to premium API (API key)
  if (env.MOBULA_API_KEY) {
    try {
      const res = await fetch(`${env.MOBULA_API_URL}${mint}`, {
        headers: { Authorization: `Bearer ${env.MOBULA_API_KEY}` },
      });
      if (res.ok) {
        const { data } = await res.json();
        if (data) return data;
      }
    } catch {}
  }

  return null;
}

/**
 * Get token holders from stonk.fun API
 * Returns { holderCount, holders[], devHoldPct }
 */
export async function getHolders(mint, creatorAddress) {
  try {
    const res = await fetch(`https://www.stonkfun.xyz/api/token-holders?mint=${mint}`);
    if (!res.ok) return { holderCount: 0, holders: [], devHoldPct: 0 };
    const data = await res.json();

    const holderCount = data.holderCount || 0;
    const holders = data.holders || [];
    const supplyTokens = data.supplyTokens || 0;

    let devHoldPct = 0;
    if (creatorAddress && supplyTokens > 0) {
      const devHolder = holders.find(
        h => h.address.toLowerCase() === creatorAddress.toLowerCase()
      );
      if (devHolder) {
        devHoldPct = (devHolder.amountTokens / supplyTokens) * 100;
      }
    }

    return { holderCount, holders, devHoldPct };
  } catch {
    return { holderCount: 0, holders: [], devHoldPct: 0 };
  }
}

/**
 * Check if token passes filters
 * @param {object} tokenData - Token data from stonk.fun API
 * @param {object} filters - Filter config
 * @param {object|null} holdersData - Holder data from stonk.fun /api/token-holders
 * @param {object|null} mobulaData - Token data from Mobula API
 * @returns {{ pass: boolean, reason: string, meta: object }}
 */
export async function checkFilters(tokenData, filters, holdersData = null, mobulaData = null) {
  // Normalize: detail response has nested token/launch, list response has flat structure
  const isDetail = !!tokenData.token;
  const token = isDetail ? tokenData.token : tokenData;
  const launch = isDetail ? tokenData.launch : null;

  const meta = {
    symbol: token.symbol || 'UNKNOWN',
    name: token.name || '',
    mint: token.mint,
    status: token.status,
    mcap: token.market?.marketCapUsd || 0,
    volume24h: token.market?.volume24hUsd || 0,
    liquidityUsd: token.market?.liquidityUsd || 0,
    peakMcap: token.market?.peakMarketCapUsd || 0,
    priceUsd: token.market?.priceUsd || 0,
    graduationProgress: token.graduationProgress || 0,
    logo: token.imageUrl,
    mode: token.mode,
    launchpad: token.launchpad,
    creator: launch?.creator || null,
    links: token.links || {},
    holderCount: holdersData?.holderCount || 0,
    devHoldPct: holdersData?.devHoldPct || 0,
  };

  // Liquidity filter (from stonk.fun market data)
  const minLiquidity = parseFloat(filters.min_liquidityUsd || '0');
  if (minLiquidity > 0) {
    const liquidity = meta.liquidityUsd;
    if (liquidity < minLiquidity) {
      return { pass: false, reason: `Liquidity $${liquidity.toFixed(0)} (min: $${minLiquidity})`, meta };
    }
  }

  // Social check
  if (filters.require_social === 'true') {
    const links = token.links || {};
    const hasSocial = !!(links.twitter || links.telegram || links.website || links.discord);
    if (!hasSocial) {
      return { pass: false, reason: 'No social links', meta };
    }
  }

  // Holder count filter (from stonk.fun)
  const minHolders = parseInt(filters.min_holders || '0');
  if (minHolders > 0 && holdersData) {
    if (holdersData.holderCount < minHolders) {
      return { pass: false, reason: `Only ${holdersData.holderCount} holders (min: ${minHolders})`, meta };
    }
  }

  // Dev hold percentage filter (from stonk.fun)
  const maxDevHoldPct = parseFloat(filters.max_dev_hold_pct || '5');
  if (maxDevHoldPct > 0 && holdersData && holdersData.devHoldPct > 0) {
    if (holdersData.devHoldPct > maxDevHoldPct) {
      return { pass: false, reason: `Dev holds ${holdersData.devHoldPct.toFixed(1)}% (max: ${maxDevHoldPct}%)`, meta };
    }
  }

  // === Mobula filters ===
  if (mobulaData) {
    // Organic buys in last 1 min
    const minOrganicBuys = parseInt(filters.min_organicBuys1min || '0');
    if (minOrganicBuys > 0) {
      const organicBuys = mobulaData.organicBuys1min || 0;
      if (organicBuys < minOrganicBuys) {
        return { pass: false, reason: `Only ${organicBuys} organic buys 1m (min: ${minOrganicBuys})`, meta };
      }
    }

    // Organic buy volume USD in last 1 min
    const minOrganicVol = parseFloat(filters.min_organicVolumeBuy1minUSD || '0');
    if (minOrganicVol > 0) {
      const organicVol = mobulaData.organicVolumeBuy1minUSD || 0;
      if (organicVol < minOrganicVol) {
        return { pass: false, reason: `Organic vol buy 1m: $${organicVol.toFixed(0)} (min: $${minOrganicVol})`, meta };
      }
    }

    // Bundlers holdings %
    const maxBundlers = parseFloat(filters.max_bundlersHoldingsPercentage || '100');
    if (maxBundlers < 100) {
      const bundlers = mobulaData.bundlersHoldingsPercentage || 0;
      if (bundlers > maxBundlers) {
        return { pass: false, reason: `Bundlers hold ${bundlers.toFixed(1)}% (max: ${maxBundlers}%)`, meta };
      }
    }

    // Snipers holdings %
    const maxSnipers = parseFloat(filters.max_snipersHoldingsPercentage || '100');
    if (maxSnipers < 100) {
      const snipers = mobulaData.snipersHoldingsPercentage || 0;
      if (snipers > maxSnipers) {
        return { pass: false, reason: `Snipers hold ${snipers.toFixed(1)}% (max: ${maxSnipers}%)`, meta };
      }
    }

    // Top 10 holders %
    const maxTop10 = parseFloat(filters.max_top10HoldingsPercentage || '100');
    if (maxTop10 < 100) {
      const top10 = mobulaData.top10HoldingsPercentage || 0;
      if (top10 > maxTop10) {
        return { pass: false, reason: `Top10 hold ${top10.toFixed(1)}% (max: ${maxTop10}%)`, meta };
      }
    }

    // Price change 5min %
    const maxPriceChange = parseFloat(filters.max_priceChange5minPercentage || '0');
    if (maxPriceChange > 0) {
      const priceChange = mobulaData.priceChange5minPercentage || 0;
      if (priceChange > maxPriceChange) {
        return { pass: false, reason: `Price +${priceChange.toFixed(1)}% 5m (max: ${maxPriceChange}%)`, meta };
      }
    }
  }

  return { pass: true, reason: 'All filters passed', meta };
}
