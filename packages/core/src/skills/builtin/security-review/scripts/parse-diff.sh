#!/usr/bin/env bash
# parse-diff.sh — Extracts security-relevant metadata from git diffs.
#
# Usage:
#   bash parse-diff.sh [target]
#
# Target:
#   (empty)    — Analyzes staged changes, falls back to unstaged
#   staged     — Analyzes staged changes only
#   <number>   — Analyzes PR diff via gh cli
#   <ref>      — Analyzes git diff against the given ref
#
# Output: Structured summary of changed files with security-relevant metadata.

set -euo pipefail

TARGET="${1:-}"

# File extensions considered security-relevant for prioritization
SECURITY_RELEVANT_EXTENSIONS="ts tsx js jsx py go java rb rs php c cpp h cs"

# Patterns in filenames that indicate security-critical files
SECURITY_CRITICAL_PATTERNS="auth|login|session|token|crypt|secret|password|credential|permission|acl|rbac|oauth|jwt|saml|csrf|cors|sanitiz|validat|middleware|guard|policy|firewall|ssl|tls|cert"

# File patterns to skip entirely
SKIP_PATTERNS="\.lock$|\.min\.|\.map$|\.svg$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.ico$|\.woff|\.ttf|\.eot|node_modules|dist/|build/|\.git/|vendor/|__pycache__|\.pyc$|\.class$|\.o$"

get_diff() {
  case "$TARGET" in
    ""|staged)
      # Try staged first, fall back to unstaged
      local staged
      staged=$(git diff --staged --name-only 2>/dev/null || true)
      if [ -n "$staged" ]; then
        git diff --staged
      else
        git diff
      fi
      ;;
    [0-9]*)
      # PR number — use gh cli
      if command -v gh &>/dev/null; then
        gh pr diff "$TARGET"
      else
        echo "Error: gh CLI not installed. Cannot fetch PR diff." >&2
        exit 1
      fi
      ;;
    *)
      # Git ref or branch
      git diff "$TARGET"
      ;;
  esac
}

# Get the list of changed files from the diff
get_changed_files() {
  case "$TARGET" in
    ""|staged)
      local staged
      staged=$(git diff --staged --name-only 2>/dev/null || true)
      if [ -n "$staged" ]; then
        git diff --staged --name-only
      else
        git diff --name-only
      fi
      ;;
    [0-9]*)
      if command -v gh &>/dev/null; then
        gh pr diff "$TARGET" --name-only 2>/dev/null || gh pr diff "$TARGET" | grep '^diff --git' | sed 's/diff --git a\/.* b\///'
      fi
      ;;
    *)
      git diff "$TARGET" --name-only
      ;;
  esac
}

# Get diff stats (additions/deletions per file)
get_diff_stats() {
  case "$TARGET" in
    ""|staged)
      local staged
      staged=$(git diff --staged --name-only 2>/dev/null || true)
      if [ -n "$staged" ]; then
        git diff --staged --stat
      else
        git diff --stat
      fi
      ;;
    [0-9]*)
      if command -v gh &>/dev/null; then
        gh pr diff "$TARGET" --stat 2>/dev/null || echo "(stats unavailable)"
      fi
      ;;
    *)
      git diff "$TARGET" --stat
      ;;
  esac
}

# Main output
echo "=== Security Review: Diff Analysis ==="
echo ""
echo "Target: ${TARGET:-staged/unstaged changes}"
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Get all changed files
ALL_FILES=$(get_changed_files 2>/dev/null || true)

if [ -z "$ALL_FILES" ]; then
  echo "No changes detected."
  exit 0
fi

TOTAL_FILES=$(echo "$ALL_FILES" | wc -l | tr -d ' ')
echo "Total files changed: $TOTAL_FILES"
echo ""

# Categorize files
echo "=== File Classification ==="
echo ""

SECURITY_CRITICAL=""
CODE_FILES=""
SKIP_FILES=""

while IFS= read -r file; do
  # Skip non-relevant files
  if echo "$file" | grep -qE "$SKIP_PATTERNS"; then
    SKIP_FILES="${SKIP_FILES}${file}\n"
    continue
  fi

  # Check if security-critical by path/name
  if echo "$file" | grep -qiE "$SECURITY_CRITICAL_PATTERNS"; then
    SECURITY_CRITICAL="${SECURITY_CRITICAL}${file}\n"
    continue
  fi

  # Check if it's a code file
  ext="${file##*.}"
  if echo "$SECURITY_RELEVANT_EXTENSIONS" | grep -qw "$ext" 2>/dev/null; then
    CODE_FILES="${CODE_FILES}${file}\n"
  else
    SKIP_FILES="${SKIP_FILES}${file}\n"
  fi
done <<< "$ALL_FILES"

# Output security-critical files first
if [ -n "$SECURITY_CRITICAL" ]; then
  echo "## PRIORITY — Security-Critical Files"
  echo -e "$SECURITY_CRITICAL" | grep -v '^$' | while read -r f; do
    echo "  [!] $f"
  done
  echo ""
fi

# Output regular code files
if [ -n "$CODE_FILES" ]; then
  echo "## Code Files"
  echo -e "$CODE_FILES" | grep -v '^$' | while read -r f; do
    echo "  [ ] $f"
  done
  echo ""
fi

# Output skipped files
if [ -n "$SKIP_FILES" ]; then
  SKIP_COUNT=$(echo -e "$SKIP_FILES" | grep -cv '^$' || echo 0)
  echo "## Skipped ($SKIP_COUNT files): non-code, generated, or vendored"
  echo ""
fi

# Diff stats
echo "=== Diff Statistics ==="
get_diff_stats 2>/dev/null || echo "(unable to generate stats)"
echo ""

echo "=== Analysis Complete ==="
