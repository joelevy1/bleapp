#!/usr/bin/env bash
set -euo pipefail

# Run this AFTER finishing manual Xcode watch target setup.
# It validates that watch targets exist, shows changed files, and prints exact git commands.
#
# Usage:
#   chmod +x scripts/cloudmac-watch-finish.sh
#   ./scripts/cloudmac-watch-finish.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Ballast watch finish check =="

if [[ ! -d ios ]]; then
  echo "ios/ folder not found. Run bootstrap first."
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Open Xcode once and install command line tools."
  exit 1
fi

echo ""
echo "1) Listing schemes (expect iOS app + watch app/extension schemes)"
xcodebuild -workspace ios/BallastMonitor.xcworkspace -list | sed -n '/Schemes:/,$p'

echo ""
echo "2) Git status for files to commit"
git status --short

echo ""
echo "3) Next commands"
cat <<'EOF'
git add ios .gitignore .easignore watchSync.js WATCH_XCODE_SETUP.md scripts/cloudmac-watch-bootstrap.sh scripts/cloudmac-watch-finish.sh
git commit -m "watch: add WatchKit targets and include companion in iOS build"
git push origin main
EOF

echo ""
echo "4) Trigger build"
echo "Push to main should trigger your production workflow automatically (unless commit contains [skip-eas])."
echo "After EAS build completes, submit that build to TestFlight."

