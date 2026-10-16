import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import { createWebSearchTool } from '../src/tools/web-search.js';

const exaText = 'Title: Node.js\nURL: https://nodejs.org/\nText: Official documentation';
const result = { content: [{ type: 'text', text: exaText }] };
const envelope = (value: unknown = result) => ({ jsonrpc: '2.0', id: 1, result: value });
const execute = (args: Record<string, unknown> = { query: 'Node.js' }, signal?: AbortSignal) =>
  createWebSearchTool().execute('search', args, signal);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function respond(body: unknown, headers = { 'content-type': 'application/json' }) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('searches Exa by default and returns source text and provider in tool details', async () => {
  const fetch = respond(envelope());
  const output = await execute();
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://mcp.exa.ai/mcp');
  expect(init.redirect).toBe('error');
  expect(init.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' });
  expect(JSON.parse(String(init.body))).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'web_search_exa', arguments: { query: 'Node.js', numResults: 8 } } });
  expect(output).toEqual({ content: [{ type: 'text', text: exaText }],
    details: { provider: 'exa', query: 'Node.js', text: exaText } });
});

test('uses Parallel objective/search_queries and reads a multiline SSE result after a notification', async () => {
  const body = ': keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
    + 'event: message\r\ndata: {"jsonrpc":"2.0","id":1,\r\ndata: "result":' + JSON.stringify(result) + '}\r\n\r\n';
  const fetch = respond(body, { 'content-type': 'text/event-stream' });
  expect((await execute({ query: 'Node.js', provider: 'parallel' })).details).toMatchObject({ provider: 'parallel', text: exaText });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://search.parallel.ai/mcp');
  expect(JSON.parse(String(init.body)).params).toEqual({ name: 'web_search', arguments: { objective: 'Node.js', search_queries: ['Node.js'] } });
});

test('accepts structured Parallel results when text content is absent', async () => {
  const results = [{ url: 'https://nodejs.org/', title: 'Node', excerpts: ['Documentation'] }];
  respond(envelope({ structuredContent: { results } }));
  expect((await execute({ query: 'Node', provider: 'parallel' })).content).toEqual([{ type: 'text', text: JSON.stringify({ results }) }]);
});

test.each([
  { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'remote-secret' } },
  envelope({ isError: true, content: [{ type: 'text', text: 'remote-secret' }] }),
  envelope({ content: [{ type: 'image', data: 'remote-secret' }] }),
  envelope({ content: [{ type: 'text', text: 3 }] }),
  { jsonrpc: '2.0', id: 2, result },
  'not json remote-secret',
])('rejects malformed/error MCP responses without echoing remote diagnostics', async body => {
  respond(body);
  await expect(execute()).rejects.toThrow(/^Web search failed \(exa\): invalid MCP response$/);
});

test('does not expose HTTP error bodies or retry denied searches', async () => {
  const fetch = vi.fn(async () => new Response('remote-secret', { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  await expect(execute()).rejects.toThrow('Web search failed (exa): HTTP 403');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('bounds streamed response size and cancels the reader', async () => {
  let cancelled = false;
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); },
    cancel() { cancelled = true; },
  })));
  await expect(execute()).rejects.toThrow('response exceeds 256 KiB');
  expect(cancelled).toBe(true);
});

test('propagates cancellation and bounds stalled requests to 25 seconds', async () => {
  const started = Promise.withResolvers<void>();
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init.signal!;
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started.resolve();
  }));
  const abort = new AbortController();
  const pending = expect(execute({ query: 'test' }, abort.signal)).rejects.toThrow('cancelled');
  await started.promise;
  abort.abort();
  await pending;
  // AbortSignal.timeout uses a native timer; replace just the clock source for this check.
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
  const timed = expect(execute()).rejects.toThrow('timed out');
  timeout.abort(new DOMException('Timed out', 'TimeoutError'));
  await timed;
  expect(AbortSignal.timeout).toHaveBeenCalledWith(25_000);
});

test.each([{ query: ' ' }, { query: 'x'.repeat(4001) }, { query: 'x', provider: 'custom' }])('rejects invalid direct inputs without a network request', async args => {
  const fetch = respond(envelope());
  await expect(execute(args)).rejects.toThrow('Invalid web search input');
  expect(fetch).not.toHaveBeenCalled();
});

test('finishes an SSE result without waiting for the remote stream to close', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const payload = `data: ${JSON.stringify(envelope())}\n\n`;
  let offset = 0;
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      // Exercise chunk boundaries inside both JSON and SSE delimiters.
      if (offset < payload.length) controller.enqueue(encoder.encode(payload.slice(offset, offset += 7)));
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  expect((await execute()).details).toMatchObject({ text: exaText });
  expect(cancelled).toBe(true);
});

test('sanitizes connection errors without leaking transport diagnostics', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('sensitive transport details'); });
  await expect(execute()).rejects.toThrow(/^Web search failed \(exa\): request failed$/);
});


test.each(['cancelled', 'timed out'])('interrupts a real stalled HTTP response body when %s', async reason => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': keepalive\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const nativeFetch = globalThis.fetch;
  const headersReceived = Promise.withResolvers<void>();
  const abort = new AbortController();
  if (reason === 'timed out') vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(abort.signal);
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/mcp`, init);
    headersReceived.resolve();
    return response;
  });
  try {
    const pending = expect(execute({ query: 'test' }, reason === 'cancelled' ? abort.signal : undefined)).rejects.toThrow(reason);
    await headersReceived.promise;
    abort.abort(new DOMException('Stopped', reason === 'timed out' ? 'TimeoutError' : 'AbortError'));
    await pending;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
