#!/bin/bash
# Mac 러너를 launchd에 등록한다 (1시간마다 실행, 로그인 시 1회 실행).
#   설치:  bash scripts/agent/install-launchd.sh
#   제거:  bash scripts/agent/install-launchd.sh --uninstall
#   지금 바로 1회 실행:  launchctl kickstart -k gui/$(id -u)/com.travelscheduling.agent
set -euo pipefail

LABEL="com.travelscheduling.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/travelscheduling-agent.log"
WORKDIR="${AGENT_WORKDIR:-$HOME/agent-work/TravelScheduling}"
INTERVAL="${AGENT_INTERVAL_SECONDS:-3600}"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "제거 완료"
  exit 0
fi

for c in git gh node npm codex; do
  command -v "$c" >/dev/null 2>&1 || { echo "필요한 명령이 없음: $c (설치 후 다시 실행)"; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "gh 로그인이 필요함: gh auth login"; exit 1; }

if [ ! -d "$WORKDIR/.git" ]; then
  mkdir -p "$(dirname "$WORKDIR")"
  gh repo clone "${AGENT_REPO:-minuk1749/TravelScheduling}" "$WORKDIR"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
# launchd는 PATH가 최소한이라 지금 셸의 PATH를 그대로 넘긴다 (node, gh, codex 위치 포함)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>/bin/bash</string>
    <string>-o</string>
    <string>pipefail</string>
    <string>-c</string>
    <string>git -C "\$1" fetch -q origin refs/heads/develop:refs/remotes/origin/develop &amp;&amp; git -C "\$1" show refs/remotes/origin/develop:scripts/agent/local-runner.sh | /bin/bash</string>
    <string>TravelScheduling</string>
    <string>$WORKDIR</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH</string>
    <key>HOME</key><string>$HOME</string>
    <key>AGENT_WORKDIR</key><string>$WORKDIR</string>
  </dict>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "등록 완료: $INTERVAL 초마다 실행"
echo "로그 보기: tail -f $LOG"
