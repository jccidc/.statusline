---
name: statusline-preset
description: "List, import, or activate Claude Code statusline presets by name"
argument-hint: "[name | import <payload>]"
allowed-tools:
  - Bash
---

Show the following output to the user verbatim, with no extra commentary:

!`node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline/statusline-preset.js" --raw $ARGUMENTS`
