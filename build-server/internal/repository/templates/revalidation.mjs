import fs from 'node:fs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// The stock OpenNext revalidator calls the viewer hostname over unsigned HTTP.
// LaunchPad's origin is IAM protected, so regenerate through the Invoke API.
const client = new LambdaClient({});
const preview = JSON.parse(fs.readFileSync(new URL('./prerender-manifest.json', import.meta.url))).preview.previewModeId;
export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const { host, url } = JSON.parse(record.body);
      const parsed = new URL(url, 'https://localhost');
      const request = {
        version: '2.0', routeKey: '$default', rawPath: parsed.pathname,
        rawQueryString: parsed.search.slice(1), isBase64Encoded: false,
        headers: { host, 'x-forwarded-proto': 'https', 'x-prerender-revalidate': preview, 'x-isr': '1' },
        requestContext: { http: { method: 'HEAD', path: parsed.pathname, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } }
      };
      const output = await client.send(new InvokeCommand({ FunctionName: process.env.SERVER_FUNCTION_NAME, Payload: Buffer.from(JSON.stringify(request)) }));
      if (output.FunctionError) throw new Error('Regeneration invocation failed');
      const response = JSON.parse(Buffer.from(output.Payload).toString());
      const cache = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'x-nextjs-cache')?.[1];
      if (![200, 307, 308, 404].includes(response.statusCode) || cache !== 'REVALIDATED') throw new Error('Page was not regenerated');
    } catch {
      console.error('ISR regeneration failed', { messageId: record.messageId });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
