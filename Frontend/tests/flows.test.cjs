const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, globals = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/lib/", file),
    "utf8",
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      URL,
      Uint8Array,
      atob,
      TextDecoder,
      Date,
      process: { env: {} },
      ...globals,
    },
  );
  return exports;
}
const session = load("session.ts");
const form = load("deployment-form.ts");
const token = (payload) =>
  "header." +
  Buffer.from(JSON.stringify(payload)).toString("base64url") +
  ".signature";

test("OAuth display data handles Unicode and rejects malformed, expired or incomplete sessions", () => {
  const data = {
    userId: "user-1",
    email: "review@example.invalid",
    username: "आयुष",
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  assert.equal(session.userFromToken(token(data)).username, data.username);
  for (const value of [
    "invalid",
    token({ ...data, exp: 1 }),
    token({ ...data, exp: undefined }),
    token({ ...data, userId: null }),
    token({ ...data, username: "" }),
  ]) {
    assert.throws(() => session.userFromToken(value));
  }
  assert.equal(session.isSessionUser(null), false);
  assert.equal(
    session.isSessionUser({ id: 1, username: "user", email: "" }),
    false,
  );
});

test("sign-in return paths retain the deployment query but cannot leave workspace routes", () => {
  assert.equal(
    session.workspaceDestination(
      "/launch?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    ),
    "/launch?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
  );
  assert.equal(
    session.workspaceDestination("/project/my-site"),
    "/project/my-site",
  );
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/launch-elsewhere",
    "/auth/callback?token=secret",
    "/project/../login",
  ]) {
    assert.equal(session.workspaceDestination(value), "/dashboard");
  }
});

test("source folders reject traversal, absolute paths and control characters", () => {
  for (const value of ["", "apps/web", "my app/site"])
    assert.equal(form.validSourcePath(value), true);
  for (const value of [
    "/etc",
    "../app",
    "apps/../web",
    "./apps",
    "apps\\web",
    "apps\nweb",
    "apps//web",
    "apps/",
    "apps\x7fweb",
  ])
    assert.equal(form.validSourcePath(value), false);
});

test("environment inputs flag duplicate, unnamed and invalid values without changing case or whitespace", () => {
  assert.equal(
    form.environmentIssue([
      { key: "Sample", value: " keep spaces " },
      { key: "SAMPLE", value: "" },
    ]),
    "",
  );
  assert.match(
    form.environmentIssue([
      { key: " SAMPLE ", value: "1" },
      { key: "SAMPLE", value: "2" },
    ]),
    /more than once/,
  );
  assert.match(
    form.environmentIssue([{ key: "", value: "secret" }]),
    /variable name/,
  );
  assert.match(
    form.environmentIssue([{ key: "1KEY", value: "x" }]),
    /start with a letter/,
  );
});

test("folder browsing sends an encoded branch/path and passes cancellation to fetch", async () => {
  const controller = new AbortController();
  let received;
  const api = load("api.ts", {
    fetch: async (url, options) => {
      received = { url, options };
      return { ok: true, status: 200, json: async () => ({ path: 'apps/my app', directories: [] }) };
    },
  });
  await api.listDirectories(
    "owner",
    "repo",
    "feature/ui",
    "apps/my app",
    controller.signal,
  );
  assert.match(received.url, /branch=feature%2Fui&path=apps%2Fmy%20app/);
  assert.equal(received.options.signal, controller.signal);
});

test("expired API sessions notify the auth provider; aborted requests keep their original error", async () => {
  const events = [];
  const api = load("api.ts", {
    Event,
    window: { dispatchEvent: (event) => events.push(event.type) },
    localStorage: { getItem: () => "session-token" },
    fetch: async () => ({ status: 401 }),
  });
  await api.fetchWithAuth("/projects");
  assert.deepEqual(events, ["launchpad:unauthorized"]);
  const controller = new AbortController();
  controller.abort();
  const expected = new Error("cancelled");
  const cancelled = load("api.ts", {
    fetch: async () => {
      throw expected;
    },
  });
  await assert.rejects(
    cancelled.fetchWithAuth("/projects", { signal: controller.signal }),
    (error) => error === expected,
  );
});
