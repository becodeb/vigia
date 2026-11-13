#!/usr/bin/env bash
# Installs the vigia home agent (Linux/macOS) for the current user: config + cron every 5 minutes.
# Usage: ./install-linux.sh https://vigia.example.com TOKEN [192.168.1.37]
set -eu
[ $# -ge 2 ] || { echo "usage: $0 URL TOKEN [PI_LAN_IP]" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
conf="$HOME/.config/vigia"
mkdir -p "$bin" "$conf"
install -m 755 "$here/vigia-home.sh" "$bin/vigia-home.sh"
umask 077
printf 'VIGIA_URL=%s\nVIGIA_HOME_TOKEN=%s\nPI_LAN_IP=%s\n' "$1" "$2" "${3:-192.168.1.37}" > "$conf/home.env"
chmod 600 "$conf/home.env"

line="*/5 * * * * $bin/vigia-home.sh"
( crontab -l 2> /dev/null | grep -vF 'vigia-home.sh' || true; echo "$line" ) | crontab -
echo "Installed. Cron line: $line"
echo "Remove with: crontab -l | grep -vF vigia-home.sh | crontab -; rm -f $bin/vigia-home.sh $conf/home.env"
