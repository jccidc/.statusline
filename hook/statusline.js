#!/usr/bin/env node
// gsd-hook-version: 1.34.2
// Claude Code Statusline - GSD Edition
// Shows: model | current task | directory | context usage

const fs = require('fs');
const path = require('path');
const os = require('os');

// Read JSON from stdin
let input = '';
// Timeout guard: if stdin doesn't close within 3s (e.g. pipe issues on
// Windows/Git Bash), exit silently instead of hanging. See #775.
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Context window display (shows USED percentage scaled to usable context)
    // Claude Code reserves ~16.5% for autocompact buffer, so usable context
    // is 83.5% of the total window. We normalize to show 100% at that point.
    const AUTO_COMPACT_BUFFER_PCT = 16.5;
    let ctx = '';
    if (remaining != null) {
      // Normalize: subtract buffer from remaining, scale to usable range
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

      // Write context metrics to bridge file for the context-monitor PostToolUse hook.
      // The monitor reads this file to inject agent-facing warnings when context is low.
      // Reject session IDs with path separators or traversal sequences to prevent
      // a malicious session_id from writing files outside the temp directory.
      const sessionSafe = session && !/[/\\]|\.\./.test(session);
      if (sessionSafe) {
        try {
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
          const bridgeData = JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000)
          });
          fs.writeFileSync(bridgePath, bridgeData);
        } catch (e) {
          // Silent fail -- bridge is best-effort, don't break statusline
        }
      }

      // Build progress bar (10 segments)
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      // Color based on usable context thresholds
      if (used < 50) {
        ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      } else if (used < 65) {
        ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      } else if (used < 80) {
        ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      } else {
        ctx = ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
      }
    }

    const homeDir = os.homedir();
    const homeResolved = path.resolve(homeDir);
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

    // Todos: capture current in-progress task + pending count for the badge.
    let task = '';
    let todosPending = 0;
    const todosDir = path.join(claudeDir, 'todos');
    if (session && fs.existsSync(todosDir)) {
      try {
        const files = fs.readdirSync(todosDir)
          .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          try {
            const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
            const inProgress = todos.find(t => t.status === 'in_progress');
            if (inProgress) task = inProgress.activeForm || '';
            todosPending = todos.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Caveman flag
    const cavemanActive = fs.existsSync(path.join(homeDir, '.claude', '.caveman-active'));

    // Walk up from cwd to the nearest project root (first dir with .git), stopping at home.
    let foundRoot = null;
    try {
      let cur = path.resolve(dir);
      for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(cur, '.git'))) { foundRoot = cur; break; }
        if (cur === homeResolved) break;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      if (foundRoot === homeResolved) foundRoot = null;
    } catch (e) {}

    // Enforcer progress (done/total) if a ledger exists at the project root.
    let enforcerProgress = '';
    if (foundRoot) {
      try {
        const ledgerPath = path.join(foundRoot, '.plan-enforcer', 'ledger.md');
        if (fs.existsSync(ledgerPath)) {
          const ledger = fs.readFileSync(ledgerPath, 'utf8');
          const sb = ledger.match(/(\d+)\s+total\s*\|\s*(\d+)\s+done\s*\|\s*(\d+)\s+verified(?:\s*\|\s*(\d+)\s+skipped)?/i);
          let done = 0, total = 0;
          if (sb) {
            total = parseInt(sb[1], 10);
            done = parseInt(sb[2], 10) + parseInt(sb[3], 10) + (sb[4] ? parseInt(sb[4], 10) : 0);
          } else {
            const rows = ledger.split('\n').filter(l => /^\|\s*T\d+\s*\|/.test(l));
            total = rows.length;
            done = rows.filter(l => /\|\s*(done|verified|skipped)\s*\|/i.test(l)).length;
          }
          if (total > 0) enforcerProgress = `${done}/${total}`;
        }
      } catch (e) {}
    }

    // Preview fallback — force the enforcer badge when no real ledger is detected but a
    // preview flag file exists. Real ledger always wins; this only fills in when empty.
    if (!enforcerProgress) {
      try {
        const previewFlag = path.join(homeDir, '.claude', '.enforcer-preview');
        if (fs.existsSync(previewFlag)) {
          const raw = fs.readFileSync(previewFlag, 'utf8').trim();
          enforcerProgress = raw || '3/7';
        }
      } catch (e) {}
    }

    // Git helpers — execSync with short timeout, fail silent.
    function tryGit(args, cwd) {
      try {
        const { execSync } = require('child_process');
        return execSync('git ' + args, {
          cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 400, windowsHide: true,
        }).toString().trim();
      } catch (e) { return ''; }
    }
    function formatAge(unixSec) {
      const now = Math.floor(Date.now() / 1000);
      const dt = Math.max(0, now - unixSec);
      if (dt < 60) return dt + 's ago';
      if (dt < 3600) return Math.floor(dt / 60) + 'm ago';
      if (dt < 86400) return Math.floor(dt / 3600) + 'h ago';
      return Math.floor(dt / 86400) + 'd ago';
    }
    let branch = '', commitAge = '';
    if (foundRoot) {
      branch = tryGit('rev-parse --abbrev-ref HEAD', foundRoot);
      if (branch === 'HEAD') branch = tryGit('rev-parse --short HEAD', foundRoot);
      const ts = tryGit('log -1 --format=%ct', foundRoot);
      if (ts) commitAge = formatAge(parseInt(ts, 10));
    }

    // Usage stats from session JSONL logs.
    // Claude Code writes one append-only .jsonl per session under
    // ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl. Each `assistant`
    // entry carries message.usage.{input_tokens, output_tokens,
    // cache_read_input_tokens, cache_creation_input_tokens, model}. We parse
    // the current session for live stats and a cached cross-session scan for
    // today's cost + messages-this-5h.

    // Per-1M-token prices (USD). Rough, user-side estimate only.
    const PRICES = {
      opus:   { in: 15.0, out: 75.0 },
      sonnet: { in: 3.0,  out: 15.0 },
      haiku:  { in: 0.8,  out: 4.0 },
    };
    function priceFor(modelStr) {
      const m = String(modelStr || '').toLowerCase();
      if (m.includes('opus')) return PRICES.opus;
      if (m.includes('haiku')) return PRICES.haiku;
      return PRICES.sonnet;
    }
    function costOfUsage(u, modelStr) {
      if (!u) return 0;
      const p = priceFor(modelStr);
      const input = u.input_tokens || 0;
      const output = u.output_tokens || 0;
      const cacheRead = u.cache_read_input_tokens || 0;
      const cache5m = u.cache_creation?.ephemeral_5m_input_tokens || 0;
      const cache1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
      return (
        input * p.in +
        output * p.out +
        cacheRead * p.in * 0.1 +
        cache5m * p.in * 1.25 +
        cache1h * p.in * 2.0
      ) / 1e6;
    }
    function sanitizeCwd(d) {
      // Claude Code maps each [:\/ ] char to '-' individually (not greedy),
      // so C:/Users/... becomes C--Users-... (two hyphens at the drive split).
      return String(d).replace(/[:\\/]/g, '-').replace(/\s/g, '-');
    }
    function readJsonlStats(filepath, cutoffMs) {
      // Streamed-ish read (small files; Claude logs cap under a few MB typical).
      // Returns { tokens, cost, cacheRead, cacheWrite, input, output, msgCount, lastTs }.
      const out = { tokens: 0, cost: 0, cacheRead: 0, cacheWrite: 0, input: 0, output: 0, msgCount: 0, lastTs: 0 };
      try {
        const raw = fs.readFileSync(filepath, 'utf8');
        const lines = raw.split('\n');
        for (const line of lines) {
          if (!line) continue;
          let d;
          try { d = JSON.parse(line); } catch (e) { continue; }
          const tsStr = d.timestamp;
          const ts = tsStr ? Date.parse(tsStr) : 0;
          if (cutoffMs && ts && ts < cutoffMs) continue;
          if (d.type === 'assistant') {
            const msg = d.message || {};
            const u = msg.usage;
            if (u) {
              out.input += u.input_tokens || 0;
              out.output += u.output_tokens || 0;
              out.cacheRead += u.cache_read_input_tokens || 0;
              out.cacheWrite += (u.cache_creation?.ephemeral_5m_input_tokens || 0) +
                                (u.cache_creation?.ephemeral_1h_input_tokens || 0);
              out.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
                             (u.cache_read_input_tokens || 0) +
                             (u.cache_creation_input_tokens || 0);
              out.cost += costOfUsage(u, msg.model);
              out.msgCount += 1;
              if (ts > out.lastTs) out.lastTs = ts;
            }
          }
        }
      } catch (e) {}
      return out;
    }
    // One-pass multi-window read. `windows` is { key: cutoffMs, ... }.
    // Returns { key: { cost, msgCount, earliestTs, lastTs } }.
    function readJsonlWindows(filepath, windows) {
      const out = {};
      for (const k of Object.keys(windows)) {
        out[k] = { cost: 0, msgCount: 0, earliestTs: 0, lastTs: 0 };
      }
      try {
        const raw = fs.readFileSync(filepath, 'utf8');
        const lines = raw.split('\n');
        for (const line of lines) {
          if (!line) continue;
          let d;
          try { d = JSON.parse(line); } catch (e) { continue; }
          if (d.type !== 'assistant') continue;
          const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
          if (!ts) continue;
          const msg = d.message || {};
          const u = msg.usage;
          if (!u) continue;
          const cost = costOfUsage(u, msg.model);
          for (const [k, cutoff] of Object.entries(windows)) {
            if (ts < cutoff) continue;
            const s = out[k];
            s.cost += cost;
            s.msgCount += 1;
            if (!s.earliestTs || ts < s.earliestTs) s.earliestTs = ts;
            if (ts > s.lastTs) s.lastTs = ts;
          }
        }
      } catch (e) {}
      return out;
    }
    function formatDuration(ms) {
      if (ms <= 0) return '0m';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d > 0) return d + 'd' + (h ? h + 'h' : '');
      if (h > 0) return h + 'h' + (m ? m + 'm' : '');
      return m + 'm';
    }
    function formatTokens(n) {
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
      return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    // Display currency. USD native; SEK converted via STATUSLINE_SEK_RATE.
    // All internal costs stay USD; only display layer converts.
    const CURRENCY = (process.env.STATUSLINE_CURRENCY || 'USD').toUpperCase() === 'SEK' ? 'SEK' : 'USD';
    const SEK_RATE = Number(process.env.STATUSLINE_SEK_RATE || 10.5);
    function toDisplay(usd) {
      return CURRENCY === 'SEK' ? usd * SEK_RATE : usd;
    }
    function formatCost(usd) {
      const v = toDisplay(usd);
      if (CURRENCY === 'SEK') {
        if (v < 1) return '0 kr';
        if (v < 100) return Math.round(v) + ' kr';
        return Math.round(v).toLocaleString('en-US').replace(/,/g, ' ') + ' kr';
      }
      if (usd < 0.01) return '$0.00';
      if (usd < 100) return '$' + v.toFixed(2);
      return '$' + v.toFixed(0);
    }
    function formatCeiling(displayAmount) {
      return CURRENCY === 'SEK' ? `${Math.round(displayAmount)} kr` : `$${displayAmount}`;
    }

    // Current session stats (live, no cache — file is append-only, reading whole file is cheap).
    let sessionStats = null;
    if (session) {
      const projectDir = path.join(claudeDir, 'projects', sanitizeCwd(dir));
      const sessionFile = path.join(projectDir, session + '.jsonl');
      if (fs.existsSync(sessionFile)) sessionStats = readJsonlStats(sessionFile, 0);
    }

    // Cross-session aggregates, cached in tmp for 60s.
    // Windows: 5h (rolling), today (since midnight), week (rolling 7d).
    let aggStats = {
      todayCost: 0,
      msgs5h: 0, cost5h: 0, earliest5h: 0,
      msgsWeek: 0, costWeek: 0, earliestWeek: 0,
    };
    try {
      const cachePath = path.join(os.tmpdir(), 'claude-statusline-agg.json');
      const now = Date.now();
      let cached = null;
      if (fs.existsSync(cachePath)) {
        try {
          const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          if (c && c.fetchedAt && now - c.fetchedAt < 60_000) cached = c;
        } catch (e) {}
      }
      if (cached) {
        aggStats = {
          todayCost:    cached.todayCost    || 0,
          msgs5h:       cached.msgs5h       || 0,
          cost5h:       cached.cost5h       || 0,
          earliest5h:   cached.earliest5h   || 0,
          msgsWeek:     cached.msgsWeek     || 0,
          costWeek:     cached.costWeek     || 0,
          earliestWeek: cached.earliestWeek || 0,
        };
      } else {
        const projectsDir = path.join(claudeDir, 'projects');
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const fiveHAgo = now - 5 * 60 * 60 * 1000;
        const weekAgo  = now - 7 * 24 * 60 * 60 * 1000;
        const windows = { today: todayMs, window5h: fiveHAgo, week: weekAgo };
        const oldest  = Math.min(todayMs, fiveHAgo, weekAgo);
        let todayCost = 0, msgs5h = 0, cost5h = 0, earliest5h = 0;
        let msgsWeek = 0, costWeek = 0, earliestWeek = 0;
        try {
          const projects = fs.readdirSync(projectsDir);
          for (const p of projects) {
            const pDir = path.join(projectsDir, p);
            let entries;
            try { entries = fs.readdirSync(pDir); } catch (e) { continue; }
            for (const f of entries) {
              if (!f.endsWith('.jsonl')) continue;
              const fp = path.join(pDir, f);
              let st;
              try { st = fs.statSync(fp); } catch (e) { continue; }
              // Skip files untouched for longer than every window of interest.
              if (st.mtimeMs < oldest) continue;
              const w = readJsonlWindows(fp, windows);
              todayCost += w.today.cost;
              msgs5h    += w.window5h.msgCount;
              cost5h    += w.window5h.cost;
              if (w.window5h.earliestTs && (!earliest5h || w.window5h.earliestTs < earliest5h)) {
                earliest5h = w.window5h.earliestTs;
              }
              msgsWeek  += w.week.msgCount;
              costWeek  += w.week.cost;
              if (w.week.earliestTs && (!earliestWeek || w.week.earliestTs < earliestWeek)) {
                earliestWeek = w.week.earliestTs;
              }
            }
          }
        } catch (e) {}
        aggStats = { todayCost, msgs5h, cost5h, earliest5h, msgsWeek, costWeek, earliestWeek };
        try {
          fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: now, ...aggStats }));
        } catch (e) {}
      }
    } catch (e) {}

    // Authoritative quota override (optional escape hatch).
    // If a scraper (ccusage, mitmproxy capture, corporate bot, future `claude usage --json`)
    // writes ~/.claude/.statusline-quota.json within the last 15 min, the hook uses its
    // numbers instead of the local estimate. Override path: STATUSLINE_QUOTA_FILE.
    // Schema (all fields optional — hook gracefully uses whatever is present):
    //   {
    //     "fetched_at": <unix seconds>,            // required for freshness check
    //     "five_hour": {
    //       "messages_used":   <number>,
    //       "messages_limit":  <number>,
    //       "used_pct":        <number 0-100>,     // used if messages_* absent
    //       "resets_at":       <unix seconds>      // time-left comes from here
    //     },
    //     "weekly": {
    //       "used_pct":        <number 0-100>,
    //       "cost_usd":        <number>,           // optional alternative display
    //       "limit_usd":       <number>,
    //       "resets_at":       <unix seconds>
    //     }
    //   }
    let quota = null;
    try {
      const quotaPath = process.env.STATUSLINE_QUOTA_FILE ||
                        path.join(homeDir, '.claude', '.statusline-quota.json');
      if (fs.existsSync(quotaPath)) {
        const q = JSON.parse(fs.readFileSync(quotaPath, 'utf8'));
        const fetchedAt = (q && q.fetched_at) ? q.fetched_at * 1000 : 0;
        if (fetchedAt && Date.now() - fetchedAt < 15 * 60 * 1000) quota = q;
      }
    } catch (e) {}

    // Context bar — bar + percent + color, built from remaining_percentage.
    let ctxText = '', ctxColorCode = '';
    if (remaining != null) {
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      ctxText = `${bar} ${used}%`;
      if (used < 50) ctxColorCode = '32';          // green
      else if (used < 65) ctxColorCode = '33';     // yellow
      else if (used < 80) ctxColorCode = '38;5;208'; // orange
      else ctxColorCode = '5;31';                  // blinking red
    }

    // Build segment list — only include segments with real data.
    // Shape: { text, codes, caption, sepBefore }
    const segs = [];
    segs.push({ text: `[${String(model).toUpperCase()}]`, codes: '2;38;5;208', caption: 'model', sepBefore: null });
    if (enforcerProgress) segs.push({ text: `[ENFORCER:${enforcerProgress}]`, codes: '1;94', caption: 'enforcer', sepBefore: null });
    if (cavemanActive) segs.push({ text: '[CAVEMAN]', codes: '1;93', caption: 'caveman', sepBefore: null });
    segs.push({ text: '\u{1F4C2} ' + path.basename(dir), codes: '2;97', caption: 'local directory', sepBefore: null });
    if (foundRoot) segs.push({ text: '\u{1F4DF} ' + path.basename(foundRoot), codes: '31', caption: 'Repository', sepBefore: ' \u2502 ' });
    if (branch) segs.push({ text: '\u{1F33F} ' + branch, codes: '31', caption: 'branch', sepBefore: ' \u2192 ' });
    if (commitAge) segs.push({ text: '\u2713 ' + commitAge, codes: '3;31', caption: 'commit', sepBefore: ' \u2192 ' });
    if (todosPending > 0) segs.push({ text: `[${todosPending} TODO]`, codes: '95', caption: 'todos', sepBefore: null });
    if (task) segs.push({ text: task, codes: '1;95', caption: 'current task', sepBefore: ' \u2192 ' });
    if (ctxText) segs.push({ text: ctxText, codes: ctxColorCode, caption: 'Context', sepBefore: null, align: 'left' });

    // Usage segments. Only session tokens enabled — cost/cache/today/msgs left
    // commented so you can flip them back on per taste. Captions stay short so
    // they don't get truncated under small numeric values.
    if (sessionStats && sessionStats.tokens > 0) {
      segs.push({ text: formatTokens(sessionStats.tokens), codes: '96', caption: 'tok', sepBefore: null, align: 'left' });
      // segs.push({ text: formatCost(sessionStats.cost), codes: '92', caption: 'cost', sepBefore: null });
      // const cacheInputTotal = sessionStats.cacheRead + sessionStats.input + sessionStats.cacheWrite;
      // if (cacheInputTotal > 0) {
      //   const hitPct = Math.round((sessionStats.cacheRead / cacheInputTotal) * 100);
      //   segs.push({ text: hitPct + '% cached', codes: '38;5;208', caption: 'cache', sepBefore: null });
      // }
    }
    // if (aggStats.todayCost > 0) {
    //   segs.push({ text: formatCost(aggStats.todayCost) + ' today', codes: '92', caption: 'today', sepBefore: null });
    // }
    // if (aggStats.msgs5h > 0) {
    //   segs.push({ text: aggStats.msgs5h + ' msgs/5h', codes: '93', caption: 'msgs', sepBefore: null });
    // }

    // Helper: pick a color code based on % used. Flashing red at 90+.
    function pctCodes(pct, baseColor) {
      if (pct >= 90) return '5;31';
      if (pct >= 75) return '38;5;208';
      if (pct >= 50) return '33';
      return baseColor;
    }
    function barStr(pct) {
      const p = Math.min(100, Math.max(0, pct));
      const filled = Math.min(10, Math.floor(p / 10));
      return '█'.repeat(filled) + '░'.repeat(10 - filled);
    }

    // 5h window segment. Prefers authoritative quota file if present.
    const q5 = quota && quota.five_hour;
    const hasQuota5h = q5 && (q5.resets_at || q5.messages_used != null || q5.used_pct != null);
    if (hasQuota5h) {
      const timeLeft = q5.resets_at ? Math.max(0, q5.resets_at * 1000 - Date.now()) : 0;
      const left = q5.resets_at ? formatDuration(timeLeft) : '?';
      let pct = 0, label = '';
      if (q5.messages_used != null && q5.messages_limit) {
        pct = Math.min(100, Math.round((q5.messages_used / q5.messages_limit) * 100));
        label = `${q5.messages_used}/${q5.messages_limit}`;
      } else if (q5.used_pct != null) {
        pct = Math.min(100, Math.round(q5.used_pct));
        label = `${pct}%`;
      } else if (q5.messages_used != null) {
        label = String(q5.messages_used);
      }
      const text = `5h ${barStr(pct)} ${label} · ${left}`;
      segs.push({ text, codes: pctCodes(pct, '93'), caption: '5h window*', sepBefore: null, align: 'left' });
    } else if (aggStats.earliest5h) {
      // Fallback: local estimate
      const timeLeft = Math.max(0, (5 * 3600 * 1000) - (Date.now() - aggStats.earliest5h));
      const left = formatDuration(timeLeft);
      const ceiling = Number(process.env.STATUSLINE_5H_MSG_CEILING || 0);
      let text, codes;
      if (ceiling > 0) {
        const pct = Math.min(100, Math.round((aggStats.msgs5h / ceiling) * 100));
        text = `5h ${barStr(pct)} ${aggStats.msgs5h}/${ceiling} · ${left}`;
        codes = pctCodes(pct, '93');
      } else {
        text = `5h: ${aggStats.msgs5h} · ${left}`;
        codes = '93';
      }
      segs.push({ text, codes, caption: '5h window', sepBefore: null, align: 'left' });
    }

    // Weekly segment. Prefers authoritative quota file if present.
    const qw = quota && quota.weekly;
    const hasQuotaWk = qw && (qw.resets_at || qw.used_pct != null || qw.cost_usd != null);
    if (hasQuotaWk) {
      const timeLeft = qw.resets_at ? Math.max(0, qw.resets_at * 1000 - Date.now()) : 0;
      const left = qw.resets_at ? formatDuration(timeLeft) : '?';
      let pct = 0, label = '';
      if (qw.used_pct != null) {
        pct = Math.min(100, Math.round(qw.used_pct));
        label = `${pct}%`;
      } else if (qw.cost_usd != null && qw.limit_usd) {
        pct = Math.min(100, Math.round((qw.cost_usd / qw.limit_usd) * 100));
        label = `${formatCost(qw.cost_usd)}/${formatCeiling(toDisplay(qw.limit_usd))}`;
      } else if (qw.cost_usd != null) {
        label = formatCost(qw.cost_usd);
      }
      const text = `wk ${barStr(pct)} ${label} · ${left}`;
      segs.push({ text, codes: pctCodes(pct, '95'), caption: 'weekly*', sepBefore: null, align: 'left' });
    } else if (aggStats.earliestWeek) {
      // Fallback: local estimate
      const timeLeft = Math.max(0, (7 * 86400 * 1000) - (Date.now() - aggStats.earliestWeek));
      const left = formatDuration(timeLeft);
      const costStr = formatCost(aggStats.costWeek);
      const ceilingDisplay = Number(process.env.STATUSLINE_WEEKLY_COST_CEILING || 0);
      let text, codes;
      if (ceilingDisplay > 0) {
        const costDisplay = toDisplay(aggStats.costWeek);
        const pct = Math.min(100, Math.round((costDisplay / ceilingDisplay) * 100));
        text = `wk ${barStr(pct)} ${costStr}/${formatCeiling(ceilingDisplay)} · ${left}`;
        codes = pctCodes(pct, '95');
      } else {
        text = `wk: ${costStr} · ${left}`;
        codes = '95';
      }
      segs.push({ text, codes, caption: 'weekly', sepBefore: null, align: 'left' });
    }

    // Visible-width helper (rough: emoji / symbol code points = 2 cols).
    function visibleLen(s) {
      let n = 0;
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF)) n += 2;
        else n += 1;
      }
      return n;
    }

    const DEFAULT_SEP = ' | ';
    const SEP_COLOR = '38;5;208'; // orange
    const wrapSep = s => `\x1b[${SEP_COLOR}m${s}\x1b[0m`;

    // Line 1: statusline.
    let line1 = '';
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) line1 += wrapSep(segs[i].sepBefore || DEFAULT_SEP);
      line1 += `\x1b[${segs[i].codes}m${segs[i].text}\x1b[0m`;
    }

    // Line 2: dim gray captions centered under each segment.
    function centerPad(str, width) {
      if (str.length >= width) return str.slice(0, width);
      const total = width - str.length;
      const left = Math.floor(total / 2);
      const right = total - left;
      return ' '.repeat(left) + str + ' '.repeat(right);
    }
    let line2 = '\x1b[2;90m';
    for (let i = 0; i < segs.length; i++) {
      const w = visibleLen(segs[i].text);
      const cap = segs[i].caption || '';
      if (segs[i].align === 'left') line2 += cap.padEnd(w).slice(0, w);
      else if (segs[i].align === 'right') line2 += cap.padStart(w).slice(-w);
      else line2 += centerPad(cap, w);
      if (i < segs.length - 1) {
        const sepLiteral = segs[i + 1].sepBefore || DEFAULT_SEP;
        line2 += ' '.repeat(visibleLen(sepLiteral));
      }
    }
    line2 += '\x1b[0m';

    process.stdout.write(line1 + '\n' + line2);
  } catch (e) {
    // Silent fail - don't break statusline on parse errors
  }
});
