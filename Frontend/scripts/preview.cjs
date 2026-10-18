const path = require("node:path");
const http = require("node:http");
const { createPreviewStore } = require("./preview-store.cjs");

if (process.env.NODE_ENV === "production")
  throw new Error("UI preview is only available in local development.");
const port = Number(process.env.LAUNCHPAD_PREVIEW_PORT || 3201);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local preview port between 1024 and 65535.");
process.env.NODE_ENV = "development";
process.env.LAUNCHPAD_UI_PREVIEW = "1";
process.env.NEXT_PUBLIC_UI_PREVIEW = "1";
process.env.NEXT_PUBLIC_API_URL = "/preview-api";
process.env.NEXT_PUBLIC_LOGS_URL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_APP_DOMAIN = "preview.local";
process.env.NEXT_TELEMETRY_DISABLED = "1";
const next = require("next");
const { Server } = require("socket.io");
const app = next({
  dev: true,
  dir: path.resolve(__dirname, ".."),
  hostname: "127.0.0.1",
  port,
});
const store = createPreviewStore();
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

async function main() {
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/preview-api/")) {
      try {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 65536) {
            res.writeHead(413);
            return res.end("Preview request too large");
          }
        }
        const result = store.route(
          req.method,
          url.pathname.slice("/preview-api".length),
          url.searchParams,
          raw ? JSON.parse(raw) : {},
        );
        res.setHeader("Cache-Control", "no-store");
        if (result.location) {
          res.writeHead(result.status, { Location: result.location });
          return res.end();
        }
        res.writeHead(result.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result.value));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "Invalid local preview request." }),
        );
      }
    }
    if (url.pathname.startsWith("/preview-site/")) {
      const slug = decodeURIComponent(url.pathname.split("/")[2] || "");
      const project = store.projects.find((item) => item.slug === slug);
      res.writeHead(project?.currentDeployment ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
      });
      return res.end(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LaunchPad preview</title><body style="margin:0;background:#080808;color:#f5f5f5;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><main style="padding:32px;max-width:640px"><p style="color:#ff8a3d">LOCAL UI PREVIEW</p><h1>${project?.currentDeployment ? escapeHtml(slug) + " is ready." : "This sample site is not ready yet."}</h1><p>This page simulates a deployed website. No AWS resources were created.</p><a style="color:#ff8a3d" href="/project/${encodeURIComponent(slug)}">Back to deployment logs</a></main></body></html>`,
      );
    }
    return handler(req, res);
  });
  const io = new Server(server);
  store.onLog((channel, event) => io.to(channel).emit("message", event));
  io.on("connection", (socket) =>
    socket.on("subscribe", (channel) => {
      if (typeof channel !== "string") return;
      const entries = store.subscribe(channel);
      if (!entries)
        return socket.emit("error", "Preview deployment not found.");
      socket.join(channel);
      socket.emit("subscribed", channel);
      socket.emit("history", entries);
    }),
  );
  server.listen(port, "127.0.0.1", () => {
    console.log(`Local UI preview: http://127.0.0.1:${port}`);
    console.log(
      "Sample data only. Sign-in and builds are simulated; AWS and GitHub are never contacted by the preview API.",
    );
  });
  server.on("error", (error) => {
    console.error(error.message);
    store.close();
    app.close().finally(() => process.exit(1));
  });
  const stop = () => {
    store.close();
    io.close();
    server.close();
    app.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error) => {
  console.error(error.message);
  store.close();
  process.exit(1);
});
