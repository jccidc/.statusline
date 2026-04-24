'use strict';

const ANSI_COLORS = {
  black:         { code: 30, bg: 40, hex: '#000000', label: 'black' },
  red:           { code: 31, bg: 41, hex: '#cd3131', label: 'red' },
  green:         { code: 32, bg: 42, hex: '#0dbc79', label: 'green' },
  yellow:        { code: 33, bg: 43, hex: '#e5e510', label: 'yellow' },
  blue:          { code: 34, bg: 44, hex: '#2472c8', label: 'blue' },
  magenta:       { code: 35, bg: 45, hex: '#bc3fbc', label: 'magenta' },
  cyan:          { code: 36, bg: 46, hex: '#11a8cd', label: 'cyan' },
  white:         { code: 37, bg: 47, hex: '#e5e5e5', label: 'white' },
  gray:          { code: 90, bg: 100, hex: '#8b949e', label: 'gray' },
  brightRed:     { code: 91, bg: 101, hex: '#f14c4c', label: 'bright red' },
  brightGreen:   { code: 92, bg: 102, hex: '#23d18b', label: 'bright green' },
  brightYellow:  { code: 93, bg: 103, hex: '#f5f543', label: 'bright yellow' },
  brightBlue:    { code: 94, bg: 104, hex: '#3b8eea', label: 'bright blue' },
  brightMagenta: { code: 95, bg: 105, hex: '#d670d6', label: 'bright magenta' },
  brightCyan:    { code: 96, bg: 106, hex: '#29b8db', label: 'bright cyan' },
  brightWhite:   { code: 97, bg: 107, hex: '#ffffff', label: 'bright white' },
  orange:        { code: '38;5;208', bg: '48;5;208', hex: '#e67e22', label: 'orange (256)' },
  pink:          { code: '38;5;205', bg: '48;5;205', hex: '#ff69b4', label: 'pink (256)' },
  inherit:       { code: null, bg: null, hex: 'transparent', label: '(default)' },
};

const BRACKETS = {
  none:       { open: '', close: '' },
  square:     { open: '[', close: ']' },
  angle:      { open: '<', close: '>' },
  round:      { open: '(', close: ')' },
  curly:      { open: '{', close: '}' },
  guillemets: { open: '\u00ab', close: '\u00bb' },
  pipes:      { open: '|', close: '|' },
  ticks:      { open: '`', close: '`' },
};

const DEFAULT_SEPARATOR = ' | ';
const DEFAULT_ACTIVE_PRESET = 'my-defaults';

const ALL_SEGMENTS = [
  { id: 'caveman',      label: 'Caveman badge',         text: '[CAVEMAN]',             color: 'brightYellow', bold: true },
  { id: 'enforcer',     label: 'Enforcer badge',        text: '[ENFORCER: 1-DISCUSS]', color: 'brightBlue', bold: true },
  { id: 'gsdupdate',    label: 'GSD update',            text: '\u2b06 /gsd-update',    color: 'yellow' },
  { id: 'gsdphase',     label: 'GSD phase',             text: 'phase 72.1',            color: 'brightCyan' },
  { id: 'branch',       label: 'Git branch',            text: 'main',                  color: 'magenta', icon: '\ud83c\udf3f' },
  { id: 'aheadbehind',  label: 'Ahead / behind',        text: '\u21912 \u21931',       color: 'cyan' },
  { id: 'dirty',        label: 'Dirty indicator',       text: '\u25cf',                color: 'red', bold: true },
  { id: 'untracked',    label: 'Untracked count',       text: '?3',                    color: 'yellow' },
  { id: 'diffstat',     label: 'Diffstat (A/M/D)',      text: '+2 ~1 -1',              color: 'yellow' },
  { id: 'prs',          label: 'Open PRs',              text: 'PR:2',                  color: 'green' },
  { id: 'commitage',    label: 'Last commit age',       text: '2m ago',                color: 'gray', italic: true },
  { id: 'repo',         label: 'Repo name',             text: 'caveman-harness',       color: 'white' },
  { id: 'exitstatus',   label: 'Exit status',           text: '\u2713',                color: 'green', bold: true },
  { id: 'model',        label: 'Model',                 text: 'Opus 4.7',              color: 'white', dim: true },
  { id: 'task',         label: 'Current task',          text: 'Editing statusline',    color: 'white', bold: true },
  { id: 'dir',          label: 'Directory',             text: 'caveman-harness',       color: 'white', dim: true },
  { id: 'clock',        label: 'Time',                  text: '14:32',                 color: 'gray' },
  { id: 'date',         label: 'Date',                  text: 'Fri Apr 17',            color: 'gray' },
  { id: 'session',      label: 'Session duration',      text: '1h 23m',                color: 'gray' },
  { id: 'pomodoro',     label: 'Pomodoro',              text: '25:00',                 color: 'brightRed', icon: '\u23f1' },
  { id: 'node',         label: 'Node version',          text: 'node 20.11',            color: 'green', dim: true },
  { id: 'python',       label: 'Python version',        text: 'py 3.12',               color: 'brightBlue', dim: true },
  { id: 'battery',      label: 'Battery',               text: '82%',                   color: 'brightGreen', icon: '\ud83d\udd0b' },
  { id: 'todos',        label: 'TODO count',            text: '3 todo',                color: 'yellow' },
  { id: 'enforcerprog', label: 'Enforcer progress',     text: '0/7',                   color: 'brightBlue' },
  { id: 'cost',         label: 'Cost estimate',         text: '$0.42',                 color: 'brightGreen' },
  { id: 'aws',          label: 'AWS profile',           text: 'aws:prod',              color: 'orange' },
  { id: 'kubectl',      label: 'kubectl context',       text: 'k8s:staging',           color: 'brightMagenta' },
  { id: 'gcloud',       label: 'gcloud account',        text: 'gcp:main',              color: 'brightBlue' },
  { id: 'context',      label: 'Context bar',           text: '\u2588\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 12%', color: 'green' },
  { id: 'tokens',       label: 'Tokens saved',          text: '~45k saved',            color: 'brightCyan' },
  { id: 'block',        label: '5h quota',              text: '\u25d4 23% (4h 12m)',   color: 'brightCyan' },
  { id: 'weekly',       label: 'Weekly quota',          text: '\u25d1 41% (3d 5h)',    color: 'brightBlue' },
  { id: 'sessTokens',   label: 'Session tokens',        text: '45.3k',                 color: 'brightCyan' },
  { id: 'sessCost',     label: 'Session cost',          text: '$2.14',                 color: 'brightGreen' },
  { id: 'cacheHit',     label: 'Cache hit %',           text: '78% cached',            color: 'orange' },
  { id: 'todayCost',    label: "Today's cost",          text: '$14.82 today',          color: 'brightGreen' },
  { id: 'msgs5h',       label: 'Messages / 5h (local)', text: '23 msgs/5h',            color: 'brightYellow' },
];

function hydrateSegment(segment) {
  return Object.assign({
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    bgColor: 'inherit',
    useHex: false,
    hex: '#e5e5e5',
    useHexBg: false,
    hexBg: '#000000',
    icon: '',
    bracket: 'none',
    maxWidth: 0,
    caseTransform: 'none',
    sepBefore: '',
    caption: '',
    captionAlign: 'left',
  }, segment);
}

const BASE_SEGMENTS = ALL_SEGMENTS.map(hydrateSegment);

const BUILTIN_PRESETS = {
  'my-defaults': {
    label: 'My defaults \u2605',
    enabled: ['model', 'enforcer', 'caveman', 'dir', 'repo', 'branch', 'commitage', 'todos', 'task', 'context'],
    separator: DEFAULT_SEPARATOR,
    overrides: {
      model: { color: 'orange', dim: true, bracket: 'square', caseTransform: 'upper', caption: 'model' },
      enforcer: { caption: 'enforcer' },
      caveman: { caption: 'caveman' },
      dir: { color: 'brightWhite', dim: true, icon: '\ud83d\udcc2', caption: 'dir' },
      repo: { color: 'red', icon: '\ud83d\udcdf', sepBefore: ' \u2502 ', caption: 'repo' },
      branch: { color: 'red', icon: '\ud83c\udf3f', sepBefore: ' \u2192 ', caption: 'branch' },
      commitage: { color: 'red', italic: true, icon: '\u2713', sepBefore: ' \u2192 ', caption: 'commit' },
      todos: { color: 'brightMagenta', bracket: 'square', caseTransform: 'upper', caption: 'todos' },
      task: { color: 'brightMagenta', sepBefore: ' \u2192 ', caption: 'task' },
      context: { caption: 'ctx' },
    },
  },
  original: {
    label: 'Original',
    enabled: ['caveman', 'enforcer', 'gsdupdate', 'model', 'task', 'dir', 'context'],
    separator: ' \u2502 ',
    overrides: {},
  },
  minimal: {
    label: 'Minimal',
    enabled: ['model', 'dir', 'context'],
    separator: '  ',
    overrides: { model: { dim: true }, dir: { dim: true } },
  },
  developer: {
    label: 'Developer',
    enabled: ['caveman', 'enforcer', 'branch', 'aheadbehind', 'dirty', 'model', 'dir', 'context'],
    separator: ' \u00b7 ',
    overrides: { branch: { icon: '\ud83c\udf3f' } },
  },
  'kitchen-sink': {
    label: 'Kitchen sink',
    enabled: ['caveman', 'enforcer', 'branch', 'aheadbehind', 'dirty', 'untracked', 'prs', 'todos', 'enforcerprog', 'clock', 'session', 'model', 'task', 'dir', 'node', 'battery', 'context', 'block', 'weekly', 'tokens', 'cost'],
    separator: ' \u00b7 ',
    overrides: {},
  },
  'clock-first': {
    label: 'Clock-first',
    enabled: ['clock', 'caveman', 'model', 'task', 'dir', 'context'],
    separator: ' \u2502 ',
    overrides: { clock: { color: 'brightCyan', bold: true } },
  },
  monochrome: {
    label: 'Monochrome',
    enabled: ['caveman', 'enforcer', 'model', 'task', 'dir', 'context'],
    separator: ' \u2502 ',
    overrides: {
      caveman: { color: 'white', bold: true },
      enforcer: { color: 'white', bold: true, italic: true },
      model: { color: 'white', dim: true },
      task: { color: 'white', bold: true },
      dir: { color: 'white', dim: true, italic: true },
      context: { color: 'white', dim: false },
    },
  },
  cyberpunk: {
    label: 'Cyberpunk',
    enabled: ['caveman', 'branch', 'dirty', 'model', 'task', 'dir', 'context'],
    separator: ' \u2726 ',
    overrides: {
      caveman: { color: 'pink', bold: true, bracket: 'guillemets' },
      branch: { color: 'brightMagenta', icon: '\ud83c\udf3f' },
      dirty: { color: 'pink', bold: true },
      model: { color: 'brightMagenta', italic: true },
      task: { color: 'brightCyan', bold: true },
      dir: { color: 'brightBlue', dim: true },
      context: { color: 'brightMagenta' },
    },
  },
  'brand-jccidc': {
    label: 'JCCIDC brand',
    enabled: ['caveman', 'enforcer', 'model', 'task', 'dir', 'context'],
    separator: ' \u2500 ',
    overrides: {
      caveman: { useHex: true, hex: '#58a6ff', bold: true },
      enforcer: { useHex: true, hex: '#1f6feb', bold: true },
      model: { useHex: true, hex: '#d4e2f7', dim: true },
      task: { useHex: true, hex: '#58a6ff', bold: true },
      dir: { useHex: true, hex: '#4f6a8f', italic: true },
      context: { useHex: true, hex: '#58a6ff' },
    },
  },
  dashboard: {
    label: 'Dashboard',
    enabled: ['caveman', 'enforcer', 'branch', 'aheadbehind', 'dirty', 'commitage', 'model', 'task', 'clock', 'session', 'context', 'block', 'weekly', 'tokens'],
    separator: ' \u2502 ',
    overrides: {
      branch: { icon: '\ud83c\udf3f', bracket: 'square' },
      commitage: { italic: true, color: 'gray' },
      clock: { icon: '\u23f1' },
    },
  },
};

const SEGMENT_ALIASES = {
  tokens: 'tokens',
  sessTokens: 'sessTokens',
  cost: 'cost',
  sessCost: 'sessCost',
};

const SUPPORTED_SEGMENT_IDS = new Set([
  'caveman',
  'enforcer',
  'branch',
  'aheadbehind',
  'dirty',
  'untracked',
  'diffstat',
  'commitage',
  'repo',
  'model',
  'task',
  'dir',
  'clock',
  'date',
  'session',
  'node',
  'todos',
  'enforcerprog',
  'cost',
  'context',
  'tokens',
  'block',
  'weekly',
  'sessTokens',
  'sessCost',
  'cacheHit',
  'todayCost',
  'msgs5h',
]);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBaseSegment(id) {
  return BASE_SEGMENTS.find(segment => segment.id === id) || null;
}

function buildPresetSnapshot(name) {
  const preset = BUILTIN_PRESETS[name];
  if (!preset) return null;
  return {
    label: preset.label,
    enabled: preset.enabled.slice(),
    separator: preset.separator,
    sepColor: 'gray',
    sepBold: false,
    sepDim: false,
    showCaptions: true,
    overrides: deepClone(preset.overrides || {}),
  };
}

function listBuiltInPresetRecords() {
  return Object.entries(BUILTIN_PRESETS).map(([key, preset]) => ({
    key,
    label: preset.label,
    source: 'built-in',
    snapshot: buildPresetSnapshot(key),
  }));
}

function mergeSnapshotIntoSegments(snapshot) {
  const segments = BASE_SEGMENTS.map(segment => deepClone(segment));
  for (const [id, override] of Object.entries(snapshot?.overrides || {})) {
    const target = segments.find(segment => segment.id === id);
    if (!target) continue;
    Object.assign(target, deepClone(override));
  }
  return segments;
}

function slugifyPresetName(label) {
  return 'saved:' + String(label || 'preset')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function effectiveSeparator(snapshot) {
  return snapshot?.separator || DEFAULT_SEPARATOR;
}

function resolveSegmentId(id) {
  return SEGMENT_ALIASES[id] || id;
}

function listUnsupportedSegmentIds(snapshot) {
  const seen = new Set();
  const unsupported = [];
  for (const id of snapshot?.enabled || []) {
    const resolved = resolveSegmentId(id);
    if (SUPPORTED_SEGMENT_IDS.has(resolved) || seen.has(id)) continue;
    seen.add(id);
    unsupported.push(id);
  }
  return unsupported;
}

module.exports = {
  ANSI_COLORS,
  BRACKETS,
  BASE_SEGMENTS,
  BUILTIN_PRESETS,
  DEFAULT_ACTIVE_PRESET,
  DEFAULT_SEPARATOR,
  SUPPORTED_SEGMENT_IDS,
  buildPresetSnapshot,
  deepClone,
  effectiveSeparator,
  getBaseSegment,
  listBuiltInPresetRecords,
  listUnsupportedSegmentIds,
  mergeSnapshotIntoSegments,
  resolveSegmentId,
  slugifyPresetName,
};
