import { ReleaseGateContract } from './contract/contract.js'
import { ReleaseGateProtocol } from './contract/protocol.js'

const intercom = resolveIntercom()
const devMode = !globalThis?.Pear?.intercom

const rawState = await intercom.getState('release-gate-contract').catch(() => null)
const contract = ReleaseGateContract.deserialize(rawState)
const protocol = new ReleaseGateProtocol(intercom)

intercom.onTransaction(async (tx) => {
  const result = contract.apply(tx)
  await intercom.setState('release-gate-contract', contract.serialize())

  const cmd = typeof tx.command === 'string' ? safeParse(tx.command) : tx.command
  const op = cmd?.op
  const releaseId = cmd?.releaseId || result?.releaseId
  const trackedOps = new Set([
    'release_new',
    'release_check',
    'release_approve',
    'release_unblock',
    'release_deploy',
    'release_cancel'
  ])

  if (releaseId && trackedOps.has(op)) {
    await protocol.broadcast(releaseId, {
      op,
      releaseId,
      status: result?.status,
      message: result?.ok ? 'Applied successfully' : undefined,
      error: result?.ok ? undefined : result?.error
    })
  }

  return result
})

intercom.onSideChannelMessage('release-help', async (_msg, channel) => {
  await intercom.sideChannelSend(channel, ReleaseGateProtocol.help())
})

console.log('')
console.log('Intercom Release Gate ready')
console.log('--------------------------')
console.log('Create gate:')
console.log('/tx --command \'{"op":"release_new","service":"api-gateway","version":"v1.4.2","approvers":["qa","sec"],"minApprovals":2,"checks":["unit-tests","integration-tests","smoke-prod"]}\'')
console.log('')
console.log('Then:')
console.log('/tx --command \'{"op":"release_check","releaseId":"<id>","checkId":"c1","status":"passed"}\'')
console.log('/tx --command \'{"op":"release_approve","releaseId":"<id>"}\'')
console.log('/tx --command \'{"op":"release_deploy","releaseId":"<id>"}\'')
console.log('')
console.log('Help channel: /sc_join --channel "release-help"')
console.log('')

const isBareRuntime = Boolean(globalThis.Bare || process?.versions?.bare)
if (devMode && !isBareRuntime) startLocalCli(intercom)
if (devMode && isBareRuntime) console.log('Pear.intercom is unavailable in this runtime. App is in no-op dev mode.')

function safeParse (text) {
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

function resolveIntercom () {
  const runtimeIntercom = globalThis?.Pear?.intercom
  if (runtimeIntercom) return runtimeIntercom
  return createLocalIntercom()
}

function createLocalIntercom () {
  const state = new Map()
  const txHandlers = []
  const scHandlers = new Map()

  return {
    async getState (key) { return state.has(key) ? state.get(key) : null },
    async setState (key, value) { state.set(key, value) },
    onTransaction (handler) { txHandlers.push(handler) },
    async submitTransaction (tx) {
      const results = []
      for (const handler of txHandlers) results.push(await handler(tx))
      return results[results.length - 1]
    },
    onSideChannelMessage (channel, handler) { scHandlers.set(channel, handler) },
    async sideChannelSend (_channel, _message) {},
    async emitSideChannel (channel, msg) {
      const handler = scHandlers.get(channel)
      if (handler) await handler(msg, channel)
    }
  }
}

async function startLocalCli (shim) {
  console.log('Running in local dev mode (Pear.intercom not available).')
  console.log('Local tx: /tx --sender <address> --command \'<json>\'')
  console.log('Exit: /exit')

  const { default: readline } = await import('node:readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', async (line) => {
    const text = String(line || '').trim()
    if (!text) return
    if (text === '/exit') {
      rl.close()
      process.exit(0)
      return
    }
    if (!text.startsWith('/tx')) {
      console.log('Unknown command')
      return
    }
    const senderMatch = text.match(/--sender\s+("[^"]+"|'[^']+'|\S+)/)
    const commandMatch = text.match(/--command\s+(.+)$/)
    const sender = senderMatch ? unwrap(senderMatch[1]) : 'local-user'
    const rawCommand = commandMatch ? unwrap(commandMatch[1]) : null
    if (!rawCommand) {
      console.log('Usage: /tx --sender <address> --command \'{"op":"release_list"}\'')
      return
    }
    const result = await shim.submitTransaction({
      sender,
      timestamp: Date.now(),
      command: rawCommand
    })
    console.log(JSON.stringify(result, null, 2))
  })
}

function unwrap (value) {
  if (!value) return value
  return value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
}
