import { PrismaClient } from '@prisma/client';

let prisma;

export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Default config values
const DEFAULTS = {
  // Scanner
  scan_mode: 'new',
  scanner_poll_ms: '10000',
  max_open_positions: '5',

  // Filters
  min_graduation_pct: '0',
  max_graduation_pct: '100',
  scan_sort: 'volume',
  scan_pageSize: '50',
  min_holders: '10',
  require_social: 'true',
  max_dev_hold_pct: '5',
  min_organicBuys1min: '0',
  min_organicVolumeBuy1minUSD: '0',
  max_bundlersHoldingsPercentage: '100',
  max_snipersHoldingsPercentage: '100',
  max_top10HoldingsPercentage: '100',
  min_liquidityUsd: '0',
  max_priceChange5minPercentage: '0',
  slippageBps: '2000',

  // Trade
  buy_amount_sol: '0.01',
  main_stoploss_pct: '30',
  trailing_activation_pct: '10',
  trailing_stoploss_pct: '5',
  max_position_minutes: '30',
  no_rebuy: 'true',

  // Monitor
  monitor_poll_ms: '5000',
};

export async function initDefaults() {
  const db = getPrisma();
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.config.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
}

export async function getConfig(key) {
  const row = await getPrisma().config.findUnique({ where: { key } });
  return row?.value;
}

export async function setConfig(key, value) {
  await getPrisma().config.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllConfig() {
  const rows = await getPrisma().config.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
