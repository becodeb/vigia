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
- [x] T01 Server: heartbeat API, external probes, diagnosis, web push, PWA dashboard (route: delegated writer, trigger: 2+ non-trivial files)
- [x] T02 Pi agent (bash, cron every minute) with auto-discovery (same writer)
- [ ] T03 Home agents: Windows PowerShell + Task Scheduler, Linux cron (same writer)
- [x] T04 Deploy on coolify.becode.com.ar, env secrets, domain (inline)
- [x] T05 Install Pi agent cron, end-to-end check, push subscription test (inline)

## Checks
- `node --test` for diagnosis logic; local run with simulated heartbeats; live check after deploy.
- TDD: off (new project, no config); ordinary functional checks.

## Progress
- T01/T02/T03 written by delegated writer (da83c19, b10dc19); node --test 17/17 pass.
- T04 deployed: Coolify app `vigia` uuid rtkivwgssjwdhxzxmqsuoaup, https://vigia.becode.com.ar, repo becodeb/vigia (public, no auto-deploy).
- T05 Pi cron installed; live: 42 items discovered, external probes from VPS ok except www.ai-router (no DNS).
- T03 pending: PowerShell agent never executed (no pwsh on the Pi); needs a real Windows run. Push not tested end to end (needs a phone subscription).
- Secrets in ~/.credentials/vigia.env.
