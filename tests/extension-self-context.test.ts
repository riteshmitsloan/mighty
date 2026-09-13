import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExtensionSelfContext, validateExtensionSelfContext, SELF_CONTEXT_LIMITS} from '../src/lib/extension-self-context';
import {buildSelfEvidence, createEvidenceClaim, evidenceKey, type EvidenceClaim} from '../src/lib/evidence';
import type {LocalSources} from '../src/lib/workspace';
const uid = '11111111-1111-4111-a111-111111111111', other = '22222222-2222-4222-a222-222222222222', now = Date.parse('2026-09-13T12:00:00Z');
const claim = (field: EvidenceClaim['field'], text: string, rest: Partial<EvidenceClaim> = {}) => createEvidenceClaim({subject:'self',field,text,sourceKind:'profile',sourceLabel:'Own profile',confidence:'observed',appliesTo:'contact',...rest});
const rekey = (changes: Record<string, unknown>) => {const {key, ...body} = changes; return {...body,key:evidenceKey(body)};};

test('projection sends only small factual self fields and strips private source paths and metadata', () => {
  const facts = [claim('company','Example Labs',{sourceRef:'private-source-path',observedAt:'2026-09-12T00:00:00Z',span:{start:1,end:13}}), claim('role','Engineer'),claim('education','Example University'),claim('skill','Machine learning')];
  const excluded = [claim('email','owner@example.test'),claim('name','A Person'),claim('context','Private resume paragraph'),claim('writing','Private email body'),claim('skill','Invented',{sourceKind:'knowledge'}),claim('role','Aspirational CEO',{sourceLabel:'Profile headline'}),claim('company','Not employed',{polarity:'negative'}),claim('skill','Derived',{derivedFrom:['raw']}),claim('role','Private fact',{subject:'candidate'}),claim('company','Opportunity',{appliesTo:'opportunity'}),claim('company','Company owner@example.test')];
  const input = [...facts,...excluded], before=structuredClone(input), result = buildExtensionSelfContext(uid,input,now);
  assert.equal(result.claims.length,4);assert.equal(result.omittedCount,0);assert.deepEqual(input,before);
  assert.ok(result.claims.every(value=>value.subject==='self'&&value.appliesTo==='contact'&&value.polarity==='positive'));
  assert.doesNotMatch(JSON.stringify(result),/private-source-path|Private|owner@example|sourceRef|span|derivedFrom/);
  assert.deepEqual(validateExtensionSelfContext(result,uid,now),result);assert.ok(Object.isFrozen(result.claims));
});
test('real archive fields include institutions and skills but not education dates, notes or profile headlines', () => {
  const sources = {accountFacts:{archive:{layer1:{fingerprint:'fixture',importedAt:new Date(now).toISOString(),profile:[{Headline:'AI explorer'}],positions:[{Company:'Example',Title:'Engineer'}],education:[{'School Name':'Example University','Degree Name':'MBA','Start Date':'September 2024',Notes:'Private notes'}],skills:[{Name:'Machine learning'}]}}}} as unknown as LocalSources;
  const context = buildExtensionSelfContext(uid,buildSelfEvidence(sources),now);
  assert.deepEqual(new Set(context.claims.map(value=>value.text)),new Set(['Example','Engineer','Example University','MBA','Machine learning']));
  assert.doesNotMatch(JSON.stringify(context),/September|Private notes|AI explorer|archive:fixture/);
});
test('separate field budgets preserve education and roles despite many skills, with explicit omitted count', () => {
  const facts = [...Array.from({length:50},(_,i)=>claim('skill','Skill '+i)),...Array.from({length:20},(_,i)=>claim('company','Company '+i)),...Array.from({length:10},(_,i)=>claim('education','School '+i)),...Array.from({length:10},(_,i)=>claim('role','Role '+i)),claim('company','COMPANY 0')];
  const result=buildExtensionSelfContext(uid,facts,now);
  assert.deepEqual(Object.fromEntries(['company','skill','education','role'].map(field=>[field,result.claims.filter(value=>value.field===field).length])),{company:16,skill:12,education:8,role:4});
  assert.equal(result.claims.length,40);assert.equal(result.omittedCount,50);assert.ok(validateExtensionSelfContext(result,uid,now));
});
test('long fields are refused whole and UTF-8 payload stays bounded without cutting source text', () => {
  const facts = Array.from({length:50},(_,i)=>claim('company','界'.repeat(195)+i));facts.push(claim('role','x'.repeat(201)));
  const result=buildExtensionSelfContext(uid,facts,now);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<=SELF_CONTEXT_LIMITS.maxBytes);
  assert.ok(result.claims.every(value=>facts.some(original=>original.text===value.text)));
  assert.ok(validateExtensionSelfContext(result,uid,now));
});
test('foreign, stale, future, tampered and unknown-schema contexts yield no facts', () => {
  const original=buildExtensionSelfContext(uid,[claim('skill','Strategy')],now);
  assert.equal(validateExtensionSelfContext(original,other,now),null);
  assert.equal(validateExtensionSelfContext(original,uid,now+SELF_CONTEXT_LIMITS.lifetimeMs+1),null);
  for(const value of [null,{},rekey({...original,capturedAt:now+6000}),rekey({...original,schemaVersion:2}),{...original,claims:[]},rekey({...original,rawResume:'private'}),rekey({...original,claims:[{...original.claims[0],sourceRef:'private'}]}),rekey({...original,claims:[{...original.claims[0],field:'email'}]}),rekey({...original,claims:[{...original.claims[0],subject:'candidate'}]}),rekey({...original,claims:[{...original.claims[0],derivedFrom:['x']}]}),rekey({...original,claims:[original.claims[0],original.claims[0]]})]) assert.equal(validateExtensionSelfContext(value,uid,now),null);
});
test('source removal creates an explicit empty replacement, and account identity changes the context key', () => {
  const facts=[claim('company','Example')], a=buildExtensionSelfContext(uid,facts,now),b=buildExtensionSelfContext(other,facts,now),empty=buildExtensionSelfContext(uid,[],now);
  assert.notEqual(a.key,b.key);assert.notEqual(a.key,empty.key);assert.equal(validateExtensionSelfContext(empty,uid,now)?.claims.length,0);
});
