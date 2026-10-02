const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ECSClient, ListTasksCommand, RunTaskCommand } = require('@aws-sdk/client-ecs');
const { Project } = require('../dist/src/models/Project');
const { Deployment } = require('../dist/src/models/Deployment');
const { triggerBuildTask } = require('../dist/src/lib/build-task');

async function fixture(send, check, extra = {}) {
    const original = { send: ECSClient.prototype.send, project: Project.updateOne, deployment: Deployment.updateOne };
    const settings = {
        AWS_ECS_CLUSTER: 'test-cluster', AWS_ECS_TASK_DEFINITION: 'test-worker',
        AWS_ECS_SUBNETS: 'subnet-a, subnet-b', AWS_ECS_SECURITY_GROUPS: 'sg-worker',
        BUILD_MAX_CONCURRENT: '2', BUILD_REDIS_URL: 'redis://:test-password@10.0.0.1:6379',
        BUILD_CALLBACK_BASE_URL: 'https://api.example.test/',
        AWS_ACCESS_KEY_ID: 'test-api-key', AWS_SECRET_ACCESS_KEY: 'test-api-secret',
        AWS_SESSION_TOKEN: 'test-api-session', CF_API_TOKEN: 'test-cloudflare-token', JWT_SECRET: 'test-jwt',
        ...extra,
    };
    const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    const failures = [];
    try {
        Object.assign(process.env, settings);
        ECSClient.prototype.send = send;
        Project.updateOne = async () => ({ modifiedCount: 1 });
        Deployment.updateOne = async (filter, update) => { failures.push(update.$set); return { modifiedCount: 1 }; };
        await check({ failures, project: { _id: 'project', slug: 'test', gitUrl: 'https://example.test/repo.git' }, deployment: { _id: 'deployment', save: async () => {} } });
    } finally {
        ECSClient.prototype.send = original.send;
        Project.updateOne = original.project;
        Deployment.updateOne = original.deployment;
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
}

test('Fargate launches with remote log/callback endpoints and excludes API credentials', async () => {
    let launch;
    await fixture(async command => {
        if (command instanceof ListTasksCommand) return { taskArns: [] };
        assert.ok(command instanceof RunTaskCommand);
        launch = command.input;
        return { tasks: [{ taskArn: 'arn:aws:ecs:region:account:task/cluster/test' }] };
    }, async ({ project, deployment }) => {
        assert.match(await triggerBuildTask(project, deployment, 'test-github-token'), /^arn:aws:ecs:/);
        assert.equal(launch.launchType, 'FARGATE');
        assert.equal(launch.platformVersion, '1.4.0');
        assert.equal(launch.clientToken, deployment._id);
        assert.deepEqual(launch.networkConfiguration.awsvpcConfiguration.subnets, ['subnet-a', 'subnet-b']);
        const env = Object.fromEntries(launch.overrides.containerOverrides[0].environment.map(v => [v.name, v.value]));
        assert.equal(env.REDIS_URL, 'redis://:test-password@10.0.0.1:6379');
        assert.equal(env.API_CALLBACK_URL, 'https://api.example.test/projects/test/deployments/deployment/status');
        assert.equal(env.GITHUB_TOKEN, 'test-github-token');
        for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'CF_API_TOKEN', 'JWT_SECRET']) assert.ok(!(key in env));
    });
});

test('capacity includes paginated pending/running jobs and prevents another launch', async () => {
    let lists = 0;
    await fixture(async command => {
        assert.ok(command instanceof ListTasksCommand);
        return ++lists === 1 ? { taskArns: ['first'], nextToken: 'next' } : { taskArns: ['second'] };
    }, async ({ project, deployment, failures }) => {
        await assert.rejects(triggerBuildTask(project, deployment, ''), /capacity is busy/);
        assert.equal(lists, 2);
        assert.equal(failures[0].status, 'FAILED');
    });
});

test('concurrent requests cannot both take the final build slot', async () => {
    const active = [];
    await fixture(async command => {
        if (command instanceof ListTasksCommand) return { taskArns: [...active] };
        await new Promise(resolve => setTimeout(resolve, 20));
        active.push('arn:aws:ecs:region:account:task/cluster/first');
        return { tasks: [{ taskArn: active[0] }] };
    }, async ({ project, deployment }) => {
        const results = await Promise.allSettled([triggerBuildTask(project, deployment, ''), triggerBuildTask(project, { ...deployment, _id: 'second' }, '')]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(active.length, 1);
    }, { BUILD_MAX_CONCURRENT: '1' });
});

test('SDK errors do not expose task environment values', async () => {
    await fixture(async command => {
        if (command instanceof ListTasksCommand) return { taskArns: [] };
        throw new Error('private SDK payload test-api-secret');
    }, async ({ project, deployment, failures }) => {
        await assert.rejects(triggerBuildTask(project, deployment, ''), /^Error: Build task could not start$/);
        assert.equal(failures[0].failureReason, 'Build task could not start');
    });
});

test('oversized application settings fail before sending task overrides', async () => {
    await fixture(async command => {
        assert.ok(command instanceof ListTasksCommand);
        return { taskArns: [] };
    }, async ({ project, deployment }) => {
        project.envVars = { LARGE_VALUE: 'x'.repeat(9000) };
        await assert.rejects(triggerBuildTask(project, deployment, ''), /override limit/);
    });
});
