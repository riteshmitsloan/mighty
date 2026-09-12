import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../supabase/functions/ai-gateway/handler.ts';
import type { Config } from '../supabase/functions/_shared/contracts.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const base: Config = {
  feature: 'profile_briefing', provider: 'gemini', model: 'gemini-2.5-pro', tier: 'standard',
  weight: 1, cache_ttl_days: 0, max_tokens: 2048, max_prompt_bytes: 16000,
  input_usd_per_million: 1.25, cached_input_usd_per_million: .125, cache_write_usd_per_million: 0,
  output_usd_per_million: 10, fixed_cost_usd: 0, reasoning_token_allowance: 1024,
  rates_valid_until: '2099-12-31', enabled: true, revision: 1,
};
const search: Config = { ...base, feature: 'people_search', provider: 'google_search', model: 'programmable-search', weight: 0, input_usd_per_million: 0, cached_input_usd_per_million: 0, output_usd_per_million: 0, fixed_cost_usd: .005, reasoning_token_allowance: 0 };
const geminiReply = () => Response.json({
  candidates: [{ content: { parts: [{ thought: true, text: 'Private reasoning' }, { text: 'A useful draft.' }] } }],
  usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 300 },
});
type Log = { id: string; feature: string; pending: boolean; dispatched: boolean; confirmation?: Record<string, unknown> };
interface HarnessOptions {
  env?: Record<string, string | undefined>;
  configs?: Record<string, Config>;
  reservedConfig?: Config;
  quota?: unknown;
  quotaError?: boolean;
  release?: 'false' | 'error';
  confirmation?: 'false' | 'error';
  dispatchError?: boolean;
  diagnostic?: (event: unknown) => void;
  reserveError?: boolean;
  cachedText?: string;
  fetcher?: (url: URL, init: RequestInit | undefined, logs: Map<string, Log>) => Promise<Response>;
}
function harness(options: HarnessOptions = {}) {
  const events: string[] = [], envReads: string[] = [], logs = new Map<string, Log>(), diagnostics: unknown[] = [];
  const fetches: { url: URL; init?: RequestInit }[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  let clients = 0;
  const configs = { profile_briefing: base, people_search: search, ...options.configs };
  const environment: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://test-project.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
    AI_PROCESSING_ENABLED: 'true', AI_PROVIDER_DATA_CONTROLS_CONFIRMED: 'true', GEMINI_PAID_PROJECT_CONFIRMED: 'true',
    GEMINI_API_KEY: 'fake-canonical-gemini', GOOGLE_SEARCH_API_KEY: 'fake-search-key', GOOGLE_SEARCH_ENGINE_ID: 'fake-engine', GOOGLE_SEARCH_ENABLED: 'true',
    ...options.env,
  };
  const query = (table: string) => {
    const filters = new Map<string, unknown>();
    let action = 'read', payload: any;
    const execute = async () => {
      if (action === 'read') {
        events.push(`read:${table}`);
        if (table === 'users') return { data: { account_status: 'active' }, error: null };
        if (table === 'ai_config') return { data: configs[filters.get('feature') as keyof typeof configs] ?? null, error: null };
        if (table === 'ai_cache') return { data: options.cachedText ? { text: options.cachedText } : null, error: null };
      }
      if (table === 'ai_call_log' && action === 'update') {
        events.push('dispatch');
        if (options.dispatchError) return { data: null, error: { message: 'Synthetic dispatch failure' } };
        const log = logs.get(String(filters.get('id')));
        if (log?.pending) log.dispatched = true;
      }
      if (table === 'ai_call_log' && action === 'insert') {
        if (logs.has(payload.id)) return { data: null, error: { code: '23505' } };
        logs.set(payload.id, { id: payload.id, feature: payload.feature, pending: false, dispatched: false });
      }
      return { data: null, error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.set(key, value); return chain; },
      gt: () => chain,
      maybeSingle: execute,
      update: (value: unknown) => { action = 'update'; payload = value; return chain; },
      insert: (value: unknown) => { action = 'insert'; payload = value; return chain; },
      upsert: (value: unknown) => { action = 'upsert'; payload = value; return chain; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject),
    };
    return chain;
  };
  const db = {
    auth: { getUser: async () => { events.push('auth'); return { data: { user: { id: UID } }, error: null }; } },
    from: query,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      events.push(name); rpcs.push({ name, args });
      if (name === 'ai_reserve_call') {
        if (options.reserveError) return { data: null, error: { message: 'Daily budget limit reached.' } };
        const id = String(args.p_request_id);
        if (logs.has(id)) return { data: null, error: { message: 'Request already reserved.' } };
        const feature = String(args.p_feature);
        logs.set(id, { id, feature, pending: true, dispatched: false });
        return { data: { config: options.reservedConfig ?? configs[feature as keyof typeof configs] }, error: null };
      }
      if (name === 'claim_people_search') return { data: options.quota === undefined ? { allowed: true, remaining: 94 } : options.quota, error: options.quotaError ? { message: 'Synthetic quota failure' } : null };
      if (name === 'ai_release_call') {
        if (options.release === 'error') return { data: null, error: { message: 'Synthetic release failure' } };
        if (options.release === 'false') return { data: false, error: null };
        const id = String(args.p_id), log = logs.get(id);
        if (!log?.pending || (log.dispatched && args.p_definitive_no_charge !== true)) return { data: false, error: null };
        logs.delete(id); return { data: true, error: null };
      }
      if (name === 'ai_confirm_call') {
        if (options.confirmation) return { data: false, error: options.confirmation === 'error' ? { message: 'Synthetic confirmation failure' } : null };
        const log = logs.get(String(args.p_id));
        assert.ok(log?.pending && log.dispatched);
        log.pending = false; log.confirmation = args;
        return { data: true, error: null };
      }
      if (name === 'ai_remaining') return { data: 19, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const handler = createGateway({
    diagnostic: event => { diagnostics.push(event); options.diagnostic?.(event); },
    env: key => { envReads.push(key); return environment[key]; },
    client: () => { clients++; return db; },
    fetcher: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(url instanceof Request ? url.url : String(url));
      events.push(`fetch:${endpoint.hostname}`); fetches.push({ url: endpoint, init });
      assert.ok([...logs.values()].some(log => log.pending && log.dispatched), 'Provider fetch must follow a dispatch marker.');
      if (options.fetcher) return options.fetcher(endpoint, init, logs);
      return endpoint.hostname === 'customsearch.googleapis.com' ? Response.json({ items: [{ title: 'Public result', link: 'https://www.linkedin.com/in/example/', snippet: 'Public context' }] }) : geminiReply();
    }) as typeof fetch,
  });
  const send = (feature: string, user: string, extra: Record<string, unknown> = {}, id = ID) => handler(new Request('https://test.invalid', {
    method: 'POST', headers: { authorization: 'Bearer fake-session', 'x-request-id': id },
    body: JSON.stringify({ feature, system: '', user, ...extra }),
  }));
  return { handler, send, events, rpcs, logs, fetches, envReads, diagnostics, get clients() { return clients; }, pending: () => [...logs.values()].filter(log => log.pending) };
}

test('malformed search body returns 400 before auth, reservation, quota, cache, or dispatch', async () => {
  const invalid = ['{', '[1]', '{}', '{"query":"","start":1}', '{"query":"  ","start":1}', '{"query":12,"start":1}', '{"query":"engineer"}', '{"query":"engineer","start":0}', '{"query":"engineer","start":92}', '{"query":"engineer","start":1.5}', '{"query":"engineer","start":"1"}', '{"query":"engineer","start":null}', '{"query":"engineer","start":1,"extra":true}', 'x'.repeat(257), JSON.stringify({ query: 'x'.repeat(257), start: 1 })];
  for (const user of invalid) {
    const h = harness({ cachedText: 'An old cache entry must not bypass validation.' });
    const result = await h.send('people_search', user);
    assert.equal(result.status, 400, user);
    assert.equal(h.clients, 0); assert.deepEqual(h.rpcs, []); assert.deepEqual(h.fetches, []); assert.equal(h.pending().length, 0);
  }
  const h = harness();
  const invalidJSON = await h.handler(new Request('https://test.invalid', { method: 'POST', body: '{' }));
  assert.equal(invalidJSON.status, 400); assert.equal(h.clients, 0);
});

test('plain search and boundary JSON pagination stay compatible without truncation', async () => {
  for (const [user, query, start] of [['  site:linkedin.com/in/ engineer  ', 'site:linkedin.com/in/ engineer', 1], [JSON.stringify({ query: 'x'.repeat(256), start: 91 }), 'x'.repeat(256), 91]] as const) {
    const h = harness(); const result = await h.send('people_search', user);
    assert.equal(result.status, 200); assert.equal(h.fetches.length, 1);
    assert.equal(h.fetches[0].url.searchParams.get('q'), query); assert.equal(h.fetches[0].url.searchParams.get('start'), String(start));
    assert.equal(h.rpcs.filter(call => call.name === 'claim_people_search').length, 1);
    assert.ok(h.events.indexOf('claim_people_search') < h.events.indexOf('dispatch'));
    assert.equal(h.pending().length, 0); assert.equal(h.logs.get(ID)?.confirmation?.p_cost_usd, .005);
  }
});

test('quota refusal and unavailable quota release the reservation before any provider dispatch', async () => {
  for (const [options, expectedStatus] of [[{ quota: { allowed: false, reason: 'Daily cap reached.' } }, 429], [{ quotaError: true }, 503], [{ quota: null }, 503], [{ quota: { allowed: 'yes' } }, 503]] as const) {
    const h = harness(options); const result = await h.send('people_search', JSON.stringify({ query: 'engineer', start: 1 }));
    assert.equal(result.status, expectedStatus); assert.equal(h.pending().length, 0); assert.equal(h.fetches.length, 0);
    assert.equal(h.events.includes('dispatch'), false); assert.equal(h.rpcs.filter(call => call.name === 'ai_release_call').length, 1);
    assert.equal(h.rpcs.find(call => call.name === 'ai_release_call')?.args.p_definitive_no_charge, false);
  }
});

test('the authoritative reserved provider is validated again before quota and dispatch', async () => {
  const h = harness({ reservedConfig: { ...search, feature: 'profile_briefing' } });
  const result = await h.send('profile_briefing', '{"query":"engineer","start":99}');
  assert.equal(result.status, 400); assert.equal(h.rpcs.filter(call => call.name === 'ai_reserve_call').length, 1);
  assert.equal(h.rpcs.some(call => call.name === 'claim_people_search'), false); assert.equal(h.events.includes('dispatch'), false);
  assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0); assert.equal(h.rpcs.filter(call => call.name === 'ai_release_call').length, 1);
});

test('invalid nested search releases the parent and cannot consume child quota', async () => {
  const h = harness(); const result = await h.send('profile_briefing', 'Draft with public context.', { tools: [{ name: 'people_search', query: '{broken JSON' }] });
  assert.equal(result.status, 400); assert.equal(h.rpcs.filter(call => call.name === 'ai_reserve_call').length, 1);
  assert.equal(h.rpcs.some(call => call.name === 'claim_people_search'), false); assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0);
});

test('nested plain-query search keeps parent-first reservation and confirms both real usage results', async () => {
  const h = harness(); const result = await h.send('profile_briefing', 'Draft with public context.', { tools: [{ name: 'people_search', query: '  site:linkedin.com/in/ engineer  ' }] });
  assert.equal(result.status, 200);
  assert.deepEqual(h.rpcs.filter(call => call.name === 'ai_reserve_call').map(call => call.args.p_feature), ['profile_briefing', 'people_search']);
  assert.deepEqual(h.fetches.map(call => call.url.hostname), ['customsearch.googleapis.com', 'generativelanguage.googleapis.com']);
  assert.equal(h.fetches[0].url.searchParams.get('q'), 'site:linkedin.com/in/ engineer'); assert.equal(h.fetches[0].url.searchParams.get('start'), '1');
  assert.match(String(h.fetches[1].init?.body), /Unverified public search snippets/);
  assert.equal(h.pending().length, 0); assert.equal(h.logs.size, 2); assert.equal(h.logs.get(ID)?.confirmation?.p_cost_usd, .005025);
});

test('Gemini canonical secret wins; exact existing Gemini AOI Key is the fallback', async () => {
  for (const [canonical, legacy, expected] of [[' fake-preferred ', 'fake-existing', 'fake-preferred'], [undefined, 'fake-existing', 'fake-existing'], ['   ', ' fake-existing ', 'fake-existing']] as const) {
    const h = harness({ env: { GEMINI_API_KEY: canonical, 'Gemini AOI Key': legacy } });
    const result = await h.send('profile_briefing', 'A profile brief.');
    assert.equal(result.status, 200); assert.equal(new Headers(h.fetches[0].init?.headers).get('x-goog-api-key'), expected);
    if (canonical?.trim()) assert.equal(h.envReads.includes('Gemini AOI Key'), false);
    else assert.equal(h.envReads.includes('Gemini AOI Key'), true);
    const response = await result.text(); assert.equal(response.includes(expected), false);
  }
});

test('missing Gemini secrets or unconfirmed paid project release without dispatch', async () => {
  for (const env of [{ GEMINI_API_KEY: undefined, 'Gemini AOI Key': undefined }, { GEMINI_API_KEY: undefined, 'Gemini AOI Key': 'fake-existing', GEMINI_PAID_PROJECT_CONFIRMED: 'false' }]) {
    const h = harness({ env }); const result = await h.send('profile_briefing', 'A profile brief.');
    assert.equal(result.status, 503); assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0);
    assert.equal(h.events.includes('dispatch'), false); assert.equal(h.rpcs.filter(call => call.name === 'ai_release_call').length, 1);
  }
});

test('processing/data-control gates still refuse before reservation', async () => {
  for (const key of ['AI_PROCESSING_ENABLED', 'AI_PROVIDER_DATA_CONTROLS_CONFIRMED']) {
    const h = harness({ env: { [key]: 'false', GEMINI_API_KEY: undefined, 'Gemini AOI Key': 'fake-existing' } });
    assert.equal((await h.send('profile_briefing', 'A profile brief.')).status, 503);
    assert.equal(h.rpcs.length, 0); assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0);
  }
});

test('missing search configuration releases before quota claim or dispatch', async () => {
  for (const key of ['GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID', 'GOOGLE_SEARCH_ENABLED']) {
    const h = harness({ env: { [key]: undefined } });
    assert.equal((await h.send('people_search', 'engineer')).status, 503);
    assert.equal(h.rpcs.some(call => call.name === 'claim_people_search'), false); assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0);
  }
});

test('failed or false release is reported as pending, never as a clean no-charge failure', async () => {
  for (const release of ['false', 'error'] as const) {
    const h = harness({ release, env: { GEMINI_API_KEY: undefined } });
    const result = await h.send('profile_briefing', 'A profile brief.');
    assert.equal(result.status, 503); assert.equal((await result.json()).error, 'release_pending');
    assert.equal(h.pending().length, 1); assert.equal(h.pending()[0].dispatched, false); assert.equal(h.fetches.length, 0);
  }
});

test('definitive provider rejection releases, while attempted search quota remains consumed', async () => {
  const h = harness({ fetcher: async () => new Response('', { status: 403 }) });
  const result = await h.send('people_search', 'engineer');
  assert.equal(result.status, 502); assert.equal(h.fetches.length, 1); assert.equal(h.pending().length, 0);
  assert.equal(h.rpcs.filter(call => call.name === 'claim_people_search').length, 1);
  assert.equal(h.rpcs.find(call => call.name === 'ai_release_call')?.args.p_definitive_no_charge, true);
  assert.equal((await result.json()).message, 'The provider rejected this request. Its reservation was released.');
});

test('timeouts, 5xx, and missing usage preserve unknown-outcome reservations', async () => {
  const outcomes = [async () => { throw new TypeError('Synthetic network uncertainty'); }, async () => new Response('', { status: 500 }), async () => Response.json({ candidates: [] })];
  for (const fetcher of outcomes) {
    const h = harness({ fetcher }); const result = await h.send('profile_briefing', 'A profile brief.');
    assert.equal(result.status, 502); assert.equal(h.pending().length, 1); assert.equal(h.pending()[0].dispatched, true);
    assert.equal(h.rpcs.some(call => call.name === 'ai_release_call'), false); assert.equal(h.rpcs.some(call => call.name === 'ai_confirm_call'), false);
    assert.match((await result.json()).message, /uncertain.*reservation is retained/);
  }
});

test('actual usage confirmation is not replaced with a reservation estimate', async () => {
  const h = harness(); const result = await h.send('profile_briefing', 'A profile brief.');
  assert.equal(result.status, 200); const confirmed = h.logs.get(ID)?.confirmation;
  assert.deepEqual([confirmed?.p_tokens_in, confirmed?.p_tokens_out, confirmed?.p_cached_tokens_in, confirmed?.p_cache_write_tokens_in, confirmed?.p_cost_usd], [1000, 400, 200, 0, .005025]);
  assert.equal((await result.json()).text, 'A useful draft.');
  const request = JSON.parse(String(h.fetches[0].init?.body));
  assert.equal(request.store, false); assert.equal(request.generationConfig.candidateCount, 1);
  assert.equal(request.generationConfig.maxOutputTokens, 2048); assert.equal(request.generationConfig.thinkingConfig.thinkingBudget, 1024);
});

test('confirmation failure preserves the dispatched reservation and prohibits automatic retry', async () => {
  for (const confirmation of ['false', 'error'] as const) {
    const h = harness({ confirmation }); const result = await h.send('profile_briefing', 'A profile brief.');
    assert.equal(result.status, 503); assert.equal((await result.json()).error, 'confirmation_pending');
    assert.equal(h.pending().length, 1); assert.equal(h.rpcs.some(call => call.name === 'ai_release_call'), false);
  }
});

test('budget refusal and duplicate parent requests cannot spend on child tools', async () => {
  const refused = harness({ reserveError: true });
  const input = { tools: [{ name: 'people_search', query: 'engineer' }] };
  assert.equal((await refused.send('profile_briefing', 'Draft.', input)).status, 429);
  assert.equal(refused.fetches.length, 0); assert.equal(refused.rpcs.some(call => call.name === 'claim_people_search'), false);
  const h = harness(); assert.equal((await h.send('profile_briefing', 'Draft.', input)).status, 200);
  assert.equal((await h.send('profile_briefing', 'Draft.', input)).status, 409);
  assert.equal(h.fetches.length, 2); assert.equal(h.rpcs.filter(call => call.name === 'claim_people_search').length, 1);
});

test('a failed dispatch marker releases a valid search reservation and does not call the provider', async () => {
  const h = harness({ dispatchError: true }); const result = await h.send('people_search', 'engineer');
  assert.equal(result.status, 503); assert.equal(h.fetches.length, 0); assert.equal(h.pending().length, 0);
  assert.equal(h.rpcs.filter(call => call.name === 'claim_people_search').length, 1);
});


test('short Flash slots use zero thinking from their frozen configuration, while usage stays measured', async () => {
  for (const feature of ['classify_ask', 'search_keywords']) {
    const flash: Config = { ...base, feature, model: 'gemini-2.5-flash', weight: 0, input_usd_per_million: .30, cached_input_usd_per_million: .03, output_usd_per_million: 2.50, reasoning_token_allowance: 0, revision: 2 };
    // Simulate a registry update between the initial read and atomic reservation.
    // The snapshot returned by SQL must govern the dispatch, including zero.
    const h = harness({ configs: { [feature]: { ...flash, reasoning_token_allowance: 1024, revision: 1 } }, reservedConfig: flash,
      fetcher: async () => Response.json({ candidates: [{ content: { parts: [{ text: feature === 'classify_ask' ? 'find_people' : 'engineer product' }] } }], usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 25, thoughtsTokenCount: 0 } }),
    });
    const result = await h.send(feature, 'Find product engineering leaders.', { maxTokens: 128 });
    assert.equal(result.status, 200); assert.equal(h.fetches.length, 1);
    const request = JSON.parse(String(h.fetches[0].init?.body));
    assert.equal(h.fetches[0].url.pathname, '/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(request.generationConfig.maxOutputTokens, 128); assert.equal(request.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal(request.store, false); assert.equal(h.pending().length, 0);
    const confirmed = h.logs.get(ID)?.confirmation;
    assert.deepEqual([confirmed?.p_tokens_in, confirmed?.p_tokens_out, confirmed?.p_cached_tokens_in, confirmed?.p_cost_usd], [70, 25, 0, .0000835]);
  }
});


test('upstream diagnostics contain only fixed fields and never reach the client response', async () => {
  const privateValue = 'PRIVATE_KEY_AND_PROMPT_MARKER';
  const h = harness({ fetcher: async () => Response.json({ error: { code: 403, status: 'PERMISSION_DENIED', message: privateValue, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_SERVICE_BLOCKED', domain: privateValue, metadata: { apiKey: privateValue, prompt: privateValue } }] } }, { status: 403 }) });
  const response = await h.send('profile_briefing', privateValue);
  assert.equal(response.status, 502); assert.equal(h.pending().length, 0); assert.equal(h.fetches.length, 1);
  assert.deepEqual(h.diagnostics, [{ event: 'ai_provider_failure', requestId: ID, provider: 'gemini', httpStatus: 403, code: 'PERMISSION_DENIED', reason: 'API_KEY_SERVICE_BLOCKED' }]);
  assert.equal(JSON.stringify(h.diagnostics).includes(privateValue), false);
  const body = await response.text(); assert.equal(body.includes(privateValue), false); assert.equal(body.includes('API_KEY_SERVICE_BLOCKED'), false);
});

test('an invalid store field becomes a fixed diagnostic without silently changing the request', async () => {
  const h = harness({ fetcher: async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "store": Cannot find field. PRIVATE_PROMPT_MARKER' } }, { status: 400 }) });
  assert.equal((await h.send('profile_briefing', 'Synthetic input.')).status, 502);
  assert.equal(h.fetches.length, 1); assert.equal(JSON.parse(String(h.fetches[0].init?.body)).store, false);
  assert.deepEqual(h.diagnostics, [{ event: 'ai_provider_failure', requestId: ID, provider: 'gemini', httpStatus: 400, code: 'INVALID_ARGUMENT', reason: 'INVALID_FIELD_STORE' }]);
  assert.equal(h.pending().length, 0); assert.equal(JSON.stringify(h.diagnostics).includes('PRIVATE_PROMPT_MARKER'), false);
});

test('diagnostic logging failure cannot change release or unknown-outcome reservation rules', async () => {
  for (const status of [403, 500]) {
    const h = harness({ diagnostic: () => { throw new Error('Synthetic logging failure'); }, fetcher: async () => Response.json({ error: { status: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL' } }, { status }) });
    const response = await h.send('profile_briefing', 'Synthetic input.');
    assert.equal(response.status, 502); assert.equal(h.fetches.length, 1); assert.equal(h.diagnostics.length, 1);
    assert.equal(h.pending().length, status === 403 ? 0 : 1);
    assert.equal(h.rpcs.filter(call => call.name === 'ai_release_call').length, status === 403 ? 1 : 0);
  }
});
