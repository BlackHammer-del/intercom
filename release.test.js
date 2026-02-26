import assert from 'node:assert/strict'
import { ReleaseGateDomain } from './contract/release-gate-domain.js'

function run () {
  const c = new ReleaseGateDomain()

  const created = c.apply({
    op: 'release_new',
    service: 'api-gateway',
    version: 'v1.4.2',
    approvers: ['qa', 'sec'],
    minApprovals: 2,
    checks: ['unit-tests', 'integration-tests', 'smoke-prod']
  }, 'owner', 1000)
  assert.equal(created.ok, true)
  assert.equal(created.status, 'drafting')
  const id = created.releaseId

  const check1 = c.apply({ op: 'release_check', releaseId: id, checkId: 'c1', status: 'passed' }, 'qa', 1001)
  assert.equal(check1.ok, true)
  assert.equal(check1.status, 'drafting')

  const failed = c.apply({ op: 'release_check', releaseId: id, checkId: 'c2', status: 'failed', note: 'timeout' }, 'sec', 1002)
  assert.equal(failed.ok, true)
  assert.equal(failed.status, 'blocked')

  const unblock = c.apply({ op: 'release_unblock', releaseId: id, reason: 'fix merged' }, 'owner', 1003)
  assert.equal(unblock.ok, true)

  const c2Pass = c.apply({ op: 'release_check', releaseId: id, checkId: 'c2', status: 'passed' }, 'sec', 1004)
  assert.equal(c2Pass.ok, true)

  const c3Pass = c.apply({ op: 'release_check', releaseId: id, checkId: 'c3', status: 'passed' }, 'owner', 1005)
  assert.equal(c3Pass.ok, true)

  const a1 = c.apply({ op: 'release_approve', releaseId: id }, 'qa', 1006)
  assert.equal(a1.ok, true)
  assert.equal(a1.status, 'drafting')

  const a2 = c.apply({ op: 'release_approve', releaseId: id }, 'sec', 1007)
  assert.equal(a2.ok, true)
  assert.equal(a2.status, 'ready')

  const deploy = c.apply({ op: 'release_deploy', releaseId: id }, 'owner', 1008)
  assert.equal(deploy.ok, true)
  assert.equal(deploy.status, 'deployed')

  const state = c.apply({ op: 'release_state', releaseId: id }, 'owner', 1009)
  assert.equal(state.ok, true)
  assert.equal(state.release.status, 'deployed')
}

run()
console.log('release.test.js: all tests passed')
