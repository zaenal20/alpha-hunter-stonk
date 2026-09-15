import { getPrisma } from '../db/index.js';
import { formatErrorMsg } from './format.js';

// Telegram notify function - set by bot on startup
let telegramNotify = null;

// Rate limiting for error notifications
const errorTimestamps = [];
const ERROR_RATE_LIMIT_MS = 60000; // Max 1 error notification per minute
const ERROR_RATE_LIMIT_COUNT = 3; // Max 3 errors per minute

/**
 * Set the Telegram notify function
 */
export function setTelegramNotify(fn) {
  telegramNotify = fn;
}

/**
 * Save log to database
 */
async function saveToDb(level, message, data) {
  try {
    const db = getPrisma();
    await db.log.create({
      data: {
        level,
        message,
        data: data ? JSON.stringify(data) : null,
      },
    });
  } catch (err) {
    console.error('[Logger] Failed to save to DB:', err.message);
  }
}

/**
 * Check if we should send error notification (rate limit)
 */
function shouldNotifyError() {
  const now = Date.now();

  while (errorTimestamps.length > 0 && errorTimestamps[0] < now - ERROR_RATE_LIMIT_MS) {
    errorTimestamps.shift();
  }

  if (errorTimestamps.length >= ERROR_RATE_LIMIT_COUNT) {
    return false;
  }

  errorTimestamps.push(now);
  return true;
}

/**
 * Log info message (DB only)
 */
export async function logInfo(message, data) {
  console.log(`[INFO] ${message}`);
  await saveToDb('info', message, data);
}

/**
 * Log warning message (DB only)
 */
export async function logWarn(message, data) {
  console.warn(`[WARN] ${message}`);
  await saveToDb('warn', message, data);
}

/**
 * Log error message (DB + Telegram with rate limit)
 */
export async function logError(message, data) {
  console.error(`[ERROR] ${message}`);
  await saveToDb('error', message, data);

  if (telegramNotify && shouldNotifyError()) {
    await telegramNotify(formatErrorMsg(message, data));
  }
}

/**
 * Log buy event (DB + Telegram)
 */
export async function logBuy(message, data) {
  console.log(`[BUY] ${message}`);
  await saveToDb('buy', message, data);
}

/**
 * Log sell event (DB + Telegram)
 */
export async function logSell(message, data) {
  console.log(`[SELL] ${message}`);
  await saveToDb('sell', message, data);
}

/**
 * Get recent logs from DB
 */
export async function getRecentLogs(limit = 50, level) {
  const db = getPrisma();
  const where = level ? { level } : {};
  return db.log.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Clear old logs (keep last N days)
 */
export async function clearOldLogs(days = 7) {
  const db = getPrisma();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await db.log.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
