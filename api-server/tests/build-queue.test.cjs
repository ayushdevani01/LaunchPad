const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Deployment } = require('../dist/src/models/Deployment')
const { Project } = require('../dist/src/models/Project')
const { parseBuildMessage, publishPending, enqueueDeployment } = require('../dist/src/lib/build-queue')
const { triggerBuildTask } = require('../dist/src/lib/build-task')
const { ECSClient, ListTasksCommand } = require('@aws-sdk/client-ecs')

test('Kafka job payloads contain only a version and deployment ID, never credentials', () => {
  assert.deepEqual(parseBuildMessage(JSON.stringify({ version: 1, deploymentId: 'a'.repeat(24) })), { version: 1, deploymentId: 'a'.repeat(24) })
  for (const value of [{ version: 2, deploymentId: 'a'.repeat(24) }, { version: 1, deploymentId: '../secret' }, { version: 1, deploymentId: 'a'.repeat(24), token: 'private' }]) assert.throws(() => parseBuildMessage(JSON.stringify(value)))
})

test('an unavailable broker cannot mark an outbox job published; retry sends the same deployment', async t => {
  const previous = { find: Deployment.findOneAndUpdate, update: Deployment.updateOne, project: Project.updateOne }
  t.after(() => { Deployment.findOneAndUpdate = previous.find; Deployment.updateOne = previous.update; Project.updateOne = previous.project })
  const deployment = { _id: 'b'.repeat(24), projectId: 'project' }
  let published = false, available = true
  Deployment.findOneAndUpdate = async () => { if (!available) return null; available = false; return deployment }
  Deployment.updateOne = async (_, update) => { if (update.$set?.queuePublishedAt) published = true }
  Project.updateOne = async () => ({ modifiedCount: 1 })
  await assert.rejects(publishPending({ send: async () => { throw Error('broker offline') } }), /broker offline/)
  assert.equal(published, false)
  available = true
  let sent
  await publishPending({ send: async value => { sent = value } })
  assert.equal(published, true)
  assert.equal(sent.acks, -1)
  assert.deepEqual(JSON.parse(sent.messages[0].value), { version: 1, deploymentId: deployment._id })
})

test('enqueue accepts a deployment durably without calling ECS and repairs duplicate push requests', async t => {
  const previous = { create: Deployment.create, find: Deployment.findOne, update: Project.updateOne }
  t.after(() => { Deployment.create = previous.create; Deployment.findOne = previous.find; Project.updateOne = previous.update })
  const deployment = { _id: 'd'.repeat(24), projectId: 'project', status: 'PENDING' }
  let value, duplicate = false
  Deployment.create = async input => { value = input; if (duplicate) throw { code: 11000 }; return deployment }
  Deployment.findOne = async () => deployment
  Project.updateOne = async () => ({ modifiedCount: 1 })
  assert.equal(await enqueueDeployment({ _id: 'project' }, 'e'.repeat(40), 'push'), deployment)
  assert.equal(value.status, 'PENDING')
  assert.equal(value.commitHash, 'e'.repeat(40))
  duplicate = true
  assert.equal(await enqueueDeployment({ _id: 'project' }, 'e'.repeat(40), 'push'), deployment)
  await assert.rejects(enqueueDeployment({ _id: 'project' }, 'not-a-sha'), /verified source commit/)
})

test('an uncertain Fargate launch retries the exact persisted request with the same idempotency token', async t => {
  const oldSend = ECSClient.prototype.send, oldUpdate = Deployment.updateOne
  const env = { ...process.env }
  t.after(() => { ECSClient.prototype.send = oldSend; Deployment.updateOne = oldUpdate; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env) })
  Object.assign(process.env, { AWS_ECS_CLUSTER: 'test', AWS_ECS_TASK_DEFINITION: 'test', AWS_ECS_SUBNETS: 'subnet-test', AWS_ECS_SECURITY_GROUPS: 'sg-test', BUILD_REDIS_URL: 'redis://test' })
  const project = { slug: 'test', gitUrl: 'https://github.com/test/test.git' }
  const deployment = { _id: 'a'.repeat(24), commitHash: 'b'.repeat(40) }
  const requests = []
  ECSClient.prototype.send = async command => {
    if (command instanceof ListTasksCommand) return { taskArns: [] }
    requests.push(command.input)
    if (requests.length === 1) throw Error('response lost after AWS accepted the request')
    return { tasks: [{ taskArn: 'arn:test' }] }
  }
  Deployment.updateOne = async () => ({ modifiedCount: 1 })
  await assert.rejects(triggerBuildTask(project, deployment, 'original-one-use-key'))
  process.env.AWS_ECS_TASK_DEFINITION = 'new-revision'
  await triggerBuildTask(project, deployment, 'different-key')
  assert.deepEqual(requests[1], requests[0])
})
