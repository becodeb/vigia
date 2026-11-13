# vigia

Watches the Raspberry Pi at home from an external VPS and tells you, by push notification,
what broke and why: an app, the Pi itself, the network path (DDNS, port forwarding) or the
home internet. The dashboard is an installable PWA.

```
 Raspberry Pi (home)                 VPS (Coolify, vigia.becode.com.ar)           Phone
 cron 1/min: vigia-pi.sh  ─ heartbeat ─►  server (Node 22, JSON state in /data)  ─ web push ─► PWA
   web apps, containers,                   - probes every 60s: HTTPS to each
   agents, systemd, DDNS                     web host, TCP to Pi SSH, DNS of PI_HOST
 Home PCs: every 5 min     ─ heartbeat ─►  - diagnosis + debounced notifications
   can I ping / SSH / HTTPS the Pi?        - dashboard + event log
```

New Pi services are discovered automatically (Coolify API, Traefik rules, docker). Items that
vanish are greyed out with a delete button, and you get one push after 3 missed heartbeats.

## Diagnosis

Pi heartbeat is stale after 3 min, a home heartbeat after 15 min.

| Situation | Level | Code |
|---|---|---|
| Pi fresh, everything ok | ok | `OK` |
| Pi fresh, internal web ok, all web + SSH fail from outside | down | `PATH_BROKEN` (detail says DDNS out of date, or port forwarding/router/ISP) |
| Pi fresh, some items fail on the Pi | warn | `SERVICES_DOWN` |
| Pi fresh, some web apps fail from outside only | warn | `EXTERNAL_PARTIAL` |
| Pi stale, its web apps still answer from outside | warn | `AGENT_SILENT` (agent or cron broken) |
| Pi stale, a home PC is fresh and reaches the Pi in the LAN | down | `PI_NO_INTERNET` |
| Pi stale, a home PC is fresh and cannot reach it | down | `PI_OFF` |
| Pi stale, no home PC reporting | down | `HOME_OFFLINE_OR_UNKNOWN` |

Notifications: an item must fail 2 evaluations in a row, an overall change must hold for 2,
recovery notifies once. One push per evaluation.

## Deploy (Coolify, Docker Compose)

1. Generate keys: `node scripts/gen-vapid.mjs`, and random strings for the tokens
   (`openssl rand -hex 24`).
2. New Coolify resource from this repo using `docker-compose.yml`. Set the domain on service `app`
   (port 3000) and these variables: `DASH_PASSWORD`, `PI_TOKEN`, `HOME_TOKEN`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@example.com`), `PI_HOST`
   (default `mastro.becode.com.ar`), `PI_SSH_PORT` (default 22), `SESSION_SECRET`.
3. Open the site, log in, press "Enable notifications" (on iPhone, add to the home screen first).

State lives in the `vigia-data` volume. Local run: `cd server && npm ci && PORT=3000 DATA_DIR=./data DASH_PASSWORD=x PI_TOKEN=x HOME_TOKEN=y node index.js`.
Tests: `cd server && node --test`.

## Install the agents

**Pi** (needs bash, curl, python3, flock; docker access for the user):

```
agents/pi/install.sh                # copies the script, creates ~/.config/vigia/pi.env, adds the cron line
$EDITOR ~/.config/vigia/pi.env      # VIGIA_URL, VIGIA_PI_TOKEN
VIGIA_DRY=1 ~/.local/bin/vigia-pi.sh   # prints the JSON it would send
```

Optional files in `~/.config/vigia/`: `extra-hosts` (extra web hosts, one per line) and
`ignore-containers` (container names to skip, e.g. stopped dev stacks). Log: `~/.local/share/vigia/pi.log`.

**Home, Windows** (no admin needed), from PowerShell:

```
powershell -ExecutionPolicy Bypass -File agents\home\install-windows.ps1 -Url https://vigia.becode.com.ar -Token <HOME_TOKEN> -PiLanIp 192.168.1.37
```

**Home, Linux/macOS**: `agents/home/install-linux.sh https://vigia.becode.com.ar <HOME_TOKEN> 192.168.1.37`

## Uninstall

- Pi: `crontab -l | grep -vF vigia-pi.sh | crontab -; rm -f ~/.local/bin/vigia-pi.sh; rm -rf ~/.config/vigia ~/.local/share/vigia`
- Windows: `Unregister-ScheduledTask -TaskName vigia-home -Confirm:$false; Remove-Item -Recurse $env:LOCALAPPDATA\vigia`
- Linux/macOS: `crontab -l | grep -vF vigia-home.sh | crontab -; rm -f ~/.local/bin/vigia-home.sh ~/.config/vigia/home.env`
- Server: delete the Coolify resource (and the `vigia-data` volume).
