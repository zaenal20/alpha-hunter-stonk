import https from 'https';
import { Telegraf } from 'telegraf';
import { env } from '../config/env.js';
import { getAllConfig, setConfig, getPrisma } from '../db/index.js';
import { startScanner, stopScanner } from '../scanner/index.js';
import { sellToken } from '../trader/sell.js';
import { stopPriceMonitor, resumeAllMonitors } from '../trader/monitor.js';
import { setTelegramNotify, getRecentLogs, clearOldLogs, logInfo } from '../utils/logger.js';
import { setTraderNotify } from '../trader/buy.js';
import { setSellerNotify } from '../trader/sell.js';
import { getCurrentPrice } from '../core/trade.js';
import { getBalance, getWallet } from '../core/chain.js';
import {
  formatConfigMsg, formatPositionsMsg, formatHistoryMsg,
  formatStatusMsg, formatLogsMsg, formatErrorMsg,
  formatBuyMsg, formatSellMsg, formatLaunchMsg, formatFilterMsg,
  formatSummaryMsg,
} from '../utils/format.js';

let bot;
let scannerRunning = false;

/**
 * Get/set scanner state from DB
 */
async function getScannerState() {
  const db = getPrisma();
  const row = await db.config.findUnique({ where: { key: 'scanner_running' } });
  return row?.value === 'true';
}

async function setScannerState(running) {
  const db = getPrisma();
  await db.config.upsert({
    where: { key: 'scanner_running' },
    update: { value: String(running) },
    create: { key: 'scanner_running', value: String(running) },
  });
}

export function getBot() {
  if (!bot) {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  }
  return bot;
}

// Middleware: only allow admin
function adminOnly(ctx, next) {
  if (ctx.from.id.toString() !== env.TELEGRAM_ADMIN_ID) {
    return ctx.reply('⛔ Unauthorized');
  }
  return next(ctx);
}

/**
 * Send rich message via Bot API with Markdown fallback
 */
function sendRichMessage(html, fallbackMarkdown) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_ADMIN_ID;
  if (!token || !chatId) return;

  const data = JSON.stringify({
    chat_id: chatId,
    rich_message: { html },
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendRichMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.ok && fallbackMarkdown) {
          bot.telegram.sendMessage(chatId, fallbackMarkdown, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }).catch(() => {});
        }
      } catch {}
    });
  });

  req.on('error', () => {
    if (fallbackMarkdown) {
      bot.telegram.sendMessage(chatId, fallbackMarkdown, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }).catch(() => {});
    }
  });

  req.write(data);
  req.end();
}

/**
 * Send notification - uses rich message with fallback
 */
async function notifyAdmin(messageOrObj) {
  try {
    if (typeof messageOrObj === 'object' && messageOrObj.html) {
      sendRichMessage(messageOrObj.html, messageOrObj.fallback);
    } else {
      await bot.telegram.sendMessage(env.TELEGRAM_ADMIN_ID, messageOrObj, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
  } catch (err) {
    console.error('[Bot] Failed to send Telegram notification:', err.message);
  }
}

export async function setupBot() {
  bot = getBot();
  bot.use(adminOnly);

  // Set notify functions for all modules
  setTelegramNotify(notifyAdmin);
  setTraderNotify(notifyAdmin);
  setSellerNotify(notifyAdmin);

  // Auto-start scanner if it was running before
  const scannerState = await getScannerState();
  if (scannerState) {
    scannerRunning = true;
    await startScanner(notifyAdmin);
    await resumeAllMonitors();
    console.log('[Bot] Scanner auto-started from DB state');
  }

  // /start
  bot.command('start', (ctx) => {
    const html =
      `<h3>🤖 Alpha Hunter - Stonk Sniper</h3>` +
      `<p>Chain: <b>Solana</b> | Source: <b>Stonk.fun</b></p>` +
      `<table bordered striped>` +
      `<tr><th>Command</th><th>Description</th></tr>` +
      `<tr><td>/config</td><td>View all settings</td></tr>` +
      `<tr><td>/set</td><td>Update setting</td></tr>` +
      `<tr><td>/positions</td><td>Open positions</td></tr>` +
      `<tr><td>/history</td><td>Closed trades</td></tr>` +
      `<tr><td>/sell</td><td>Force sell position</td></tr>` +
      `<tr><td>/start_scanner</td><td>Start scanning</td></tr>` +
      `<tr><td>/stop_scanner</td><td>Stop scanning</td></tr>` +
      `<tr><td>/status</td><td>Bot status</td></tr>` +
      `<tr><td>/summary</td><td>Trading summary</td></tr>` +
      `<tr><td>/logs</td><td>View recent logs</td></tr>` +
      `<tr><td>/logs_error</td><td>View error logs</td></tr>` +
      `<tr><td>/clear_logs</td><td>Clear old logs</td></tr>` +
      `</table>` +
      `<p>${env.DRY_RUN ? '🧪 <i>DRY RUN MODE</i>' : '💰 <b>LIVE MODE</b>'}</p>`;

    const fallback =
      `🤖 *Alpha Hunter - Stonk Sniper*\n` +
      `Chain: Solana | Source: Stonk.fun\n\n` +
      `/config - View settings\n` +
      `/set - Update setting\n` +
      `/positions - Open positions\n` +
      `/history - Closed trades\n` +
      `/sell - Force sell\n` +
      `/start_scanner - Start\n` +
      `/stop_scanner - Stop\n` +
      `/status - Bot status\n` +
      `/summary - Trading summary\n` +
      `/logs - View logs\n` +
      `/logs_error - Error logs\n` +
      `/clear_logs - Clear logs\n\n` +
      (env.DRY_RUN ? '🧪 DRY RUN' : '💰 LIVE');

    sendRichMessage(html, fallback);
  });

  // /help
  bot.command('help', (ctx) => {
    const html =
      `<h3>📋 Available Config Keys</h3>` +
      `<table bordered striped>` +
      `<tr><th>Key</th><th align="right">Default</th><th>Command</th></tr>` +
      `<tr><td><b>scan_mode</b></td><td align="right">new</td><td><code>/set scan_mode new</code></td></tr>` +
      `<tr><td><b>min_graduation_pct</b></td><td align="right">0</td><td><code>/set min_graduation_pct 50</code></td></tr>` +
      `<tr><td><b>max_graduation_pct</b></td><td align="right">100</td><td><code>/set max_graduation_pct 80</code></td></tr>` +
      `<tr><td><b>min_holders</b></td><td align="right">10</td><td><code>/set min_holders 10</code></td></tr>` +
      `<tr><td><b>require_social</b></td><td align="right">true</td><td><code>/set require_social true</code></td></tr>` +
      `<tr><td><b>buy_amount_sol</b></td><td align="right">0.01</td><td><code>/set buy_amount_sol 0.05</code></td></tr>` +
      `<tr><td><b>main_stoploss_pct</b></td><td align="right">30</td><td><code>/set main_stoploss_pct 30</code></td></tr>` +
      `<tr><td><b>trailing_activation_pct</b></td><td align="right">10</td><td><code>/set trailing_activation_pct 10</code></td></tr>` +
      `<tr><td><b>trailing_stoploss_pct</b></td><td align="right">5</td><td><code>/set trailing_stoploss_pct 5</code></td></tr>` +
      `<tr><td><b>scanner_poll_ms</b></td><td align="right">10000</td><td><code>/set scanner_poll_ms 10000</code></td></tr>` +
      `<tr><td><b>monitor_poll_ms</b></td><td align="right">5000</td><td><code>/set monitor_poll_ms 5000</code></td></tr>` +
      `<tr><td><b>max_open_positions</b></td><td align="right">5</td><td><code>/set max_open_positions 5</code></td></tr>` +
      `<tr><td><b>max_position_minutes</b></td><td align="right">30</td><td><code>/set max_position_minutes 30</code></td></tr>` +
      `<tr><td><b>no_rebuy</b></td><td align="right">true</td><td><code>/set no_rebuy true</code></td></tr>` +
      `<tr><td><b>max_dev_hold_pct</b></td><td align="right">5</td><td><code>/set max_dev_hold_pct 5</code></td></tr>` +
      `</table>` +
      `<p><b>scan_mode</b> options: <code>new</code>, <code>aboutToGraduate</code>, <code>graduated</code> (comma-separated)</p>` +
      `<p><i>Example: /set scan_mode new,aboutToGraduate</i></p>`;

    const fallback =
      `📋 *Available Config Keys*\n\n` +
      `scan_mode (new) - new,aboutToGraduate,graduated\n` +
      `min_graduation_pct (0) - min graduation progress %\n` +
      `max_graduation_pct (100) - max graduation progress %\n` +
      `min_holders (10)\n` +
      `require_social (true)\n` +
      `buy_amount_sol (0.01)\n` +
      `main_stoploss_pct (30)\n` +
      `trailing_activation_pct (10)\n` +
      `trailing_stoploss_pct (5)\n` +
      `scanner_poll_ms (10000)\n` +
      `monitor_poll_ms (5000)\n` +
      `max_open_positions (5)\n` +
      `max_position_minutes (30)\n` +
      `no_rebuy (true)\n` +
      `max_dev_hold_pct (5)\n\n` +
      `Example: /set scan_mode new,aboutToGraduate`;

    sendRichMessage(html, fallback);
  });

  // /config
  bot.command('config', async (ctx) => {
    const config = await getAllConfig();
    const { html, fallback } = formatConfigMsg(config, env.DRY_RUN);
    sendRichMessage(html, fallback);
  });

  // /set <key> <value>
  bot.command('set', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply('Usage: /set <key> <value>');
    }

    const key = parts[1];
    const value = parts.slice(2).join(' '); // Support values with spaces (comma-separated modes)

    const validKeys = [
      'scan_mode', 'scan_sort', 'scan_pageSize', 'min_graduation_pct', 'max_graduation_pct', 'min_holders', 'require_social',
      'buy_amount_sol', 'main_stoploss_pct', 'trailing_activation_pct', 'trailing_stoploss_pct',
      'scanner_poll_ms', 'monitor_poll_ms', 'max_open_positions', 'max_position_minutes',
      'no_rebuy', 'max_dev_hold_pct',
      'min_organicBuys1min', 'min_organicVolumeBuy1minUSD',
      'max_bundlersHoldingsPercentage', 'max_snipersHoldingsPercentage', 'max_top10HoldingsPercentage',
    ];

    if (!validKeys.includes(key)) {
      return ctx.reply(`❌ Invalid key: ${key}\nValid: ${validKeys.join(', ')}`);
    }

    // Validate scan_mode values
    if (key === 'scan_mode') {
      const validModes = ['new', 'aboutToGraduate', 'graduated'];
      const modes = value.split(',').map(s => s.trim());
      const invalid = modes.filter(m => !validModes.includes(m));
      if (invalid.length > 0) {
        return ctx.reply(`❌ Invalid scan mode(s): ${invalid.join(', ')}\nValid: ${validModes.join(', ')}`);
      }
    }

    // Validate scan_sort values
    if (key === 'scan_sort') {
      const validSorts = ['marketCap', 'newest', 'volume'];
      if (!validSorts.includes(value)) {
        return ctx.reply(`❌ Invalid sort: ${value}\nValid: ${validSorts.join(', ')}`);
      }
    }

    await setConfig(key, value);
    await logInfo(`Config updated: ${key} = ${value}`);
    ctx.reply(`✅ ${key} = ${value}`);
  });

  // /positions
  bot.command('positions', async (ctx) => {
    const db = getPrisma();
    const positions = await db.position.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch current prices for unrealized PnL
    const prices = {};
    for (const p of positions) {
      try {
        prices[p.id] = await getCurrentPrice(p.token);
      } catch {
        prices[p.id] = null;
      }
    }

    const { html, fallback } = formatPositionsMsg(positions, prices);
    sendRichMessage(html, fallback);
  });

  // /history
  bot.command('history', async (ctx) => {
    const db = getPrisma();
    const positions = await db.position.findMany({
      where: { status: 'closed' },
      orderBy: { closedAt: 'desc' },
      take: 10,
    });

    const { html, fallback } = formatHistoryMsg(positions);
    sendRichMessage(html, fallback);
  });

  // /sell <id>
  bot.command('sell', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Usage: /sell <id>');
    }

    const id = parseInt(parts[1]);
    const db = getPrisma();
    const position = await db.position.findUnique({ where: { id } });

    if (!position || position.status !== 'open') {
      return ctx.reply(`❌ Position #${id} not found or not open`);
    }

    await sellToken(id, 'Manual sell via Telegram');
    stopPriceMonitor(id);
  });

  // /start_scanner
  bot.command('start_scanner', async (ctx) => {
    if (scannerRunning) {
      return ctx.reply('⚠️ Scanner already running');
    }

    scannerRunning = true;
    await setScannerState(true);
    await startScanner(notifyAdmin);
    await resumeAllMonitors();
    await logInfo('Scanner started');
    ctx.reply('🚀 Scanner started!');
  });

  // /stop_scanner
  bot.command('stop_scanner', async (ctx) => {
    if (!scannerRunning) {
      return ctx.reply('⚠️ Scanner not running');
    }

    stopScanner();
    scannerRunning = false;
    await setScannerState(false);
    await logInfo('Scanner stopped');
    ctx.reply('🛑 Scanner stopped');
  });

  // /status
  bot.command('status', async (ctx) => {
    const db = getPrisma();
    const openCount = await db.position.count({ where: { status: 'open' } });
    const closedCount = await db.position.count({ where: { status: 'closed' } });
    const totalPnl = await db.position.aggregate({
      where: { status: 'closed' },
      _sum: { pnl: true },
    });
    const logCount = await db.log.count();

    let balance = 0;
    try {
      balance = await getBalance();
    } catch {}

    const { html, fallback } = formatStatusMsg({
      scannerRunning,
      dryRun: env.DRY_RUN,
      openCount,
      closedCount,
      totalPnl: totalPnl._sum.pnl,
      logCount,
      balance,
    });

    sendRichMessage(html, fallback);
  });

  // /summary
  bot.command('summary', async (ctx) => {
    const db = getPrisma();

    let balance = 0;
    try {
      balance = await getBalance();
    } catch {}

    // Get all closed positions
    const closed = await db.position.findMany({ where: { status: 'closed' } });
    const openCount = await db.position.count({ where: { status: 'open' } });

    // Win/loss
    const winCount = closed.filter(p => (p.pnl || 0) > 0).length;
    const lossCount = closed.filter(p => (p.pnl || 0) <= 0).length;
    const totalTrades = closed.length;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

    // Best/worst
    const sorted = [...closed].sort((a, b) => (a.pnl || 0) - (b.pnl || 0));
    const worstTrade = sorted.length > 0 ? sorted[0] : null;
    const bestTrade = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    // Total PnL in SOL
    const totalPnlSol = closed.reduce((sum, p) => {
      const buy = p.buyAmountSol || 0;
      const sell = p.sellAmountSol || 0;
      return sum + (sell - buy);
    }, 0);

    // Today's PnL
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayClosed = closed.filter(p => p.closedAt && new Date(p.closedAt) >= today);
    const todayPnlSol = todayClosed.reduce((sum, p) => {
      const buy = p.buyAmountSol || 0;
      const sell = p.sellAmountSol || 0;
      return sum + (sell - buy);
    }, 0);

    const { html, fallback } = formatSummaryMsg({
      balance,
      totalTrades,
      winCount,
      lossCount,
      winRate,
      bestTrade: bestTrade ? { pnl: bestTrade.pnl || 0 } : null,
      worstTrade: worstTrade ? { pnl: worstTrade.pnl || 0 } : null,
      todayPnlSol,
      totalPnlSol,
      openCount,
    });

    sendRichMessage(html, fallback);
  });

  // /logs [n]
  bot.command('logs', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const limit = parseInt(parts[1]) || 20;
    const logs = await getRecentLogs(limit);
    const { html, fallback } = formatLogsMsg(logs);
    sendRichMessage(html, fallback);
  });

  // /logs_error [n]
  bot.command('logs_error', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const limit = parseInt(parts[1]) || 20;
    const logs = await getRecentLogs(limit, 'error');
    const { html, fallback } = formatLogsMsg(logs, 'errors');
    sendRichMessage(html, fallback);
  });

  // /clear_logs
  bot.command('clear_logs', async (ctx) => {
    const db = getPrisma();
    const result = await db.log.deleteMany();
    ctx.reply(`🗑️ Cleared ${result.count} logs`);
  });

  // Launch bot
  await bot.launch();
  console.log('[Bot] Telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
