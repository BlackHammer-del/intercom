# Intercom Release Gate

Deterministic release checklist and deployment gate built on the Trac Intercom peer runtime.

This app runs on the real `trac-peer` + `trac-msb` stack and supports:
- release creation (`release_new`)
- checklist updates (`release_check`)
- multi-approver gating (`release_approve`)
- block/unblock flow (`release_unblock`)
- deploy gate (`release_deploy`)
- listing/state queries (`release_list`, `release_state`)

Live updates are published on sidechannels named `release-<releaseId>`.

**Trac Address:** `trac16en65mzfka4vxyaaaup0873fd2p0lyssmuausn00r0ma0g8r2n2sgdsp9j`

## Install

```bash
npm install
```

## Run

Start admin peer:

```bash
pear run --tmp-store --no-pre . --peer-store-name admin --msb-store-name admin-msb --subnet-channel release-gate-v1
```

Start second peer (replace bootstrap with admin's printed subnet bootstrap):

```bash
pear run --tmp-store --no-pre . --peer-store-name peer1 --msb-store-name peer1-msb --subnet-channel release-gate-v1 --subnet-bootstrap <hex>
```

## Commands

Create release:

```bash
/tx --command '{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}'
```

Update checks:

```bash
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed","note":"green on CI"}'
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c2","status":"failed","note":"timeout in staging"}'
```

Approve and deploy:

```bash
/tx --command '{"op":"release_approve","releaseId":"<id>"}'
/tx --command '{"op":"release_unblock","releaseId":"<id>","reason":"Fix merged"}'
/tx --command '{"op":"release_deploy","releaseId":"<id>"}'
```

Read state:

```bash
/tx --command '{"op":"release_state","releaseId":"<id>"}'
/tx --command '{"op":"release_list"}'
/tx --command '{"op":"release_list","filter":"ready"}'
```

Sidechannel helper commands:

```bash
/release_join --releaseId "<id>"
/release_ping --releaseId "<id>" --message "hello"
```

## Tests

```bash
npm test
```

Expected:

```text
release.test.js: all tests passed
```

## Troubleshooting

- If startup fails with dependency errors, run `npm install` again and ensure Git is available on PATH.
- If `--subnet-bootstrap` is rejected, pass a 64-char hex string.
- If a release cannot deploy, verify all checks are `passed` and approval count meets `minApprovals`.

## Iteration Log

1. Detected runtime issue: app booted without `Pear.intercom` and entered local shim mode.
2. Replaced shim bootstrap with real `trac-peer` + `trac-msb` startup path.
3. Moved business logic to pure domain module and wired root peer `contract.js`/`protocol.js`.
4. Added sidechannel runtime and release update broadcasts.
5. Re-ran tests and runtime checks.
