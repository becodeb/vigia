#!/usr/bin/env bash
# vigia home agent for Linux/macOS (bash + curl). Run from cron; nothing stays resident.
# Config: ~/.config/vigia/home.env with VIGIA_URL, VIGIA_HOME_TOKEN, PI_LAN_IP
set -u
CONF="${VIGIA_CONF:-$HOME/.config/vigia/home.env}"
[ -r "$CONF" ] || exit 0
set -a; . "$CONF"; set +a
[ -n "${VIGIA_URL:-}" ] && [ -n "${VIGIA_HOME_TOKEN:-}" ] && [ -n "${PI_LAN_IP:-}" ] || exit 0

if [ "$(uname)" = Darwin ]; then PING_W=1000; else PING_W=1; fi
tcp() {
  if command -v timeout > /dev/null 2>&1; then
    timeout 2 bash -c "</dev/tcp/$PI_LAN_IP/$1" > /dev/null 2>&1
  elif command -v nc > /dev/null 2>&1; then
    nc -z -w 2 "$PI_LAN_IP" "$1" > /dev/null 2>&1
  else
    return 1
  fi
}
yn() { if "$@" > /dev/null 2>&1; then echo true; else echo false; fi; }
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'; }

ping_ok="$(yn ping -c1 -W"$PING_W" "$PI_LAN_IP")"
ssh_ok="$(yn tcp 22)"
https_ok="$(yn tcp 443)"
body="{\"host\":\"$(esc "$(hostname)")\",\"os\":\"$(esc "$(uname -sr)")\",\"lanPiPing\":$ping_ok,\"lanPiSsh\":$ssh_ok,\"lanPiHttps\":$https_ok,\"piLanIp\":\"$(esc "$PI_LAN_IP")\"}"

printf 'header = "Authorization: Bearer %s"\n' "$VIGIA_HOME_TOKEN" |
  curl -s -o /dev/null --max-time 8 -K - -X POST -H 'Content-Type: application/json' -d "$body" "${VIGIA_URL%/}/api/home/heartbeat" || true
exit 0
