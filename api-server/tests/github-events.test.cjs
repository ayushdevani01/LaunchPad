const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Project } = require('../dist/src/models/Project')
const { Deployment } = require('../dist/src/models/Deployment')
const { GitHubDelivery, GitHubInstallation } = require('../dist/src/models/GitHubConnection')
const github = require('../dist/src/lib/github-app')
const queue = require('../dist/src/lib/build-queue')
const { processDelivery } = require('../dist/src/lib/github-events')
const { normalizeWebhook } = require('../dist/src/lib/github-webhook')

test('removed repository access pauses affected projects and restores their reconnect control', async t => {
  const original = Project.updateMany
  t.after(() => { Project.updateMany = original })
  let update
  Project.updateMany = async (filter, change) => { update = { filter, change } }
  const payload = normalizeWebhook('installation_repositories', {
    installation: { id: 111 }, action: 'removed',
    repositories_removed: [{ id: 222 }, { id: 'untrusted' }, { id: -1 }],
  })
  await processDelivery({ event: 'installation_repositories', payload })
  assert.deepEqual(update.filter, { githubInstallationId: 111, githubRepositoryId: { $in: [222] } })
  assert.equal(update.change.$set.autoDeploy, false)
  assert.equal(update.change.$unset.githubInstallationId, 1)
})

test('push routing matches installation, repository, branch and changed paths, with conservative comparison fallback', async t => {
  const originals = { project: Project.find, deployment: Deployment.findById, state: GitHubInstallation.findOne,
    receipt: GitHubDelivery.updateOne, token: github.installationToken, get: github.githubGet, enqueue: queue.enqueueDeployment }
  t.after(() => { Project.find = originals.project; Deployment.findById = originals.deployment; GitHubInstallation.findOne = originals.state;
    GitHubDelivery.updateOne = originals.receipt; github.installationToken = originals.token; github.githubGet = originals.get; queue.enqueueDeployment = originals.enqueue })
  let files = [{ filename: 'apps/docs/readme.md' }], head = 'a'.repeat(40), queued = 0, comparisonFailed = false, saved = 0
  const project = { gitUrl: 'https://github.com/owner/repo.git', sourceDir: 'apps/web', branch: 'feature/ui', currentDeployment: 'previous', watchPaths: [], autoDeploy: true, save: async () => { saved++ } }
  Project.find = async filter => { assert.equal(filter.githubRepositoryId, 222); assert.equal(filter.githubInstallationId, 111); assert.equal(filter.branch, 'feature/ui'); assert.equal(filter.autoDeploy, true); return [project] }
  Deployment.findById = async () => ({ commitHash: 'b'.repeat(40) })
  GitHubInstallation.findOne = async () => null
  GitHubDelivery.updateOne = async () => ({ modifiedCount: 1 })
  github.installationToken = async () => 'fictional-installation-token'
  github.githubGet = async path => {
    if (path.includes('/commits/')) return { sha: head }
    if (comparisonFailed) throw Error('comparison unavailable')
    return { files, status: 'ahead' }
  }
  queue.enqueueDeployment = async (_, sha, trigger) => { assert.equal(sha, 'a'.repeat(40)); assert.equal(trigger, 'push'); queued++ }
  const receipt = { _id: 'receipt', event: 'push', payload: { repositoryId: 222, installationId: 111, ref: 'refs/heads/feature/ui', after: 'a'.repeat(40) } }
  await processDelivery(receipt); assert.equal(queued, 0)
  files = [{ filename: 'apps/web-new/page.tsx' }]; await processDelivery(receipt); assert.equal(queued, 0)
  files = [{ filename: 'apps/docs/page.tsx', previous_filename: 'apps/web/page.tsx' }]; await processDelivery(receipt); assert.equal(queued, 1)
  files = Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}` })); await processDelivery(receipt); assert.equal(queued, 2)
  comparisonFailed = true; await processDelivery(receipt); assert.equal(queued, 3)
  head = 'c'.repeat(40); await processDelivery(receipt); assert.equal(queued, 3)
  await processDelivery({ ...receipt, payload: { ...receipt.payload, deleted: true } }); assert.equal(saved, 1); assert.equal(project.autoDeploy, false)
})
