import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeSynthesizer, evidenceFor, knowledgeForStrategyBrief, parseStoredKnowledgeState, validateKnowledge, type KnowledgeInput, type KnowledgeState } from '../src/lib/knowledge';
import type { LayerOneSnapshot } from '../src/lib/archive';
import { buildSelfEvidence } from '../src/lib/evidence';
import type { LocalSources } from '../src/lib/workspace';
const facts: LayerOneSnapshot = {
  id: 'snapshot-1', importedAt: '2026-09-12', fingerprint: 'raw-facts',
  profile: [{ 'First Name': 'Alex', 'Last Name': 'Rivera' }],
  positions: [{ Company: 'Acme', Title: 'Engineering lead', Industry: 'healthcare', Description: 'Led 15 engineers. Shipped 8 products. Raised $5 million.' }],
  education: [{ School: 'MIT', Degree: 'MSc in Computer Science' }],
  skills: [{ Name: 'TypeScript' }, { Name: 'Research' }]
};
const input: KnowledgeInput = { layer1: facts, resumeText: 'Built healthcare software. Mentored 12 people.', directIndustries: [{ industry: 'healthcare', evidenceIds: ['positions:0', 'resume:0'] }] };
const valid = () => ({
  keywords: ['engineering', 'healthcare', 'leadership', 'software', 'product', 'mentoring', 'research', 'TypeScript', 'science', 'hiring', 'fundraising', 'delivery'],
  throughlines: [
    { text: 'Leads engineering teams', evidenceIds: ['positions:0'] },
    { text: 'Builds healthcare software', evidenceIds: ['positions:0', 'resume:0'] },
    { text: 'Teaches others through mentoring', evidenceIds: ['resume:0'] }
  ],
  differentiators: [{ text: 'Led 15 engineers', quote: 'Led 15 engineers.', evidenceIds: ['positions:0'] }],
  proofPoints: [
    { text: 'Raised $5 million', conversationType: 'fundraising', evidenceIds: ['positions:0'] },
    { text: 'Led 15 engineers', conversationType: 'hiring', evidenceIds: ['positions:0'] },
    { text: 'Mentored 12 people', conversationType: 'advisory', evidenceIds: ['resume:0'] },
    { text: 'Built healthcare software', conversationType: 'partnership', evidenceIds: ['resume:0'] }
  ],
  industryQuestions: [{ industry: 'healthcare', evidenceIds: ['positions:0'], questions: ['Where is software hardest to ship?', 'How do teams measure adoption?', 'Which workflows need better tooling?'] }]
});
test('knowledge schema retains 12-25 keywords, 3-5 throughlines, grounded numbers and all four conversation types', () => {
  const k = validateKnowledge(valid(), input); assert.equal(k.keywords.length, 12); assert.equal(k.throughlines.length, 3); assert.equal(k.proofPoints.length, 4); assert.equal(k.industryQuestions[0].questions.length, 3); assert.ok(Object.isFrozen(k));
});
test('raw source facts preserve stable evidence IDs for strategy auditing', () => { const e = evidenceFor(input); assert.equal(e[0].id, 'positions:0'); assert.ok(e.some(x => x.id === 'resume:0')); });
test('unsupported numeric differentiators are refused', () => { const v = valid(); v.differentiators[0].text = 'Led 150 engineers'; assert.throws(() => validateKnowledge(v, input), /unsupported number/); });
test('numeric claims cannot borrow unrelated numbers from uncited sources', () => { const v = valid(); v.proofPoints[0].text = 'Mentored 12 people'; assert.throws(() => validateKnowledge(v, input), /unsupported number/); });
test('a numeric differentiator requires a verbatim source quote', () => { const v = valid(); v.differentiators[0].quote = 'Led a team of 15 engineers.'; assert.throws(() => validateKnowledge(v, input), /real numeric source quote/); });
test('numeric quotes must support the exact number in the claim', () => { const v = valid(); v.differentiators[0].text = 'Led 8 engineers'; assert.throws(() => validateKnowledge(v, input), /unsupported number/); });
test('missing evidence references refuse a response', () => { const v = valid(); v.throughlines[0].evidenceIds = ['made-up']; assert.throws(() => validateKnowledge(v, input), /missing evidence/); });
test('guessed industry experience is rejected', () => { const v = valid(); v.industryQuestions[0].industry = 'banking'; assert.throws(() => validateKnowledge(v, input), /without direct evidence/); });
test('an unrelated education reference cannot establish direct industry experience', () => {
  const changed = { ...input, directIndustries: [{ industry: 'Computer Science', evidenceIds: ['education:0'] }] }; const v = valid(); v.industryQuestions[0].industry = 'Computer Science'; v.industryQuestions[0].evidenceIds = ['education:0'];
  assert.throws(() => validateKnowledge(v, changed), /without direct evidence/);
});
test('each directly evidenced industry needs exactly three questions', () => { const v = valid(); v.industryQuestions[0].questions.pop(); assert.throws(() => validateKnowledge(v, input), /industry questions/); });
test('an unknown conversation type is refused', () => { const v = valid(); v.proofPoints[0].conversationType = 'politics'; assert.throws(() => validateKnowledge(v, input), /unknown conversation type/); });
test('missing numeric accomplishments stay empty instead of being invented', () => { const v = valid(); v.differentiators = []; assert.deepEqual(validateKnowledge(v, input).differentiators, []); });
test('short and duplicated keyword sets are refused', () => {
  const v = valid(); v.keywords.pop(); assert.throws(() => validateKnowledge(v, input), /invalid keywords/);
  const d = valid(); d.keywords[1] = d.keywords[0]; assert.throws(() => validateKnowledge(d, input), /distinct/);
});
test('same content coalesces concurrent calls and uses the free profile_briefing feature', async () => {
  let saved: KnowledgeState | null = null; let calls = 0; let saves = 0;
  const synthesize = createKnowledgeSynthesizer({ read: async () => saved, persist: async state => { saved = state; saves++; return { error: null }; }, gateway: async request => {
    calls++; assert.equal(request.feature, 'profile_briefing'); assert.ok(request.system.includes('untrusted source data')); assert.ok(request.user.startsWith('DATA\n'));
    await new Promise(resolve => setTimeout(resolve, 5)); return { text: JSON.stringify(valid()), remaining: 10 };
  } });
  const [a, b] = await Promise.all([synthesize(input), synthesize(input)]); assert.equal(a, b); assert.equal(calls, 1); assert.equal(saves, 1);
  assert.equal(await synthesize({ ...input, layer1: { ...facts, id: 'new-import-id', importedAt: 'tomorrow' } }), a); assert.equal(calls, 1);
  assert.equal(knowledgeForStrategyBrief(a), a.knowledge);
});
test('resume content changes trigger a new synthesis with no timer', async () => {
  let saved: KnowledgeState | null = null; let calls = 0;
  const synthesize = createKnowledgeSynthesizer({ read: async () => saved, persist: async state => { saved = state; return {}; }, gateway: async () => { calls++; return { text: JSON.stringify(valid()), remaining: 10 }; } });
  const a = await synthesize(input); const b = await synthesize({ ...input, resumeText: input.resumeText + ' Shipped new tools.' }); assert.notEqual(a.fingerprint, b.fingerprint); assert.equal(calls, 2);
});
test('persistence failures are surfaced and do not mark the fingerprint saved', async () => {
  let calls = 0; let failed = true; let saved: KnowledgeState | null = null;
  const synthesize = createKnowledgeSynthesizer({ read: async () => saved, persist: async state => { if (failed) return { error: { message: 'Session expired', code: '42501' } }; saved = state; return {}; }, gateway: async () => { calls++; return { text: JSON.stringify(valid()), remaining: 10 }; } });
  await assert.rejects(synthesize(input), /Session expired.*42501/); assert.equal(saved, null); failed = false;
  await synthesize(input); assert.equal(calls, 2); assert.ok(saved);
});
test('invalid JSON is not persisted and original facts remain untouched', async () => {
  const before = JSON.stringify(input); let writes = 0;
  const synthesize = createKnowledgeSynthesizer({ read: async () => null, persist: async () => { writes++; return {}; }, gateway: async () => ({ text: 'not json', remaining: 10 }) });
  await assert.rejects(synthesize(input), /invalid JSON/); assert.equal(writes, 0); assert.equal(JSON.stringify(input), before);
});
test('empty sources are refused without a model request', async () => {
  let calls = 0; const synthesize = createKnowledgeSynthesizer({ read: async () => null, persist: async () => ({}), gateway: async () => { calls++; return { text: '', remaining: 10 }; } });
  await assert.rejects(synthesize({ layer1: null, resumeText: '' }), /Import an archive or resume/); assert.equal(calls, 0);
});
test('bounded synthesis refuses silent source truncation', async () => {
  let calls = 0; const synthesize = createKnowledgeSynthesizer({ read: async () => null, persist: async () => ({}), gateway: async () => { calls++; return { text: '', remaining: 10 }; } });
  await assert.rejects(synthesize({ ...input, resumeText: '你'.repeat(16_000) }), /input limit/); assert.equal(calls, 0);
});

const stored = () => ({fingerprint: 'persisted-knowledge', createdAt: '2026-09-12T00:00:00.000Z', knowledge: valid()});
test('persisted knowledge accepts the complete current schema without changing or freezing stored JSON', () => {
  const state = stored(); const before = JSON.stringify(state);
  assert.equal(parseStoredKnowledgeState(state), state);
  assert.equal(knowledgeForStrategyBrief(state), state.knowledge);
  assert.equal(JSON.stringify(state), before); assert.equal(Object.isFrozen(state.knowledge.proofPoints), false);
  const claims = buildSelfEvidence({resume: {text: input.resumeText, pages: 1, fingerprint: 'resume'}, knowledge: state as KnowledgeState});
  assert.ok(claims.some(item => item.sourceKind === 'knowledge' && item.text === 'Mentored 12 people'));
});
test('legacy or malformed persisted knowledge is ignored as a whole while original source claims survive', () => {
  const corruptions: Array<[string, (state: Record<string, any>) => unknown]> = [
    ['missing wrapper', () => valid()], ['missing inner knowledge', state => { delete state.knowledge; return state; }],
    ['null inner knowledge', state => ({...state, knowledge: null})], ['invalid timestamp', state => ({...state, createdAt: 'not a timestamp'})],
    ['invalid fingerprint', state => ({...state, fingerprint: {value: 'bad'}})],
    ...['keywords', 'throughlines', 'differentiators', 'proofPoints', 'industryQuestions'].map(field => [
      `${field} is not an array`, (state: Record<string, any>) => { state.knowledge[field] = {}; return state; }
    ] as [string, (state: Record<string, any>) => unknown]),
    ['null point', state => { state.knowledge.proofPoints.push(null); return state; }],
    ['wrong point text', state => { state.knowledge.proofPoints[0].text = {}; return state; }],
    ['unknown conversation type', state => { state.knowledge.proofPoints[0].conversationType = 'other'; return state; }],
    ...['throughlines', 'differentiators', 'proofPoints', 'industryQuestions'].flatMap(field => [
      [`${field} string references`, (state: Record<string, any>) => { state.knowledge[field][0].evidenceIds = 'positions:0'; return state; }],
      [`${field} object reference`, (state: Record<string, any>) => { state.knowledge[field][0].evidenceIds = [{}]; return state; }]
    ] as Array<[string, (state: Record<string, any>) => unknown]>),
    ['missing supporting quote', state => { delete state.knowledge.differentiators[0].quote; return state; }],
    ['invalid questions', state => { state.knowledge.industryQuestions[0].questions = 'question'; return state; }],
    ['invalid question member', state => { state.knowledge.industryQuestions[0].questions[0] = {}; return state; }],
    ['missing industry', state => { delete state.knowledge.industryQuestions[0].industry; return state; }]
  ];
  for (const [label, corrupt] of corruptions) {
    const state = corrupt(stored()); const before = JSON.stringify(state);
    assert.equal(parseStoredKnowledgeState(state), null, label);
    assert.equal(knowledgeForStrategyBrief(state), null, label);
    const sources = {resume: {text: 'My original career fact.', pages: 1, fingerprint: 'original'}, knowledge: state} as LocalSources;
    const claims = buildSelfEvidence(sources);
    assert.equal(claims.length, 1, label); assert.equal(claims[0].text, 'My original career fact.', label);
    assert.equal(claims[0].sourceKind, 'resume', label); assert.equal(JSON.stringify(state), before, label);
  }
});
test('a malformed or unsupported same-fingerprint cache cannot bypass synthesis validation', async () => {
  let cache: unknown = null; let calls = 0; let writes = 0;
  const synthesize = createKnowledgeSynthesizer({read: async () => cache,
    persist: async state => { cache = state; writes++; return {}; },
    gateway: async () => { calls++; return {text: JSON.stringify(valid()), remaining: 10}; }
  });
  const good = await synthesize(input);
  const malformed = {fingerprint: good.fingerprint, createdAt: good.createdAt}; cache = malformed;
  const malformedBefore = JSON.stringify(malformed);
  await synthesize(input); assert.equal(calls, 2); assert.equal(writes, 2);
  assert.equal(JSON.stringify(malformed), malformedBefore);
  const forged = structuredClone(good); (forged.knowledge.proofPoints[0] as {text: string}).text = 'Raised $900 million'; cache = forged;
  await synthesize(input); assert.equal(calls, 3); assert.equal(writes, 3);
  assert.equal(forged.knowledge.proofPoints[0].text, 'Raised $900 million');
});
