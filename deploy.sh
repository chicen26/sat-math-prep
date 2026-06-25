#!/usr/bin/env bash
# One-command deploy for the SAT Math PWA.
# Usage:  ./deploy.sh "what you changed"   (message optional)
# Syntax-checks the JS first (so a typo can't blank the live page), then
# commits everything and pushes. GitHub Pages redeploys in ~30-60s and every
# user gets the update on their next online open — no re-download needed.
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-update $(git rev-list --count HEAD 2>/dev/null || echo)}"
URL="https://chicen26.github.io/sat-math-prep/"

# 1. Guard: never push broken JS (this is what blanked the page once before).
for f in app.js data.js; do
  [ -f "$f" ] && node --check "$f" && echo "✓ $f syntax OK"
done

# 2. Nothing staged? Say so and bail cleanly.
if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to deploy — working tree is clean."
  exit 0
fi

# 3. Commit + push.
git add -A
git commit -q -m "$MSG"
git push -q origin HEAD
echo "✓ Pushed: \"$MSG\""
echo "→ Live in ~30-60s at $URL"
echo "  (Tip: if you added a NEW file, also bump VERSION in sw.js.)"
