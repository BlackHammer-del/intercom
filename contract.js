import { Contract } from 'trac-peer'
import { ReleaseGateDomain } from './contract/release-gate-domain.js'

const MUTATING_OPS = new Set([
  'release_new',
  'release_check',
  'release_approve',
  'release_unblock',
  'release_deploy',
  'release_cancel'
])

class ReleaseGatePeerContract extends Contract {
  constructor (protocol, options = {}) {
    super(protocol, options)

    this.addSchema('releaseOp', {
      value: {
        $$strict: false,
        $$type: 'object',
        op: { type: 'string', min: 1, max: 64 }
      }
    })
  }

  async releaseOp () {
    const op = this.value?.op
    if (!op) return { ok: false, error: 'Missing op' }

    const raw = await this.get('release_gate_state')
    const domain = ReleaseGateDomain.deserialize(raw)
    const result = domain.apply(this.value, this.address, this.op?.timestamp || 0)

    if (MUTATING_OPS.has(op) && result?.ok) {
      await this.put('release_gate_state', domain.serialize())
      await this.put('release_gate_last_event', {
        op,
        releaseId: result.releaseId || this.value?.releaseId || null,
        status: result.status || null,
        at: this.op?.timestamp || 0,
        by: this.address || null
      })
    }

    return result
  }
}

export default ReleaseGatePeerContract
