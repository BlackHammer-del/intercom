import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import PeerWallet from 'trac-wallet'
import { Peer, Wallet, createConfig as createPeerConfig, ENV as PEER_ENV } from 'trac-peer'
import { MainSettlementBus } from 'trac-msb/src/index.js'
import { createConfig as createMsbConfig, ENV as MSB_ENV } from 'trac-msb/src/config/env.js'
import { ensureTextCodecs } from 'trac-peer/src/textCodec.js'
import { getPearRuntime, ensureTrailingSlash } from 'trac-peer/src/runnerArgs.js'
import { Terminal } from 'trac-peer/src/terminal/index.js'
import ReleaseGateProtocol from './protocol.js'
import ReleaseGateContract from './contract.js'
import Sidechannel from './features/sidechannel/index.js'

const { env, storeLabel, flags } = getPearRuntime()

const peerStoreNameRaw = (flags['peer-store-name'] && String(flags['peer-store-name'])) || env.PEER_STORE_NAME || storeLabel || 'peer'
const peerStoresDirectory = ensureTrailingSlash(
  (flags['peer-stores-directory'] && String(flags['peer-stores-directory'])) ||
  env.PEER_STORES_DIRECTORY ||
  'stores/'
)

const msbStoreName =
  (flags['msb-store-name'] && String(flags['msb-store-name'])) ||
  env.MSB_STORE_NAME ||
  `${peerStoreNameRaw}-msb`

const msbStoresDirectory = ensureTrailingSlash(
  (flags['msb-stores-directory'] && String(flags['msb-stores-directory'])) ||
  env.MSB_STORES_DIRECTORY ||
  'stores/'
)

const subnetChannel =
  (flags['subnet-channel'] && String(flags['subnet-channel'])) ||
  env.SUBNET_CHANNEL ||
  'release-gate-v1'

const subnetBootstrapHex =
  (flags['subnet-bootstrap'] && String(flags['subnet-bootstrap'])) ||
  env.SUBNET_BOOTSTRAP ||
  null

const parseCsvList = (raw) => {
  if (!raw) return null
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

const peerDhtBootstrapRaw =
  (flags['peer-dht-bootstrap'] && String(flags['peer-dht-bootstrap'])) ||
  (flags['dht-bootstrap'] && String(flags['dht-bootstrap'])) ||
  env.PEER_DHT_BOOTSTRAP ||
  env.DHT_BOOTSTRAP ||
  ''
const peerDhtBootstrap = parseCsvList(peerDhtBootstrapRaw)

const msbDhtBootstrapRaw =
  (flags['msb-dht-bootstrap'] && String(flags['msb-dht-bootstrap'])) ||
  env.MSB_DHT_BOOTSTRAP ||
  ''
const msbDhtBootstrap = parseCsvList(msbDhtBootstrapRaw)

const readHexFile = (filePath, byteLength) => {
  try {
    if (fs.existsSync(filePath)) {
      const hex = fs.readFileSync(filePath, 'utf8').trim().toLowerCase()
      if (/^[0-9a-f]+$/.test(hex) && hex.length === byteLength * 2) return hex
    }
  } catch (_) {}
  return null
}

const subnetBootstrapFile = path.join(peerStoresDirectory, peerStoreNameRaw, 'subnet-bootstrap.hex')
let subnetBootstrap = subnetBootstrapHex ? subnetBootstrapHex.trim().toLowerCase() : null
if (subnetBootstrap && !/^[0-9a-f]{64}$/.test(subnetBootstrap)) {
  throw new Error('Invalid --subnet-bootstrap. Provide 32-byte hex (64 chars).')
}
if (!subnetBootstrap) subnetBootstrap = readHexFile(subnetBootstrapFile, 32)

const msbOptions = {
  storeName: msbStoreName,
  storesDirectory: msbStoresDirectory,
  enableInteractiveMode: false
}
if (msbDhtBootstrap) msbOptions.dhtBootstrap = msbDhtBootstrap
const msbConfig = createMsbConfig(MSB_ENV.MAINNET, msbOptions)

const effectivePeerDhtBootstrap =
  peerDhtBootstrap ||
  (Array.isArray(msbConfig.dhtBootstrap) && msbConfig.dhtBootstrap.length > 0
    ? msbConfig.dhtBootstrap
    : undefined)

const msbBootstrapHex = b4a.toString(msbConfig.bootstrap, 'hex')
if (subnetBootstrap && subnetBootstrap === msbBootstrapHex) {
  throw new Error('Subnet bootstrap cannot equal MSB bootstrap.')
}

const peerOptions = {
  storesDirectory: peerStoresDirectory,
  storeName: peerStoreNameRaw,
  bootstrap: subnetBootstrap || null,
  channel: subnetChannel,
  enableInteractiveMode: true,
  enableBackgroundTasks: true,
  enableUpdater: true,
  replicate: true
}
if (effectivePeerDhtBootstrap) peerOptions.dhtBootstrap = effectivePeerDhtBootstrap
const peerConfig = createPeerConfig(PEER_ENV.MAINNET, peerOptions)

const ensureKeypairFile = async (keyPairPath) => {
  if (fs.existsSync(keyPairPath)) return
  fs.mkdirSync(path.dirname(keyPairPath), { recursive: true })
  await ensureTextCodecs()
  const wallet = new PeerWallet()
  await wallet.ready
  if (!wallet.secretKey) await wallet.generateKeyPair()
  wallet.exportToFile(keyPairPath, b4a.alloc(0))
}

await ensureKeypairFile(msbConfig.keyPairPath)
await ensureKeypairFile(peerConfig.keyPairPath)

console.log('=============== STARTING MSB ===============')
const msb = new MainSettlementBus(msbConfig)
await msb.ready()

console.log('=============== STARTING PEER ===============')
const peer = new Peer({
  config: peerConfig,
  msb,
  wallet: new Wallet(),
  protocol: ReleaseGateProtocol,
  contract: ReleaseGateContract
})
await peer.ready()

const effectiveSubnetBootstrapHex = peer.base?.key
  ? peer.base.key.toString('hex')
  : b4a.isBuffer(peer.config.bootstrap)
    ? peer.config.bootstrap.toString('hex')
    : String(peer.config.bootstrap ?? '').toLowerCase()

if (!subnetBootstrap) {
  fs.mkdirSync(path.dirname(subnetBootstrapFile), { recursive: true })
  fs.writeFileSync(subnetBootstrapFile, `${effectiveSubnetBootstrapHex}\n`)
}

const sidechannelEntry = '0000release-gate'
const sidechannel = new Sidechannel(peer, {
  channels: [sidechannelEntry],
  entryChannel: sidechannelEntry,
  allowRemoteOpen: true,
  autoJoinOnOpen: true,
  inviteRequired: false,
  welcomeRequired: false
})
peer.sidechannel = sidechannel
await sidechannel.start()

console.log('')
console.log('================ RELEASE GATE ================')
console.log('MSB network bootstrap:', msbBootstrapHex)
console.log('Peer subnet bootstrap:', effectiveSubnetBootstrapHex)
console.log('Peer subnet channel:', subnetChannel)
console.log('Peer pubkey (hex):', peer.wallet.publicKey)
console.log('Peer trac address:', peer.wallet.address ?? null)
console.log('Sidechannel entry:', sidechannelEntry)
console.log('==============================================')
console.log('')
console.log('Use /tx with release_* commands, for example:')
console.log('/tx --command \'{"op":"release_list"}\'')
console.log('')

const terminal = new Terminal(peer)
await terminal.start()
