#!/bin/zsh

set -euo pipefail

WORKSPACE_DIR="/Users/jay/Documents/Playground 8"
APP_DIR="$HOME/.storyguide"
APP_PACKAGE_DIR="$APP_DIR/storyguide"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_LABEL="com.jay.storyguide"
SOURCE_PLIST="$WORKSPACE_DIR/com.jay.storyguide.plist"
TARGET_PLIST="$LAUNCH_AGENTS_DIR/$PLIST_LABEL.plist"

echo "Preparing Storyguide deployment..."
mkdir -p "$APP_PACKAGE_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"

echo "Validating LaunchAgent plist..."
plutil -lint "$SOURCE_PLIST" >/dev/null

echo "Copying application files to $APP_DIR ..."
cp "$WORKSPACE_DIR/main.py" "$APP_DIR/main.py"
mkdir -p "$APP_DIR/.pycache"
ditto "$WORKSPACE_DIR/storyguide" "$APP_PACKAGE_DIR"
if [ -f "$WORKSPACE_DIR/.env" ]; then
  cp "$WORKSPACE_DIR/.env" "$APP_DIR/.env"
fi

echo "Installing LaunchAgent plist..."
cp "$SOURCE_PLIST" "$TARGET_PLIST"

echo "Reloading LaunchAgent..."
launchctl bootout "gui/$(id -u)" "$TARGET_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"

echo
echo "Storyguide deployed."
echo "LaunchAgent: $PLIST_LABEL"
echo "App directory: $APP_DIR"
echo "URL: http://127.0.0.1:8000"
echo "Status command: launchctl print gui/$(id -u)/$PLIST_LABEL"
