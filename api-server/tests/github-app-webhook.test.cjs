const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const express = require('express')
const { validWebhookSignature, watchedChange, normalizeWebhook } = require('../dist/src/lib/github-webhook')
const { GitHubDelivery } = require('../dist/src/models/GitHubConnection')
const { appUserToken, repositoryFromURL } = require('../dist/src/lib/github-app')
const { repositoryAccess } = require('../dist/src/lib/github-app')
const axios = require('axios').default
const routes = require('../dist/src/routes/github-webhook').default

test('push signatures authenticate the exact bytes and reject missing, malformed or modified payloads', () => {
  const body = Buffer.from('{ "hello": "world" }')
  const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex')
  assert.equal(validWebhookSignature(body, signature, 'test-secret'), true)
  assert.equal(validWebhookSignature(Buffer.from('{"hello":"world"}'), signature, 'test-secret'), false)
  for (const value of ['', 'sha1=abc', 'sha256=00', 'sha256=' + 'z'.repeat(64)]) assert.equal(validWebhookSignature(body, value, 'test-secret'), false)
})

test('watch paths respect directory boundaries and include lockfiles and shared packages', () => {
  assert.equal(watchedChange(['apps/web/page.tsx'], 'apps/web'), true)
  assert.equal(watchedChange(['apps/web-old/page.tsx'], 'apps/web'), false)
  assert.equal(watchedChange(['apps/docs/index.md'], 'apps/web'), false)
  assert.equal(watchedChange(['pnpm-lock.yaml'], 'apps/web'), true)
  assert.equal(watchedChange(['packages/ui/button.tsx'], 'apps/web'), true)
  assert.equal(watchedChange(['shared/site.json'], 'apps/web', ['shared']), true)
  assert.equal(watchedChange(['README.md'], ''), true)
})

test('legacy OAuth tokens cannot be used as a private-repository fallback', async () => {
  await assert.rejects(appUserToken({ githubToken: 'legacy-token' }), /Sign in with the LaunchPad GitHub App/)
  assert.deepEqual(repositoryFromURL('https://github.com/owner/my.repo.git'), { owner: 'owner', repo: 'my.repo' })
  for (const url of ['http://github.com/o/r', 'https://github.com/o/r/tree/main', 'https://github.com/o/r?token=x', 'https://evil.test/o/r']) assert.throws(() => repositoryFromURL(url))
})

test('public URL deployments remain anonymous and do not reuse a broad legacy token', async t => {
  const previous = axios.get
  t.after(() => { axios.get = previous })
  axios.get = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/public/repo')
    assert.equal(options.headers.Authorization, undefined)
    return { data: { id: 123, private: false } }
  }
  const access = await repositoryAccess({ githubTokenKind: 'oauth', githubToken: 'legacy-broad-token' }, 'public', 'repo')
  assert.equal(access.token, ''); assert.equal(access.installationId, undefined)
})

test('webhook persists a compact receipt before acknowledging, deduplicates retries and rejects invalid signatures', async t => {
  const previous = GitHubDelivery.create
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  process.env.GITHUB_WEBHOOK_SECRET = 'webhook-test-secret'
  const receipts = new Map()
  GitHubDelivery.create = async receipt => {
    if (receipts.has(receipt.deliveryId)) throw { code: 11000 }
    receipts.set(receipt.deliveryId, receipt)
  }
  const app = express()
  app.use('/webhooks', routes) // Raw route precedes JSON parsing.
  app.use(express.json())
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { GitHubDelivery.create = previous; if (secret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET; else process.env.GITHUB_WEBHOOK_SECRET = secret; await new Promise(resolve => server.close(resolve)) })
  const payload = { installation: { id: 123 }, repository: { id: 456 }, ref: 'refs/heads/feature/ui', after: 'a'.repeat(40), before: 'b'.repeat(40), commits: [{ message: 'Private commit message' }] }
  const body = JSON.stringify(payload)
  const headers = { 'content-type': 'application/json', 'x-github-event': 'push', 'x-github-delivery': 'delivery-123', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex') }
  const send = (h = headers) => fetch(`http://127.0.0.1:${server.address().port}/webhooks/github`, { method: 'POST', headers: h, body })
  assert.equal((await send()).status, 202)
  assert.equal((await send()).status, 202)
  assert.equal(receipts.size, 1)
  assert.deepEqual(receipts.get('delivery-123').payload, normalizeWebhook('push', payload))
  assert.equal(JSON.stringify(receipts.get('delivery-123')).includes('Private commit'), false)
  assert.equal((await send({ ...headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).status, 401)
  GitHubDelivery.create = async () => { throw Error('database offline') }
  assert.equal((await send({ ...headers, 'x-github-delivery': 'new-delivery' })).status, 503)
})
