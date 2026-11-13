# vigia: external monitor for the Raspberry Pi

## Objective
Know from outside home whether the Pi apps are up, and when they are not, whether the cause is
the Pi itself (off/hung), its network path (public IP, DDNS, port forwarding) or the home internet.
Push notifications to the phone through an installable PWA.

## Constraints
- Server runs on coolify.becode.com.ar (separate VPS), domain vigia.becode.com.ar.
- Pi and home agents keep no resident process: cron / Task Scheduler + curl/PowerShell.
- New Pi apps/services are discovered automatically (Coolify API, Traefik rules, docker).
- Covers opencode remote and claude remote.

## Tasks
- [ ] T01 Server: heartbeat API, external probes, diagnosis, web push, PWA dashboard (route: delegated writer, trigger: 2+ non-trivial files)
- [ ] T02 Pi agent (bash, cron every minute) with auto-discovery (same writer)
- [ ] T03 Home agents: Windows PowerShell + Task Scheduler, Linux cron (same writer)
- [ ] T04 Deploy on coolify.becode.com.ar, env secrets, domain (inline)
- [ ] T05 Install Pi agent cron, end-to-end check, push subscription test (inline)

## Checks
- `node --test` for diagnosis logic; local run with simulated heartbeats; live check after deploy.
- TDD: off (new project, no config); ordinary functional checks.

## Progress
