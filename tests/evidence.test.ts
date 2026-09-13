import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSelfEvidence, buildCandidateEvidence, candidateKey, createEvidenceClaim, createEvidenceSnapshot, evidenceFingerprint, type EvidenceClaim} from '../src/lib/evidence';
import type {LocalSources} from '../src/lib/workspace';
import type {ArchiveResult} from '../src/lib/archive';
import type {KnowledgeState} from '../src/lib/knowledge';

function archive(): ArchiveResult {
  return {fingerprint: 'archive-one', layer1: {id: 'layer-one', fingerprint: 'facts-one', importedAt: '2026-09-12T00:00:00Z',
    profile: [{'First Name': 'Alex', 'Last Name': 'Rivera'}], positions: [{'Company Name': 'Acme &amp; Sons', Title: 'CFO', Industry: 'Manufacturing'}],
    education: [{School: 'Example University', Degree: 'MSc'}], skills: [{Name: 'Forecasting'}]},
    verifiedAccountHolder: null, connections: [], writingSamples: [], counts: {connections: 0, positions: 1, education: 1, skills: 1,
      messages: 0, sentMessages: 0, receivedMessages: 0, unidentifiedMessages: 0, threads: 0, invitations: 0}, companyIndex: {}, warnings: []};
}
const candidateClaim = (changes: Partial<EvidenceClaim> = {}) => createEvidenceClaim({subject: 'candidate', field: 'industry', text: 'FMCG',
  sourceLabel: 'Confirmed conversation', sourceKind: 'manual', confidence: 'user_confirmed', appliesTo: 'contact', ...changes});

test('archive evidence preserves raw cells and source identity without changing or freezing the import', () => {
  const source = archive(); const before = JSON.stringify(source); const claims = buildSelfEvidence({archive: source});
  const company = claims.find(c => c.field === 'company')!;
  assert.equal(company.text, 'Acme &amp; Sons'); assert.equal(company.sourceRef, 'archive:facts-one/positions/0/Company%20Name');
  assert.equal(company.observedAt, source.layer1.importedAt); assert.equal(JSON.stringify(source), before);
  assert.equal(Object.isFrozen(source.layer1), false); assert.ok(Object.isFrozen(claims)); assert.ok(claims.every(Object.isFrozen));
  assert.ok(claims.some(c => c.field === 'education')); assert.ok(claims.some(c => c.field === 'skill'));
});
test('a connection row supplies company and role but no guessed sector, location, or complete profile', () => {
  const person = buildCandidateEvidence({firstName: 'Sam', lastName: 'Lee', company: 'Unilever', position: 'CEO', url: 'https://linkedin.com/in/sam', completeProfile: true, profileReadAt: 'today'});
  assert.equal(person.completeProfile, false); assert.ok(person.claims.some(c => c.field === 'role' && c.sourceKind === 'archive'));
  assert.equal(person.claims.some(c => c.field === 'industry' || c.field === 'location'), false);
});
test('rendered profile anchors retain actual source references and only explicit full-profile observations can be complete', () => {
  const input = {name: 'Sam', profileReadAt: '2026-09-12T00:00:00Z', completeProfile: true,
    anchors: [{kind: 'headline', text: 'CEO'}, {kind: 'industry', text: 'FMCG', sourceUrl: 'https://linkedin.com/in/sam', observedAt: '2026-09-12T00:00:00Z'}]};
  const result = buildCandidateEvidence(input); assert.equal(result.completeProfile, true);
  assert.equal(result.claims.find(c => c.field === 'industry')?.sourceRef, 'https://linkedin.com/in/sam');
  assert.equal(buildCandidateEvidence({...input, profileReadAt: null}).completeProfile, false);
  assert.equal(Object.isFrozen(input.anchors), false);
});
test('manual context is user-confirmed evidence and claims from another subject or candidate are refused', () => {
  const good = candidateClaim({subjectKey: 'sam'}); const bad = candidateClaim({subjectKey: 'elsewhere'});
  const own = candidateClaim({subject: 'self'});
  const result = buildCandidateEvidence({key: 'sam', manualContext: 'We met at the finance roundtable.', claims: [good, bad, own]});
  assert.ok(result.claims.some(c => c.confidence === 'user_confirmed' && c.field === 'context'));
  assert.ok(result.claims.some(c => c.id === good.id)); assert.equal(result.claims.some(c => c.id === bad.id || c.id === own.id), false);
});
test('claim creation and snapshots clone nested input instead of freezing caller-owned data', async () => {
  const refs = ['original']; const span = {start: 1, end: 5}; const item = candidateClaim({derivedFrom: refs, span});
  assert.equal(Object.isFrozen(refs), false); refs.push('later'); span.end = 9;
  assert.deepEqual(item.derivedFrom, ['original']); assert.equal(item.span?.end, 5);
  const mutable = {...item, text: 'Original text'}; const snapshot = await createEvidenceSnapshot([mutable]); mutable.text = 'Changed';
  assert.equal(snapshot.claims[0].text, 'Original text'); assert.ok(Object.isFrozen(snapshot.claims[0]));
});
test('resume line spans refer to exact cleaned LF-normalized text and do not infer employers', () => {
  const raw = '\u0000  Built finance tools.\r\n\r\n  Led 8 people.  \n'; const cleaned = '  Built finance tools.\n\n  Led 8 people.  \n';
  const result = buildSelfEvidence({resume: {text: raw, pages: 1, fingerprint: 'resume-one'}});
  assert.equal(result.length, 2); for (const c of result) assert.equal(cleaned.slice(c.span!.start, c.span!.end), c.text);
  assert.ok(result.every(c => c.sourceKind === 'resume' && c.field === 'context' && c.sourceRef === 'resume:resume-one'));
});
test('knowledge proof points retain original evidence references and missing-source synthesis is omitted', () => {
  const knowledge = {fingerprint: 'knowledge-one', createdAt: 'today', knowledge: {proofPoints: [
    {text: 'A finance leader', conversationType: 'hiring', evidenceIds: ['positions:0']},
    {text: 'Unverifiable claim', conversationType: 'hiring', evidenceIds: ['positions:999']}
  ]}} as KnowledgeState;
  const result = buildSelfEvidence({archive: archive(), knowledge}); const point = result.find(c => c.field === 'proof_point')!;
  assert.equal(result.filter(c => c.field === 'proof_point').length, 1); assert.equal(point.sourceKind, 'knowledge');
  assert.ok(point.derivedFrom!.length > 0); assert.ok(point.derivedFrom!.every(id => result.some(c => c.id === id && c.sourceKind === 'archive')));
  assert.equal(buildSelfEvidence({knowledge}).length, 0);
});
test('own writing samples remove quoted received text, forwarded content and signatures, stay capped, and avoid split surrogates', () => {
  const source = archive(); const patterns = ['\n> PRIVATE_RECEIVED', '\nOn Tuesday, Pat wrote:\nPRIVATE_RECEIVED',
    '\n-----Original Message-----\nPRIVATE_RECEIVED', '\nFrom: Pat\nPRIVATE_RECEIVED', '\nBest,\nSIGNATURE'];
  const samples = [...patterns.map(end => `My own sentence.${end}`), 'x'.repeat(11_999) + '😀', ...Array.from({length: 60}, (_, i) => `Own sample ${i}`)];
  const result = buildSelfEvidence({archive: {...source, writingSamples: samples}}).filter(c => c.field === 'writing');
  assert.equal(result.length, 40); assert.ok(result.every(c => !/PRIVATE_RECEIVED|SIGNATURE|[\uD800-\uDBFF]$/.test(c.text)));
  assert.deepEqual(result.slice(0, 5).map(c => c.text), Array(5).fill('My own sentence.'));
});
test('cloud account facts support a fresh device and local sources take precedence without fabricating an archive', () => {
  const source = archive(); const cloud = {archive: {layer1: source.layer1, counts: source.counts, writingSamples: ['Cloud own sample'], companyIndex: {}, fingerprint: source.fingerprint},
    resume: {text: 'Cloud résumé.', pages: 1, fingerprint: 'cloud-resume'}};
  const result = buildSelfEvidence({accountFacts: cloud} as LocalSources);
  assert.ok(result.some(c => c.field === 'company')); assert.ok(result.some(c => c.text === 'Cloud résumé.')); assert.ok(result.some(c => c.text === 'Cloud own sample'));
  const local = buildSelfEvidence({accountFacts: cloud, resume: {text: 'Local résumé.', pages: 1, fingerprint: 'local-resume'}} as LocalSources);
  assert.ok(local.some(c => c.text === 'Local résumé.')); assert.equal(local.some(c => c.text === 'Cloud résumé.'), false);
});
test('canonical profile and email keys are stable while distinct unnamed records remain separate', () => {
  assert.equal(candidateKey({url: 'https://www.linkedin.com/in/sam/?tracking=one'}), candidateKey({url: 'http://linkedin.com/in/sam#about'}));
  assert.equal(candidateKey({email: ' SAM@Example.com '}), 'email:sam@example.com');
  assert.notEqual(candidateKey({name: 'Sam', company: 'A'}), candidateKey({name: 'Sam', company: 'B'}));
  assert.equal(candidateKey({key: 'verified-key', url: 'https://linkedin.com/in/sam'}), 'verified-key');
});
test('evidence fingerprints ignore array ordering but invalidate content, provenance, and source deletion', async () => {
  const first = candidateClaim(); const second = candidateClaim({field: 'role', text: 'CFO'});
  const original = await evidenceFingerprint([first, second]); assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(original, await evidenceFingerprint([second, first]));
  assert.notEqual(original, await evidenceFingerprint([{...first, text: 'Software'}, second]));
  assert.notEqual(original, await evidenceFingerprint([{...first, sourceRef: 'different-source'}, second]));
  assert.notEqual(original, await evidenceFingerprint([second]));
});
test('identical claim IDs deduplicate but ID reuse for contradictory payloads is refused', () => {
  const item = candidateClaim(); const result = buildCandidateEvidence({key: 'sam', claims: [item, {...item}]});
  assert.equal(result.claims.length, 1);
  assert.throws(() => buildCandidateEvidence({key: 'sam', claims: [item, {...item, polarity: 'negative'}]}), /identifier refers to different claims/);
});
