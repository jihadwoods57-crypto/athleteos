#!/usr/bin/env bash
set -euo pipefail
# Deploy the Fable 5 engine from this repo to the global ~/.claude paths the loaders read.
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$CLAUDE_DIR/workflows" "$CLAUDE_DIR/skills/fable5"
cp "$SRC/fable5.js" "$CLAUDE_DIR/workflows/fable5.js"
cp "$SRC/SKILL.md" "$CLAUDE_DIR/skills/fable5/SKILL.md"
echo "Deployed fable5.js -> $CLAUDE_DIR/workflows/ and SKILL.md -> $CLAUDE_DIR/skills/fable5/"
