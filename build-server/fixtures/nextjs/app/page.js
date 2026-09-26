export const dynamic = 'force-dynamic';
export default function Page() { return <main><h1>LaunchPad runtime test</h1><p id="rendered">Rendered on the server: {new Date().toISOString()}</p><a href="/public-check.txt">Public asset</a></main>; }
