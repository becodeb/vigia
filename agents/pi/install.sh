#!/usr/bin/env bash
# Installs the vigia Pi agent for the current user: script in ~/.local/bin, config template, cron line (idempotent).
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
conf="$HOME/.config/vigia"
mkdir -p "$bin" "$conf" "$HOME/.local/share/vigia"
install -m 755 "$here/vigia-pi.sh" "$bin/vigia-pi.sh"

if [ ! -f "$conf/pi.env" ]; then
  cat > "$conf/pi.env" <<'CONF'
VIGIA_URL=https://vigia.example.com
VIGIA_PI_TOKEN=change-me
# PI_HOST=mastro.becode.com.ar
# COOLIFY_ENV_FILE=$HOME/.credentials/coolify-mastropietro.env
CONF
  chmod 600 "$conf/pi.env"
  echo "Created $conf/pi.env: edit VIGIA_URL and VIGIA_PI_TOKEN."
fi
[ -f "$conf/extra-hosts" ] || printf '# one extra host per line (optional)\n' > "$conf/extra-hosts"

line="* * * * * $bin/vigia-pi.sh"
( crontab -l 2> /dev/null | grep -vF 'vigia-pi.sh' || true; echo "$line" ) | crontab -
echo "Installed. Cron line: $line"
echo "Test with: VIGIA_DRY=1 $bin/vigia-pi.sh"
echo "Remove with: crontab -l | grep -vF vigia-pi.sh | crontab -; rm -f $bin/vigia-pi.sh"
