const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPreviewStore } = require("../scripts/preview-store.cjs");

function fixture() {
  const queued = [];
  const store = createPreviewStore({
    schedule(callback, delay) {
      const item = { callback, delay };
      queued.push(item);
      return item;
    },
    cancel(item) {
      item.cancelled = true;
    },
  });
  return {
    store,
    finish() {
      queued
        .sort((a, b) => a.delay - b.delay)
        .forEach((item) => {
          if (!item.cancelled) item.callback();
        });
    },
  };
}

test("preview redeploy streams history and promotes production only after simulated health checks", () => {
  const { store, finish } = fixture();
  const project = store.projects[0],
    production = project.currentDeployment,
    streamed = [];
  store.onLog((channel, event) =>
    streamed.push({ channel, event: JSON.parse(event) }),
  );
  const build = store.startBuild(project);
  assert.equal(build.status, "PENDING");
  assert.equal(project.currentDeployment, production);
  assert.equal(store.startBuild(project), null);
  assert.equal(store.subscribe(`logs:wrong-project:${build._id}`), null);
  assert.equal(store.subscribe(`logs:${project.slug}:${build._id}`).length, 1);
  finish();
  assert.equal(build.status, "SUCCESS");
  assert.equal(project.currentDeployment, build._id);
  assert.ok(streamed.some((item) => item.event.log.includes("npm install")));
  assert.ok(streamed.some((item) => item.event.log.includes("health check")));
  assert.equal(streamed.at(-1).event.stage, "finalize");
  store.close();
});

test("failed preview builds retain the existing production and expose an archived error", () => {
  const { store, finish } = fixture();
  const project = store.projects[0],
    production = project.currentDeployment;
  const build = store.startBuild(project, true);
  finish();
  assert.equal(build.status, "FAILED");
  assert.equal(project.currentDeployment, production);
  const response = store.route(
    "GET",
    `/projects/${project.slug}/deployments/${build._id}/logs`,
    new URLSearchParams(),
  );
  assert.match(response.value.logs, /Simulated build failure/);
  store.close();
});

test("preview API creates only in-memory samples and does not retain environment secrets", () => {
  const { store } = fixture();
  const response = store.route("POST", "/projects", new URLSearchParams(), {
    project_name: "test-preview",
    gitURL: "https://github.com/example/app",
    sourceDir: "apps/web",
    envVars: { SAMPLE: "fictional-secret-value" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.value.data.url, "/preview-site/test-preview");
  const project = store.projects.find((item) => item.slug === "test-preview");
  assert.equal(project.sourceDir, "apps/web");
  assert.equal(
    JSON.stringify(project).includes("fictional-secret-value"),
    false,
  );
  assert.equal(
    store.route("GET", "/account/billing", new URLSearchParams()).status,
    404,
  );
  store.close();
});
