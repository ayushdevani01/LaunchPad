const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')

test('HTTP request -> Mongo outbox -> real Kafka -> restarted worker -> one Fargate dispatch', { skip: process.env.KAFKA_INTEGRATION !== '1', timeout: 90000 }, async t => {
  const mongoose = require('mongoose')
  const express = require('express')
  const github = require('../dist/src/lib/github-app')
  const { signToken } = require('../dist/src/lib/jwt')
  const { User } = require('../dist/src/models/User')
  const { Project } = require('../dist/src/models/Project')
  const { Deployment } = require('../dist/src/models/Deployment')
  const { kafkaClient, ensureBuildTopic, publishPending, BUILD_TOPIC, BUILD_GROUP } = require('../dist/src/lib/build-queue')
  await mongoose.connect(process.env.MONGODB_URI)
  const projectName = 'queue-integration-' + Date.now()
  const user = await User.create({ email: projectName + '@example.invalid', username: projectName, password: 'fictional-test-password' })
  github.repositoryAccess = async () => ({ token: 'fictional-token', repo: { id: 111, clone_url: 'https://github.com/test/repo.git' }, installationId: 222 })
  github.githubGet = async () => ({ sha: 'a'.repeat(40) })
  const app = express(); app.use(express.json()); app.use('/projects', require('../dist/src/routes/projects').default)
  let busy = true, listCalls = 0, runCalls = 0, taskRequest
  app.post('/internal/builds/:id/source', (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + process.env.WORKER_API_TOKEN) return res.sendStatus(401)
    res.json({ authorization: 'c'.repeat(64) })
  })
  const api = app.listen(0, '0.0.0.0'); await new Promise(resolve => api.once('listening', resolve))
  const ecs = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const action = req.headers['x-amz-target'] || ''
    res.setHeader('Content-Type', 'application/x-amz-json-1.1')
    if (action.endsWith('ListTasks')) { listCalls++; return res.end(JSON.stringify({ taskArns: busy ? ['busy-one', 'busy-two'] : [] })) }
    assert.ok(action.endsWith('RunTask')); runCalls++; taskRequest = JSON.parse(body)
    res.end(JSON.stringify({ tasks: [{ taskArn: 'arn:aws:ecs:ap-south-1:000000000000:task/test/fixture' }] }))
  }).listen(0, '0.0.0.0'); await new Promise(resolve => ecs.once('listening', resolve))
  const kafka = kafkaClient('launchpad-integration')
  await ensureBuildTopic(kafka)
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 }); await producer.connect()
  const admin = kafka.admin(); await admin.connect()
  let worker, workerOutput = ''
  const startWorker = () => {
    worker = spawn(process.execPath, ['dist/worker.js'], { env: { ...process.env,
      INTERNAL_API_URL: `http://127.0.0.1:${api.address().port}`,
      AWS_ECS_ENDPOINT: `http://127.0.0.1:${ecs.address().port}`,
      AWS_ECS_CLUSTER: 'test', AWS_ECS_TASK_DEFINITION: 'test', AWS_ECS_SUBNETS: 'subnet-test', AWS_ECS_SECURITY_GROUPS: 'sg-test', BUILD_MAX_CONCURRENT: '2', BUILD_REDIS_URL: 'redis://fixture-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
    worker.stdout.on('data', data => { workerOutput += data }); worker.stderr.on('data', data => { workerOutput += data })
  }
  const stopWorker = async () => { if (worker && worker.exitCode === null) { const child = worker; child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) } }
  const until = async (condition, label) => {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 150)) }
    throw Error(label + ': ' + workerOutput.slice(-1500))
  }
  t.after(async () => {
    await stopWorker(); await producer.disconnect(); await admin.disconnect()
    await Deployment.deleteMany({ projectId: { $in: (await Project.find({ slug: projectName })).map(p => p._id) } })
    await Project.deleteMany({ slug: projectName }); await User.deleteOne({ _id: user._id }); await mongoose.disconnect()
    await Promise.all([new Promise(resolve => api.close(resolve)), new Promise(resolve => ecs.close(resolve))])
  })
  const token = signToken({ userId: user._id.toString(), email: user.email, username: user.username })
  const response = await fetch(`http://127.0.0.1:${api.address().port}/projects`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ gitURL: 'https://github.com/test/repo', project_name: projectName, branch: 'feature/ui' }) })
  assert.equal(response.status, 202)
  const { data } = await response.json()
  assert.equal(data.deployment.status, 'PENDING')
  assert.equal(runCalls, 0)
  await publishPending(producer)
  startWorker()
  await until(() => listCalls > 0, 'Worker did not read the Kafka job')
  assert.equal((await Deployment.findById(data.deployment._id)).status, 'PENDING')
  assert.equal(runCalls, 0)
  // Kill a consumer with a pending, uncommitted message, then resume it.
  await stopWorker(); busy = false; startWorker()
  await until(async () => (await Deployment.findById(data.deployment._id)).status === 'BUILDING', 'Pending job was not recovered')
  assert.equal(runCalls, 1)
  const variables = Object.fromEntries(taskRequest.overrides.containerOverrides[0].environment.map(v => [v.name, v.value]))
  assert.equal(variables.COMMIT_SHA, 'a'.repeat(40)); assert.ok(!('GITHUB_TOKEN' in variables)); assert.ok(!('AWS_SECRET_ACCESS_KEY' in variables))
  await producer.send({ topic: BUILD_TOPIC, messages: [{ key: data.project._id, value: JSON.stringify({ version: 1, deploymentId: data.deployment._id }) }] })
  await until(async () => {
    const committed = await admin.fetchOffsets({ groupId: BUILD_GROUP, topics: [BUILD_TOPIC] })
    const end = await admin.fetchTopicOffsets(BUILD_TOPIC)
    return committed[0]?.partitions[0]?.offset === end[0]?.offset
  }, 'Duplicate job was not acknowledged')
  assert.equal(runCalls, 1)
})
