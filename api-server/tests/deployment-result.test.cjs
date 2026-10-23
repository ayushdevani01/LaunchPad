const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateResult, publishResult } = require('../dist/src/lib/deployment-result')
const { Deployment } = require('../dist/src/models/Deployment')
const { Project } = require('../dist/src/models/Project')
const { createHash } = require('node:crypto')

function result(id = 'deployment') { return { status: 'SUCCESS', manifest: { version: 2, projectId: 'demo', deploymentId: id, target: 'nextjs-web', assetPrefix: `__outputs/demo/${id}`, region: 'ap-south-1', functionName: `lp-demo-${createHash('sha256').update(id).digest('hex').slice(0, 12)}-web`, endpointUrl: 'https://abcd.b7t.lambda-web.ap-south-1.on.aws', staticPrefixes: ['/_next/static/'] } } }
test('runtime manifests cannot select a different project or asset prefix', () => {
  assert.equal(validateResult(result(), 'demo', 'deployment').status, 'SUCCESS')
  assert.throws(() => validateResult(result(), 'another-project', 'deployment'))
  const invalid = result(); invalid.manifest.assetPrefix = '__artifacts/private'
  assert.throws(() => validateResult(invalid, 'demo', 'deployment'))
  invalid.manifest.assetPrefix = '__outputs/demo/deployment'; invalid.manifest.functionName = 'unrelated-function'
  assert.throws(() => validateResult(invalid, 'demo', 'deployment'))
})
test('runtime endpoints cannot redirect proxy traffic or masquerade as a static SPA', () => {
  for (const endpointUrl of ['http://abcd.b7t.lambda-web.ap-south-1.on.aws', 'https://evil.on.aws', 'https://abcd.b7t.lambda-web.ap-south-1.on.aws.evil.test', 'https://abcd.b7t.lambda-web.ap-south-1.on.aws/other']) {
    const invalid = result(); invalid.manifest.endpointUrl = endpointUrl
    assert.throws(() => validateResult(invalid, 'demo', 'deployment'))
  }
  const invalid = result(); invalid.manifest.staticPrefixes = ['/']
  assert.throws(() => validateResult(invalid, 'demo', 'deployment'))
})
test('an older successful build cannot replace the latest requested deployment', async t => {
  const oldUpdate = Deployment.updateOne, oldProjectUpdate = Project.updateOne
  t.after(() => { Deployment.updateOne = oldUpdate; Project.updateOne = oldProjectUpdate })
  let current = 'previous'; const latest = 'newer'
  Deployment.updateOne = async () => ({ modifiedCount: 1 })
  Project.updateOne = async (filter, update) => { if (filter.latestDeployment === latest) current = update.$set.currentDeployment }
  const client = { send: async command => ({ Body: { transformToString: async () => JSON.stringify(result(command.input.Key.split('/')[2])) } }) }
  const project = { _id: 'project-id', slug: 'demo' }
  await publishResult(client, project, { _id: 'older', status: 'BUILDING' }); assert.equal(current, 'previous')
  await publishResult(client, project, { _id: 'newer', status: 'BUILDING' }); assert.equal(current, 'newer')
  await publishResult(client, project, { _id: 'older', status: 'BUILDING' }); assert.equal(current, 'newer')
})
test('missing private result cannot be replaced by a claimed success', async () => {
  await assert.rejects(() => publishResult({ send: async () => { throw Object.assign(new Error('absent'), { name: 'NoSuchKey' }) } }, { slug: 'demo' }, { _id: 'deployment' }), /absent/)
})
test('terminal failed deployments are not promoted by a later success notification', async t => {
  const oldUpdate = Deployment.updateOne, oldProjectUpdate = Project.updateOne
  t.after(() => { Deployment.updateOne = oldUpdate; Project.updateOne = oldProjectUpdate })
  Deployment.updateOne = async () => ({ modifiedCount: 0 })
  let promotions = 0; Project.updateOne = async () => { promotions++ }
  await publishResult({ send: async () => ({ Body: { transformToString: async () => JSON.stringify(result()) } }) }, { _id: 'project-id', slug: 'demo' }, { _id: 'deployment', status: 'FAILED' })
  assert.equal(promotions, 0)
})
