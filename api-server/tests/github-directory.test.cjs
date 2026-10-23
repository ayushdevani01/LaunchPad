const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const axios = require('axios').default
process.env.JWT_SECRET = 'directory-test-signing-key'
const { signToken } = require('../dist/src/lib/jwt')
const { User } = require('../dist/src/models/User')
const { githubSource, githubContentsUrl } = require('../dist/src/lib/github-source')
const githubApp = require('../dist/src/lib/github-app')
const routes = require('../dist/src/routes/projects').default

async function withAPI(getContents, run) {
  const previousGet = axios.get
  const previousFind = User.findById
  const previousAccess = githubApp.repositoryAccess
  githubApp.repositoryAccess = async () => ({ token: 'fictional-github-token' })
  axios.get = getContents
  User.findById = async () => ({ githubToken: 'fictional-github-token' })
  const app = express()
  app.use('/projects', routes)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = signToken({ userId: 'test-user', email: 'test@example.invalid', username: 'test' })
  const base = `http://127.0.0.1:${server.address().port}/projects/github`
  try {
    await run((path, authenticated = true) => fetch(base + path, {
      headers: authenticated ? { Authorization: `Bearer ${token}` } : {}
    }))
  } finally {
    axios.get = previousGet
    User.findById = previousFind
    githubApp.repositoryAccess = previousAccess
    await new Promise(resolve => server.close(resolve))
  }
}

test('folder API reads only the chosen directory and preserves branch names and spaced paths', async () => {
  let calls = 0
  await withAPI(async (url, options) => {
    calls++
    assert.equal(url, 'https://api.github.com/repos/owner/repo/contents/apps/my%20app')
    assert.equal(options.params.ref, 'feature/ui#next')
    assert.equal(options.timeout, 15000)
    assert.equal(options.headers.Authorization, 'token fictional-github-token')
    return { data: [
      { type: 'file', name: 'package.json', path: 'apps/my app/package.json' },
      { type: 'dir', name: 'src', path: 'apps/my app/src' },
      { type: 'file', name: 'README.md', path: 'apps/my app/README.md' },
      { type: 'dir', name: 'public', path: 'apps/my app/public' }
    ] }
  }, async request => {
    const query = new URLSearchParams({ owner: 'owner', repo: 'repo', branch: 'feature/ui#next', path: 'apps/my app' })
    const response = await request('/tree?' + query)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      path: 'apps/my app',
      hasPackageJson: true,
      truncated: false,
      directories: [
        { name: 'public', path: 'apps/my app/public' },
        { name: 'src', path: 'apps/my app/src' }
      ]
    })
    assert.equal(calls, 1)
    assert.equal((await request('/tree?' + query, false)).status, 401)
    assert.equal(calls, 1)
  })
})

test('folder API handles root manifests, file selection, missing paths and GitHub permission errors', async () => {
  let result = { data: [] }
  await withAPI(async () => {
    if (result.error) throw result.error
    return result
  }, async request => {
    const path = '/tree?owner=owner&repo=repo&branch=main'
    assert.deepEqual(await (await request(path)).json(), {
      path: '', directories: [], hasPackageJson: false, truncated: false
    })
    result = { data: { type: 'file' } }
    assert.equal((await request(path)).status, 400)
    for (const upstream of [404, 409, 403, 429]) {
      result = { error: { response: { status: upstream } } }
      assert.equal((await request(path)).status, upstream === 409 ? 404 : upstream)
    }
  })
})

test('folder API does not cut off repositories with more than 100 subfolders', async () => {
  const data = Array.from({ length: 120 }, (_, index) => ({ type: 'dir', name: `app-${index}`, path: `app-${index}` }))
  await withAPI(async () => ({ data }), async request => {
    const response = await request('/tree?owner=owner&repo=repo')
    assert.equal((await response.json()).directories.length, 120)
  })
})

test('repository paths reject traversal and query arrays before contacting GitHub', async () => {
  const valid = { owner: 'owner', repo: 'repo', branch: 'feature/ui', path: '' }
  for (const path of ['../app', 'apps/../web', 'apps//web', '/app', 'apps/', 'apps\\web', 'apps\nweb']) {
    assert.throws(() => githubSource({ ...valid, path }))
  }
  assert.throws(() => githubSource({ ...valid, branch: ['main', 'other'] }))
  assert.throws(() => githubSource({ ...valid, owner: '../owner' }))
  assert.equal(githubContentsUrl('owner', 'repo', 'apps/my app/package.json'),
    'https://api.github.com/repos/owner/repo/contents/apps/my%20app/package.json')
  await withAPI(async () => { throw new Error('GitHub must not be contacted') }, async request => {
    assert.equal((await request('/tree?owner=owner&repo=repo&path=..%2Fapp')).status, 400)
    assert.equal((await request('/detect?owner=owner&repo=repo&branch=main&branch=other')).status, 400)
  })
})

test('framework detection reads the selected folder on the exact chosen branch', async () => {
  let manifestRead = false
  await withAPI(async (url, options) => {
    assert.equal(options.params.ref, 'feature/new#design')
    if (url.endsWith('/apps/my%20app/package.json')) {
      manifestRead = true
      return { data: { encoding: 'base64', content: Buffer.from(JSON.stringify({ dependencies: { vite: '^6' } })).toString('base64') } }
    }
    throw { response: { status: 404 } }
  }, async request => {
    const query = new URLSearchParams({ owner: 'owner', repo: 'repo', branch: 'feature/new#design', path: 'apps/my app' })
    const response = await request('/detect?' + query)
    assert.equal(response.status, 200)
    assert.equal(manifestRead, true)
    assert.equal((await response.json()).detection.supported, 'YES')
  })
})

test('Node server detection supports Express and Hono without inventing a build command or static folder', async () => {
  for (const dependency of ['express', 'hono']) {
    await withAPI(async () => ({ data: { encoding: 'base64', content: Buffer.from(JSON.stringify({ dependencies: { [dependency]: '1' }, scripts: { start: 'node server.js' } })).toString('base64') } }), async request => {
      const response = await request('/detect?owner=owner&repo=repo&branch=main')
      const { detection } = await response.json()
      assert.equal(detection.supported, 'YES')
      assert.equal(detection.buildCommand, '')
      assert.equal(detection.outputDir, '')
      assert.equal(detection.startCommand, 'node server.js')
    })
  }
})
