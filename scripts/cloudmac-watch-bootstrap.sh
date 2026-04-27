#!/usr/bin/env bash
set -euo pipefail

# One-time helper for cloud-Mac setup.
# This script does everything possible from CLI, then pauses for the few required Xcode UI steps.
#
# Usage:
#   chmod +x scripts/cloudmac-watch-bootstrap.sh
#   ./scripts/cloudmac-watch-bootstrap.sh
#
# Optional env vars:
#   APPLE_TEAM_ID=XXXXXXXXXX   # If set, applied after prebuild via app.json patch reminder only.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Ballast watch bootstrap =="
echo "Repo: $ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is required. Install Node 20+ on this Mac."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required. Install npm/Node."
  exit 1
fi

echo ""
echo "1) Installing JS dependencies"
npm install

echo ""
echo "2) Generating iOS native project (Expo prebuild)"
npx expo prebuild --platform ios

echo ""
echo "3) Confirming watch source files exist"
for f in \
  watchkit-sources/BallastWatch/BallastWatchApp.swift \
  watchkit-sources/BallastWatch/PhoneBridge.swift \
  watchkit-sources/BallastWatch/ContentView.swift \
  watchkit-sources/BallastWatch/TankDetailView.swift
do
  if [[ ! -f "$f" ]]; then
    echo "Missing file: $f"
    exit 1
  fi
done

echo ""
echo "4) Opening Xcode workspace"
open ios/BallastMonitor.xcworkspace

cat <<'EOF'

======================================
REQUIRED MANUAL XCODE STEPS (5-10 min)
======================================

A) Add Watch targets
   File > New > Target... > watchOS > App
   Product Name: BallastWatch
   Interface: SwiftUI
   Language: Swift
   Include Notification Scene: OFF
   Include Complication: OFF
   Embed in Application: Ballast Monitor

B) Add existing Swift files to Watch target
   In Project Navigator, right-click the Watch extension group > Add Files to "BallastMonitor"...
   Add:
     watchkit-sources/BallastWatch/BallastWatchApp.swift
     watchkit-sources/BallastWatch/PhoneBridge.swift
     watchkit-sources/BallastWatch/ContentView.swift
     watchkit-sources/BallastWatch/TankDetailView.swift

   IMPORTANT:
   - Remove template Watch ContentView/App file to avoid duplicate @main.
   - In File Inspector for each added file, enable target membership for Watch extension target.

C) Signing
   Select iOS app target, Watch app target, and Watch extension target.
   In Signing & Capabilities:
   - Set your Team
   - Ensure each has a unique bundle identifier
   - Keep automatic signing ON

D) Build check
   Product > Build (⌘B)
   Resolve any signing prompts.

After these UI steps, return to terminal and run:
   ./scripts/cloudmac-watch-finish.sh

EOF

