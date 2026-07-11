#!/usr/bin/env bash
set -euo pipefail
# Deploy the Fable 5 engine from this repo to the global ~/.claude paths the loaders read.
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$CLAUDE_DIR/workflows" "$CLAUDE_DIR/skills/fable5"
# Normalize CRLF -> LF on copy: on Windows the working tree is checked out with
# CRLF, and the Workflow permission dialog rejects the CR bytes as control chars.
tr -d '\r' < "$SRC/fable5.js" > "$CLAUDE_DIR/workflows/fable5.js"
tr -d '\r' < "$SRC/SKILL.md" > "$CLAUDE_DIR/skills/fable5/SKILL.md"
echo "Deployed fable5.js -> $CLAUDE_DIR/workflows/ and SKILL.md -> $CLAUDE_DIR/skills/fable5/ (LF-normalized)"
