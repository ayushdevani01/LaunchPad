// Registers one app through GitHub's official manifest flow. The owner confirms
// creation in GitHub; credentials are exchanged directly into local files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const envFile = path.join(root, '.env');
const env = require('dotenv').parse(fs.existsSync(envFile) ? fs.readFileSync(envFile) : '');
const port = Number(process.env.GITHUB_SETUP_PORT || 3101);
const origin = `http://127.0.0.1:${port}`;
const api = `https://api.${env.BASE_DOMAIN || 'launch-pad.dev'}`;
const state = crypto.randomBytes(32).toString('hex');
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const manifest = {
  name: process.argv[2] || 'LaunchPad Deployments',
  url: env.FRONTEND_URL || 'https://launch-pad.dev',
  redirect_url: `${origin}/callback`,
  callback_urls: [`${api}/auth/github-app/callback`],
  setup_url: `${api}/github/install/callback`,
  setup_on_update: true,
  hook_attributes: { url: `${api}/webhooks/github`, active: true },
  public: true,
  default_permissions: { contents: 'read', metadata: 'read', emails: 'read' },
  default_events: ['push'],
  request_oauth_on_install: false,
  description: 'Sign in to LaunchPad, connect selected repositories, and deploy changes from your chosen branch.'
};
function updateEnv(values) {
  let source = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(String(value))}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    source = pattern.test(source) ? source.replace(pattern, () => line) : `${source.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envFile, source, { mode: 0o600 });
}
let complete = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); return res.end('Invalid host'); }
  const url = new URL(req.url, origin);
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  if (url.pathname === '/') {
    return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>LaunchPad GitHub App setup</title><body style="background:#101010;color:#eee;font:16px system-ui;max-width:640px;margin:64px auto;padding:24px"><h1>Connect LaunchPad to GitHub</h1><p>Create one GitHub App for sign-in and selected repository deployments.</p><ul><li>Email addresses: read only</li><li>Repository contents and metadata: read only</li><li>Push notifications to ${escape(api)}/webhooks/github</li></ul><p>No code write or repository administration permissions. Select individual repositories when installing.</p><form method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button style="background:#ff8738;border:0;padding:14px 20px;border-radius:8px;cursor:pointer">Review registration on GitHub</button></form><p>GitHub will ask you to confirm creation. The generated credentials are saved directly to the ignored root .env and .secrets directory.</p></body></html>`);
  }
  if (url.pathname !== '/callback' || complete) { res.writeHead(404); return res.end('Not found'); }
  const received = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (received.length !== state.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(state)) || !/^[a-zA-Z0-9_-]+$/.test(code)) {
    res.writeHead(400); return res.end('Invalid registration state. Start again.');
  }
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LaunchPad-Setup', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Manifest exchange failed');
    const data = await response.json();
    if (!data.id || !data.slug || !data.pem || !data.client_id || !data.client_secret || !data.webhook_secret) throw new Error('Incomplete manifest response');
    fs.mkdirSync(path.join(root, '.secrets'), { recursive: true });
    fs.writeFileSync(path.join(root, '.secrets/github-app.pem'), data.pem, { mode: 0o600 });
    updateEnv({ GITHUB_APP_ID: data.id, GITHUB_APP_SLUG: data.slug, GITHUB_APP_CLIENT_ID: data.client_id,
      GITHUB_APP_CLIENT_SECRET: data.client_secret, GITHUB_WEBHOOK_SECRET: data.webhook_secret,
      GITHUB_APP_PRIVATE_KEY_PATH: '.secrets/github-app.pem', GITHUB_APP_CALLBACK_URL: `${api}/auth/github-app/callback`,
      WORKER_API_TOKEN: env.WORKER_API_TOKEN || crypto.randomBytes(32).toString('hex') });
    complete = true;
    res.end('<h1>GitHub App created</h1><p>Credentials have been saved locally. Return to Codex so the backend can be deployed before connecting repositories.</p>');
    console.log('GitHub App created; credentials saved directly to ignored local files. No secrets printed.');
    server.close();
  } catch { res.writeHead(502); res.end('Registration could not finish. No credentials were printed. Try again from the local setup page.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Review GitHub App registration: ${origin}`));
setTimeout(() => server.close(), 3600000).unref();
