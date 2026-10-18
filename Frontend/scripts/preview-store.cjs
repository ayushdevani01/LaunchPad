const { randomUUID } = require("node:crypto");

// Development fixtures only. This module has no AWS/GitHub clients, credentials,
// persistence or network requests; build timers only change in-memory data.
function createPreviewStore({
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const projects = [],
    deployments = new Map(),
    output = new Map(),
    timers = new Set();
  let publish = () => {};
  const later = (callback, delay) => {
    let timer;
    timer = schedule(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };
  const append = (slug, id, log, stage = "build", level = "info") => {
    const entries = output.get(id) || [];
    const event = {
      id: randomUUID(),
      deploymentId: id,
      sequence: entries.length + 1,
      timestamp: new Date().toISOString(),
      log,
      stage,
      level,
    };
    entries.push(JSON.stringify(event));
    output.set(id, entries);
    publish(`logs:${slug}:${id}`, entries[entries.length - 1]);
  };
  const seed = (slug, sourceDir, target) => {
    const createdAt = new Date(
      Date.now() - projects.length * 86400000 - 3600000,
    ).toISOString();
    const id = randomUUID();
    const project = {
      _id: randomUUID(),
      slug,
      gitUrl: `https://github.com/launchpad-preview/${slug}`,
      branch: "main",
      sourceDir,
      createdAt,
      deploymentTarget: target,
      buildCommand: "npm run build",
      currentDeployment: id,
      latestDeployment: id,
    };
    projects.push(project);
    deployments.set(slug, [
      { _id: id, projectId: project._id, status: "SUCCESS", createdAt },
    ]);
    append(slug, id, "Installing dependencies (preview)", "install");
    append(slug, id, "Added 184 packages", "install");
    append(slug, id, "Application compiled successfully");
    append(slug, id, "Runtime health check passed", "deploy");
    append(slug, id, "SUCCESS: Preview deployment ready", "finalize");
    return project;
  };
  seed("studio-portfolio", "apps/web", "nextjs-lambda");
  const docs = seed("project-docs", "", "static");
  const failedId = randomUUID();
  deployments
    .get(docs.slug)
    .unshift({
      _id: failedId,
      projectId: docs._id,
      status: "FAILED",
      createdAt: new Date().toISOString(),
      failureReason:
        "Preview example: a required environment variable was missing. The previous production stays live.",
    });
  docs.latestDeployment = failedId;
  append(docs.slug, failedId, "Building documentation");
  append(
    docs.slug,
    failedId,
    "Missing required variable: DOCS_TITLE",
    "build",
    "error",
  );
  projects.push({
    _id: randomUUID(),
    slug: "weekend-experiment",
    gitUrl: "https://github.com/launchpad-preview/weekend-experiment",
    branch: "main",
    createdAt: new Date().toISOString(),
  });
  deployments.set("weekend-experiment", []);

  function startBuild(project, fail = false) {
    const list = deployments.get(project.slug) || [];
    if (list.some((item) => ["PENDING", "BUILDING"].includes(item.status)))
      return null;
    const deployment = {
      _id: randomUUID(),
      projectId: project._id,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    list.unshift(deployment);
    deployments.set(project.slug, list);
    project.latestDeployment = deployment._id;
    append(
      project.slug,
      deployment._id,
      "Queued an isolated preview build",
      "queue",
    );
    const stages = [
      ["clone", "Repository source ready"],
      ["install", "npm install"],
      ["install", "added 184 packages in 2s"],
      ["build", project.buildCommand || "npm run build"],
      ["build", "Compiling application pages and API routes"],
      ["build", "Compiled successfully"],
      ["upload", "Static assets uploaded (simulated)"],
      ["deploy", "Runtime health check passed (simulated)"],
    ];
    stages.forEach(([stage, log], index) =>
      later(
        () => {
          deployment.status = "BUILDING";
          append(project.slug, deployment._id, log, stage);
        },
        600 + index * 1100,
      ),
    );
    later(() => {
      deployment.status = fail ? "FAILED" : "SUCCESS";
      if (fail) {
        deployment.failureReason = "Simulated build failure";
        append(
          project.slug,
          deployment._id,
          deployment.failureReason,
          "finalize",
          "error",
        );
      } else {
        project.currentDeployment = deployment._id;
        append(
          project.slug,
          deployment._id,
          "SUCCESS: Preview deployment ready",
          "finalize",
        );
      }
    }, 10500);
    return deployment;
  }

  function route(method, path, query, body = {}) {
    const json = (value, status = 200) => ({ status, value });
    if (path === "/auth/github") {
      const payload = {
        userId: "preview-user",
        email: "preview@example.invalid",
        username: "Preview workspace",
        exp: Math.floor(Date.now() / 1000) + 86400,
      };
      const token =
        "preview." +
        Buffer.from(JSON.stringify(payload)).toString("base64url") +
        ".local-only";
      return { status: 302, location: `/auth/callback?token=${token}` };
    }
    if (path === "/projects/github/repos")
      return json({
        repos: [
          {
            name: "studio-portfolio",
            fullName: "launchpad-preview/studio-portfolio",
            gitUrl: "https://github.com/launchpad-preview/studio-portfolio",
            defaultBranch: "main",
            private: true,
          },
          {
            name: "project-docs",
            fullName: "launchpad-preview/project-docs",
            gitUrl: "https://github.com/launchpad-preview/project-docs",
            defaultBranch: "main",
            private: false,
          },
          {
            name: "weekend-experiment",
            fullName: "launchpad-preview/weekend-experiment",
            gitUrl: "https://github.com/launchpad-preview/weekend-experiment",
            defaultBranch: "main",
            private: false,
          },
        ],
      });
    if (path === "/projects/github/branches")
      return json({
        branches: ["main", "preview", "feature/new-design"],
        defaultBranch: "main",
      });
    if (path === "/projects/github/tree") {
      const directory = query.get("path") || "";
      const paths = {
        "": ["apps", "packages", "public"],
        apps: ["web", "docs"],
        packages: ["ui"],
      };
      return json({
        path: directory,
        hasPackageJson: ["apps/web", "apps/docs", "packages/ui"].includes(
          directory,
        ),
        directories: (paths[directory] || []).map((name) => ({
          name,
          path: directory ? directory + "/" + name : name,
          hasPackageJson: ["web", "docs", "ui"].includes(name),
        })),
      });
    }
    if (path === "/projects/github/detect") {
      const directory = query.get("path") || "";
      const docsRepo =
        (query.get("repo") || "").includes("docs") || directory === "apps/docs";
      const monorepo = !directory && !docsRepo;
      return json({
        detection: {
          framework: monorepo
            ? "Monorepo"
            : docsRepo
              ? "Vite Project"
              : "Next.js",
          supported: monorepo ? "NO" : "YES",
          installCommand: monorepo ? "" : "npm install",
          buildCommand: monorepo ? "" : "npm run build",
          outputDir: docsRepo ? "dist" : "",
          notes: monorepo
            ? "Preview repository: choose apps/web or apps/docs to detect an app."
            : "Sample framework detection for local UI preview.",
        },
      });
    }
    if (path === "/projects/check-name")
      return json({
        available: !projects.some(
          (project) => project.slug === query.get("name"),
        ),
      });
    if (path === "/projects" && method === "GET") return json({ projects });
    if (path === "/projects" && method === "POST") {
      const slug = body.project_name || "preview-" + randomUUID().slice(0, 6);
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug))
        return json({ error: "Use a valid project name." }, 400);
      if (projects.some((project) => project.slug === slug))
        return json({ error: "That project name is taken." }, 409);
      if (
        typeof body.gitURL !== "string" ||
        !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(body.gitURL)
      )
        return json({ error: "Choose a GitHub repository." }, 400);
      const project = {
        _id: randomUUID(),
        slug,
        gitUrl: body.gitURL,
        branch: body.branch || "main",
        sourceDir: body.sourceDir || "",
        installCommand: body.installCommand,
        buildCommand: body.buildCommand,
        outputDir: body.outputDir,
        deploymentTarget: body.deploymentTarget || "auto",
        createdAt: new Date().toISOString(),
      };
      projects.unshift(project);
      const deployment = startBuild(project);
      return json({
        data: { projectSlug: slug, url: `/preview-site/${slug}`, deployment },
      });
    }
    const parts = path.split("/").filter(Boolean);
    const project = projects.find((item) => item.slug === parts[1]);
    if (parts[0] !== "projects" || !project)
      return json({ error: "Preview project not found." }, 404);
    if (parts.length === 2 && method === "GET") return json({ project });
    if (parts[2] === "deployments" && parts.length === 3)
      return json({ deployments: deployments.get(project.slug) || [] });
    if (parts[2] === "deployments" && parts[4] === "logs") {
      const entries = output.get(parts[3]);
      if (!entries) return json({ error: "Preview log not found." }, 404);
      return json({
        logs: entries
          .map((entry) => {
            const event = JSON.parse(entry);
            return `[${event.timestamp}] [${event.stage}] [${event.level}] ${event.log}`;
          })
          .join("\n"),
      });
    }
    if (parts[2] === "redeploy" && method === "POST") {
      const deployment = startBuild(project);
      return deployment
        ? json({ deployment })
        : json({ error: "A preview build is already running." }, 409);
    }
    return json(
      { error: "This action is not part of the local preview." },
      404,
    );
  }
  return {
    route,
    startBuild,
    projects,
    deployments,
    output,
    subscribe(channel) {
      const [prefix, slug, id] = channel.split(":");
      return prefix === "logs" &&
        deployments.get(slug)?.some((item) => item._id === id)
        ? output.get(id) || []
        : null;
    },
    onLog(callback) {
      publish = callback;
    },
    close() {
      timers.forEach((timer) => cancel(timer));
      timers.clear();
    },
  };
}
module.exports = { createPreviewStore };
