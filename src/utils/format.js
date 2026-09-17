/**
 * Format date to WIB (UTC+7)
 */
function toWIB(date) {
  const d = new Date(date);
  d.setHours(d.getHours() + 7);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = months[d.getUTCMonth()];
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const secs = String(d.getUTCSeconds()).padStart(2, '0');
  return `${day} ${month}, ${hours}:${mins}:${secs}`;
}

/**
 * Escape characters for Telegram HTML
 */
export function htmlEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format price with subscript notation for small numbers
 * e.g. 0.0₄2 instead of 0.00002
 */
function fmtPrice(price) {
  if (!price) return 'N/A';
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);

  // Small numbers: use subscript notation
  const str = price.toFixed(20);
  const match = str.match(/^(0\.)(0+)(\d+?)(0*)$/);
  if (!match) return price.toFixed(8);

  const leadingZeros = match[2].length;
  const digits = match[3];

  if (leadingZeros < 4) {
    return price.toFixed(leadingZeros + digits.length);
  }

  const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
  const subNum = String(leadingZeros).split('').map(d => subscripts[parseInt(d)]).join('');
  const trimmed = digits.slice(0, 3);

  return `0.0${subNum}${trimmed}`;
}

/**
 * Build gmgn.ai URL for a token
 */
function gmgnUrl(mint) {
  return `https://gmgn.ai/sol/token/${mint}`;
}

/**
 * Format buy notification
 */
export function formatBuyMsg(data) {
  const { symbol, token, amount, tokens, price, mainSL, trailingPct, positionId, tx, dryRun } = data;
  const url = gmgnUrl(token);

  const html =
    `<h3>🟢 BUY ${htmlEsc(symbol)}</h3>` +
    `<table bordered striped>` +
    `<tr><td>Token</td><td align="right"><a href="${url}">${htmlEsc(symbol)}</a></td></tr>` +
    `<tr><td>Amount</td><td align="right"><b>${amount} SOL</b></td></tr>` +
    `<tr><td>Tokens</td><td align="right">${tokens > 0 ? tokens.toFixed(4) : 'pending'}</td></tr>` +
    `<tr><td>Price</td><td align="right">${fmtPrice(price)} SOL</td></tr>` +
    `<tr><td>Main SL</td><td align="right">${fmtPrice(mainSL)} SOL</td></tr>` +
    `<tr><td>Trailing</td><td align="right">${trailingPct}%</td></tr>` +
    `<tr><td>Position</td><td align="right">#${positionId}</td></tr>` +
    `<tr><td>Tx</td><td align="right"><code>${htmlEsc(tx)}</code></td></tr>` +
    `</table>` +
    `<p>${dryRun ? '🧪 <i>DRY RUN</i>' : '💰 <b>LIVE TRADE</b>'}</p>`;

  const fallback =
    `🟢 *BUY ${symbol}*\n\n` +
    `Token: [${symbol}](${url})\n` +
    `Amount: ${amount} SOL\n` +
    `Tokens: ${tokens > 0 ? tokens.toFixed(4) : 'pending'}\n` +
    `Price: ${fmtPrice(price)} SOL\n` +
    `Main SL: ${fmtPrice(mainSL)} SOL\n` +
    `Trailing: ${trailingPct}%\n` +
    `Position: #${positionId}\n` +
    `Tx: \`${tx}\`\n\n` +
    (dryRun ? '🧪 DRY RUN' : '💰 LIVE TRADE');

  return { html, fallback };
}

/**
 * Format sell notification
 */
export function formatSellMsg(data) {
  const { symbol, token, positionId, reason, buyPrice, buyAmountSol, sellPrice, solReceived, pnl, tx, dryRun } = data;
  const url = gmgnUrl(token);
  const pnlNum = parseFloat(pnl);
  const pnlEmoji = pnlNum >= 0 ? '📈' : '📉';
  const pnlSol = solReceived - (buyAmountSol || 0);

  const html =
    `<h3>🔴 SELL ${htmlEsc(symbol || `#${positionId}`)}</h3>` +
    `<table bordered striped>` +
    `<tr><td>Token</td><td align="right"><a href="${url}">${htmlEsc(symbol || positionId)}</a></td></tr>` +
    `<tr><td>Reason</td><td align="right">${htmlEsc(reason)}</td></tr>` +
    `<tr><td>Buy</td><td align="right">${fmtPrice(buyPrice)} SOL</td></tr>` +
    `<tr><td>Sell</td><td align="right">${fmtPrice(sellPrice)} SOL</td></tr>` +
    `<tr><td>Received</td><td align="right">${solReceived.toFixed(6)} SOL</td></tr>` +
    `<tr><td>PnL</td><td align="right">${pnlEmoji} ${pnlNum >= 0 ? '+' : ''}${pnl}% (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)</td></tr>` +
    `<tr><td>Tx</td><td align="right"><code>${htmlEsc(tx)}</code></td></tr>` +
    `</table>` +
    `<p>${dryRun ? '🧪 <i>DRY RUN</i>' : '💰 <b>LIVE TRADE</b>'}</p>`;

  const fallback =
    `🔴 *SELL #${positionId}*\n\n` +
    `Reason: ${reason}\n` +
    `Buy: ${fmtPrice(buyPrice)} SOL\n` +
    `Sell: ${fmtPrice(sellPrice)} SOL\n` +
    `Received: ${solReceived.toFixed(6)} SOL\n` +
    `${pnlEmoji} PnL: ${pnlNum >= 0 ? '+' : ''}${pnl}% (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)\n` +
    `Tx: \`${tx}\`\n\n` +
    (dryRun ? '🧪 DRY RUN' : '💰 LIVE TRADE');

  return { html, fallback };
}

/**
 * Format error notification
 */
export function formatErrorMsg(message, data) {
  const html =
    `<h3>❌ ERROR</h3>` +
    `<pre>${htmlEsc(message)}</pre>` +
    (data ? `<pre>${htmlEsc(JSON.stringify(data, null, 2).slice(0, 400))}</pre>` : '');

  const fallback =
    `❌ *ERROR*\n\n` +
    `\`${message}\`` +
    (data ? `\n\`${JSON.stringify(data).slice(0, 200)}\`` : '');

  return { html, fallback };
}

/**
 * Format new token detected
 */
export function formatLaunchMsg(data) {
  const { symbol, name, status, mcap, volume24h } = data;

  const html =
    `<h3>🎯 ${htmlEsc(symbol)} detected!</h3>` +
    `<table bordered striped>` +
    `<tr><td>Symbol</td><td align="right"><b>${htmlEsc(symbol)}</b></td></tr>` +
    `<tr><td>Name</td><td align="right">${htmlEsc(name)}</td></tr>` +
    `<tr><td>Status</td><td align="right">${htmlEsc(status)}</td></tr>` +
    `<tr><td>MCap</td><td align="right">$${mcap?.toLocaleString() || 'N/A'}</td></tr>` +
    `<tr><td>Volume 24h</td><td align="right">$${volume24h?.toLocaleString() || 'N/A'}</td></tr>` +
    `</table>` +
    `<p><b>Running filters...</b></p>`;

  const fallback =
    `🎯 *${symbol} detected!*\n\n` +
    `Symbol: ${symbol}\n` +
    `Name: ${name}\n` +
    `Status: ${status}\n` +
    `MCap: $${mcap?.toLocaleString() || 'N/A'}\n` +
    `Volume 24h: $${volume24h?.toLocaleString() || 'N/A'}\n\n` +
    `Running filters...`;

  return { html, fallback };
}

/**
 * Format filter result
 */
export function formatFilterMsg(symbol, passed, reason) {
  if (passed) {
    return {
      html: `<p>✅ <b>${htmlEsc(symbol)} passed filters!</b> &nbsp; Buying...</p>`,
      fallback: `✅ *${symbol} passed filters!* Buying...`,
    };
  }

  const html =
    `<h3>🚫 ${htmlEsc(symbol)} filtered</h3>` +
    `<table bordered striped>` +
    `<tr><td>Symbol</td><td align="right"><b>${htmlEsc(symbol)}</b></td></tr>` +
    `<tr><td>Status</td><td align="right">REJECTED</td></tr>` +
    `<tr><td>Reason</td><td align="right">${htmlEsc(reason)}</td></tr>` +
    `</table>`;

  const fallback =
    `🚫 *${symbol} filtered*\n\n` +
    `Reason: ${reason}`;

  return { html, fallback };
}

/**
 * Format position list with unrealized PnL
 */
export function formatPositionsMsg(positions, prices = {}) {
  if (positions.length === 0) {
    return { html: '<p>📭 No open positions</p>', fallback: '📭 No open positions' };
  }

  let html = `<h3>📊 Open Positions (${positions.length})</h3>`;
  html += `<table bordered striped>`;
  html += `<tr><th>#</th><th>Token</th><th>Buy</th><th>Current</th><th>PnL</th><th>SL</th><th>Age</th></tr>`;

  let fallback = `📊 *Open Positions (${positions.length})*\n\n`;

  for (const p of positions) {
    const age = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 60000);
    const currentPrice = prices[p.id];
    const unrealizedPnl = (currentPrice && p.buyPrice > 0)
      ? ((currentPrice - p.buyPrice) / p.buyPrice) * 100
      : null;
    const pnlEmoji = unrealizedPnl !== null ? (unrealizedPnl >= 0 ? '🟢' : '🔴') : '⚪';
    const symbol = p.symbol || p.token.slice(0, 10);
    const url = gmgnUrl(p.token);

    const pnlSol = (unrealizedPnl !== null && p.buyAmountSol)
      ? p.buyAmountSol * (unrealizedPnl / 100)
      : null;
    const pnlStr = unrealizedPnl !== null
      ? `${pnlEmoji} ${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}% (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)`
      : '-';

    const activeSL = p.trailingStop || p.mainStoploss;
    const slLabel = p.trailingStop ? '📈 Trail' : '🛑 Main';

    html +=
      `<tr>` +
      `<td>${p.id}</td>` +
      `<td><b><a href="${url}">${htmlEsc(symbol)}</a></b></td>` +
      `<td>${fmtPrice(p.buyPrice)}</td>` +
      `<td>${currentPrice ? fmtPrice(currentPrice) : '-'}</td>` +
      `<td>${pnlStr}</td>` +
      `<td>${fmtPrice(activeSL)}</td>` +
      `<td>${age}m</td>` +
      `</tr>`;

    fallback +=
      `*#${p.id}* | [${symbol}](${url})\n` +
      `Buy: ${fmtPrice(p.buyPrice)} | Now: ${currentPrice ? fmtPrice(currentPrice) : '-'}\n` +
      `PnL: ${pnlStr} | SL: ${fmtPrice(activeSL)} (${slLabel})\n\n`;
  }

  html += `</table>`;

  return { html, fallback };
}

/**
 * Format trade history
 */
export function formatHistoryMsg(positions) {
  if (positions.length === 0) {
    return { html: '<p>📭 No trade history</p>', fallback: '📭 No trade history' };
  }

  let html = `<h3>📜 Trade History (last 10)</h3>`;
  html += `<table bordered striped>`;
  html += `<tr><th>ID</th><th>Token</th><th>PnL</th></tr>`;

  let fallback = `📜 *Trade History (last 10)*\n\n`;

  for (const p of positions) {
    const pnl = p.pnl || 0;
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    const symbol = p.symbol || p.token.slice(0, 10);
    const url = gmgnUrl(p.token);

    const pnlSol = (p.sellAmountSol && p.buyAmountSol)
      ? p.sellAmountSol - p.buyAmountSol
      : p.buyAmountSol ? p.buyAmountSol * (pnl / 100) : 0;
    const pnlStr = `${emoji} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)`;

    html +=
      `<tr>` +
      `<td>#${p.id}</td>` +
      `<td><b><a href="${url}">${htmlEsc(symbol)}</a></b></td>` +
      `<td>${pnlStr}</td>` +
      `</tr>`;

    fallback += `${pnlStr} #${p.id} | [${symbol}](${url})\n`;
  }

  html += `</table>`;

  return { html, fallback };
}

/**
 * Format config list (categorized)
 */
export function formatConfigMsg(config, dryRun) {
  const categories = {
    '🔍 Scanner': ['scan_mode', 'scan_sort', 'scan_pageSize', 'min_graduation_pct', 'max_graduation_pct', 'max_open_positions', 'no_rebuy'],
    '🎯 Filter': ['min_liquidityUsd', 'min_holders', 'require_social', 'max_dev_hold_pct',
      'min_organicBuys1min', 'min_organicVolumeBuy1minUSD',
      'max_bundlersHoldingsPercentage', 'max_snipersHoldingsPercentage', 'max_top10HoldingsPercentage',
      'max_priceChange5minPercentage'],
    '💰 Trade': ['buy_amount_sol', 'slippageBps', 'main_stoploss_pct', 'trailing_activation_pct', 'trailing_stoploss_pct', 'max_position_minutes'],
    '⚙️ System': ['scanner_poll_ms', 'monitor_poll_ms'],
  };

  let html = `<h3>⚙️ Current Config</h3>`;
  let fallback = `⚙️ *Current Config*\n\n`;

  for (const [cat, keys] of Object.entries(categories)) {
    html += `<p><b>${cat}</b></p>`;
    html += `<table bordered striped>`;
    html += `<tr><th>Key</th><th align="right">Value</th></tr>`;
    fallback += `*${cat}*\n`;

    const hints = {
      scan_mode: '<br>(<code>new</code> | <code>aboutToGraduate</code> | <code>graduated</code>)',
      scan_sort: '<br>(<code>marketCap</code> | <code>newest</code> | <code>volume</code>)',
      scan_pageSize: '<br>(<code>1-100</code>, default 50)',
    };

    for (const key of keys) {
      const value = config[key] || '-';
      const hint = hints[key] ? ` ${hints[key]}` : '';
      html += `<tr><td><code>${htmlEsc(key)}</code></td><td align="right"><code>${htmlEsc(value)}</code>${hint}</td></tr>`;
      fallback += `  ${key}: \`${value}\`${hint}\n`;
    }

    html += `</table>`;
    fallback += `\n`;
  }

  html += `<p>${dryRun ? '🧪 <i>DRY RUN</i>' : '💰 <b>LIVE MODE</b>'}</p>`;
  fallback += `${dryRun ? '🧪 DRY RUN' : '💰 LIVE MODE'}`;

  return { html, fallback };
}

/**
 * Format status
 */
export function formatStatusMsg(data) {
  const { scannerRunning, dryRun, openCount, closedCount, totalPnl, logCount, balance } = data;

  const html =
    `<h3>📊 Bot Status</h3>` +
    `<table bordered striped>` +
    `<tr><td>Scanner</td><td align="right">${scannerRunning ? '🟢 Running' : '🔴 Stopped'}</td></tr>` +
    `<tr><td>Balance</td><td align="right"><b>${balance?.toFixed(4) || '?'} SOL</b></td></tr>` +
    `<tr><td>Mode</td><td align="right">${dryRun ? '🧪 DRY RUN' : '💰 LIVE'}</td></tr>` +
    `<tr><td>Open Positions</td><td align="right"><b>${openCount}</b></td></tr>` +
    `<tr><td>Closed Trades</td><td align="right">${closedCount}</td></tr>` +
    `<tr><td>Total PnL</td><td align="right"><b>${(totalPnl || 0).toFixed(2)}%</b></td></tr>` +
    `<tr><td>Logs in DB</td><td align="right">${logCount}</td></tr>` +
    `</table>`;

  const fallback =
    `📊 *Bot Status*\n\n` +
    `Scanner: ${scannerRunning ? '🟢 Running' : '🔴 Stopped'}\n` +
    `Balance: ${balance?.toFixed(4) || '?'} SOL\n` +
    `Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n` +
    `Open: ${openCount} | Closed: ${closedCount}\n` +
    `PnL: ${(totalPnl || 0).toFixed(2)}% | Logs: ${logCount}`;

  return { html, fallback };
}

/**
 * Format summary
 */
export function formatSummaryMsg(data) {
  const {
    balance, totalTrades, winCount, lossCount, winRate,
    bestTrade, worstTrade, todayPnlSol, totalPnlSol, openCount,
  } = data;

  const html =
    `<h3>📊 Summary</h3>` +
    `<table bordered striped>` +
    `<tr><td>Balance</td><td align="right"><b>${balance.toFixed(4)} SOL</b></td></tr>` +
    `<tr><td>Open Positions</td><td align="right">${openCount}</td></tr>` +
    `<tr><td>Total Trades</td><td align="right">${totalTrades}</td></tr>` +
    `<tr><td>Win / Loss</td><td align="right">${winCount}W / ${lossCount}L</td></tr>` +
    `<tr><td>Win Rate</td><td align="right">${winRate.toFixed(1)}%</td></tr>` +
    `<tr><td>Today PnL</td><td align="right">${todayPnlSol >= 0 ? '+' : ''}${todayPnlSol.toFixed(4)} SOL</td></tr>` +
    `<tr><td>Total PnL</td><td align="right">${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)} SOL</td></tr>` +
    `<tr><td>Best Trade</td><td align="right">${bestTrade ? `${bestTrade.pnl >= 0 ? '+' : ''}${bestTrade.pnl.toFixed(2)}%` : '-'}</td></tr>` +
    `<tr><td>Worst Trade</td><td align="right">${worstTrade ? `${worstTrade.pnl >= 0 ? '+' : ''}${worstTrade.pnl.toFixed(2)}%` : '-'}</td></tr>` +
    `</table>`;

  const fallback =
    `📊 *Summary*\n\n` +
    `Balance: ${balance.toFixed(4)} SOL\n` +
    `Open: ${openCount} | Total: ${totalTrades}\n` +
    `Win/Loss: ${winCount}W / ${lossCount}L (${winRate.toFixed(1)}%)\n` +
    `Today: ${todayPnlSol >= 0 ? '+' : ''}${todayPnlSol.toFixed(4)} SOL\n` +
    `Total: ${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)} SOL\n` +
    `Best: ${bestTrade ? `${bestTrade.pnl >= 0 ? '+' : ''}${bestTrade.pnl.toFixed(2)}%` : '-'}\n` +
    `Worst: ${worstTrade ? `${worstTrade.pnl >= 0 ? '+' : ''}${worstTrade.pnl.toFixed(2)}%` : '-'}`;

  return { html, fallback };
}

/**
 * Format log list
 */
export function formatLogsMsg(logs, title) {
  if (logs.length === 0) {
    return { html: `<p>📭 No ${title || 'logs'}</p>`, fallback: `📭 No ${title || 'logs'}` };
  }

  const levelEmoji = { info: 'ℹ️', warn: '⚠️', error: '❌', buy: '🟢', sell: '🔴' };

  let html = `<h3>📋 Last ${logs.length} ${title || 'logs'}</h3>`;
  html += `<table bordered striped>`;
  html += `<tr><th>Time</th><th>Level</th><th>Message</th></tr>`;

  let fallback = `📋 *Last ${logs.length} ${title || 'logs'}*\n\n`;

  for (const l of logs) {
    const time = toWIB(l.createdAt);
    const emoji = levelEmoji[l.level] || '📝';

    html +=
      `<tr>` +
      `<td><code>${time}</code></td>` +
      `<td>${emoji} ${htmlEsc(l.level)}</td>` +
      `<td>${htmlEsc(l.message)}</td>` +
      `</tr>`;

    fallback += `${emoji} [${time}] ${l.message}\n`;
  }

  html += `</table>`;

  return { html, fallback };
}
