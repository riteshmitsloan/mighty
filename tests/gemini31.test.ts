import test from 'node:test';
import assert from 'node:assert/strict';
import {gemini, geminiGenerationConfig, geminiUsage} from '../supabase/functions/ai-gateway/adapters/gemini';
import {priceUsage, type Config, type GatewayInput} from '../supabase/functions/_shared/contracts';
import {geminiFailureDiagnostic} from '../supabase/functions/_shared/provider-diagnostics';
const input: GatewayInput = {feature: 'classify_ask', system: 'Return JSON only.', user: 'Synthetic classification.', maxTokens: 128, tools: []};
const config: Config = {feature: input.feature, provider: 'gemini', model: 'gemini-3.1-flash-lite', tier: 'standard', weight: 0,
  cache_ttl_days: 0, max_tokens: 128, max_prompt_bytes: 16000, input_usd_per_million: .25, cached_input_usd_per_million: .025,
  cache_write_usd_per_million: 0, output_usd_per_million: 1.5, fixed_cost_usd: 0, reasoning_token_allowance: 0,
  rates_valid_until: '2026-12-31', enabled: true, revision: 2};
test('the exact reviewed Flash-Lite model uses minimal effort without legacy budget or candidate count', () => {
  assert.deepEqual(geminiGenerationConfig(input, config), {maxOutputTokens: 128, thinkingConfig: {thinkingLevel: 'minimal'}});
});
test('the same model uses low effort for a reserved positive reasoning allowance and never expands total output', () => {
  assert.deepEqual(geminiGenerationConfig({...input, maxTokens: 8192}, {...config, max_tokens: 2048, reasoning_token_allowance: 1024}),
    {maxOutputTokens: 2048, thinkingConfig: {thinkingLevel: 'low'}});
});
test('existing Gemini 2.5 Flash and Pro requests retain their valid budget configuration', () => {
  assert.deepEqual(geminiGenerationConfig(input, {...config, model: 'gemini-2.5-flash'}), {maxOutputTokens: 128, thinkingConfig: {thinkingBudget: 0}, candidateCount: 1});
  assert.deepEqual(geminiGenerationConfig({...input, maxTokens: 2048}, {...config, model: 'gemini-2.5-pro', max_tokens: 2048, reasoning_token_allowance: 1024}),
    {maxOutputTokens: 2048, thinkingConfig: {thinkingBudget: 1024}, candidateCount: 1});
});
test('Flash-Lite sends store false, the exact model endpoint and the original synthetic request, and meters thought tokens', async () => {
  let calls = 0;
  const result = await gemini(input, config, 'fake-test-key', (async (url, init) => {
    calls++; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    const request = JSON.parse(String(init?.body)); assert.equal(request.store, false); assert.deepEqual(request.generationConfig, {maxOutputTokens: 128, thinkingConfig: {thinkingLevel: 'minimal'}});
    assert.equal(request.contents[0].parts[0].text, input.user); assert.equal(request.systemInstruction.parts[0].text, input.system);
    return Response.json({candidates: [{content: {parts: [{text: 'Private thoughts', thought: true}, {text: '{"route":"person"}'}]}}],
      usageMetadata: {promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 12, thoughtsTokenCount: 8}});
  }) as typeof fetch);
  assert.equal(calls, 1); assert.equal(result.text, '{"route":"person"}'); assert.equal(result.usage.tokensOut, 20);
  assert.equal(priceUsage(result.usage, config), .0000505);
});
test('empty thought-only output still retains its actual usage for gateway confirmation', () => {
  assert.deepEqual(geminiUsage({usageMetadata: {promptTokenCount: 20, thoughtsTokenCount: 128}}), {tokensIn: 20, tokensOut: 128, cachedTokensIn: 0, cacheWriteTokensIn: 0});
});
test('a known new-user model restriction becomes a finite server diagnostic without disclosing provider text', async () => {
  const diagnostic = await geminiFailureDiagnostic(Response.json({error: {status: 'NOT_FOUND', message: 'This model models/gemini-2.5-flash is no longer available to new users. PRIVATE_PROJECT_AND_KEY'}}, {status: 404}));
  assert.deepEqual(diagnostic, {provider: 'gemini', httpStatus: 404, code: 'NOT_FOUND', reason: 'MODEL_NEW_USER_RESTRICTED'});
  assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
  const unknown = await geminiFailureDiagnostic(Response.json({error: {status: 'NOT_FOUND', message: 'An arbitrary private failure'}}, {status: 404}));
  assert.equal(unknown.reason, 'UNSPECIFIED');
});
