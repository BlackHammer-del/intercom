export const RELEASE_CHANNEL_PREFIX = 'release-'

export class ReleaseGateProtocol {
  constructor (intercom) {
    this.intercom = intercom
  }

  channelForRelease (releaseId) {
    return `${RELEASE_CHANNEL_PREFIX}${releaseId}`
  }

  async broadcast (releaseId, payload) {
    const channel = this.channelForRelease(releaseId)
    const message = this.formatUpdate(payload)
    try {
      await this.intercom.sideChannelSend(channel, message)
    } catch (_) {}
  }

  formatUpdate (payload) {
    const lines = []
    lines.push(`Release update: ${payload.op}`)
    if (payload.releaseId) lines.push(`Release: ${payload.releaseId}`)
    if (payload.status) lines.push(`Status: ${payload.status}`)
    if (payload.message) lines.push(payload.message)
    if (payload.error) lines.push(`Error: ${payload.error}`)
    return lines.join('\n')
  }

  static help () {
    return `
INTERCOM RELEASE GATE - COMMANDS

Create release gate
/tx --command '{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}'

Set check status
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed","note":"green on CI"}'
/tx --command '{"op":"release_check","releaseId":"<id>","checkId":"c2","status":"failed","note":"timeout in staging"}'

Approve release (only listed approvers)
/tx --command '{"op":"release_approve","releaseId":"<id>"}'

Unblock after fixing failed checks (owner only)
/tx --command '{"op":"release_unblock","releaseId":"<id>","reason":"Patch merged"}'

Deploy when ready (owner only)
/tx --command '{"op":"release_deploy","releaseId":"<id>"}'

Read/list
/tx --command '{"op":"release_state","releaseId":"<id>"}'
/tx --command '{"op":"release_list"}'
/tx --command '{"op":"release_list","filter":"ready"}'

Join live channel
/sc_join --channel "release-<releaseId>"
`
  }
}
