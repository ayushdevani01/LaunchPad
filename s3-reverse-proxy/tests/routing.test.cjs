const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { Readable } = require('node:stream')
const { createApp } = require('../dist/app')
const { viewerHeaders } = require('../dist/web')

const runtime = { target: 'nextjs-web', region: 'ap-south-1', functionName: 'lp-demo-deployment-web', endpointUrl: 'https://abcd.b7t.lambda-web.ap-south-1.on.aws', staticPrefixes: ['/_next/static/'] }
function setup(t, overrides = {}) {
  const calls = { assets: [], forwards: [] }
  const deps = {
    resolve: async () => ({ slug: 'demo', deploymentId: 'deployment', runtime }),
    asset: async key => { calls.assets.push(key); return { body: Readable.from('static-ok'), contentType: 'text/plain', cacheControl: 'public, max-age=31536000, immutable' } },
    forward: async (runtime, req, res) => {
      const body = []; for await (const chunk of req) body.push(chunk)
      calls.forwards.push({ runtime, url: req.originalUrl, headers: viewerHeaders(req, new URL(runtime.endpointUrl).hostname), body: Buffer.concat(body) })
      res.setHeader('set-cookie', ['one=1; Path=/', 'two=2; Path=/']); res.end('runtime-ok')
    }, ...overrides
  }
  const server = createApp(deps).listen(0, '127.0.0.1')
  t.after(() => new Promise(resolve => server.close(resolve)))
  async function request(path, options = {}) {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: options.method || 'GET', headers: { host: 'demo.launch-pad.dev', ...options.headers } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      }); req.on('error', reject); req.end(options.body)
    })
  }
  return { request, calls }
}
test('Next pages, APIs, RSC, images and public files reach one native HTTP server', async t => {
  const { request, calls } = setup(t)
  for (const path of ['/', '/api/items?value=a%20b&value=c', '/_next/data/build/page.json', '/_next/image?url=%2Fphoto.png&w=64&q=75', '/public.txt']) assert.equal((await request(path)).body.toString(), 'runtime-ok')
  assert.equal(calls.assets.length, 0)
  assert.equal(calls.forwards[1].url, '/api/items?value=a%20b&value=c')
})
test('POST streams original bytes and safely forwards viewer auth, cookies and action origin', async t => {
  const { request, calls } = setup(t)
  const body = Buffer.from('body 🌏 & data')
  const res = await request('/api/echo', { method: 'POST', body, headers: { authorization: 'Bearer viewer', 'x-launchpad-authorization': 'spoofed', origin: 'https://demo.launch-pad.dev', 'x-forwarded-proto': 'https', cookie: 'session=1; app=2', 'x-amz-security-token': 'spoofed' } })
  assert.deepEqual(calls.forwards[0].body, body)
  const headers = calls.forwards[0].headers
  assert.equal(headers['x-launchpad-authorization'], 'Bearer viewer')
  assert.equal(headers.authorization, undefined)
  assert.equal(headers['x-amz-security-token'], undefined)
  assert.equal(headers['x-forwarded-host'], 'demo.launch-pad.dev')
  assert.equal(headers.origin, 'https://demo.launch-pad.dev')
  assert.equal(headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD')
  assert.equal(res.headers['set-cookie'].length, 2)
})
test('only immutable Next assets go to private S3 and missing assets never become HTML', async t => {
  const { request, calls } = setup(t, { asset: async key => { calls.assets.push(key); throw Object.assign(new Error(), { name: 'NoSuchKey' }) } })
  assert.equal((await request('/_next/static/missing.js', { headers: { accept: 'text/html' } })).status, 404)
  assert.deepEqual(calls.assets, ['__outputs/demo/deployment/_next/static/missing.js'])
  assert.equal(calls.forwards.length, 0)
})
test('static SPAs use S3 fallback; a Node plus SPA project keeps /api on its Web Function', async t => {
  const combined = { ...runtime, target: 'nodejs-web', staticPrefixes: ['/'] }
  const { request, calls } = setup(t, { resolve: async () => ({ slug: 'demo', deploymentId: 'deployment', runtime: combined }) })
  assert.equal((await request('/')).body.toString(), 'static-ok')
  assert.equal((await request('/api/hello')).body.toString(), 'runtime-ok')
  assert.equal(calls.forwards.length, 1)
})
test('backend-only Node projects route every method and path to their HTTP server', async t => {
  const { request, calls } = setup(t, { resolve: async () => ({ slug: 'demo', deploymentId: 'deployment', runtime: { ...runtime, target: 'nodejs-web', staticPrefixes: [] } }) })
  await request('/hello'); await request('/hello', { method: 'DELETE' })
  assert.equal(calls.forwards.length, 2); assert.equal(calls.assets.length, 0)
})
test('routing refuses arbitrary origins, malformed paths and internal health routes', async t => {
  const { request, calls } = setup(t, { resolve: async () => ({ slug: 'demo', deploymentId: 'deployment', runtime: { ...runtime, endpointUrl: 'https://attacker.on.aws' } }) })
  assert.equal((await request('/api/hello')).status, 503)
  assert.equal((await request('/%2e%2e/private')).status, 400)
  assert.equal((await request('/%zz')).status, 400)
  assert.equal((await request('/.launchpad/health')).status, 404)
  assert.equal(calls.forwards.length, 0)
})
