import { Protocol } from 'trac-peer'

const ALLOWED_OPS = new Set([
  'release_new',
  'release_check',
  'release_approve',
  'release_unblock',
  'release_deploy',
  'release_cancel',
  'release_list',
  'release_state'
])

const MUTATING_OPS = new Set([
  'release_new',
  'release_check',
  'release_approve',
  'release_unblock',
  'release_deploy',
  'release_cancel'
])

class ReleaseGatePeerProtocol extends Protocol {
  constructor (peer, base, options = {}) {
    super(peer, base, options)
  }

  mapTxCommand (command) {
    const json = this.safeJsonParse(command)
    if (!json || typeof json !== 'object') return null
    if (!ALLOWED_OPS.has(json.op)) return null
    return { type: 'releaseOp', value: json }
  }

  async tx (subject, sim = false, surrogate = null) {
    const result = await super.tx(subject, sim, surrogate)
    if (sim) return result

    const json = this.safeJsonParse(subject?.command || '')
    const op = json?.op
    if (!MUTATING_OPS.has(op)) return result

    const event = await this.get('release_gate_last_event')
    const releaseId = event?.releaseId || json?.releaseId || null
    if (!releaseId) return result

    await this._broadcastReleaseUpdate(releaseId, {
      op,
      status: event?.status || null,
      by: event?.by || null,
      at: event?.at || null
    })
    return result
  }

  async _broadcastReleaseUpdate (releaseId, payload) {
    if (!this.peer.sidechannel) return
    const channel = `release-${releaseId}`
    const joined = await this.peer.sidechannel.addChannel(channel)
    if (!joined) return

    const lines = [
      `Release update: ${payload.op}`,
      `Release: ${releaseId}`
    ]
    if (payload.status) lines.push(`Status: ${payload.status}`)
    if (payload.by) lines.push(`By: ${payload.by}`)
    if (payload.at) lines.push(`At: ${payload.at}`)
    this.peer.sidechannel.broadcast(channel, lines.join('\n'))
  }

  async printOptions () {
    console.log(' ')
    console.log('- Release Gate Commands:')
    console.log('/tx --command \'{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}\'')
    console.log('/tx --command \'{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed","note":"green on CI"}\'')
    console.log('/tx --command \'{"op":"release_approve","releaseId":"<id>"}\'')
    console.log('/tx --command \'{"op":"release_unblock","releaseId":"<id>","reason":"Fix merged"}\'')
    console.log('/tx --command \'{"op":"release_deploy","releaseId":"<id>"}\'')
    console.log('/tx --command \'{"op":"release_state","releaseId":"<id>"}\'')
    console.log('/tx --command \'{"op":"release_list"}\'')
    console.log('/tx --command \'{"op":"release_list","filter":"ready"}\'')
    console.log('/release_join --releaseId "<id>"')
    console.log('/release_ping --releaseId "<id>" --message "optional text"')
  }

  async customCommand (input) {
    await super.tokenizeInput(input)

    if (this.input.startsWith('/release_help')) {
      console.log('Use /tx with release_* ops. Example: /tx --command \'{"op":"release_list"}\'')
      return
    }

    if (this.input.startsWith('/release_join')) {
      if (!this.peer.sidechannel) {
        console.log('Sidechannel not initialized.')
        return
      }
      const args = this.parseArgs(input)
      const releaseId = args.releaseId || args.id
      if (!releaseId) {
        console.log('Usage: /release_join --releaseId "<id>"')
        return
      }
      const channel = `release-${releaseId}`
      const ok = await this.peer.sidechannel.addChannel(channel)
      if (!ok) {
        console.log(`Could not join sidechannel ${channel}`)
        return
      }
      console.log(`Joined sidechannel ${channel}`)
      return
    }

    if (this.input.startsWith('/release_ping')) {
      if (!this.peer.sidechannel) {
        console.log('Sidechannel not initialized.')
        return
      }
      const args = this.parseArgs(input)
      const releaseId = args.releaseId || args.id
      if (!releaseId) {
        console.log('Usage: /release_ping --releaseId "<id>" [--message "<text>"]')
        return
      }
      const channel = `release-${releaseId}`
      const msg = args.message || args.msg || 'ping'
      const ok = await this.peer.sidechannel.addChannel(channel)
      if (!ok) {
        console.log(`Could not join sidechannel ${channel}`)
        return
      }
      this.peer.sidechannel.broadcast(channel, `release ping: ${msg}`)
      console.log(`Pinged ${channel}`)
    }
  }
}

export default ReleaseGatePeerProtocol
