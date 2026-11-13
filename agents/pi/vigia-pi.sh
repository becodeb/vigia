#!/usr/bin/env bash
# vigia Pi agent: collects health data and POSTs it to the vigia server.
# Runs from cron every minute. Nothing stays resident. Set VIGIA_DRY=1 to print the JSON instead of sending it.
set -u

# Hard cap on total runtime
if [ -z "${VIGIA_INNER:-}" ]; then
  VIGIA_INNER=1 exec timeout 35 "$0" "$@"
fi

CONF="${VIGIA_CONF:-$HOME/.config/vigia/pi.env}"
STATE_DIR="$HOME/.local/share/vigia"
LOG="$STATE_DIR/pi.log"
mkdir -p "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"
  if [ "$(wc -l < "$LOG")" -gt 600 ]; then
    tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

exec 9> "$STATE_DIR/pi.lock"
flock -n 9 || exit 0

[ -r "$CONF" ] && { set -a; . "$CONF"; set +a; }
PI_HOST="${PI_HOST:-mastro.becode.com.ar}"
COOLIFY_ENV_FILE="${COOLIFY_ENV_FILE:-$HOME/.credentials/coolify-mastropietro.env}"
DRY="${VIGIA_DRY:-0}"
if [ "$DRY" != 1 ] && { [ -z "${VIGIA_URL:-}" ] || [ -z "${VIGIA_PI_TOKEN:-}" ]; }; then
  log "VIGIA_URL / VIGIA_PI_TOKEN missing in $CONF"
  exit 1
fi

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
: > "$T/items.tsv"
clean() { printf '%s' "$1" | tr '\t\n\r' '   ' | cut -c1-200; }
add_item() { printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$(clean "${5:-}")" >> "$T/items.tsv"; }

# ---------- Coolify API (token is sourced, never printed)
(
  COOLIFY_API_TOKEN=""
  if [ -r "$COOLIFY_ENV_FILE" ]; then set -a; . "$COOLIFY_ENV_FILE"; set +a; fi
  if [ -n "${COOLIFY_API_TOKEN:-}" ]; then
    for ep in applications services; do
      printf 'header = "Authorization: Bearer %s"\n' "$COOLIFY_API_TOKEN" |
        curl -s --max-time 8 -K - "http://localhost:8000/api/v1/$ep" > "$T/coolify_$ep.json" 2>/dev/null || : > "$T/coolify_$ep.json"
    done
  fi
) 

# ---------- docker + traefik sources
if command -v docker > /dev/null 2>&1; then
  docker ps -aq 2> /dev/null | xargs -r docker inspect --format \
    '{{.Name}}{{"\t"}}{{.State.Status}}{{"\t"}}{{if .State.Health}}{{.State.Health.Status}}{{end}}{{"\t"}}{{index .Config.Labels "coolify.resourceName"}}{{"\t"}}{{json .Config.Labels}}' \
    > "$T/containers.tsv" 2> /dev/null
  timeout 8 docker exec coolify-proxy sh -c 'cat /traefik/dynamic/*.yaml /traefik/dynamic/*.yml 2>/dev/null' > "$T/traefik.txt" 2> /dev/null
fi
touch "$T/containers.tsv" "$T/traefik.txt" "$T/coolify_applications.json" "$T/coolify_services.json"
EXTRA="$HOME/.config/vigia/extra-hosts"
[ -r "$EXTRA" ] && cp "$EXTRA" "$T/extra-hosts" || : > "$T/extra-hosts"
# Optional: container names to ignore (one per line), e.g. stopped dev stacks
IGNORE="$HOME/.config/vigia/ignore-containers"
[ -r "$IGNORE" ] && cp "$IGNORE" "$T/ignore-containers" || : > "$T/ignore-containers"

# ---------- parse: hosts to check + container items
python3 - "$T" > "$T/hosts.txt" 2>> "$LOG" <<'PY'
import json, re, sys, os
t = sys.argv[1]
def read(n):
    try:
        return open(os.path.join(t, n), encoding='utf-8', errors='replace').read()
    except OSError:
        return ''
hosts = set()
def add_url(u):
    u = u.strip()
    if not u:
        return
    h = re.sub(r'^[a-z]+://', '', u, flags=re.I).split('/')[0].split(':')[0].strip().lower()
    if (h and '.' in h and not h.endswith('.sslip.io') and h != 'localhost' and not re.search(r'[*{}$ ]', h)
            and not re.fullmatch(r'[\d.]+', h) and re.fullmatch(r'[a-z0-9.-]+', h)):
        hosts.add(h)
def add_rule(s):
    for m in re.finditer(r'Host\(([^)]*)\)', s):
        for h in re.findall(r'`([^`]+)`', m.group(1)):
            add_url(h)
def load(n):
    try:
        return json.loads(read(n))
    except ValueError:
        return None
apps = load('coolify_applications.json')
if isinstance(apps, list):
    for a in apps:
        for u in (a.get('fqdn') or '').split(','):
            add_url(u)
        dcd = a.get('docker_compose_domains')
        if isinstance(dcd, str) and dcd:
            try:
                dcd = json.loads(dcd)
            except ValueError:
                dcd = None
        if isinstance(dcd, dict):
            for v in dcd.values():
                if isinstance(v, dict):
                    for u in str(v.get('domain') or '').split(','):
                        add_url(u)
services = load('coolify_services.json')
if isinstance(services, list):
    for s in services:
        for a in s.get('applications') or []:
            for u in (a.get('fqdn') or '').split(','):
                add_url(u)
add_rule(read('traefik.txt'))
for line in read('extra-hosts').splitlines():
    line = line.split('#')[0].strip()
    if line:
        add_url(line)

# containers
ignore = {l.split('#')[0].strip() for l in read('ignore-containers').splitlines()}
groups = {}
for line in read('containers.tsv').splitlines():
    p = line.split('\t')
    if len(p) < 5:
        continue
    name = p[0].lstrip('/')
    status, health, res, labels = p[1], p[2], p[3], p[4]
    if name.startswith('buildx_buildkit'):
        continue
    stable = res.strip() or re.sub(r'-\d{12,}$', '', name)
    if stable in ignore:
        continue
    groups.setdefault(stable, []).append((status, health))
    if status == 'running':
        try:
            for k, v in json.loads(labels).items():
                if re.fullmatch(r'traefik\.http\.routers\..+\.rule', k):
                    add_rule(v)
        except ValueError:
            pass
with open(os.path.join(t, 'containers.items'), 'w') as f:
    for stable, members in sorted(groups.items()):
        running = [m for m in members if m[0] == 'running']
        if running:
            bad = [m for m in running if m[1] == 'unhealthy']
            ok = len(bad) < len(running)
            detail = 'running' + (f' ({running[0][1]})' if running[0][1] else '')
        else:
            ok = False
            detail = members[0][0]
        f.write('\t'.join(['container', 'container:' + stable, stable, '1' if ok else '0', detail]) + '\n')
print('\n'.join(sorted(hosts)))
PY
[ -s "$T/containers.items" ] && cat "$T/containers.items" >> "$T/items.tsv"

# ---------- web checks in parallel
i=0
while read -r h; do
  [ -z "$h" ] && continue
  i=$((i + 1))
  (
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 8 --resolve "$h:443:127.0.0.1" "https://$h/" 2> /dev/null)"
    code="${code:-000}"
    ok=0
    [ "$code" -ge 100 ] 2> /dev/null && [ "$code" -lt 500 ] && ok=1
    printf 'web\tweb:%s\t%s\t%s\t%s\n' "$h" "$h" "$ok" "$code" > "$T/web.$i"
  ) &
done < "$T/hosts.txt"

# ---------- agents
if pgrep -f "claude remote-control" > /dev/null 2>&1; then ok=1; d="running"; else ok=0; d="not running"; fi
if command -v tmux > /dev/null 2>&1; then
  sess="$(tmux ls -F '#S' 2> /dev/null | tr '\n' ',' | sed 's/,$//')"
  [ -n "$sess" ] && d="$d; tmux: $sess"
fi
add_item agent agent:claude-remote claude-remote "$ok" "$d"
oc="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:4096/ 2> /dev/null)"
oc="${oc:-000}"
if [ "$oc" -ge 100 ] 2> /dev/null && [ "$oc" -lt 500 ]; then ok=1; else ok=0; fi
add_item agent agent:opencode-web opencode-web "$ok" "HTTP $oc"

# ---------- system units
for u in ssh docker tailscaled cron; do
  [ "$(systemctl show -p LoadState --value "$u" 2> /dev/null)" = "not-found" ] && continue
  st="$(systemctl is-active "$u" 2> /dev/null)"
  ok=0; [ "$st" = "active" ] && ok=1
  add_item system "system:$u" "$u" "$ok" "${st:-unknown}"
done

# ---------- public IP (cached 5 min) + ddns
PUBF="$STATE_DIR/publicip"
pub=""
if [ -s "$PUBF" ] && [ $(( $(date +%s) - $(stat -c %Y "$PUBF") )) -lt 300 ]; then pub="$(cat "$PUBF")"; fi
if [ -z "$pub" ]; then
  pub="$(curl -s --max-time 5 https://api.ipify.org 2> /dev/null | grep -E '^[0-9.]+$' | head -1)"
  [ -n "$pub" ] && printf '%s' "$pub" > "$PUBF"
fi
dnsip="$(getent ahostsv4 "$PI_HOST" 2> /dev/null | awk 'NR==1{print $1}')"
if [ -z "$pub" ] || [ -z "$dnsip" ]; then ok=1; d="unknown (public=${pub:-?} dns=${dnsip:-?})"
elif [ "$pub" = "$dnsip" ]; then ok=1; d="$PI_HOST -> $dnsip"
else ok=0; d="DNS $dnsip but public IP is $pub"; fi
add_item ddns ddns:"$PI_HOST" "$PI_HOST" "$ok" "$d"

wait

# ---------- vitals
up="$(awk '{print int($1)}' /proc/uptime)"
load1="$(awk '{print $1}' /proc/loadavg)"
mem="$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{if(t>0)printf "%.1f",(t-a)*100/t}' /proc/meminfo)"
disk="$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}')"
temp=""
[ -r /sys/class/thermal/thermal_zone0/temp ] && temp="$(awk '{printf "%.1f",$1/1000}' /sys/class/thermal/thermal_zone0/temp)"
lan="$(hostname -I 2> /dev/null | awk '{print $1}')"
cat "$T"/web.* >> "$T/items.tsv" 2> /dev/null

# ---------- build JSON (python, never string concatenation)
export V_UP="$up" V_LOAD="$load1" V_MEM="$mem" V_DISK="$disk" V_TEMP="$temp" V_LAN="$lan" V_PUB="$pub" V_HOST="$(hostname)"
python3 - "$T/items.tsv" > "$T/body.json" 2>> "$LOG" <<'PY'
import json, os, sys, time
def num(k):
    try:
        return float(os.environ.get(k, ''))
    except ValueError:
        return None
items, seen = [], set()
for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
    p = line.rstrip('\n').split('\t')
    if len(p) < 5 or p[1] in seen:
        continue
    seen.add(p[1])
    items.append({'id': p[1], 'kind': p[0], 'name': p[2], 'ok': p[3] == '1', 'detail': p[4]})
up = num('V_UP')
print(json.dumps({
    'ts': int(time.time()), 'hostname': os.environ['V_HOST'], 'lanIp': os.environ.get('V_LAN', ''),
    'publicIp': os.environ.get('V_PUB', ''), 'uptimeSec': int(up) if up is not None else None,
    'load1': num('V_LOAD'), 'memUsedPct': num('V_MEM'), 'diskUsedPct': num('V_DISK'), 'tempC': num('V_TEMP'),
    'items': items,
}))
PY

if [ "$DRY" = 1 ]; then
  cat "$T/body.json"
  exit 0
fi
if [ ! -s "$T/body.json" ]; then log "could not build JSON"; exit 1; fi
code="$(printf 'header = "Authorization: Bearer %s"\n' "$VIGIA_PI_TOKEN" |
  curl -s -o "$T/resp" -w '%{http_code}' --max-time 15 -K - -X POST -H 'Content-Type: application/json' \
    --data-binary @"$T/body.json" "${VIGIA_URL%/}/api/pi/heartbeat" 2>&1)"
[ "$code" = 200 ] || log "heartbeat failed: HTTP $code"
exit 0
