const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hook', 'statusline.js');

function mkClaudeDir(snapshot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-hook-'));
  const claudeDir = path.join(root, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.statusline-active-preset'), 'test-preset\n', 'utf8');
  fs.writeFileSync(path.join(claudeDir, 'statusline-presets.json'), JSON.stringify({
    version: 1,
    presets: {
      'test-preset': {
        label: 'Test preset',
        snapshot
      }
    }
  }, null, 2) + '\n', 'utf8');
  return { root, claudeDir };
}

function runHook(cwd, snapshot, extraEnv = {}) {
  const { root, claudeDir } = mkClaudeDir(snapshot);
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      workspace: { current_dir: cwd },
      session_id: 's1',
      model: { display_name: 'Claude' }
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CLAUDE_CONFIG_DIR: claudeDir,
      ...extraEnv
    }
  });
  return result;
}

describe('statusline hook chained enforcer integration', () => {
  it('renders the chained enforcer label in the configured slot after model', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-cwd-'));
    const result = runHook(cwd, {
      enabled: ['model', 'enforcer', 'caveman', 'dir'],
      separator: ' | ',
      sepColor: 'gray',
      sepBold: false,
      sepDim: false,
      showCaptions: true,
      overrides: {
        model: { bracket: 'square', caseTransform: 'upper', caption: 'model', color: 'orange' },
        enforcer: { caption: 'enforcer' },
        caveman: { caption: 'caveman' },
        dir: { icon: 'DIR', caption: 'dir' }
      }
    }, {
      PLAN_ENFORCER_STATUSLINE_CHAINED: '1',
      PLAN_ENFORCER_STATUSLINE_LABEL: '1-DISCUSS'
    });

    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.match(clean, /^\[CLAUDE\] \| \[ENFORCER: 1-DISCUSS\] \| /);
  });

  it('injects the enforcer slot after model when the preset omits it', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-cwd-'));
    const result = runHook(cwd, {
      enabled: ['model', 'caveman', 'dir'],
      separator: ' | ',
      sepColor: 'gray',
      sepBold: false,
      sepDim: false,
      showCaptions: true,
      overrides: {
        model: { bracket: 'square', caseTransform: 'upper', caption: 'model', color: 'orange' },
        caveman: { caption: 'caveman' },
        dir: { icon: 'DIR', caption: 'dir' }
      }
    }, {
      PLAN_ENFORCER_STATUSLINE_CHAINED: '1',
      PLAN_ENFORCER_STATUSLINE_LABEL: 'P1 1/2',
      PLAN_ENFORCER_STATUSLINE_PROGRESS: '1/2'
    });

    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.match(clean, /^\[CLAUDE\] \| \[ENFORCER: P1 1\/2\] \| /);
    assert.match(clean, /\n.*model.*enforcer.*dir/i);
  });
});
