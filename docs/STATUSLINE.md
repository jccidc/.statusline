# Claude Code Statusline: How It Works, How to Customize

This is a reference for the statusline that renders at the bottom of Claude Code
(the one showing model, directory, context bar, and the `[CAVEMAN]` /
`[ENFORCER]` badges). If you've never touched it, start at the top. If you just
want to add a new badge, jump to "Adding a Badge".

## What the Statusline Actually Is

Claude Code runs a user-defined shell command every time it wants to refresh the
statusline. That command receives a JSON blob on **stdin**, writes a single line
of text to **stdout**, and the CLI displays that output verbatim at the bottom
of the screen.

That's it. No framework, no plugin API. Whatever your command prints is what
shows up.

### Wiring

In `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node \"C:/Users/ls13/.claude/hooks/gsd-statusline.js\""
}
```

The command runs on every message, every tool call, every refresh. Keep it
fast (sub-100ms) or Claude Code's UI will feel laggy.

### The stdin JSON

Claude Code pipes something like this into your command:

```json
{
  "model": { "display_name": "Opus 4.7" },
  "workspace": { "current_dir": "C:/Users/ls13/My Drive/projects/foo" },
  "session_id": "abc123",
  "context_window": { "remaining_percentage": 73 }
}
```

Read it, parse it, output whatever you want.

### The stdout format

A single line, optionally with ANSI escape codes for color/bold/etc. Examples:

```
\x1b[1;33m[CAVEMAN]\x1b[0m │ Opus 4.7 │ my-project █████░░░░░ 50%
```

Claude Code renders the ANSI codes, so you can color, bold, dim, and blink text
by wrapping it in escape sequences.

## The ANSI Color Cheat Sheet

All escape codes start with `\x1b[` and end with `m`. Combine codes with `;`.

| Code        | Effect          |
| ----------- | --------------- |
| `0`         | reset all       |
| `1`         | bold            |
| `2`         | dim             |
| `3`         | italic          |
| `4`         | underline       |
| `5`         | blink (loud)    |
| `30`–`37`   | foreground      |
| `40`–`47`   | background      |
| `90`–`97`   | bright foreground |
| `38;5;N`    | 256-color fg (N = 0–255) |
| `48;5;N`    | 256-color bg    |
| `38;2;R;G;B`| 24-bit truecolor fg |

**Standard foreground colors:** 30 black, 31 red, 32 green, 33 yellow, 34 blue,
35 magenta, 36 cyan, 37 white.

**Always close with `\x1b[0m`** or the color bleeds into everything after it.

### Quick examples

```js
`\x1b[1;34m[ENFORCER]\x1b[0m`           // bold blue
`\x1b[38;5;208m⚠ low context\x1b[0m`    // 256-color orange
`\x1b[2;37mmodel\x1b[0m`                // dim white
`\x1b[38;2;255;105;180mpink\x1b[0m`     // truecolor hot pink
```

## The Current Layout

`~/.claude/hooks/gsd-statusline.js` outputs segments in this order, separated
by `│` (vertical bar):

1. **Badges** — `[CAVEMAN]`, `[ENFORCER:tier]`, `⬆ /gsd-update`, etc.
   Conditional; skipped when not applicable.
2. **Model** — dim grey (`\x1b[2m`), e.g. `Opus 4.7`.
3. **Current task** — bold; pulled from `~/.claude/todos/<session>*.json`, only
   shown if an in-progress todo exists.
4. **Directory** — dim; just the basename of `workspace.current_dir`.
5. **Context bar** — 10-segment progress bar, color-coded by usage:
   green < 50%, yellow < 65%, orange < 80%, blinking red ≥ 80%.

Each segment is built independently then concatenated at the bottom of the
script. Adding or reordering segments is a matter of editing one template
string.

## Adding a Badge (the Canonical Pattern)

Say you want to add a `[DIRTY]` badge when the current git repo has uncommitted
changes. Here's the pattern every badge in `gsd-statusline.js` follows:

### 1. Detection block

Put this alongside the other detection blocks (after `cavemanBadge`,
`enforcerBadge`):

```js
// Git dirty badge — show [DIRTY] if the current repo has uncommitted changes.
let dirtyBadge = '';
try {
  const { execSync } = require('child_process');
  const out = execSync('git status --porcelain', {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 500,
  }).toString().trim();
  if (out) {
    dirtyBadge = '\x1b[1;31m[DIRTY]\x1b[0m \u2502 ';
  }
} catch (e) {
  // Not a git repo, git not installed, or timeout -- silent fail.
}
```

### 2. Concatenate into the output

Update both `process.stdout.write(...)` calls at the bottom of the script.
Example:

```js
if (task) {
  process.stdout.write(
    `${cavemanBadge}${enforcerBadge}${dirtyBadge}${gsdUpdate}` +
    `\x1b[2m${model}\x1b[0m │ \x1b[1m${task}\x1b[0m │ ` +
    `\x1b[2m${dirname}\x1b[0m${ctx}`
  );
}
```

### 3. Smoke-test before trusting it

```bash
echo '{"model":{"display_name":"Opus 4.7"},"workspace":{"current_dir":"/path/to/dirty/repo"},"session_id":"t","context_window":{"remaining_percentage":90}}' \
  | node ~/.claude/hooks/gsd-statusline.js
```

That's the pattern. Detect, build a string (or empty string), concat. Every
segment in the statusline follows this shape.

### Design rules

- **Fail silent.** A broken badge must never break the statusline. Wrap every
  detection block in `try/catch`.
- **Fast.** The statusline re-runs constantly. If your detection takes > 100ms,
  cache the result to a tmp file and re-read it (see how the context-window
  bridge file is written for a cached-result example).
- **Use `\u2502`, not `│`.** Git Bash on Windows can mangle raw multi-byte
  characters in shell strings. The escape form is portable.
- **Always reset ANSI** with `\x1b[0m` at the end of every coloured segment.

## Other Ideas Worth Stealing

Drop-in patterns for things you might want on the bar:

| Badge / segment       | Detection                                                                                          | Notes                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Git branch            | `execSync('git rev-parse --abbrev-ref HEAD')`                                                      | Cache: same branch per session usually.  |
| Untracked file count  | `git status --porcelain \| grep '^??' \| wc -l`                                                    | Cheap.                                   |
| Ahead/behind origin   | `git rev-list --left-right --count HEAD...@{u}`                                                    | Show as `↑2 ↓1`.                         |
| Open PR count         | `gh pr list --json number --jq 'length'`                                                           | Slow; cache for 5 min in tmp.            |
| Time                  | `new Date().toLocaleTimeString()`                                                                  | Useful during long sessions.             |
| Battery (laptop)      | WMI on Windows, `pmset -g batt` on macOS, `/sys/class/power_supply` on Linux                      | Platform-gate it.                        |
| Node / Python version | Read `.nvmrc` / `.python-version` / `pyproject.toml` from workspace root                          | Cheap, no subprocess needed.             |
| Plan Enforcer status  | Read `.plan-enforcer/ledger.md` and count `- [ ]` vs `- [x]`                                       | Already half-built, could show progress. |
| Token usage today     | Tail a log you write to from a PostToolUse hook                                                    | Requires a separate hook to log events.  |
| Weather / stock / XKCD| HTTP fetch with 2-second timeout, cached to tmp                                                    | Novelty; use at your own peril.          |

## Turning Badges On and Off Without Editing Code

Two useful patterns the current statusline already uses:

1. **Flag file gate** — `[CAVEMAN]` shows only if `~/.claude/.caveman-active`
   exists. To turn off without editing the script: `rm ~/.claude/.caveman-active`.
   To turn back on: let the SessionStart hook re-create it (or `touch` it
   manually).
2. **Workspace-scoped gate** — `[ENFORCER]` shows only when the current project
   root (nearest `.git`) contains `.plan-enforcer/ledger.md`. No flag, no
   toggle — presence of a file in the project is the switch.

Both patterns are trivial to apply to your own badges. Flag file for personal
always-on/always-off toggles, workspace-scoped for per-project features.

## Where the Script Lives and How to Edit Safely

- **Path:** `~/.claude/hooks/gsd-statusline.js`
- **Version marker:** first line comment `// gsd-hook-version: 1.34.2`.
  Increment if you publish changes back to a shared dotfiles repo.
- **Don't break `JSON.parse(input)`** — the outer try/catch will swallow the
  error, and the statusline will silently disappear. If you're debugging, add a
  temporary `fs.writeFileSync('/tmp/statusline-debug.log', err.stack)` inside
  the catch.
- **Rebuild takes zero time.** Node reads the file on every invocation; save,
  and the next message shows your change.

## Troubleshooting

- **Statusline blank** — your script crashed. Add a debug log in the outer
  `catch`. Common cause: a regex or `JSON.parse` threw.
- **Colour bleeds into the prompt** — you forgot `\x1b[0m` somewhere. Every
  colour open needs a close.
- **Badge never shows** — smoke-test with a fake stdin JSON (see pattern
  above). Print `JSON.stringify(data, null, 2)` at the top to see what Claude
  Code is actually handing you.
- **Badge shows at wrong times** — the detection is too loose. Walk-up logic
  especially leaks across project roots; scope it with a home-dir boundary or a
  `.git` anchor.

## Summary

The statusline is a shell command. It reads JSON on stdin, writes a string on
stdout. Everything else — badges, colours, conditional logic, caching — is
just what you choose to put between those two steps. Edit
`~/.claude/hooks/gsd-statusline.js`, save, next refresh picks it up.
