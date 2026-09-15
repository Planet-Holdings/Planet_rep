#!/bin/bash
# Planet Rep — workstation screenshot agent (macOS)
#
# Takes ONE screenshot per day, and only while this user is actually
# screen-sharing in Discord. The server decides; this script just asks.
#
# This is company monitoring software. Tell your team it is installed.
# It writes a plain-text log next to itself so anyone on the machine can see
# exactly when a screenshot was taken and where it went.
#
# Setup (run once, in Terminal):
#   1. Fill in the three settings below.
#   2. chmod +x capture-mac.sh
#   3. Test it:     ./capture-mac.sh --once
#      macOS will ask for Screen Recording permission — allow it, then re-run.
#   4. Install it:  ./capture-mac.sh --install

# ---------------------------------------------------------------------------
# SETTINGS — fill these in
# ---------------------------------------------------------------------------
SERVER_URL="https://planetrep-production.up.railway.app"
CAPTURE_TOKEN="PASTE_CAPTURE_TOKEN_HERE"
DISCORD_USER_ID="PASTE_THIS_REPS_DISCORD_USER_ID"
# ---------------------------------------------------------------------------

set -uo pipefail
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
LOG_FILE="$(dirname "$SCRIPT_PATH")/capture-agent.log"
PLIST="$HOME/Library/LaunchAgents/com.planetrep.capture.plist"

log() {
  local line="$(date '+%Y-%m-%d %H:%M:%S')  $1"
  echo "$line"
  echo "$line" >> "$LOG_FILE"
}

install_agent() {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.planetrep.capture</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT_PATH</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict>
</plist>
PLISTEOF
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST"
  log "Installed launch agent (runs at login). Plist: $PLIST"
  exit 0
}

uninstall_agent() {
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  log "Removed launch agent."
  exit 0
}

case "${1:-}" in
  --install)   install_agent ;;
  --uninstall) uninstall_agent ;;
esac

if [[ "$CAPTURE_TOKEN" == PASTE_* || "$DISCORD_USER_ID" == PASTE_* ]]; then
  log "ERROR: Fill in CAPTURE_TOKEN and DISCORD_USER_ID at the top of this script first."
  exit 1
fi

run_cycle() {
  local response
  response=$(curl -fsS --max-time 30 \
    "$SERVER_URL/api/capture/should?userId=$DISCORD_USER_ID&token=$CAPTURE_TOKEN" 2>/dev/null)
  if [[ -z "$response" ]]; then
    log "Could not reach server."
    echo 300
    return
  fi

  local poll capture reason channel
  poll=$(echo "$response" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("pollSeconds",300))' 2>/dev/null || echo 300)
  capture=$(echo "$response" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("capture",False))' 2>/dev/null || echo False)
  reason=$(echo "$response" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("reason",""))' 2>/dev/null)
  channel=$(echo "$response" | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin).get("channelName") or "")' 2>/dev/null)

  if [[ "$capture" != "True" ]]; then
    log "No capture needed ($reason)."
    echo "$poll"
    return
  fi

  local tmp="/tmp/planetrep-capture.png"
  # -x = no camera sound. Captures the main display.
  if ! /usr/sbin/screencapture -x -t png "$tmp" 2>/dev/null; then
    log "screencapture failed — check System Settings > Privacy & Security > Screen Recording."
    echo "$poll"
    return
  fi

  if curl -fsS --max-time 60 -X POST \
      -H 'Content-Type: image/png' \
      --data-binary "@$tmp" \
      "$SERVER_URL/api/capture?userId=$DISCORD_USER_ID&token=$CAPTURE_TOKEN&host=$(hostname -s)&platform=macos" >/dev/null 2>&1; then
    log "Screenshot taken and uploaded while streaming in '$channel'."
  else
    log "Upload failed."
  fi
  rm -f "$tmp"
  echo "$poll"
}

log "Planet Rep capture agent started (user $DISCORD_USER_ID)."

if [[ "${1:-}" == "--once" ]]; then
  run_cycle > /dev/null
  exit 0
fi

while true; do
  sleep_for=$(run_cycle | tail -1)
  [[ "$sleep_for" =~ ^[0-9]+$ ]] && (( sleep_for >= 60 )) || sleep_for=300
  sleep "$sleep_for"
done
