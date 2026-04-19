# .statusline

A two-line, live-data statusline for Claude Code — with a browser playground to
design your own and share it with teammates.

**Live in your terminal:**

![terminal preview](docs/preview-terminal.png)

**Design it in the browser:**

![playground preview](docs/preview-playground.png)

## What's different

- **Two lines.** The first is your live statusline; the second is a dim caption
  row, width-aligned under each segment. No other statusline does this (Claude
  Code's multi-line renderer isn't documented — we spike-tested it).
- **Live from your actual session logs.** Token counts, cost estimates, cache
  hit %, today's spend, 5-hour message rate — all parsed from Claude Code's own
  `~/.claude/projects/<cwd>/<session>.jsonl` files.
- **Everything's a skippable segment.** No ledger? No `[ENFORCER]` badge. No
  git repo? No branch or repo name. Segments drop cleanly and take their
  separators with them.
- **Per-segment styling.** Color (16 + truecolor), bold, dim, italic,
  underline, strikethrough, background color, icon prefix, bracket style, case
  transform (UPPER / lower / Title), caption, custom separator-before,
  alignment (center / left / right), max width with middle-ellipsis truncation.
- **Playground.** A single HTML file with live preview, 8+ presets, 9 terminal
  themes, undo/redo, URL-sharing, localStorage presets, and a "copy prompt"
  button that emits a natural-language instruction for Claude Code to rewrite
  your hook.

## Install

### 1. Clone

```bash
git clone https://github.com/jccidc/.statusline ~/.statusline
```

### 2. Copy the hook into place

```bash
cp ~/.statusline/hook/statusline.js ~/.claude/hooks/statusline.js
```

> If you already have a hook at `~/.claude/hooks/gsd-statusline.js` or
> `~/.claude/hooks/statusline.js`, back it up first:
> `cp ~/.claude/hooks/statusline.js ~/.claude/hooks/statusline.js.bak`

### 3. Wire it into Claude Code

Open `~/.claude/settings.json` and add (or edit) the `statusLine` block:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.claude/hooks/statusline.js\""
  }
}
```

On Windows + Git Bash, use the forward-slash path:
`node "C:/Users/<you>/.claude/hooks/statusline.js"`.

### 4. (Optional) Caveman-mode flag

The `[CAVEMAN]` badge only renders when `~/.claude/.caveman-active` exists.
To toggle:

```bash
touch ~/.claude/.caveman-active   # on
rm    ~/.claude/.caveman-active   # off
```

### 5. (Optional) Preview the Plan Enforcer badge

The `[ENFORCER:N/M]` badge shows real progress from a project's
`.plan-enforcer/ledger.md`. To preview the look without setting up a real
ledger:

```bash
echo "3/7" > ~/.claude/.enforcer-preview   # on, with placeholder value
rm ~/.claude/.enforcer-preview             # off
```

Real ledgers always win over the preview flag.

### 6. Restart Claude Code

Fire up a new session. Your statusline is now two-line and live.

## Design your own

Open the playground in any browser:

```bash
# macOS
open  ~/.statusline/playground/index.html

# Windows
start ~/.statusline/playground/index.html

# Linux
xdg-open ~/.statusline/playground/index.html
```

- Pick a preset, or start from `My defaults ★` and edit from there.
- Click "more…" on any segment to expand advanced styling (italic, bg color,
  truecolor hex, icon, bracket, case, sep-before, caption, max width).
- Hit **Copy** to copy a natural-language prompt you can paste into Claude
  Code — it'll rewrite your `hook/statusline.js` to match.
- Hit **🔗 Share** to copy a URL with your full state embedded; hand the URL
  to anyone who has the playground HTML and their playground loads your exact
  setup.
- Hit **💾 Save** to stash a custom preset in `localStorage`.

See [`docs/STATUSLINE.md`](docs/STATUSLINE.md) for an architectural deep-dive on
how the bar is built and how to add your own segments.

## Share your statusline

Five paths, ranked by recipient friction:

1. **URL share** — playground → 🔗 Share → send the URL. Recipient has the
   playground HTML → pastes URL → loads your setup verbatim.
2. **Send playground HTML + URL** — email/Slack them `playground/index.html`
   plus the share URL. Fully offline.
3. **Copy the prompt** — playground → switch output to "Prompt" → Copy → paste
   into their Claude Code session. Claude rewrites their hook. Zero tooling
   needed on their end.
4. **Send the JSON config** — playground → output "JSON" → Copy. A raw config
   artifact.
5. **Send the hook file** — `hook/statusline.js` directly. Most accurate, most
   invasive.

## Segments available

All of these render live from real data on your machine. Any segment with no
data simply skips (no empty slot, no dangling separator):

| Segment              | Source                                                  |
| -------------------- | ------------------------------------------------------- |
| Model                | `data.model.display_name` from stdin                    |
| Caveman badge        | `~/.claude/.caveman-active` flag                        |
| Enforcer progress    | `.plan-enforcer/ledger.md` scoreboard (walk-up)         |
| Enforcer preview     | `~/.claude/.enforcer-preview` flag (placeholder)        |
| GSD update notice    | `~/.cache/gsd/gsd-update-check.json`                    |
| Local directory      | `data.workspace.current_dir`                            |
| Repo name            | `git rev-parse --show-toplevel` basename                |
| Git branch           | `git rev-parse --abbrev-ref HEAD`                       |
| Last commit age      | `git log -1 --format=%ct` relative                      |
| TODO count           | `~/.claude/todos/<session>-agent-*.json`                |
| Current task         | same todos file, `in_progress` entry                    |
| Context bar          | `data.context_window.remaining_percentage`              |
| Session tokens       | session JSONL usage totals                              |
| Session cost         | session JSONL × price table                             |
| Cache hit %          | session JSONL `cache_read` ÷ total input                |
| Today's cost         | all-session JSONL scan, mtime-filtered, 60s cache       |
| Messages / 5h        | all-session JSONL scan, timestamp-filtered, 60s cache   |
| 5h window            | msg count in last 5h + time until earliest ages out     |
| Weekly limit         | cost over last 7d + time until earliest ages out        |

## Configuration knobs

| File                                  | Purpose                                  |
| ------------------------------------- | ---------------------------------------- |
| `~/.claude/hooks/statusline.js`       | Your live hook (edit or regenerate)      |
| `~/.claude/settings.json`             | Wires the hook into Claude Code          |
| `~/.claude/.caveman-active`           | Toggles the `[CAVEMAN]` badge            |
| `~/.claude/.enforcer-preview`         | Forces `[ENFORCER:N/M]` with a value     |
| `<project>/.plan-enforcer/ledger.md`  | Real enforcer progress (walk-up)         |
| `~/.claude/todos/<sess>-agent-*.json` | TODOs + current task                     |
| `~/.claude/projects/<cwd>/*.jsonl`    | Session logs — usage/cost/cache source   |
| `os.tmpdir()/claude-statusline-agg.json` | Cross-session cost/msg cache (60s TTL) |

## Budget tracking (5h + weekly)

The hook can display two rolling budget segments: **5h window** and
**Weekly limit**. Both work out of the box with zero config, and you can
layer extra precision on top in three tiers.

> **Important caveat.** Anthropic does **not** expose live Claude Code
> subscription quotas to any hook, env var, stdin payload, or CLI flag —
> only through the interactive `/usage` slash command. Tiers 1–2 below
> give you a local *estimate* parsed from your session JSONLs. Tier 3
> replaces the estimate with authoritative numbers, but requires an
> external scraper you run yourself.

### Tier 1 — just install the hook (zero config)

Do nothing extra. The segments render as:

```
5h: 23 · 2h14m    wk: $47 · 4d3h
```

Count of assistant messages in the last 5h, rolling cost over the last
7d, and time until the earliest entry in each window ages out. No bars,
no colors beyond the defaults. Caption: `5h window`, `weekly`.

### Tier 2 — add ceilings + currency (one-time env-var setup)

Pick your budget caps and (optionally) your display currency. The
segments gain progress bars that turn orange at 75% and blink red at
90%. Caption stays `5h window` / `weekly` (still local estimate).

```bash
# in ~/.bashrc, ~/.zshrc, or `env` block in ~/.claude/settings.json
export STATUSLINE_5H_MSG_CEILING=50            # msgs per 5h — fills the 5h bar
export STATUSLINE_WEEKLY_COST_CEILING=140      # cost per 7d in display currency
export STATUSLINE_CURRENCY=USD                 # or SEK
export STATUSLINE_SEK_RATE=10.5                # only read when CURRENCY=SEK
```

All four are optional. Omit `STATUSLINE_5H_MSG_CEILING` and the 5h
segment shows a raw count. Omit `STATUSLINE_WEEKLY_COST_CEILING` and
the weekly shows a raw cost. Omit currency entries and everything stays
USD.

**Don't want to hand-edit?** Open the playground, click
**⚙ Config** in the top bar, pick your values, hit **Copy** in the
"Env vars" box. Paste into your shell profile. Done. (The playground's
Config modal is purely a helper — it doesn't modify the hook by itself.)

| Env var                          | What it does                                    | Default    |
| -------------------------------- | ----------------------------------------------- | ---------- |
| `STATUSLINE_5H_MSG_CEILING`      | Msg count that fills the 5h bar                 | `0` (no bar) |
| `STATUSLINE_WEEKLY_COST_CEILING` | Cost that fills the weekly bar (display ccy)    | `0` (no bar) |
| `STATUSLINE_CURRENCY`            | `USD` or `SEK` — affects all cost displays      | `USD`      |
| `STATUSLINE_SEK_RATE`            | USD→SEK conversion rate                         | `10.5`     |

### Tier 3 — authoritative numbers (requires a scraper)

Install any scraper that can pull Anthropic's real subscription quota
(e.g. [`ccusage`](https://github.com/ryoppippi/ccusage), a
`mitmproxy` capture of the `/v1/messages?source=quota_check` call, a
corporate usage bot, or a future `claude usage --json` if/when Anthropic
ships one). Have it write this JSON to
`~/.claude/.statusline-quota.json` every 5 minutes or so:

```json
{
  "fetched_at": 1776614452,
  "five_hour": {
    "messages_used":  12,
    "messages_limit": 225,
    "resets_at":      1776625252
  },
  "weekly": {
    "used_pct":  23,
    "cost_usd":  47.32,
    "limit_usd": 140,
    "resets_at": 1777046452
  }
}
```

The hook auto-detects the file, prefers it over the local estimate, and
flips the caption to `5h window*` / `weekly*` (trailing asterisk) so
you can tell at a glance whether the number is authoritative or an
approximation. If the file is missing or older than 15 minutes, the
hook silently falls back to Tier 1/2 behavior.

**All fields are optional** — the hook uses whatever's present. Only
`fetched_at` (unix seconds) is required for the freshness check.

**Override the path:** `export STATUSLINE_QUOTA_FILE=/some/other/path.json`

**Example one-liner** (adapt `jq` to your scraper's actual output
shape — the hook only cares about the schema above):

```bash
ccusage --json \
  | jq '{fetched_at: now|floor, five_hour: .five_hour, weekly: .weekly}' \
  > ~/.claude/.statusline-quota.json
```

Wrap that in cron / Windows Task Scheduler on a 5-minute interval.

### Which tier should I pick?

| If you want…                                         | Use tier |
| ---------------------------------------------------- | -------- |
| "How much have I used so far?" — vague answer is fine | 1 |
| Progress bars with warning colors near your cap       | 2 |
| The same numbers `/usage` shows, in your statusline   | 3 |

Tiers are additive — Tier 3 gracefully degrades to Tier 2 when the
quota file goes stale; Tier 2 degrades to Tier 1 when env vars are
absent. You never have to rip anything out to move between them.

## Performance

The hook re-runs every message and tool call, so it has to be fast:

- Git subprocesses: `execSync` with 400ms timeout, fail-silent.
- Cross-session log scan: mtime-gated per file, cached in `os.tmpdir()` for
  60s. Only files touched today or within the 5-hour window are parsed.
- All ANSI is written to stdout in a single buffered write.
- Target: < 60ms cold, < 10ms warm (cache hit).

If your bar ever feels laggy, delete the agg cache to force a refresh
(`rm "$TMPDIR/claude-statusline-agg.json"`) or grep for long-running
`execSync` calls.

## Compatibility

- Tested on Windows 11 + Git Bash, macOS, Linux (Ubuntu).
- Node 18+.
- Terminals: Windows Terminal, iTerm2, Alacritty, Kitty, VS Code terminal.
- Multi-line is a Claude Code feature; it will look wrong in terminals that
  don't do what Claude Code expects on `\n`. Disable the caption line in
  `statusline.js` if you hit that by setting all `caption` fields to empty
  strings.

## License

MIT. See [LICENSE](LICENSE).
