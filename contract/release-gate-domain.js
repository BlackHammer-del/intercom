const ALLOWED_STATUSES = new Set([
  'drafting',
  'blocked',
  'ready',
  'deployed',
  'cancelled'
])

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeList (items) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) continue
    out.push(value)
    seen.add(value)
  }
  return out
}

export class ReleaseGateDomain {
  constructor () {
    this.releases = new Map()
    this.nextId = 1
  }

  apply (cmd, sender, timestamp) {
    if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'Invalid command JSON' }
    const op = cmd.op
    const ts = Number(timestamp || 0)
    const actor = String(sender || '')
    if (!op) return { ok: false, error: 'Invalid command JSON' }

    switch (op) {
      case 'release_new': return this._releaseNew(cmd, actor, ts)
      case 'release_check': return this._releaseCheck(cmd, actor, ts)
      case 'release_approve': return this._releaseApprove(cmd, actor, ts)
      case 'release_unblock': return this._releaseUnblock(cmd, actor, ts)
      case 'release_deploy': return this._releaseDeploy(cmd, actor, ts)
      case 'release_cancel': return this._releaseCancel(cmd, actor, ts)
      case 'release_list': return this._releaseList(cmd)
      case 'release_state': return this._releaseState(cmd)
      default: return { ok: false, error: `Unknown op: ${op}` }
    }
  }

  isMutatingOp (op) {
    return new Set([
      'release_new',
      'release_check',
      'release_approve',
      'release_unblock',
      'release_deploy',
      'release_cancel'
    ]).has(op)
  }

  _releaseNew (cmd, sender, ts) {
    const service = String(cmd?.service || '').trim()
    const version = String(cmd?.version || '').trim()
    const approvers = normalizeList(cmd?.approvers)
    const checksRaw = Array.isArray(cmd?.checks) ? cmd.checks : []
    const minApprovals = Number.isFinite(Number(cmd?.minApprovals))
      ? Math.max(1, Number(cmd.minApprovals))
      : approvers.length

    if (!service) return { ok: false, error: 'service is required' }
    if (!version) return { ok: false, error: 'version is required' }
    if (approvers.length === 0) return { ok: false, error: 'approvers must contain at least one address' }
    if (checksRaw.length === 0) return { ok: false, error: 'checks must contain at least one item' }
    if (minApprovals > approvers.length) return { ok: false, error: 'minApprovals cannot exceed approvers length' }

    const checks = []
    for (let i = 0; i < checksRaw.length; i++) {
      const title = String(checksRaw[i] || '').trim()
      if (!title) return { ok: false, error: `check ${i + 1} title is empty` }
      checks.push({
        id: `c${i + 1}`,
        title,
        status: 'pending',
        updatedAt: null,
        updatedBy: null,
        note: null
      })
    }

    const releaseId = `release-${ts}-${this.nextId++}`
    const release = {
      releaseId,
      service,
      version,
      owner: sender,
      approvers,
      minApprovals,
      approvals: [],
      checks,
      status: 'drafting',
      deployedAt: null,
      events: [{ at: ts, by: sender, type: 'release_new', note: `${service}@${version}` }]
    }
    this.releases.set(releaseId, release)
    return {
      ok: true,
      releaseId,
      service,
      version,
      status: release.status,
      minApprovals,
      checkCount: checks.length
    }
  }

  _releaseCheck (cmd, sender, ts) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    if (!this._isParticipant(release, sender)) return { ok: false, error: 'Only owner/approvers can update checks' }
    if (release.status === 'deployed' || release.status === 'cancelled') {
      return { ok: false, error: `Cannot update checks in status ${release.status}` }
    }

    const checkId = String(cmd?.checkId || '').trim()
    const status = String(cmd?.status || '').trim()
    const note = String(cmd?.note || '').trim() || null
    if (!checkId) return { ok: false, error: 'checkId is required' }
    if (!['passed', 'failed'].includes(status)) return { ok: false, error: 'status must be passed or failed' }

    const check = release.checks.find(c => c.id === checkId)
    if (!check) return { ok: false, error: `Check ${checkId} not found` }

    check.status = status
    check.updatedAt = ts
    check.updatedBy = sender
    check.note = note
    release.events.push({ at: ts, by: sender, type: 'release_check', note: `${checkId}:${status}` })

    if (status === 'failed') release.status = 'blocked'
    else this._recomputeStatus(release)

    return {
      ok: true,
      releaseId: release.releaseId,
      checkId,
      checkStatus: check.status,
      status: release.status
    }
  }

  _releaseApprove (cmd, sender, ts) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    if (!release.approvers.includes(sender)) return { ok: false, error: 'Only listed approvers can approve' }
    if (release.status === 'deployed' || release.status === 'cancelled') {
      return { ok: false, error: `Cannot approve in status ${release.status}` }
    }

    if (!release.approvals.includes(sender)) {
      release.approvals.push(sender)
      release.events.push({ at: ts, by: sender, type: 'release_approve', note: 'Approval submitted' })
    }
    this._recomputeStatus(release)
    return {
      ok: true,
      releaseId: release.releaseId,
      approvalCount: release.approvals.length,
      minApprovals: release.minApprovals,
      status: release.status
    }
  }

  _releaseUnblock (cmd, sender, ts) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    if (release.owner !== sender) return { ok: false, error: 'Only owner can unblock' }
    if (release.status !== 'blocked') return { ok: false, error: 'Release is not blocked' }

    const reason = String(cmd?.reason || '').trim() || 'Unblocked by owner'
    release.status = 'drafting'
    release.events.push({ at: ts, by: sender, type: 'release_unblock', note: reason })
    this._recomputeStatus(release)
    return { ok: true, releaseId: release.releaseId, status: release.status }
  }

  _releaseDeploy (cmd, sender, ts) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    if (release.owner !== sender) return { ok: false, error: 'Only owner can deploy' }
    if (release.status !== 'ready') return { ok: false, error: `Release must be ready before deploy (current: ${release.status})` }

    release.status = 'deployed'
    release.deployedAt = ts
    release.events.push({ at: ts, by: sender, type: 'release_deploy', note: 'Deployed' })
    return { ok: true, releaseId: release.releaseId, status: release.status, deployedAt: ts }
  }

  _releaseCancel (cmd, sender, ts) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    if (release.owner !== sender) return { ok: false, error: 'Only owner can cancel' }
    if (release.status === 'deployed') return { ok: false, error: 'Cannot cancel deployed release' }

    release.status = 'cancelled'
    release.events.push({ at: ts, by: sender, type: 'release_cancel', note: 'Cancelled by owner' })
    return { ok: true, releaseId: release.releaseId, status: release.status }
  }

  _releaseList (cmd) {
    const filter = String(cmd?.filter || '').trim()
    const actor = String(cmd?.actor || '').trim()
    const items = []

    if (filter && filter !== 'all' && !ALLOWED_STATUSES.has(filter)) return { ok: false, error: `Invalid filter: ${filter}` }

    for (const release of this.releases.values()) {
      if (actor && !this._isParticipant(release, actor)) continue
      if (filter && filter !== 'all' && release.status !== filter) continue
      items.push({
        releaseId: release.releaseId,
        service: release.service,
        version: release.version,
        owner: release.owner,
        status: release.status,
        approvals: release.approvals.length,
        minApprovals: release.minApprovals,
        passedChecks: release.checks.filter(c => c.status === 'passed').length,
        totalChecks: release.checks.length
      })
    }
    return { ok: true, count: items.length, items }
  }

  _releaseState (cmd) {
    const release = this.releases.get(cmd?.releaseId)
    if (!release) return { ok: false, error: `Release ${cmd?.releaseId} not found` }
    return { ok: true, release: clone(release) }
  }

  _isParticipant (release, actor) {
    return release.owner === actor || release.approvers.includes(actor)
  }

  _recomputeStatus (release) {
    if (release.status === 'cancelled' || release.status === 'deployed') return
    const allChecksPassed = release.checks.every(c => c.status === 'passed')
    const enoughApprovals = release.approvals.length >= release.minApprovals
    const anyFailed = release.checks.some(c => c.status === 'failed')
    if (anyFailed) {
      release.status = 'blocked'
      return
    }
    release.status = (allChecksPassed && enoughApprovals) ? 'ready' : 'drafting'
  }

  serialize () {
    return JSON.stringify({
      nextId: this.nextId,
      releases: Array.from(this.releases.entries())
    })
  }

  static deserialize (raw) {
    const domain = new ReleaseGateDomain()
    if (!raw) return domain
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw
      domain.nextId = Number(data?.nextId || 1)
      const rows = Array.isArray(data?.releases) ? data.releases : []
      for (const [id, release] of rows) {
        if (release && typeof release === 'object') domain.releases.set(id, release)
      }
      return domain
    } catch (_) {
      return domain
    }
  }
}
