#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function loadCommon() {
  const candidates = [
    path.join(__dirname, '..', 'shared', 'statusline-preset-common.js'),
    path.join(__dirname, 'statusline-preset-common.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return require(candidate);
    } catch (error) {
      // Keep trying other locations.
    }
  }
  throw new Error('statusline-preset-common.js not found');
}

const common = loadCommon();
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const presetsPath = path.join(claudeDir, 'statusline-presets.json');
const activePresetPath = path.join(claudeDir, '.statusline-active-preset');

function ensureClaudeDir() {
  fs.mkdirSync(claudeDir, { recursive: true });
}

function readActivePresetName() {
  try {
    return fs.readFileSync(activePresetPath, 'utf8').trim();
  } catch (error) {
    return '';
  }
}

function writeActivePresetName(name) {
  ensureClaudeDir();
  fs.writeFileSync(activePresetPath, String(name).trim() + '\n', 'utf8');
}

function loadCustomPresetStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.presets && typeof parsed.presets === 'object') {
      return parsed.presets;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    // Fall through.
  }
  return {};
}

function saveCustomPresetStore(store) {
  ensureClaudeDir();
  fs.writeFileSync(
    presetsPath,
    JSON.stringify({ version: 1, presets: store }, null, 2) + '\n',
    'utf8'
  );
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    label: snapshot.label || '',
    enabled: Array.isArray(snapshot.enabled) ? snapshot.enabled.slice() : [],
    separator: snapshot.separator || common.DEFAULT_SEPARATOR,
    sepColor: snapshot.sepColor || 'gray',
    sepBold: !!snapshot.sepBold,
    sepDim: !!snapshot.sepDim,
    showCaptions: snapshot.showCaptions !== false,
    overrides: snapshot.overrides && typeof snapshot.overrides === 'object'
      ? common.deepClone(snapshot.overrides)
      : {},
  };
}

function listAllPresetRecords() {
  const builtIn = common.listBuiltInPresetRecords();
  const custom = Object.entries(loadCustomPresetStore()).map(([key, record]) => ({
    key,
    label: record.label || key,
    source: 'imported',
    snapshot: normalizeSnapshot(record.snapshot || record),
  }));
  return builtIn.concat(custom).sort((a, b) => a.label.localeCompare(b.label));
}

function findPresetRecord(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return null;
  for (const record of listAllPresetRecords()) {
    if (record.key.toLowerCase() === needle) return record;
  }
  for (const record of listAllPresetRecords()) {
    if (record.label.toLowerCase() === needle) return record;
  }
  return null;
}

function closestPresetNames(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return [];
  return listAllPresetRecords()
    .filter(record =>
      record.key.toLowerCase().includes(needle) ||
      record.label.toLowerCase().includes(needle)
    )
    .slice(0, 6)
    .map(record => record.key);
}

function formatRecordLine(record, activeName) {
  const marker = record.key === activeName ? '* ' : '  ';
  const unsupported = common.listUnsupportedSegmentIds(record.snapshot);
  const suffix = unsupported.length ? ` (skips: ${unsupported.join(', ')})` : '';
  return `${marker}${record.key} - ${record.label}${suffix}`;
}

function renderList() {
  const activeName = readActivePresetName() || common.DEFAULT_ACTIVE_PRESET;
  const records = listAllPresetRecords();
  const builtIn = records.filter(record => record.source === 'built-in');
  const imported = records.filter(record => record.source === 'imported');
  const lines = [];

  lines.push(`Active preset: ${activeName}`);
  lines.push('');
  lines.push('Built-in presets:');
  for (const record of builtIn) lines.push(formatRecordLine(record, activeName));

  lines.push('');
  lines.push('Imported presets:');
  if (imported.length) {
    for (const record of imported) lines.push(formatRecordLine(record, activeName));
  } else {
    lines.push('  (none)');
  }

  lines.push('');
  lines.push('Use:');
  lines.push('/statusline-preset <name>');
  lines.push('/statusline-preset import <payload>');
  lines.push('');
  lines.push('* active preset');

  return lines.join('\n');
}

function applyPreset(name) {
  const record = findPresetRecord(name);
  if (!record) {
    const suggestions = closestPresetNames(name);
    const lines = [`Preset not found: ${name}`];
    if (suggestions.length) lines.push(`Try: ${suggestions.join(', ')}`);
    return { ok: false, text: lines.join('\n') };
  }

  writeActivePresetName(record.key);

  const unsupported = common.listUnsupportedSegmentIds(record.snapshot);
  const lines = [
    `Applied preset: ${record.key}`,
    `Label: ${record.label}`,
  ];
  if (unsupported.length) lines.push(`Skipped by hook: ${unsupported.join(', ')}`);
  lines.push('Next Claude statusline refresh will use it.');
  return { ok: true, text: lines.join('\n') };
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function importPreset(payload) {
  if (!payload) {
    return { ok: false, text: 'Import payload missing.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(decodeBase64Url(payload));
  } catch (error) {
    return { ok: false, text: 'Import payload is invalid.' };
  }

  const label = String(parsed.label || '').trim();
  const snapshot = normalizeSnapshot(parsed.snapshot);
  if (!label || !snapshot || !snapshot.enabled.length) {
    return { ok: false, text: 'Import payload is missing label or enabled segments.' };
  }

  const key = String(parsed.key || common.slugifyPresetName(label));
  const store = loadCustomPresetStore();
  store[key] = {
    label,
    snapshot,
    importedAt: new Date().toISOString(),
  };
  saveCustomPresetStore(store);
  writeActivePresetName(key);

  const unsupported = common.listUnsupportedSegmentIds(snapshot);
  const lines = [
    `Imported preset: ${key}`,
    `Label: ${label}`,
    'Activated immediately.',
  ];
  if (unsupported.length) lines.push(`Skipped by hook: ${unsupported.join(', ')}`);
  return { ok: true, text: lines.join('\n') };
}

function main(argv) {
  const args = argv.filter(arg => arg !== '--raw');
  if (args.length === 0 || args[0] === 'list') {
    process.stdout.write(renderList());
    return;
  }

  if (args[0] === 'import') {
    const result = importPreset(args[1] || '');
    process.stdout.write(result.text);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const result = applyPreset(args.join(' '));
  process.stdout.write(result.text);
  process.exitCode = result.ok ? 0 : 1;
}

main(process.argv.slice(2));
