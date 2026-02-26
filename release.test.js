import assert from 'node:assert/strict'
import { ReleaseGateContract } from './contract/contract.js'

function run () {
  const c = new ReleaseGateContract()

  const created = c.apply({
    sender: 'owner',
    timestamp: 1000,
    command: JSON.stringify({
      op: 'release_new',
      service: 'api-gateway',
      version: 'v1.4.2',
      approvers: ['qa', 'sec'],
      minApprovals: 2,
      checks: ['unit-tests', 'integration-tests', 'smoke-prod']
    })
  })
  assert.equal(created.ok, true)
  assert.equal(created.status, 'drafting')
  const id = created.releaseId

  const check1 = c.apply({
    sender: 'qa',
    timestamp: 1001,
    command: JSON.stringify({ op: 'release_check', releaseId: id, checkId: 'c1', status: 'passed' })
  })
  assert.equal(check1.ok, true)
  assert.equal(check1.status, 'drafting')

  const failed = c.apply({
    sender: 'sec',
    timestamp: 1002,
    command: JSON.stringify({ op: 'release_check', releaseId: id, checkId: 'c2', status: 'failed', note: 'timeout' })
  })
  assert.equal(failed.ok, true)
  assert.equal(failed.status, 'blocked')

  const unblock = c.apply({
    sender: 'owner',
    timestamp: 1003,
    command: JSON.stringify({ op: 'release_unblock', releaseId: id, reason: 'fix merged' })
  })
  assert.equal(unblock.ok, true)

  const c2Pass = c.apply({
    sender: 'sec',
    timestamp: 1004,
    command: JSON.stringify({ op: 'release_check', releaseId: id, checkId: 'c2', status: 'passed' })
  })
  assert.equal(c2Pass.ok, true)

  const c3Pass = c.apply({
    sender: 'owner',
    timestamp: 1005,
    command: JSON.stringify({ op: 'release_check', releaseId: id, checkId: 'c3', status: 'passed' })
  })
  assert.equal(c3Pass.ok, true)

  const a1 = c.apply({
    sender: 'qa',
    timestamp: 1006,
    command: JSON.stringify({ op: 'release_approve', releaseId: id })
  })
  assert.equal(a1.ok, true)
  assert.equal(a1.status, 'drafting')

  const a2 = c.apply({
    sender: 'sec',
    timestamp: 1007,
    command: JSON.stringify({ op: 'release_approve', releaseId: id })
  })
  assert.equal(a2.ok, true)
  assert.equal(a2.status, 'ready')

  const deploy = c.apply({
    sender: 'owner',
    timestamp: 1008,
    command: JSON.stringify({ op: 'release_deploy', releaseId: id })
  })
  assert.equal(deploy.ok, true)
  assert.equal(deploy.status, 'deployed')

  const state = c.apply({
    sender: 'owner',
    timestamp: 1009,
    command: JSON.stringify({ op: 'release_state', releaseId: id })
  })
  assert.equal(state.ok, true)
  assert.equal(state.release.status, 'deployed')
}

run()
console.log('release.test.js: all tests passed')
