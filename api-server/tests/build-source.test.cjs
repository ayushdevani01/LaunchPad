const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const crypto = require('node:crypto')
const { Deployment } = require('../dist/src/models/Deployment')
const { Project } = require('../dist/src/models/Project')
const github = require('../dist/src/lib/github-app')
const routes = require('../dist/src/routes/build-source').default

test('clone credential is scoped to one deployment and can be redeemed only once', async t => {
  const previous = { update: Deployment.findOneAndUpdate, project: Project.findById, token: github.installationToken }
  let consumed = false, minted = 0
  const authorization = 'b'.repeat(64), id = 'a'.repeat(24)
  Deployment.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter._id, id)
    assert.deepEqual(filter.status.$in, ['PENDING', 'BUILDING'])
    assert.ok(filter.cloneAuthExpiresAt.$gt instanceof Date)
    if (consumed || filter.cloneAuthHash !== crypto.createHash('sha256').update(authorization).digest('hex')) return null
    consumed = true
    assert.ok(update.$set.cloneAuthConsumedAt instanceof Date)
    return { projectId: 'project' }
  }
  Project.findById = async () => ({ githubInstallationId: 111, githubRepositoryId: 222 })
  github.installationToken = async (installation, repository) => { assert.equal(installation, 111); assert.equal(repository, 222); minted++; return 'fictional-repository-token' }
  const app = express(); app.use('/build-source', routes)
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { Deployment.findOneAndUpdate = previous.update; Project.findById = previous.project; github.installationToken = previous.token; await new Promise(resolve => server.close(resolve)) })
  const send = value => fetch(`http://127.0.0.1:${server.address().port}/build-source/${id}`, { method: 'POST', headers: { authorization: 'Bearer ' + value } })
  assert.equal((await send('wrong')).status, 401)
  const first = await send(authorization)
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await first.json(), { token: 'fictional-repository-token' })
  assert.equal((await send(authorization)).status, 401)
  assert.equal(minted, 1)
})
