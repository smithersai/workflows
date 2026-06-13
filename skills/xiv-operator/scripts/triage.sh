#!/usr/bin/env bash
# One-shot operator snapshot for an xiv stack feature: structured triage + live runs.
# Usage: triage.sh <feature-slug>
# Read-only; safe to run on any interval.
set -euo pipefail

feature="${1:?usage: triage.sh <feature-slug>}"

echo "=== xiv stack triage (structured) ==="
xiv stack triage --feature "$feature" --json

echo
echo "=== active smithers runs ==="
smithers ps --all 2>/dev/null || echo "(smithers ps unavailable)"
