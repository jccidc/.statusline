#!/usr/bin/env node
// gsd-hook-version: 1.36.0
// Claude Code Statusline - GSD Edition

const fs = require('fs');
const path = require('path');
const os = require('os');

function tryLoadPresetCommon() {
  const candidates = [
    path.join(__dirname, '..', 'shared', 'statusline-preset-common.js'),
    path.join(__dirname, '..', 'statusline', 'statusline-preset-common.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return require(candidate);
    } catch (error) {
      // Keep trying other locations.
    }
  }
  return null;
}

const presetCommon = tryLoadPresetCommon();

function visibleLen(text) {
  let width = 0;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF)) width += 2;
    else width += 1;
  }
  return width;
}

function centerPad(text, width) {
  if (text.length >= width) return text.slice(0, width);
  const total = width - text.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

function applyCase(text, mode) {
  if (!text || !mode || mode === 'none') return text;
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  if (mode === 'title') {
    return text.replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
  }
  return text;
}

function truncateMiddle(text, maxWidth) {
  if (!maxWidth || text.length <= maxWidth) return text;
  if (maxWidth < 5) return text.slice(0, maxWidth);
  const keep = maxWidth - 1;
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return text.slice(0, left) + '\u2026' + text.slice(text.length - right);
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean;
  const value = parseInt(full || '000000', 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function buildSeparatorCodes(snapshot, colors) {
  const codes = [];
  if (snapshot?.sepBold) codes.push('1');
  if (snapshot?.sepDim) codes.push('2');
  const color = colors[snapshot?.sepColor || 'gray'];
  if (color && color.code != null) codes.push(String(color.code));
  return codes.join(';');
}

function buildSegmentCodes(segment, baseSegment, runtime, colors) {
  const codes = [];
  if (segment.bold) codes.push('1');
  if (segment.dim) codes.push('2');
  if (segment.italic) codes.push('3');
  if (segment.underline) codes.push('4');
  if (segment.strikethrough) codes.push('9');

  if (segment.useHex) {
    const [r, g, b] = hexToRgb(segment.hex);
    codes.push(`38;2;${r};${g};${b}`);
  } else {
    const colorChanged = segment.color !== baseSegment.color;
    if (!colorChanged && runtime?.colorCode) codes.push(String(runtime.colorCode));
    else {
      const color = colors[segment.color];
      if (color && color.code != null) codes.push(String(color.code));
    }
  }

  if (segment.useHexBg) {
    const [r, g, b] = hexToRgb(segment.hexBg);
    codes.push(`48;2;${r};${g};${b}`);
  } else if (segment.bgColor && segment.bgColor !== 'inherit') {
    const bg = colors[segment.bgColor];
    if (bg && bg.bg != null) codes.push(String(bg.bg));
  }

  return codes.join(';');
}

function buildSegmentText(segment, baseSegment, runtime, brackets) {
  let raw = '';
  if (segment.text !== baseSegment.text) raw = segment.text || '';
  else raw = runtime?.text || segment.text || '';
  if (!raw) return '';

  raw = applyCase(String(raw), segment.caseTransform);
  if (segment.maxWidth) raw = truncateMiddle(raw, segment.maxWidth);

  const bracket = brackets[segment.bracket] || brackets.none;
  const icon = segment.icon ? segment.icon + ' ' : '';
  return bracket.open + icon + raw + bracket.close;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    label: snapshot.label || '',
    enabled: Array.isArray(snapshot.enabled) ? snapshot.enabled.slice() : [],
    separator: snapshot.separator || (presetCommon?.DEFAULT_SEPARATOR || ' | '),
    sepColor: snapshot.sepColor || 'gray',
    sepBold: !!snapshot.sepBold,
    sepDim: !!snapshot.sepDim,
    showCaptions: snapshot.showCaptions !== false,
    overrides: snapshot.overrides && typeof snapshot.overrides === 'object' ? snapshot.overrides : {},
  };
}

function loadPresetSnapshot(claudeDir) {
  if (!presetCommon) return null;

  const activePath = path.join(claudeDir, '.statusline-active-preset');
  let activeName = presetCommon.DEFAULT_ACTIVE_PRESET;
  try {
    const raw = fs.readFileSync(activePath, 'utf8').trim();
    if (raw) activeName = raw;
  } catch (error) {
    // Default stays.
  }

  try {
    const presetsPath = path.join(claudeDir, 'statusline-presets.json');
    if (fs.existsSync(presetsPath)) {
      const parsed = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
      const records = parsed?.presets && typeof parsed.presets === 'object'
        ? parsed.presets
        : (parsed && typeof parsed === 'object' ? parsed : {});
      const custom = records[activeName];
      if (custom) {
        const snapshot = normalizeSnapshot(custom.snapshot || custom);
        if (snapshot) return snapshot;
      }
    }
  } catch (error) {
    // Fall through to built-in defaults.
  }

  return normalizeSnapshot(
    presetCommon.buildPresetSnapshot(activeName) ||
    presetCommon.buildPresetSnapshot(presetCommon.DEFAULT_ACTIVE_PRESET)
  );
}

function renderConfiguredStatusline(snapshot, runtimeMap) {
  if (!presetCommon || !snapshot) return '';

  const segments = presetCommon.mergeSnapshotIntoSegments(snapshot);
  const activeSegments = [];
  for (const id of snapshot.enabled || []) {
    const resolvedId = presetCommon.resolveSegmentId(id);
    const runtime = runtimeMap[resolvedId] || runtimeMap[id];
    if (!runtime || !runtime.show) continue;

    const segment = segments.find(entry => entry.id === id) || segments.find(entry => entry.id === resolvedId);
    const baseSegment = presetCommon.getBaseSegment(id) || presetCommon.getBaseSegment(resolvedId);
    if (!segment || !baseSegment) continue;

    const text = buildSegmentText(segment, baseSegment, runtime, presetCommon.BRACKETS);
    if (!text) continue;

    activeSegments.push({
      text,
      codes: buildSegmentCodes(segment, baseSegment, runtime, presetCommon.ANSI_COLORS),
      caption: segment.caption || '',
      captionAlign: segment.captionAlign || 'left',
      align: runtime.align || 'center',
      sepBefore: segment.sepBefore || '',
    });
  }

  if (!activeSegments.length) return '';

  const separator = presetCommon.effectiveSeparator(snapshot);
  const separatorCodes = buildSeparatorCodes(snapshot, presetCommon.ANSI_COLORS);
  const wrapSep = literal => separatorCodes ? `\x1b[${separatorCodes}m${literal}\x1b[0m` : literal;

  let line1 = '';
  for (let i = 0; i < activeSegments.length; i++) {
    if (i > 0) line1 += wrapSep(activeSegments[i].sepBefore || separator);
    const codes = activeSegments[i].codes;
    line1 += codes ? `\x1b[${codes}m${activeSegments[i].text}\x1b[0m` : activeSegments[i].text;
  }

  const hasAnyCaption = snapshot.showCaptions !== false && activeSegments.some(segment => segment.caption);
  if (!hasAnyCaption) return line1;

  let line2 = '\x1b[2;90m';
  for (let i = 0; i < activeSegments.length; i++) {
    const width = visibleLen(activeSegments[i].text);
    const caption = activeSegments[i].caption || '';
    const capAlign = activeSegments[i].captionAlign || 'left';
    if (capAlign === 'right') line2 += caption.padStart(width).slice(-width);
    else if (capAlign === 'center') line2 += centerPad(caption, width);
    else line2 += caption.padEnd(width).slice(0, width);
    if (i < activeSegments.length - 1) {
      const literal = activeSegments[i + 1].sepBefore || separator;
      line2 += ' '.repeat(visibleLen(literal));
    }
  }
  line2 += '\x1b[0m';
  return line1 + '\n' + line2;
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function normalizeEnforcerLabel(value) {
  return String(value || '').trim();
}

function ensureChainedEnforcerSlot(snapshot, label) {
  if (!snapshot || !label || !Array.isArray(snapshot.enabled)) return snapshot;
  if (snapshot.enabled.includes('enforcer')) return snapshot;

  const enabled = snapshot.enabled.slice();
  const modelIndex = enabled.indexOf('model');
  if (modelIndex >= 0) enabled.splice(modelIndex + 1, 0, 'enforcer');
  else enabled.unshift('enforcer');

  return {
    ...snapshot,
    enabled,
    overrides: {
      ...(snapshot.overrides || {}),
      enforcer: {
        caption: 'enforcer',
        ...((snapshot.overrides && snapshot.overrides.enforcer) || {})
      }
    }
  };
}

function findGitRoot(startDir, homeResolved) {
  try {
    let current = path.resolve(startDir);
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(current, '.git'))) return current;
      if (current === homeResolved) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (error) {
    // Ignore.
  }
  return null;
}

function findEnforcerRoot(startDir, homeResolved) {
  try {
    let current = path.resolve(startDir);
    for (let i = 0; i < 12; i++) {
      if (current === homeResolved) break;
      if (fs.existsSync(path.join(current, '.plan-enforcer'))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (error) {
    // Ignore.
  }
  return null;
}

function stateMatchesSession(state, sessionId, transcriptPath) {
  const expectedSession = String(sessionId || '').trim();
  const stateSession = String(state?.sessionId || '').trim();
  if (expectedSession && stateSession && stateSession !== expectedSession) {
    return false;
  }

  const expectedTranscript = String(transcriptPath || '').trim();
  const stateTranscript = String(state?.transcriptPath || '').trim();
  if (expectedTranscript && stateTranscript && stateTranscript !== expectedTranscript) {
    return false;
  }

  return true;
}

function isProgressLabel(label) {
  return /^\d+\/\d+$/.test(String(label || '').trim());
}

function readLedgerProgress(ledgerPath) {
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const scoreboard = ledger.match(/(\d+)\s+total\s*\|\s*(\d+)\s+done\s*\|\s*(\d+)\s+verified(?:\s*\|\s*(\d+)\s+skipped)?/i);
  let done = 0;
  let total = 0;
  if (scoreboard) {
    total = parseInt(scoreboard[1], 10);
    done = parseInt(scoreboard[2], 10) + parseInt(scoreboard[3], 10) + (scoreboard[4] ? parseInt(scoreboard[4], 10) : 0);
  } else {
    const rows = ledger.split('\n').filter(line => /^\|\s*T\d+\s*\|/.test(line));
    total = rows.length;
    done = rows.filter(line => /\|\s*(done|verified|skipped)\s*\|/i.test(line)).length;
  }
  if (total > 0) {
    const progress = `${done}/${total}`;
    return { label: progress, progress };
  }
  return { label: '', progress: '' };
}

function readEnforcerState(enforcerRoot, homeDir, sessionId, transcriptPath) {
  if (!enforcerRoot) return { label: '', progress: '' };

  try {
    const enforcerDir = path.join(enforcerRoot, '.plan-enforcer');
    const statePath = path.join(enforcerDir, 'statusline-state.json');
    const ledgerPath = path.join(enforcerDir, 'ledger.md');

    if (fs.existsSync(statePath)) {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const label = String(parsed?.label || '').trim();
      if (label && stateMatchesSession(parsed, sessionId, transcriptPath)) {
        if ((parsed?.stage === 'tasks' || isProgressLabel(label)) && fs.existsSync(ledgerPath)) {
          const progressState = readLedgerProgress(ledgerPath);
          if (progressState.label) return progressState;
        }
        return {
          label,
          progress: isProgressLabel(label) ? label : ''
        };
      }
    }

    if (fs.existsSync(ledgerPath)) {
      return readLedgerProgress(ledgerPath);
    }
  } catch (error) {
    // Ignore.
  }

  try {
    const previewFlag = path.join(homeDir, '.claude', '.enforcer-preview');
    if (fs.existsSync(previewFlag)) {
      const raw = fs.readFileSync(previewFlag, 'utf8').trim();
      const label = raw || '3/7';
      return {
        label,
        progress: /^\d+\/\d+$/.test(label) ? label : ''
      };
    }
  } catch (error) {
    // Ignore.
  }

  return { label: '', progress: '' };
}

function readEnforcerBridge(sessionId, transcriptPath) {
  try {
    const bridgePath = path.join(os.tmpdir(), 'plan-enforcer-statusline-session.json');
    if (!fs.existsSync(bridgePath)) return null;
    const bridge = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    const expectedSession = String(sessionId || '').trim();
    const expectedTranscript = String(transcriptPath || '').trim();
    if (expectedSession && bridge.sessionId && String(bridge.sessionId).trim() !== expectedSession) return null;
    if (expectedTranscript && bridge.transcriptPath && String(bridge.transcriptPath).trim() !== expectedTranscript) return null;
    const bridgedRoot = String(bridge.projectRoot || '').trim();
    return bridgedRoot ? bridgedRoot : null;
  } catch (error) {
    return null;
  }
}

function findLedgerPath(startDir, homeResolved) {
  try {
    let current = path.resolve(startDir);
    for (let i = 0; i < 12; i++) {
      if (current === homeResolved) break;
      const candidate = path.join(current, '.plan-enforcer', 'ledger.md');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch (error) {
    // Ignore walk-up failures.
  }
  try {
    const entries = fs.readdirSync(startDir, { withFileTypes: true });
    let best = null;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = path.join(startDir, entry.name, '.plan-enforcer', 'ledger.md');
      try {
        const stat = fs.statSync(candidate);
        if (!best || stat.mtimeMs > best.mtime) best = { path: candidate, mtime: stat.mtimeMs };
      } catch (error) {
        // No ledger in this child.
      }
    }
    if (best) return best.path;
  } catch (error) {
    // Ignore readdir failures.
  }
  return null;
}

// Read JSON from stdin.
let input = '';
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

    const AUTO_COMPACT_BUFFER_PCT = 16.5;
    if (remaining != null) {
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
      const sessionSafe = session && !/[/\\]|\.\./.test(session);
      if (sessionSafe) {
        try {
          const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
          fs.writeFileSync(bridgePath, JSON.stringify({
            session_id: session,
            remaining_percentage: remaining,
            used_pct: used,
            timestamp: Math.floor(Date.now() / 1000),
          }));
        } catch (error) {
          // Best effort only.
        }
      }
    }

    const homeDir = os.homedir();
    const homeResolved = path.resolve(homeDir);
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
    const chainedEnforcer = process.env.PLAN_ENFORCER_STATUSLINE_CHAINED === '1';
    const chainedEnforcerLabel = normalizeEnforcerLabel(process.env.PLAN_ENFORCER_STATUSLINE_LABEL);
    const chainedEnforcerProgress = normalizeEnforcerLabel(process.env.PLAN_ENFORCER_STATUSLINE_PROGRESS);
    const snapshot = ensureChainedEnforcerSlot(
      loadPresetSnapshot(claudeDir),
      chainedEnforcerLabel
    );
    const requestedIds = new Set();
    if (snapshot?.enabled) {
      for (const id of snapshot.enabled) {
        requestedIds.add(id);
        if (presetCommon?.resolveSegmentId) requestedIds.add(presetCommon.resolveSegmentId(id));
      }
    }
    const needsFullRuntime = !snapshot;
    const wants = (...ids) => needsFullRuntime || ids.some(id => requestedIds.has(id));

    let task = '';
    let todosPending = 0;
    const todosDir = path.join(claudeDir, 'todos');
    if (wants('task', 'todos') && session && fs.existsSync(todosDir)) {
      try {
        const files = fs.readdirSync(todosDir)
          .filter(file => file.startsWith(session) && file.includes('-agent-') && file.endsWith('.json'))
          .map(file => ({ name: file, mtime: fs.statSync(path.join(todosDir, file)).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
          const inProgress = todos.find(entry => entry.status === 'in_progress');
          if (inProgress) task = inProgress.activeForm || '';
          todosPending = todos.filter(entry => entry.status === 'pending' || entry.status === 'in_progress').length;
        }
      } catch (error) {
        // Ignore malformed todo files.
      }
    }

    const cavemanActive = wants('caveman')
      ? fs.existsSync(path.join(homeDir, '.claude', '.caveman-active'))
      : false;

    let foundRoot = null;
    if (wants('enforcer', 'enforcerprog', 'repo', 'branch', 'commitage', 'aheadbehind', 'dirty', 'untracked', 'diffstat')) {
      foundRoot = findGitRoot(dir, homeResolved);
      if (foundRoot === homeResolved) foundRoot = null;
    }

    const enforcerRoot = wants('enforcer', 'enforcerprog')
      ? (findEnforcerRoot(dir, homeResolved) || foundRoot)
      : null;
    let enforcerLabel = '';
    let enforcerProgress = '';
    if (chainedEnforcer) {
      enforcerLabel = chainedEnforcerLabel;
      enforcerProgress = chainedEnforcerProgress;
    } else if (wants('enforcer', 'enforcerprog')) {
      let enforcerState = readEnforcerState(
        enforcerRoot,
        homeDir,
        session,
        data.transcript_path || ''
      );
      if (!enforcerState.label) {
        const bridgedRoot = readEnforcerBridge(session, data.transcript_path || '');
        if (bridgedRoot && path.resolve(bridgedRoot) !== path.resolve(enforcerRoot || '')) {
          enforcerState = readEnforcerState(
            bridgedRoot,
            homeDir,
            session,
            data.transcript_path || ''
          );
        }
      }
      enforcerLabel = enforcerState.label;
      enforcerProgress = enforcerState.progress;

      if (!enforcerLabel) {
        try {
          const ledgerPath = findLedgerPath(dir, homeResolved);
          if (ledgerPath) {
            const progressState = readLedgerProgress(ledgerPath);
            enforcerLabel = progressState.label;
            enforcerProgress = progressState.progress;
          }
        } catch (error) {
          // Ignore.
        }
      }
    }

    const gitCachePath = path.join(os.tmpdir(), 'claude-statusline-git-cache.json');
    let gitCache = null;

    function loadGitCache() {
      if (gitCache) return gitCache;
      try {
        const parsed = JSON.parse(fs.readFileSync(gitCachePath, 'utf8'));
        gitCache = parsed && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        gitCache = {};
      }
      return gitCache;
    }

    function writeGitCache(store) {
      try {
        fs.writeFileSync(gitCachePath, JSON.stringify(store));
      } catch (error) {
        // Ignore cache write errors.
      }
    }

    function gitCacheTtlMs(args) {
      if (args.includes('status --porcelain')) return 1500;
      if (args.includes('rev-list --left-right --count')) return 3000;
      return 5000;
    }

    function tryGit(args, cwd) {
      const key = `${cwd}::${args}`;
      const ttlMs = gitCacheTtlMs(args);
      const now = Date.now();
      const store = loadGitCache();
      const cached = store[key];
      if (cached && cached.fetchedAt && (now - cached.fetchedAt) < ttlMs) {
        return cached.value || '';
      }
      try {
        const { execSync } = require('child_process');
        const value = execSync('git ' + args, {
          cwd,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 400,
          windowsHide: true,
        }).toString().trim();
        store[key] = { fetchedAt: now, value };
        writeGitCache(store);
        return value;
      } catch (error) {
        store[key] = { fetchedAt: now, value: '' };
        writeGitCache(store);
        return '';
      }
    }

    function formatAge(unixSec) {
      const now = Math.floor(Date.now() / 1000);
      const delta = Math.max(0, now - unixSec);
      if (delta < 60) return `${delta}s ago`;
      if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
      if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
      return `${Math.floor(delta / 86400)}d ago`;
    }

    let branch = '';
    let commitAge = '';
    if (foundRoot && wants('branch', 'commitage')) {
      branch = tryGit('rev-parse --abbrev-ref HEAD', foundRoot);
      if (branch === 'HEAD') branch = tryGit('rev-parse --short HEAD', foundRoot);
      const commitTs = tryGit('log -1 --format=%ct', foundRoot);
      if (commitTs) commitAge = formatAge(parseInt(commitTs, 10));
    }

    const PRICES = {
      opus: { in: 15.0, out: 75.0 },
      sonnet: { in: 3.0, out: 15.0 },
      haiku: { in: 0.8, out: 4.0 },
    };

    function priceFor(modelStr) {
      const lower = String(modelStr || '').toLowerCase();
      if (lower.includes('opus')) return PRICES.opus;
      if (lower.includes('haiku')) return PRICES.haiku;
      return PRICES.sonnet;
    }

    function costOfUsage(usage, modelStr) {
      if (!usage) return 0;
      const price = priceFor(modelStr);
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const cache5m = usage.cache_creation?.ephemeral_5m_input_tokens || 0;
      const cache1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
      return (
        input * price.in +
        output * price.out +
        cacheRead * price.in * 0.1 +
        cache5m * price.in * 1.25 +
        cache1h * price.in * 2.0
      ) / 1e6;
    }

    function sanitizeCwd(currentDir) {
      return String(currentDir).replace(/[:\\/]/g, '-').replace(/\s/g, '-');
    }

    function readJsonlStats(filePath, cutoffMs) {
      const stats = {
        tokens: 0,
        cost: 0,
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        msgCount: 0,
        firstTs: 0,
        lastTs: 0,
      };
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        for (const line of raw.split('\n')) {
          if (!line) continue;
          let entry;
          try { entry = JSON.parse(line); } catch (error) { continue; }
          const ts = entry.timestamp ? Date.parse(entry.timestamp) : 0;
          if (cutoffMs && ts && ts < cutoffMs) continue;
          if (entry.type !== 'assistant') continue;
          const message = entry.message || {};
          const usage = message.usage;
          if (!usage) continue;
          stats.input += usage.input_tokens || 0;
          stats.output += usage.output_tokens || 0;
          stats.cacheRead += usage.cache_read_input_tokens || 0;
          stats.cacheWrite += (usage.cache_creation?.ephemeral_5m_input_tokens || 0) +
                              (usage.cache_creation?.ephemeral_1h_input_tokens || 0);
          stats.tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0) +
                          (usage.cache_read_input_tokens || 0) +
                          (usage.cache_creation_input_tokens || 0);
          stats.cost += costOfUsage(usage, message.model);
          stats.msgCount += 1;
          if (ts && (!stats.firstTs || ts < stats.firstTs)) stats.firstTs = ts;
          if (ts > stats.lastTs) stats.lastTs = ts;
        }
      } catch (error) {
        // Ignore missing or malformed logs.
      }
      return stats;
    }

    function formatTokens(value) {
      if (value < 1000) return String(value);
      if (value < 1e6) return (value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
      return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    }

    function formatCost(value) {
      if (value < 0.01) return '$0.00';
      if (value < 100) return '$' + value.toFixed(2);
      return '$' + value.toFixed(0);
    }

    function formatResetCountdown(unixSec) {
      if (!Number.isFinite(unixSec)) return '';
      const totalMinutes = Math.max(0, Math.ceil((unixSec * 1000 - Date.now()) / 60000));
      if (totalMinutes < 1) return 'reset soon';
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const mins = totalMinutes % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    }

    function formatRateLimit(limit, symbol) {
      if (!limit || !Number.isFinite(limit.used_percentage)) return null;
      const pct = Math.max(0, Math.min(100, Math.round(limit.used_percentage)));
      const reset = formatResetCountdown(limit.resets_at);
      const text = `${symbol} ${pct}%${reset ? ` (${reset})` : ''}`;
      let colorCode = '96';
      if (pct >= 80) colorCode = '1;31';
      else if (pct >= 50) colorCode = '38;5;208';
      return { text, colorCode };
    }

    function formatRateLimitBar(limit) {
      if (!limit || !Number.isFinite(limit.used_percentage)) return null;
      const pct = Math.max(0, Math.min(100, Math.round(limit.used_percentage)));
      const filled = Math.floor(pct / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      const reset = formatResetCountdown(limit.resets_at);
      const text = `${bar} ${pct}%${reset ? ` (${reset})` : ''}`;
      let colorCode = '32';
      if (pct >= 80) colorCode = '5;31';
      else if (pct >= 65) colorCode = '38;5;208';
      else if (pct >= 50) colorCode = '33';
      return { text, colorCode };
    }

    let sessionStats = null;
    if (wants('cost', 'tokens', 'sessTokens', 'sessCost', 'cacheHit', 'session') && session) {
      const projectDir = path.join(claudeDir, 'projects', sanitizeCwd(dir));
      const sessionFile = path.join(projectDir, session + '.jsonl');
      if (fs.existsSync(sessionFile)) sessionStats = readJsonlStats(sessionFile, 0);
    }

    let aggStats = { todayCost: 0, msgs5h: 0 };
    if (wants('todayCost', 'msgs5h')) try {
      const cachePath = path.join(os.tmpdir(), 'claude-statusline-agg.json');
      const now = Date.now();
      let cached = null;
      if (fs.existsSync(cachePath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          if (parsed && parsed.fetchedAt && now - parsed.fetchedAt < 60_000) cached = parsed;
        } catch (error) {
          // Ignore stale cache.
        }
      }
      if (cached) {
        aggStats = { todayCost: cached.todayCost || 0, msgs5h: cached.msgs5h || 0 };
      } else {
        const projectsDir = path.join(claudeDir, 'projects');
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
        let todayCost = 0;
        let msgs5h = 0;
        try {
          for (const project of fs.readdirSync(projectsDir)) {
            const projectDir = path.join(projectsDir, project);
            let entries = [];
            try { entries = fs.readdirSync(projectDir); } catch (error) { continue; }
            for (const file of entries) {
              if (!file.endsWith('.jsonl')) continue;
              const filePath = path.join(projectDir, file);
              let stat;
              try { stat = fs.statSync(filePath); } catch (error) { continue; }
              if (stat.mtimeMs < todayMs && stat.mtimeMs < fiveHoursAgo) continue;
              const today = readJsonlStats(filePath, todayMs);
              const recent = readJsonlStats(filePath, fiveHoursAgo);
              todayCost += today.cost;
              msgs5h += recent.msgCount;
            }
          }
        } catch (error) {
          // Ignore project scan failures.
        }
        aggStats = { todayCost, msgs5h };
        try {
          fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: now, ...aggStats }));
        } catch (error) {
          // Ignore cache write errors.
        }
      }
    } catch (error) {
      // Ignore aggregate failures.
    }

    let ctxText = '';
    let ctxColorCode = '';
    if (remaining != null) {
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));
      const filled = Math.floor(used / 10);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
      ctxText = `${bar} ${used}%`;
      if (used < 50) ctxColorCode = '32';
      else if (used < 65) ctxColorCode = '33';
      else if (used < 80) ctxColorCode = '38;5;208';
      else ctxColorCode = '5;31';
    }

    const blockLimit = formatRateLimit(data.rate_limits?.five_hour, '\u25D4');
    const weeklyLimit = formatRateLimit(data.rate_limits?.seven_day, '\u25D1');
    const blockLimitBar = formatRateLimitBar(data.rate_limits?.five_hour);
    const weeklyLimitBar = formatRateLimitBar(data.rate_limits?.seven_day);

    let aheadBehind = '';
    let dirty = '';
    let untracked = '';
    let diffstat = '';
    if (foundRoot) {
      if (wants('aheadbehind')) {
        const counts = tryGit('rev-list --left-right --count HEAD...@{upstream}', foundRoot);
        if (counts) {
          const parts = counts.split(/\s+/).map(part => parseInt(part, 10)).filter(Number.isFinite);
          if (parts.length >= 2) {
            const pieces = [];
            if (parts[0] > 0) pieces.push(`\u2191${parts[0]}`);
            if (parts[1] > 0) pieces.push(`\u2193${parts[1]}`);
            aheadBehind = pieces.join(' ');
          }
        }
      }
      if (wants('dirty')) {
        const dirtyOut = tryGit('status --porcelain --untracked-files=no', foundRoot);
        if (dirtyOut) dirty = '\u25cf';
      }
      if (wants('untracked')) {
        const untrackedLines = tryGit('status --porcelain --untracked-files=all', foundRoot)
          .split('\n')
          .filter(line => line.startsWith('??'));
        if (untrackedLines.length) untracked = `?${untrackedLines.length}`;
      }
      if (wants('diffstat')) {
        const porcelain = tryGit('status --porcelain --untracked-files=all', foundRoot);
        if (porcelain) {
          let added = 0, modified = 0, deleted = 0;
          for (const line of porcelain.split('\n')) {
            if (!line) continue;
            const xy = line.slice(0, 2);
            if (xy === '??') { added++; continue; }
            const x = xy[0];
            const y = xy[1];
            if (x === 'A' || y === 'A' || x === 'C') added++;
            else if (x === 'D' || y === 'D') deleted++;
            else if (x === 'M' || y === 'M' || x === 'R' || x === 'U' || y === 'U') modified++;
          }
          const parts = [];
          if (added) parts.push(`+${added}`);
          if (modified) parts.push(`~${modified}`);
          if (deleted) parts.push(`-${deleted}`);
          if (parts.length) diffstat = parts.join(' ');
        }
      }
    }

    const cacheInputTotal = sessionStats ? sessionStats.cacheRead + sessionStats.input + sessionStats.cacheWrite : 0;
    const cacheHitText = cacheInputTotal > 0
      ? `${Math.round((sessionStats.cacheRead / cacheInputTotal) * 100)}% cached`
      : '';

    const clockText = wants('clock')
      ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    const dateText = wants('date')
      ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())
      : '';
    const sessionDurationText = sessionStats?.firstTs
      ? formatDuration(Date.now() - sessionStats.firstTs)
      : '';
    const nodeText = wants('node')
      ? `node ${process.versions.node.split('.').slice(0, 2).join('.')}`
      : '';

    const runtimeMap = {
      caveman: { show: cavemanActive, text: '[CAVEMAN]' },
      enforcer: { show: !!enforcerLabel, text: `[ENFORCER: ${String(enforcerLabel).toUpperCase()}]` },
      branch: { show: !!branch, text: branch },
      aheadbehind: { show: !!aheadBehind, text: aheadBehind, align: 'left' },
      dirty: { show: !!dirty, text: dirty },
      untracked: { show: !!untracked, text: untracked, align: 'left' },
      diffstat: { show: !!diffstat, text: diffstat, align: 'left' },
      commitage: { show: !!commitAge, text: commitAge, align: 'left' },
      repo: { show: !!foundRoot, text: path.basename(foundRoot || '') },
      model: { show: true, text: model },
      task: { show: !!task, text: task },
      dir: { show: true, text: path.basename(dir) },
      clock: { show: true, text: clockText, align: 'left' },
      date: { show: true, text: dateText, align: 'left' },
      session: { show: !!sessionDurationText, text: sessionDurationText, align: 'left' },
      node: { show: true, text: nodeText, align: 'left' },
      todos: { show: todosPending > 0, text: `${todosPending} todo`, align: 'left' },
      enforcerprog: { show: !!enforcerProgress, text: enforcerProgress, align: 'left' },
      cost: { show: !!(sessionStats && sessionStats.cost > 0), text: formatCost(sessionStats?.cost || 0), align: 'left' },
      context: { show: !!ctxText, text: ctxText, colorCode: ctxColorCode, align: 'left' },
      tokens: { show: !!(sessionStats && sessionStats.tokens > 0), text: formatTokens(sessionStats?.tokens || 0), align: 'left' },
      block: { show: !!blockLimit, text: blockLimit?.text || '', colorCode: blockLimit?.colorCode || '', align: 'left' },
      blockBar: { show: !!blockLimitBar, text: blockLimitBar?.text || '', colorCode: blockLimitBar?.colorCode || '', align: 'left' },
      weekly: { show: !!weeklyLimit, text: weeklyLimit?.text || '', colorCode: weeklyLimit?.colorCode || '', align: 'left' },
      weeklyBar: { show: !!weeklyLimitBar, text: weeklyLimitBar?.text || '', colorCode: weeklyLimitBar?.colorCode || '', align: 'left' },
      sessTokens: { show: !!(sessionStats && sessionStats.tokens > 0), text: formatTokens(sessionStats?.tokens || 0), align: 'left' },
      sessCost: { show: !!(sessionStats && sessionStats.cost > 0), text: formatCost(sessionStats?.cost || 0), align: 'left' },
      cacheHit: { show: !!cacheHitText, text: cacheHitText, align: 'left' },
      todayCost: { show: aggStats.todayCost > 0, text: `${formatCost(aggStats.todayCost)} today`, align: 'left' },
      msgs5h: { show: aggStats.msgs5h > 0, text: `${aggStats.msgs5h} msgs/5h`, align: 'left' },
    };

    const configuredOutput = renderConfiguredStatusline(snapshot, runtimeMap);
    if (configuredOutput) {
      process.stdout.write(configuredOutput);
      return;
    }

    // Fallback: old hardcoded layout if the shared preset helper is missing.
    const legacySegments = [];
    legacySegments.push({ text: `[${String(model).toUpperCase()}]`, codes: '2;38;5;208', caption: 'model', sepBefore: null });
    if (enforcerLabel) legacySegments.push({ text: `[ENFORCER: ${String(enforcerLabel).toUpperCase()}]`, codes: '1;94', caption: 'enforcer', sepBefore: null });
    if (cavemanActive) legacySegments.push({ text: '[CAVEMAN]', codes: '1;93', caption: 'caveman', sepBefore: null });
    legacySegments.push({ text: '\ud83d\udcc2 ' + path.basename(dir), codes: '2;97', caption: 'dir', sepBefore: null });
    if (foundRoot) legacySegments.push({ text: '\ud83d\udcdf ' + path.basename(foundRoot), codes: '31', caption: 'repo', sepBefore: ' \u2502 ' });
    if (branch) legacySegments.push({ text: '\ud83c\udf3f ' + branch, codes: '31', caption: 'branch', sepBefore: ' \u2192 ' });
    if (commitAge) legacySegments.push({ text: '\u2713 ' + commitAge, codes: '3;31', caption: 'commit', sepBefore: ' \u2192 ' });
    if (todosPending > 0) legacySegments.push({ text: `[${todosPending} TODO]`, codes: '95', caption: 'todos', sepBefore: null });
    if (task) legacySegments.push({ text: task, codes: '1;95', caption: 'task', sepBefore: ' \u2192 ' });
    if (ctxText) legacySegments.push({ text: ctxText, codes: ctxColorCode, caption: 'ctx', sepBefore: null, align: 'left' });
    if (blockLimit) legacySegments.push({ text: blockLimit.text, codes: blockLimit.colorCode, caption: '5h', sepBefore: null, align: 'left' });
    if (weeklyLimit) legacySegments.push({ text: weeklyLimit.text, codes: weeklyLimit.colorCode, caption: 'week', sepBefore: null, align: 'left' });
    if (sessionStats && sessionStats.tokens > 0) {
      legacySegments.push({ text: formatTokens(sessionStats.tokens), codes: '96', caption: 'tok', sepBefore: null, align: 'left' });
    }

    const fallbackSeparator = ' | ';
    const wrapSep = literal => `\x1b[38;5;208m${literal}\x1b[0m`;
    let line1 = '';
    for (let i = 0; i < legacySegments.length; i++) {
      if (i > 0) line1 += wrapSep(legacySegments[i].sepBefore || fallbackSeparator);
      line1 += `\x1b[${legacySegments[i].codes}m${legacySegments[i].text}\x1b[0m`;
    }

    let line2 = '\x1b[2;90m';
    for (let i = 0; i < legacySegments.length; i++) {
      const width = visibleLen(legacySegments[i].text);
      const caption = legacySegments[i].caption || '';
      if (legacySegments[i].align === 'left') line2 += caption.padEnd(width).slice(0, width);
      else if (legacySegments[i].align === 'right') line2 += caption.padStart(width).slice(-width);
      else line2 += centerPad(caption, width);
      if (i < legacySegments.length - 1) {
        const literal = legacySegments[i + 1].sepBefore || fallbackSeparator;
        line2 += ' '.repeat(visibleLen(literal));
      }
    }
    line2 += '\x1b[0m';

    process.stdout.write(line1 + '\n' + line2);
  } catch (error) {
    // Silent fail - never break Claude's UI.
  }
});
