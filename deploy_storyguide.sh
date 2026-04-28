#!/bin/zsh

set -euo pipefail

WORKSPACE_DIR="${0:A:h}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_LABEL="com.jay.storyguide"
SOURCE_PLIST="$WORKSPACE_DIR/com.jay.storyguide.plist"
TARGET_PLIST="$LAUNCH_AGENTS_DIR/$PLIST_LABEL.plist"

echo "Preparing Storyguide deployment..."
mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$HOME/.storyguide/.pycache"

echo "Validating LaunchAgent plist..."
plutil -lint "$SOURCE_PLIST" >/dev/null

echo "Installing LaunchAgent plist..."
cp "$SOURCE_PLIST" "$TARGET_PLIST"

echo "Reloading LaunchAgent..."
launchctl bootout "gui/$(id -u)" "$TARGET_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"

echo
echo "Storyguide deployed."
echo "LaunchAgent: $PLIST_LABEL"
echo "Workspace: $WORKSPACE_DIR"
echo "URL: http://127.0.0.1:8001"
echo "Status command: launchctl print gui/$(id -u)/$PLIST_LABEL"
