import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeSynthesizer, evidenceFor, knowledgeForStrategyBrief, validateKnowledge, type KnowledgeInput, type KnowledgeState } from '../src/lib/knowledge';
import type { LayerOneSnapshot } from '../src/lib/archive';
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
