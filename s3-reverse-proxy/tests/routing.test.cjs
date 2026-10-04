const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { Readable } = require('node:stream')
const { createApp } = require('../dist/app')

const runtime = { target: 'nextjs-lambda', region: 'us-east-1', serverFunction: 'lp-demo-deployment-server', imageFunction: 'lp-demo-deployment-image', publicFiles: ['/public-check.txt'] }
function setup(t, overrides = {}) {
  const calls = { assets: [], invocations: [] }
  const deps = {
    resolve: async () => ({ slug: 'demo', deploymentId: 'deployment', runtime }),
    asset: async key => { calls.assets.push(key); return { body: Readable.from('static-ok'), contentType: 'text/plain', cacheControl: 'public, max-age=31536000, immutable' } },
    invoke: async (name, region, event) => { calls.invocations.push({ name, region, event }); return Buffer.from(JSON.stringify({ statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'runtime-ok', cookies: ['one=1; Path=/', 'two=2; Path=/'] })) },
    ...overrides
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

test('SSR, API and Next data routes reach the Lambda handler', async t => {
  const { request, calls } = setup(t)
  for (const path of ['/', '/api/items?value=a%20b', '/_next/data/build-id/page.json']) assert.equal((await request(path)).body.toString(), 'runtime-ok')
  assert.equal(calls.assets.length, 0)
  assert.equal(calls.invocations[1].event.rawQueryString, 'value=a%20b')
})
test('POST preserves binary-safe body, viewer auth, cookies and Server Action origin', async t => {
  const { request, calls } = setup(t)
  const body = Buffer.from('body 🌏 & data')
  const res = await request('/api/echo', { method: 'POST', body, headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer test-value', origin: 'https://demo.launch-pad.dev', 'x-forwarded-proto': 'https', cookie: 'session=1; app=2' } })
  const event = calls.invocations[0].event
  assert.equal(Buffer.from(event.body, 'base64').toString(), body.toString())
  assert.equal(event.headers.authorization, 'Bearer test-value')
  assert.equal(event.headers['x-forwarded-host'], 'demo.launch-pad.dev')
  assert.equal(event.headers.origin, 'https://demo.launch-pad.dev')
  assert.deepEqual(event.cookies, ['session=1', 'app=2'])
  assert.equal(res.headers['set-cookie'].length, 2)
})
test('static assets use the deployment prefix while image requests use their handler', async t => {
  const { request, calls } = setup(t)
  await request('/_next/static/chunk.js'); await request('/public-check.txt'); await request('/_next/image?url=%2Fphoto.png&w=64&q=75')
  assert.deepEqual(calls.assets, ['__outputs/demo/deployment/_next/static/chunk.js', '__outputs/demo/deployment/public-check.txt'])
  assert.equal(calls.invocations[0].name, 'lp-demo-deployment-image')
})
test('missing Next assets and API responses never get a SPA fallback', async t => {
  const { request } = setup(t, {
    asset: async () => { throw Object.assign(new Error(), { name: 'NoSuchKey' }) },
    invoke: async () => Buffer.from(JSON.stringify({ statusCode: 404, body: 'api-not-found' }))
  })
  assert.equal((await request('/_next/static/missing.js', { headers: { accept: 'text/html' } })).status, 404)
  const missing = await request('/api/missing', { headers: { accept: 'text/html' } })
  assert.equal(missing.status, 404); assert.equal(missing.body.toString(), 'api-not-found')
})
test('static deployments retain HTML navigation fallback and GET-only asset access', async t => {
  const keys = []
  const { request } = setup(t, { resolve: async () => ({ slug: 'demo', deploymentId: 'old-static' }), asset: async key => {
    keys.push(key); if (!key.endsWith('/index.html')) throw Object.assign(new Error(), { name: 'NoSuchKey' })
    return { body: Readable.from('<html>static app</html>'), contentType: 'text/html' }
  } })
  assert.equal((await request('/dashboard', { headers: { accept: 'text/html' } })).body.toString(), '<html>static app</html>')
  assert.deepEqual(keys, ['__outputs/demo/old-static/dashboard', '__outputs/demo/old-static/index.html'])
  assert.equal((await request('/', { method: 'POST' })).status, 405)
})
test('binary runtime responses survive the proxy', async t => {
  const binary = Buffer.from([0, 255, 3, 128])
  const { request } = setup(t, { invoke: async () => Buffer.from(JSON.stringify({ statusCode: 200, body: binary.toString('base64'), isBase64Encoded: true })) })
  assert.deepEqual((await request('/binary')).body, binary)
})
