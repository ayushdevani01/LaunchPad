// Runs ordinary Node HTTP servers on Lambda without an event adapter.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const endpoint = new URL(`http://${process.env.AWS_LAMBDA_HTTP_ENDPOINT || '0.0.0.0:3000'}`);
process.env.PORT = endpoint.port;
process.env.HOST = endpoint.hostname;
process.env.HOSTNAME = endpoint.hostname;
process.env.NODE_ENV = 'production';

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  // Leave internal Unix sockets alone; the primary HTTP server must bind to
  // Lambda's readiness address even when a project hardcodes localhost:8080.
  if (this instanceof http.Server) {
    const callback = args.find(value => typeof value === 'function');
    return listen.call(this, { host: endpoint.hostname, port: Number(endpoint.port) }, callback);
  }
  return listen.apply(this, args);
};

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args;
    // These headers are always overwritten by LaunchPad's IAM-signing proxy.
    // IAM removes its own Authorization header before this HTTP server sees it.
    const authorization = req.headers['x-launchpad-authorization'];
    delete req.headers.authorization;
    if (typeof authorization === 'string') req.headers.authorization = authorization;
    delete req.headers['x-launchpad-authorization'];
    const host = req.headers['x-forwarded-host'];
    if (typeof host === 'string') req.headers.host = host;
    // Fetch-based servers (including Hono) construct Headers from rawHeaders.
    // Keep the raw and normalized Node representations in sync.
    const raw = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (!['authorization', 'x-launchpad-authorization', 'host'].includes(req.rawHeaders[i].toLowerCase())) raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    if (req.headers.host) raw.push('Host', req.headers.host);
    if (typeof authorization === 'string') raw.push('Authorization', authorization);
    req.rawHeaders = raw;
    if (req.url === '/.launchpad/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"status":"ready"}');
      return true;
    }
  }
  return emit.call(this, event, ...args);
};

async function start(config) {
  let app = path.join(__dirname, 'app', config.directory || '');
  if (config.next) {
    // Next writes ISR pages, data and optimized images below .next. Code is
    // read-only in Lambda, so only that mutable tree is copied to /tmp.
    const writable = path.join(process.env.TMPDIR || '/tmp', 'launchpad-next');
    fs.mkdirSync(writable, { recursive: true });
    for (const name of fs.readdirSync(app)) {
      const source = path.join(app, name);
      const dest = path.join(writable, name);
      if (name === '.next') fs.cpSync(source, dest, { recursive: true });
      else if (!fs.existsSync(dest)) fs.symlinkSync(source, dest);
    }
    // Node resolves modules relative to the real path of server.js. Next's
    // standalone server also uses __dirname, so copy this tiny entry file.
    fs.rmSync(path.join(writable, 'server.js'), { force: true });
    fs.copyFileSync(path.join(app, 'server.js'), path.join(writable, 'server.js'));
    // Monorepo standalone trees can keep dependencies above the app folder.
    if (!fs.existsSync(path.join(writable, 'node_modules'))) {
      fs.symlinkSync(path.join(__dirname, 'app', 'node_modules'), path.join(writable, 'node_modules'));
    }
    app = writable;
  }
  process.chdir(app);
  const entry = path.join(app, config.entry);
  process.argv = [process.execPath, entry, ...(config.args || [])];
  await import(pathToFileURL(entry).href);
}
module.exports = { start };
