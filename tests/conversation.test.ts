import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDraft, prepareConversation, eligibleConversationClaims, type ConversationInput} from '../src/lib/conversation';
import {buildCandidateEvidence, createEvidenceClaim, type EvidenceClaim} from '../src/lib/evidence';
import type {Goal} from '../src/lib/goals';
import type {GatewayCall} from '../src/lib/platform';

const own = (changes: Partial<EvidenceClaim> = {}) => createEvidenceClaim({subject: 'self', field: 'context', text: 'Led a team of 8 finance specialists',
  sourceLabel: 'Résumé', sourceRef: 'resume:one', sourceKind: 'resume', appliesTo: 'contact', confidence: 'observed', ...changes});
function input(): ConversationInput {
  const goal: Goal = {id: 'career-one', kind: 'career', title: 'Find a CFO opportunity', outcome: 'Explore CFO opportunities in India',
    criteria: [], openQuestions: [], version: 1, status: 'active', createdAt: '2026-09-12', updatedAt: '2026-09-12'};
  const candidate = buildCandidateEvidence({key: 'sam', name: 'Sam Rivera', role: 'CFO', company: 'Acme'}); const self = own();
  return {goal, candidate, selfEvidence: [self], selectedCandidateClaimIds: [candidate.claims.find(c => c.field === 'role')!.id],
    selectedSelfClaimIds: [self.id], intent: 'I’m exploring a finance leadership role', ask: 'Would you be open to a brief conversation?', channel: 'email'};
}
function validResponse(user: string): string {
  const payload = JSON.parse(user);
  return JSON.stringify({version: 1, greeting: 'hi', facts: [...payload.selectedEvidence].reverse().map((c: {claimId: string; quote: string}) => ({claimId: c.claimId, quote: c.quote})),
    intent: payload.intent, ask: payload.ask, closing: 'thank_you'});
}
function gateway(mutator: (value: Record<string, any>) => void = () => {}): GatewayCall {
  return async request => { const value = JSON.parse(validResponse(request.user)); mutator(value); return {text: JSON.stringify(value), remaining: 7}; };
}

test('local drafting cites selected exact facts and keeps the goal as intent rather than established expertise', async () => {
  const source = input(); const result = await createLocalDraft(source);
  assert.equal(result.mode, 'local'); assert.equal(result.goalId, source.goal.id); assert.equal(result.candidateKey, 'sam');
  assert.ok(result.text.includes('“CFO”')); assert.ok(result.text.includes('“Led a team of 8 finance specialists”'));
  assert.ok(result.text.includes(source.intent)); assert.ok(result.text.includes(source.ask));
  assert.equal(result.text.includes('I am a CFO'), false); assert.equal(result.text.includes('India'), false);
  assert.equal(result.citations.length, 2); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.citations));
});
test('a source-poor draft stays useful with no fabricated background, familiarity or available opportunity', async () => {
  const source = input(); const result = await createLocalDraft({...source, selectedCandidateClaimIds: [], selectedSelfClaimIds: []});
  assert.deepEqual(result.citations, []); assert.ok(result.text.includes(source.ask));
  assert.equal(/background|8|CFO|we met|opening|available role/i.test(result.text), false);
  assert.ok(result.unknowns.some(u => u.includes('No candidate'))); assert.ok(result.unknowns.some(u => u.includes('No self')));
  assert.ok(result.unknowns.some(u => u.includes('willingness')));
});
test('facts require explicit selection and unrelated private evidence never enters the gateway payload', async () => {
  const source = input(); const privateClaim = own({text: 'UNSELECTED_PRIVATE_SELF'}); const candidate = buildCandidateEvidence({key: 'sam', name: 'Sam', role: 'CFO', manualContext: 'UNSELECTED_PRIVATE_CANDIDATE'});
  const selected = candidate.claims.find(c => c.field === 'role')!;
  let calls = 0;
  await prepareConversation({...source, candidate, selfEvidence: [...source.selfEvidence, privateClaim], selectedCandidateClaimIds: [selected.id]}, {useAi: true,
    gateway: async request => { calls++; assert.equal(request.feature, 'message_drafting'); assert.equal(request.maxTokens, 2048);
      assert.equal(request.user.includes('UNSELECTED_PRIVATE'), false); assert.equal(request.user.includes(privateClaim.id), false);
      const parsed = JSON.parse(request.user); assert.equal(parsed.goal.id, source.goal.id); assert.equal('goals' in parsed, false);
      return {text: validResponse(request.user), remaining: 5}; }});
  assert.equal(calls, 1);
});
test('AI preparation is opt-in and missing gateway keeps the local draft', async () => {
  let calls = 0; const source = input(); const call: GatewayCall = async () => { calls++; throw Error('unexpected'); };
  assert.equal((await prepareConversation(source, {gateway: call})).mode, 'local'); assert.equal(calls, 0);
  const unavailable = await prepareConversation(source, {useAi: true}); assert.equal(unavailable.mode, 'local'); assert.match(unavailable.notice!, /unavailable/);
});
test('a valid AI recipe can reorder exact selected evidence and use a fixed tone without adding claims', async () => {
  const source = input(); const result = await prepareConversation(source, {useAi: true, gateway: gateway()});
  assert.equal(result.mode, 'ai'); assert.equal(result.notice, null); assert.equal(result.remaining, 7);
  assert.ok(result.text.startsWith('Hi Sam Rivera,')); assert.equal(result.citations[0].subject, 'self');
  const allowed = new Set([...source.candidate.claims, ...source.selfEvidence].map(c => `${c.id}:${c.text}`));
  assert.ok(result.citations.every(c => allowed.has(`${c.claimId}:${c.quote}`)));
});
test('a provider request failure performs no retry and does not expose raw errors or claim the call was free', async () => {
  let calls = 0; const result = await prepareConversation(input(), {useAi: true, gateway: async () => { calls++; throw Error('SECRET_KEY=abc PROMPT=private'); }});
  assert.equal(calls, 1); assert.equal(result.mode, 'local'); assert.match(result.notice!, /failed/);
  assert.equal(/SECRET|PROMPT|free|not charged/i.test(result.notice!), false); assert.equal(result.remaining, undefined);
});
test('free text and malformed JSON are refused as generated claims while quota state survives', async () => {
  for (const response of ['I have raised $50 million and know you well.', '```json\n{}\n```', '{broken']) {
    const result = await prepareConversation(input(), {useAi: true, gateway: async () => ({text: response, remaining: 4})});
    assert.equal(result.mode, 'local'); assert.equal(result.remaining, 4); assert.match(result.notice!, /could not be verified/);
    assert.equal(result.text.includes('$50 million'), false);
  }
});
test('unsupported metrics, unselected facts and changed quotations cannot enter an AI draft', async () => {
  for (const change of [(value: any) => { value.facts[0].quote = 'Led a team of 800 specialists'; },
    (value: any) => { value.facts[0].claimId = 'unselected'; }, (value: any) => { value.facts.push({claimId: 'new', quote: 'We are friends'}); }]) {
    const result = await prepareConversation(input(), {useAi: true, gateway: gateway(change)});
    assert.equal(result.mode, 'local'); assert.equal(/800|We are friends/.test(result.text), false);
  }
});
test('AI cannot mutate the user request, add unchecked fields, omit facts or duplicate citations', async () => {
  for (const change of [(value: any) => { value.ask = 'Please send me a job offer'; }, (value: any) => { value.intent = 'I am a CFO'; },
    (value: any) => { value.message = 'An unsupported freeform message'; }, (value: any) => { value.facts.pop(); },
    (value: any) => { value.facts[1] = value.facts[0]; }, (value: any) => { value.greeting = ['hi']; }]) {
    assert.equal((await prepareConversation(input(), {useAi: true, gateway: gateway(change)})).mode, 'local');
  }
});
test('writing, derived synthesis, web snippets, identifiers and opportunity facts are not background personalization evidence', () => {
  const facts = [own(), own({field: 'writing', sourceKind: 'writing'}), own({sourceKind: 'knowledge', derivedFrom: ['raw']}),
    own({sourceKind: 'web'}), own({field: 'email'}), own({field: 'name'}), own({field: 'url'}), own({appliesTo: 'opportunity'}), own({polarity: 'negative'})];
  assert.deepEqual(eligibleConversationClaims(facts, 'self').map(c => c.id), [facts[0].id]);
});
test('selection refuses a deleted, foreign-candidate, wrong-subject, overlong, or duplicated fact', async () => {
  const source = input();
  await assert.rejects(createLocalDraft({...source, selectedCandidateClaimIds: ['deleted']}), /unavailable/);
  await assert.rejects(createLocalDraft({...source, selectedSelfClaimIds: source.selectedCandidateClaimIds}), /unavailable/);
  await assert.rejects(createLocalDraft({...source, selectedSelfClaimIds: [source.selfEvidence[0].id, source.selfEvidence[0].id]}), /distinct/);
  const foreign = own({subject: 'candidate', subjectKey: 'another'});
  await assert.rejects(createLocalDraft({...source, candidate: {...source.candidate, claims: [foreign]}, selectedCandidateClaimIds: [foreign.id]}), /unavailable/);
  const long = own({text: 'x'.repeat(501)});
  await assert.rejects(createLocalDraft({...source, selfEvidence: [long], selectedSelfClaimIds: [long.id]}), /500/);
});
test('known explicit contradiction must be resolved before an observed fact is used in outreach', async () => {
  const source = input(); const positive = source.selfEvidence[0]; const negative = own({polarity: 'negative'});
  await assert.rejects(createLocalDraft({...source, selfEvidence: [positive, negative]}), /conflicting evidence/);
});
test('oversized local content and invalid user input fail before any provider request', async () => {
  let calls = 0; const call: GatewayCall = async () => { calls++; throw Error('unexpected'); }; const source = input();
  for (const invalid of [{...source, intent: ''}, {...source, ask: 'x'.repeat(401)}, {...source, channel: 'other' as 'email'}]) {
    await assert.rejects(prepareConversation(invalid, {useAi: true, gateway: call}));
  }
  const claims = [own({text: 'a'.repeat(500)}), own({text: 'b'.repeat(500)})];
  const candidate = buildCandidateEvidence({key: 'sam', name: 'Sam', role: 'c'.repeat(500), company: 'd'.repeat(500)});
  await assert.rejects(prepareConversation({...source, channel: 'linkedin', candidate, selfEvidence: claims,
    selectedSelfClaimIds: claims.map(c => c.id), selectedCandidateClaimIds: candidate.claims.filter(c => ['role', 'company'].includes(c.field)).map(c => c.id)}, {useAi: true, gateway: call}), /exceeds 2000/);
  assert.equal(calls, 0);
});
test('large goal input falls back before dispatch and an excessive provider response is refused', async () => {
  const source = input(); let calls = 0;
  const largeGoal = await prepareConversation({...source, goal: {...source.goal, outcome: '你'.repeat(8_000)}}, {useAi: true, gateway: async () => { calls++; throw Error('unexpected'); }});
  assert.equal(calls, 0); assert.equal(largeGoal.mode, 'local'); assert.match(largeGoal.notice!, /exceeds the AI/);
  const excessive = await prepareConversation(source, {useAi: true, gateway: async () => ({text: 'x'.repeat(8_001), remaining: 6})});
  assert.equal(excessive.mode, 'local'); assert.equal(excessive.remaining, 6);
});
test('fingerprint binds the one goal version, candidate, channel, selected facts, source provenance and exact copy', async () => {
  const source = input(); const original = await createLocalDraft(source); assert.equal(original.fingerprint, (await createLocalDraft(source)).fingerprint);
  for (const changed of [{...source, goal: {...source.goal, version: 2}}, {...source, channel: 'linkedin' as const}, {...source, ask: 'May I ask one question?'},
    {...source, selfEvidence: [{...source.selfEvidence[0], sourceRef: 'another-source'}]}]) {
    assert.notEqual(original.fingerprint, (await createLocalDraft(changed)).fingerprint);
  }
});
test('async drafting snapshots selection and source facts without freezing caller-owned inputs', async () => {
  const source = input(); const mutableClaim = {...source.selfEvidence[0]}; const mutable = {...source, selfEvidence: [mutableClaim]};
  const result = await prepareConversation(mutable, {useAi: true, gateway: async request => { mutableClaim.text = 'Changed while waiting'; return {text: validResponse(request.user), remaining: 7}; }});
  assert.ok(result.text.includes('8 finance specialists')); assert.equal(result.text.includes('Changed while waiting'), false);
  assert.equal(Object.isFrozen(mutable), false); assert.equal(Object.isFrozen(mutableClaim), false);
});
