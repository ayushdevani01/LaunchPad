// Real worker -> Redis -> authenticated Socket.IO client, using an isolated
// Mongo database and a small S3 protocol fixture. No AWS resources are created.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const serviceRequire = createRequire(path.join(root, 'logs-service/package.json'))
const frontendRequire = createRequire(path.join(root, 'web/package.json'))
const mongoose = serviceRequire('mongoose')
const jwt = serviceRequire('jsonwebtoken')
const { io } = frontendRequire('socket.io-client')
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const event = (socket, name, timeout = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Timed out waiting for ${name}`)) }, timeout)
  function receive(value) { clearTimeout(timer); resolve(value) }
  socket.once(name, receive)
})
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
function decodeBody(raw, headers) {
  if (!String(headers['content-encoding'] || '').includes('aws-chunked')) return raw
  const pieces = []; let offset = 0
  while (offset < raw.length) {
    const end = raw.indexOf('\r\n', offset); if (end < 0) throw new Error('Invalid S3 fixture chunk')
    const size = parseInt(raw.subarray(offset, end).toString().split(';')[0], 16)
    if (!size) break
    pieces.push(raw.subarray(end + 2, end + 2 + size)); offset = end + 2 + size + 2
  }
  return Buffer.concat(pieces)
}

async function main() {
  const suffix = String(process.pid)
  const network = `launchpad-worker-smoke-${suffix}`
  const names = { redis: `${network}-redis`, mongo: `${network}-mongo`, worker: `${network}-worker` }
  const tempRoot = fs.realpathSync(os.tmpdir())
  const job = fs.mkdtempSync(path.join(tempRoot, 'launchpad-worker-smoke-'))
  const fixture = path.join(job, 'repository'); fs.mkdirSync(fixture)
  const objects = new Map(); const sockets = []; let child; let database
  const s3 = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      if (req.method !== 'PUT') { res.writeHead(404); return res.end() }
      objects.set(decodeURIComponent(req.url.split('?')[0]), decodeBody(Buffer.concat(chunks), req.headers))
      res.writeHead(200, { ETag: '"fixture"', 'x-amz-request-id': 'fixture' }); res.end()
    })
  })
  try {
    fs.writeFileSync(path.join(fixture, 'index.html'), '<html><body>launchpad-worker-ok</body></html>')
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
      name: 'launchpad-log-pipeline-fixture', version: '1.0.0', private: true,
      scripts: {
        postinstall: 'node -e "console.log(\'install stdout marker\'); console.error(\'install stderr marker\')"',
        build: 'node -e "console.log(\'build stdout marker\'); console.error(\'build stderr marker\')"'
      }
    }))
    fs.writeFileSync(path.join(fixture, '.env'), 'THIS_IS_A_TEST_PRIVATE_FILE=must-not-be-public\n')
    for (const args of [['init', '--initial-branch=main'], ['add', '.'], ['-c', 'user.name=LaunchPad Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Local static fixture']]) execFileSync('git', args, { cwd: fixture, stdio: 'ignore' })
    const gitConfig = path.join(job, 'safe.gitconfig')
    fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = /fixture/.git\n')
    const redisPort = await freePort(), mongoPort = await freePort(), socketPort = await freePort()
    docker('network', 'create', network)
    docker('run', '--detach', '--name', names.redis, '--network', network, '-p', `127.0.0.1:${redisPort}:6379`, process.env.REDIS_TEST_IMAGE || 'mirror.gcr.io/library/redis:7-alpine')
    docker('run', '--detach', '--name', names.mongo, '-p', `127.0.0.1:${mongoPort}:27017`, 'mongo:7')
    const databaseURL = `mongodb://127.0.0.1:${mongoPort}/launchpad_worker_smoke`
    await mongoose.connect(databaseURL, { serverSelectionTimeoutMS: 20000 }); database = mongoose.connection
    const projectId = new mongoose.Types.ObjectId(), deploymentId = new mongoose.Types.ObjectId(), userId = new mongoose.Types.ObjectId()
    await database.collection('projects').insertOne({ _id: projectId, slug: 'worker-smoke', userId })
    await database.collection('deployments').insertOne({ _id: deploymentId, projectId, createdAt: new Date() })
    const jwtKey = 'ephemeral-local-test-signing-key'
    let serviceOutput = ''
    child = spawn(process.execPath, ['dist/index.js'], { cwd: path.join(root, 'logs-service'), env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${redisPort}`, MONGODB_URI: databaseURL, SOCKET_PORT: String(socketPort), JWT_SECRET: jwtKey }, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { serviceOutput = (serviceOutput + b).slice(-8000) })
    for (let i = 0; i < 100 && !serviceOutput.includes('Logs service connected to MongoDB'); i++) await wait(100)
    assert.match(serviceOutput, /Logs service connected to MongoDB/)
    function client(owner = userId) { const socket = io(`http://127.0.0.1:${socketPort}`, { transports: ['websocket'], auth: { token: jwt.sign({ userId: owner.toString() }, jwtKey) }, reconnection: false }); sockets.push(socket); return socket }
    const channel = `logs:worker-smoke:${deploymentId}`
    const socket = client(); const live = new Map(); socket.on('message', raw => { const value = JSON.parse(raw); live.set(value.id, value) })
    await event(socket, 'connect'); const subscribed = event(socket, 'subscribed'); socket.emit('subscribe', channel); await subscribed
    await new Promise(resolve => s3.listen(0, '0.0.0.0', resolve))
    const env = { CLIENT_PROJECT_ID: 'worker-smoke', DEPLOYMENT_ID: deploymentId.toString(), GIT_REPOSITORY__URL: '/fixture', BRANCH: 'main', DEPLOYMENT_TARGET: 'static', BUILD_OUTPUT_DIR: '.',
      AWS_REGION: 'us-east-1', AWS_BUCKET_NAME: 'test-assets', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_EC2_METADATA_DISABLED: 'true',
      AWS_ENDPOINT: `http://host.docker.internal:${s3.address().port}`, REDIS_URL: `redis://${names.redis}:6379`, USER_ENV_VARS: '{}',
      GIT_CONFIG_GLOBAL: '/test.gitconfig' }
    const args = ['run', '--rm', '--name', names.worker, '--network', network, '-v', `${fixture}:/fixture:ro`, '-v', `${gitConfig}:/test.gitconfig:ro`, ...Object.keys(env).flatMap(key => ['--env', key]), process.env.BUILD_SERVER_IMAGE || 'launchpad-build-server:go']
    const worker = spawn('docker', args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; for (const stream of [worker.stdout, worker.stderr]) stream.on('data', b => { output = (output + b).slice(-16000) })
    const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => { worker.kill(); reject(new Error('Worker smoke test timed out')) }, 45000); worker.on('exit', code => { clearTimeout(timer); resolve(code) }); worker.on('error', reject) })
    assert.equal(code, 0, output)
    const prefix = `/test-assets/__outputs/worker-smoke/${deploymentId}`
    assert.match(objects.get(`${prefix}/index.html`).toString(), /launchpad-worker-ok/)
    assert.equal(objects.has(`${prefix}/.env`), false)
    assert.equal(objects.has(`${prefix}/.git/config`), false)
    const result = JSON.parse(objects.get(`/test-assets/__deployments/worker-smoke/${deploymentId}/result.json`).toString())
    assert.equal(result.status, 'SUCCESS'); assert.equal(result.manifest.target, 'static')
    const archive = objects.get(`/test-assets/__logs/worker-smoke/${deploymentId}/build.log`).toString()
    assert.match(archive, /SUCCESS/)
    for (let i = 0; i < 30 && ![...live.values()].some(e => e.stage === 'finalize'); i++) await wait(100)
    assert.ok([...live.values()].some(e => e.log.includes('SUCCESS')), 'Worker events did not reach the client')
    for (const stage of ['install', 'build']) for (const stream of ['stdout', 'stderr']) {
      const marker = `${stage} ${stream} marker`
      assert.match(archive, new RegExp(marker), `Archive lost ${marker}`)
      assert.ok([...live.values()].some(e => e.stage === stage && e.stream === stream && e.log.includes(marker)), `Live client lost ${marker}`)
    }
    socket.disconnect()
    const replayClient = client(); await event(replayClient, 'connect'); const replayed = event(replayClient, 'history'); replayClient.emit('subscribe', channel)
    const history = (await replayed).map(raw => JSON.parse(raw))
    assert.ok(history.some(e => e.log.includes('SUCCESS')), 'Reconnect lost terminal history')
    for (const stage of ['install', 'build']) for (const stream of ['stdout', 'stderr']) {
      assert.ok(history.some(e => e.stage === stage && e.stream === stream && e.log.includes(`${stage} ${stream} marker`)), `Reconnect lost ${stage} ${stream}`)
    }
    assert.ok(history.every((e, i) => e.sequence === i + 1 && e.deploymentId === deploymentId.toString()))
    const outsider = client(new mongoose.Types.ObjectId()); await event(outsider, 'connect'); const rejected = event(outsider, 'error'); outsider.emit('subscribe', channel)
    assert.match(await rejected, /Unauthorized/)
    console.log(`PASS: Go worker -> Redis -> logs-service -> authenticated client (${live.size} live events, ${history.length} replay events); immutable S3 output and private-file exclusion verified.`)
  } finally {
    for (const socket of sockets) socket.disconnect()
    child?.kill()
    try { docker('rm', '--force', names.worker) } catch {}
    if (database) { await database.dropDatabase(); await mongoose.disconnect() }
    if (s3.listening) await new Promise(resolve => s3.close(resolve))
    for (const name of Object.values(names)) { try { docker('rm', '--force', name) } catch {} }
    try { docker('network', 'rm', network) } catch {}
    const resolved = fs.realpathSync(job)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('launchpad-worker-smoke-')) throw new Error('Unsafe temporary cleanup path')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
