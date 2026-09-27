export const dynamic = 'force-dynamic';
export async function GET(request) {
  const url = new URL(request.url);
  const delay = Math.min(200, Math.max(0, Number(url.searchParams.get('delay') || 0)));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return Response.json({ message: 'launchpad-ok', query: url.searchParams.get('value'), method: request.method, renderedAt: Date.now() }, { headers: { 'set-cookie': 'launchpad=test; Path=/; HttpOnly; SameSite=Lax' } });
}
export async function POST(request) { return Response.json({ received: await request.json(), method: request.method }); }
