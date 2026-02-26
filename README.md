# Intercom Release Gate

P2P release checklist and deployment gate on Trac Intercom.

This app manages software release readiness across peers with:
- checklist status (`passed` / `failed`)
- multi-party approvals
- blocked/unblock workflow
- deployment gating (`ready` required before `deploy`)

All state transitions are deterministic contract updates replicated across peers.

**Trac Address:** `trac16en65mzfka4vxyaaaup0873fd2p0lyssmuausn00r0ma0g8r2n2sgdsp9j`

## Run

Requirements:
- Node.js 22+
- Pear runtime (`npm i -g pear`)

Install:

```bash
npm install
```

Start admin peer:

```bash
pear run --tmp-store --no-pre . --peer-store-name admin --msb-store-name admin-msb --subnet-channel release-gate-v1
```

Join as second peer (with bootstrap hex from admin):

```bash
pear run --tmp-store --no-pre . --peer-store-name peer1 --msb-store-name peer1-msb --subnet-channel release-gate-v1 --subnet-bootstrap <hex>
```

Local-only dev mode (no Pear intercom required):

```bash
node index.js
```

## Commands

Create a release gate:

```bash
/tx --command '{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}'
```

Update check status:

```bash
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed","note":"green on CI"}'
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c2","status":"failed","note":"timeout in staging"}'
```

Approve release:

```bash
/tx --command '{"op":"release_approve","releaseId":"<id>"}'
```

Unblock a blocked release (owner only):

```bash
/tx --command '{"op":"release_unblock","releaseId":"<id>","reason":"Fix merged"}'
```

Deploy when ready (owner only):

```bash
/tx --command '{"op":"release_deploy","releaseId":"<id>"}'
```

State/list:

```bash
/tx --command '{"op":"release_state","releaseId":"<id>"}'
/tx --command '{"op":"release_list"}'
/tx --command '{"op":"release_list","filter":"ready"}'
```

Live sidechannel updates:

```bash
/sc_join --channel "release-<releaseId>"
```

## Proof of Functionality

Run tests:

```bash
npm test
```

Expected output:

```text
release.test.js: all tests passed
```

## Proof of Work

### Environment
- OS: Windows
- Node: `v24.14.0`
- App mode: Local CLI (`node index.js`)

### Automated Test Evidence
Command:

```bash
npm.cmd test
```

Expected output:

```text
release.test.js: all tests passed
```

### Manual End-to-End Evidence
Start:

```bash
node index.js
```

Run these commands in one session:

```text
/tx --sender owner --command '{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}'
/tx --sender qa --command '{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed","note":"unit tests passed"}'
/tx --sender sec --command '{"op":"release_check","releaseId":"<id>","checkId":"c2","status":"passed","note":"integration passed"}'
/tx --sender owner --command '{"op":"release_check","releaseId":"<id>","checkId":"c3","status":"passed","note":"smoke passed"}'
/tx --sender qa --command '{"op":"release_approve","releaseId":"<id>"}'
/tx --sender sec --command '{"op":"release_approve","releaseId":"<id>"}'
/tx --sender owner --command '{"op":"release_deploy","releaseId":"<id>"}'
/tx --sender owner --command '{"op":"release_state","releaseId":"<id>"}'
```

Expected final proof:
- `release_deploy` returns `{ "ok": true, "status": "deployed" }`
- `release_state` returns `"status": "deployed"`

### Video Proof Checklist
Record one continuous clip (30-90s) showing:
1. Repo + README opened.
2. `npm.cmd test` passing.
3. `node index.js` startup.
4. Full command flow above.
5. Final `release_state` with `status: "deployed"`.

Include this commit hash in submission:
- `c6cec42`
