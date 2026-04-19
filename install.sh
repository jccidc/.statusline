#!/usr/bin/env bash
# .statusline installer - copies hook + preset helpers into ~/.claude and wires settings.json.
#
# Usage:
#   bash install.sh              # interactive, asks before each step
#   bash install.sh --yes        # non-interactive, backups made automatically
#   bash install.sh --uninstall  # restore the most recent statusline.js backup

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOOK_SRC="$REPO_ROOT/hook/statusline.js"
COMMON_SRC="$REPO_ROOT/shared/statusline-preset-common.js"
SCRIPT_SRC="$REPO_ROOT/scripts/statusline-preset.js"
SKILL_SRC="$REPO_ROOT/.claude/skills/statusline-preset/SKILL.md"

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOK_DEST="$CLAUDE_DIR/hooks/statusline.js"
HOOK_DEST_GSD="$CLAUDE_DIR/hooks/gsd-statusline.js"
COMMON_DEST="$CLAUDE_DIR/statusline/statusline-preset-common.js"
SCRIPT_DEST="$CLAUDE_DIR/statusline/statusline-preset.js"
SKILL_DEST_DIR="$CLAUDE_DIR/skills/statusline-preset"
SKILL_DEST="$SKILL_DEST_DIR/SKILL.md"
SETTINGS="$CLAUDE_DIR/settings.json"

YES=0
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --help|-h)
      sed -n '2,6p' "$0"
      exit 0
      ;;
  esac
done

confirm() {
  local msg="$1"
  if [ "$YES" -eq 1 ]; then return 0; fi
  read -r -p "$msg [Y/n] " reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]
}

backup_file() {
  local target="$1"
  if [ ! -f "$target" ]; then return 0; fi
  local bak="$target.bak.$(date +%Y%m%d-%H%M%S)"
  if confirm "Existing file found. Back it up to $bak and replace?"; then
    cp "$target" "$bak"
  else
    echo "Aborted." >&2
    exit 1
  fi
}

if [ "$UNINSTALL" -eq 1 ]; then
  latest_bak="$(ls -t "$HOOK_DEST".bak.* 2>/dev/null | head -1 || true)"
  if [ -z "$latest_bak" ]; then
    echo "No backup found. Nothing to restore." >&2
    exit 1
  fi
  if confirm "Restore $latest_bak to $HOOK_DEST?"; then
    cp "$latest_bak" "$HOOK_DEST"
    if [ -f "$HOOK_DEST_GSD" ]; then cp "$latest_bak" "$HOOK_DEST_GSD"; fi
    echo "Restored."
  fi
  exit 0
fi

for required in "$HOOK_SRC" "$COMMON_SRC" "$SCRIPT_SRC" "$SKILL_SRC"; do
  if [ ! -f "$required" ]; then
    echo "Required source missing: $required" >&2
    exit 1
  fi
done

mkdir -p "$CLAUDE_DIR/hooks" "$CLAUDE_DIR/statusline" "$SKILL_DEST_DIR"

backup_file "$HOOK_DEST"
if [ "$HOOK_DEST_GSD" != "$HOOK_DEST" ]; then backup_file "$HOOK_DEST_GSD"; fi
backup_file "$COMMON_DEST"
backup_file "$SCRIPT_DEST"
backup_file "$SKILL_DEST"

cp "$HOOK_SRC" "$HOOK_DEST"
cp "$HOOK_SRC" "$HOOK_DEST_GSD"
cp "$COMMON_SRC" "$COMMON_DEST"
cp "$SCRIPT_SRC" "$SCRIPT_DEST"
cp "$SKILL_SRC" "$SKILL_DEST"
chmod +x "$SCRIPT_DEST"

echo "Installed hooks -> $HOOK_DEST and $HOOK_DEST_GSD"
echo "Installed preset helper -> $SCRIPT_DEST"
echo "Installed slash command -> $SKILL_DEST"

cmd="node \"$HOOK_DEST\""
if [ -f "$SETTINGS" ]; then
  if grep -q '"statusLine"' "$SETTINGS"; then
    echo "settings.json already has a statusLine entry. Leaving it alone."
    echo "If you want to point it at this hook, edit $SETTINGS so statusLine.command = $cmd"
  else
    if confirm "Add statusLine block to $SETTINGS?"; then
      python3 - "$SETTINGS" "$cmd" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data.setdefault('statusLine', {'type': 'command', 'command': cmd})
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
PY
      echo "Updated settings.json."
    fi
  fi
else
  if confirm "No $SETTINGS found. Create one with statusLine wired up?"; then
    cat > "$SETTINGS" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "$cmd"
  }
}
EOF
    echo "Created $SETTINGS."
  fi
fi

cat <<EOF

Done. Start a new Claude Code session to see the statusline.

Installed extras:
  /statusline-preset        # list saved presets
  /statusline-preset all    # list saved + built-in presets
  /statusline-preset NAME   # apply preset by name

Optional toggles:
  touch $CLAUDE_DIR/.caveman-active       # turn [CAVEMAN] badge on
  rm    $CLAUDE_DIR/.caveman-active       # turn it off
  echo "3/7" > $CLAUDE_DIR/.enforcer-preview   # preview [ENFORCER] without a real ledger
  rm    $CLAUDE_DIR/.enforcer-preview     # turn preview off

Playground:
  open $REPO_ROOT/playground/index.html
EOF
