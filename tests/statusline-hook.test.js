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

describe('statusline hook diffstat segment', () => {
  function initGitRepo(cwd) {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    };
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd, env });
    fs.writeFileSync(path.join(cwd, 'seed.txt'), 'seed\n');
    spawnSync('git', ['add', 'seed.txt'], { cwd, env });
    spawnSync('git', ['commit', '-q', '-m', 'seed'], { cwd, env });
  }

  it('renders combined +added ~modified -deleted counts', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-diffstat-'));
    initGitRepo(cwd);
    fs.writeFileSync(path.join(cwd, 'seed.txt'), 'changed\n');
    fs.writeFileSync(path.join(cwd, 'new-file.txt'), 'new\n');

    const result = runHook(cwd, {
      enabled: ['model', 'diffstat'],
      separator: ' | ',
      sepColor: 'gray',
      sepBold: false,
      sepDim: false,
      showCaptions: false,
      overrides: {
        model: { bracket: 'square', caseTransform: 'upper', color: 'orange' },
        diffstat: { caption: 'diff' }
      }
    });

    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.match(clean, /\+1 ~1/);
  });

  it('hides diffstat segment when working tree is clean', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-diffstat-clean-'));
    initGitRepo(cwd);

    const result = runHook(cwd, {
      enabled: ['model', 'diffstat'],
      separator: ' | ',
      sepColor: 'gray',
      sepBold: false,
      sepDim: false,
      showCaptions: false,
      overrides: {
        model: { bracket: 'square', caseTransform: 'upper', color: 'orange' }
      }
    });

    const clean = result.stdout.replace(/\x1B\[[0-9;]*m/g, '');
    assert.equal(result.status, 0);
    assert.doesNotMatch(clean, /[+~-]\d/);
  });
});

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
