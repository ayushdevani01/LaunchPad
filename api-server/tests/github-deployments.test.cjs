const { test } = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')
const github = require('../dist/src/lib/github-app')
const { Deployment } = require('../dist/src/models/Deployment')
const { Project } = require('../dist/src/models/Project')
const { GitHubInstallation } = require('../dist/src/models/GitHubConnection')
const { githubReportFor, reportStates, syncGitHubReport, syncPendingGitHubReports } = require('../dist/src/lib/github-deployments')

function fixture(t) {
  const original = { get: axios.get, post: axios.post, token: github.deploymentReportingToken,
    configured: github.appConfigured, project: Project.findById, update: Deployment.updateOne, claim: Deployment.findOneAndUpdate }
  t.after(() => { axios.get = original.get; axios.post = original.post; github.deploymentReportingToken = original.token;
    github.appConfigured = original.configured; Project.findById = original.project; Deployment.updateOne = original.update; Deployment.findOneAndUpdate = original.claim })
  const project = { _id: 'b'.repeat(24), slug: 'test-site', gitUrl: 'https://github.com/owner/private-repo.git',
    githubInstallationId: 123, githubRepositoryId: 456, latestDeployment: 'a'.repeat(24) }
  const deployment = { _id: 'a'.repeat(24), projectId: project._id, status: 'PENDING', commitHash: 'c'.repeat(40),
    githubReport: { ...githubReportFor(project, 'a'.repeat(24)), leaseToken: 'lease', leaseUntil: new Date(Date.now() + 120000) } }
  const remote = [], statuses = [], writes = []
  let tokenRequests = 0
  github.appConfigured = () => true
  github.deploymentReportingToken = async (installation, repo) => { assert.equal(installation, 123); assert.equal(repo, 456); tokenRequests++; return 'fictional-reporting-token' }
  Project.findById = async () => project
  Deployment.updateOne = async (filter, update) => { assert.equal(filter._id, deployment._id); writes.push(update); return { matchedCount: 1, modifiedCount: 1 } }
  axios.post = async (url, body) => {
    if (url.endsWith('/statuses')) { statuses.unshift(body); return { data: { id: statuses.length } } }
    remote.push({ id: 987, sha: body.ref, payload: body.payload }); return { data: remote[remote.length - 1] }
  }
  axios.get = async url => ({ data: url.endsWith('/statuses') ? statuses : remote })
  return { project, deployment, remote, statuses, writes, tokenRequests: () => tokenRequests }
}

test('report metadata is durable, excludes credentials and gives every project its own environment and exact log URL', () => {
  const report = githubReportFor({ slug: 'my-app', gitUrl: 'https://github.com/owner/repo.git', githubInstallationId: 1, githubRepositoryId: 2 }, 'a'.repeat(24))
  assert.equal(report.environment, 'LaunchPad / my-app')
  assert.equal(new URL(report.logUrl).searchParams.get('deployment'), 'a'.repeat(24))
  assert.equal(report.done, false)
  assert.equal(githubReportFor({ slug: 'public', gitUrl: 'https://github.com/owner/repo.git' }, 'a'.repeat(24)), undefined)
  assert.equal(Object.keys(report).some(key => /token|secret|password/i.test(key)), false)
  const json = new Deployment({ projectId: 'b'.repeat(24), githubReport: report }).toJSON()
  assert.equal(json.githubReport, undefined)
})

test('queued, building and success reports retry independently; old live success is inactivated only after replacement', async t => {
  const f = fixture(t)
  await syncGitHubReport(f.deployment)
  assert.equal(f.remote.length, 1)
  assert.equal(f.statuses[0].state, 'queued')
  f.deployment.status = 'BUILDING'; f.deployment.taskArn = 'arn:test'
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses[0].state, 'in_progress')
  f.deployment.status = 'SUCCESS'; f.project.currentDeployment = f.deployment._id
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses[0].state, 'success')
  f.project.latestDeployment = 'd'.repeat(24)
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses[0].state, 'success', 'another queued or failed build cannot inactivate the live deployment')
  assert.equal(f.tokenRequests(), 3, 'idle checks do not make GitHub API calls')
  f.project.currentDeployment = f.project.latestDeployment
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses[0].state, 'inactive')
  assert.equal(f.deployment.githubReport.done, true)
  assert.deepEqual([...f.statuses].reverse().map(s => s.state), ['queued', 'in_progress', 'success', 'inactive'])
  assert.ok(f.statuses.every(s => s.auto_inactive === false && s.environment_url && s.log_url.includes('deployment=')))
})

test('a verified success waits for the serving pointer before being advertised as live', () => {
  const deployment = { _id: 'new', status: 'SUCCESS', taskArn: 'arn:test' }
  assert.deepEqual(reportStates(deployment, { currentDeployment: 'old', latestDeployment: 'new' }), ['queued', 'in_progress'])
  assert.deepEqual(reportStates(deployment, { currentDeployment: 'old', latestDeployment: 'another' }), ['queued', 'in_progress', 'inactive'])
})

test('a failed build reports failure without promoting code or inactivating the previous environment', async t => {
  const f = fixture(t)
  f.project.currentDeployment = 'previous'
  f.deployment.status = 'FAILED'; f.deployment.taskArn = 'arn:test'
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses[0].state, 'failure')
  assert.equal(f.project.currentDeployment, 'previous')
  assert.equal(f.deployment.githubReport.done, true)
  assert.ok(f.writes.every(w => !JSON.stringify(w).includes('currentDeployment')))
})

test('an uncertain create response is recovered by the unique payload before another deployment is created', async t => {
  const f = fixture(t)
  const post = axios.post; let uncertain = true
  axios.post = async (url, body, config) => {
    const response = await post(url, body, config)
    if (!url.endsWith('/statuses') && uncertain) { uncertain = false; throw Error('response lost after GitHub accepted the deployment') }
    return response
  }
  await assert.rejects(syncGitHubReport(f.deployment), /response lost/)
  assert.equal(f.deployment.githubReport.createAttempted, true)
  await syncGitHubReport(f.deployment)
  assert.equal(f.remote.length, 1)
  assert.equal(f.deployment.githubReport.remoteId, 987)
})

test('an uncertain status response is recovered without repeating the accepted status', async t => {
  const f = fixture(t)
  const post = axios.post; let uncertain = true
  axios.post = async (url, body, config) => {
    const response = await post(url, body, config)
    if (url.endsWith('/statuses') && uncertain) { uncertain = false; throw Error('status response lost') }
    return response
  }
  await assert.rejects(syncGitHubReport(f.deployment), /response lost/)
  await syncGitHubReport(f.deployment)
  assert.equal(f.statuses.length, 1)
  assert.deepEqual(f.deployment.githubReport.sentStates, ['queued'])
})

test('revoked connections and lost reporting leases cannot publish new GitHub data', async t => {
  const f = fixture(t)
  f.project.githubInstallationId = undefined
  await syncGitHubReport(f.deployment)
  assert.equal(f.remote.length, 0)
  assert.equal(f.deployment.githubReport.done, true)
  f.project.githubInstallationId = 123
  Deployment.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 })
  await assert.rejects(syncGitHubReport(f.deployment), /lease expired/)
  assert.equal(f.remote.length, 0)
})

test('GitHub permission/rate-limit errors back off without changing build status or retaining credentials', async t => {
  const f = fixture(t)
  let available = true
  Deployment.findOneAndUpdate = () => ({ select: async () => { if (!available) return null; available = false; return f.deployment } })
  github.deploymentReportingToken = async () => { throw { response: { status: 429, headers: { 'retry-after': '60' } }, config: { headers: { Authorization: 'secret-token' } } } }
  const before = Date.now()
  await syncPendingGitHubReports()
  const retry = f.writes.find(w => w.$set?.['githubReport.lastError'])
  assert.ok(retry.$set['githubReport.nextAttemptAt'].getTime() >= before + 60000)
  assert.match(retry.$set['githubReport.lastError'], /HTTP 429/)
  assert.equal(JSON.stringify(f.writes).includes('secret-token'), false)
  assert.equal(f.deployment.status, 'PENDING')
})

test('reporting tokens grant deployments write for one repository and never grant contents write', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpad-test-app-key-'))
  const keyFile = path.join(directory, 'test.pem')
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  fs.writeFileSync(keyFile, privateKey)
  const env = { ...process.env }, oldPost = axios.post, oldFind = GitHubInstallation.findOne
  t.after(() => { axios.post = oldPost; GitHubInstallation.findOne = oldFind; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); fs.unlinkSync(keyFile); fs.rmdirSync(directory) })
  Object.assign(process.env, { GITHUB_APP_ID: '1', GITHUB_APP_SLUG: 'test', GITHUB_APP_CLIENT_ID: 'test', GITHUB_APP_CLIENT_SECRET: 'fictional', GITHUB_APP_PRIVATE_KEY_PATH: keyFile })
  GitHubInstallation.findOne = async () => null
  const requests = []
  axios.post = async (_, body) => { requests.push(body); return { data: { token: 'fictional' } } }
  await github.deploymentReportingToken(123, 456)
  await github.installationToken(123, 456)
  assert.deepEqual(requests, [{ repository_ids: [456], permissions: { deployments: 'write' } }, { repository_ids: [456], permissions: { contents: 'read' } }])
})
