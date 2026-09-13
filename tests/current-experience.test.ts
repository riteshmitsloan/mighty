import test from 'node:test';
import assert from 'node:assert/strict';
import {currentExperienceDateRanges, validCurrentExperienceDate, validCurrentExperienceAnchor} from '../src/lib/current-experience';
const now='2026-09-13T12:00:00.000Z', url='https://www.linkedin.com/in/person/';
const raw={kind:'experience',text:'Role CEO Company Example Jan 2023 – Present',sourceUrl:url+'#experience',observedAt:now};
const timing={...raw,kind:'timing',text:'Jan 2023 – Present'};
const role={...raw,field:'role',text:'CEO',currentExperience:{dateRange:timing.text,entryText:raw.text}};
const valid=(value:unknown=role,anchors:readonly unknown[]=[raw,timing,role])=>validCurrentExperienceAnchor(value,anchors,url,now);
test('explicit current dates accept year, month and valid calendar day without a recency inference',()=>{
  for(const date of ['2023 – Present','January 2023 to Current','2024-02-29 – Present','Sep 2026 – Current'])assert.equal(validCurrentExperienceDate(date,now),true,date);
});
test('current date validation rejects past endings, partial prose, future and nonexistent dates',()=>{
  for(const date of ['2023 – 2025','Past: 2023 – Present','2023 – Present role','2026-02-30 – Present','2026-13-01 – Present','2027 – Present','Oct 2026 – Current','2026-09-14 – Present','Present','2023 – Present'.repeat(10)])assert.equal(validCurrentExperienceDate(date,now),false,date);
  assert.equal(validCurrentExperienceDate('2023 – Present','invalid'),false);
});
test('range extraction preserves full source spelling and identifies conflicting entries',()=>{
  assert.deepEqual(currentExperienceDateRanges('Role Jan 2023 – Present and 2019 – Dec 2022'),['Jan 2023 – Present','2019 – Dec 2022']);
  assert.deepEqual(currentExperienceDateRanges('2026-02-30 – Present'),['2026-02-30 – Present']);
});
test('current anchor gate requires exact original source and timing companions',()=>{
  assert.equal(valid(),true);assert.equal(valid(role,[raw,role]),false);assert.equal(valid(role,[timing,role]),false);
  assert.equal(valid({...role,currentExperience:{...role.currentExperience,entryText:'CEO at another entry Jan 2023 – Present'}}),false);
  assert.equal(valid(role,[{...raw,sourceUrl:url+'#about'},timing,role]),false);
});
test('typed anchor metadata cannot broaden scope, evidence kind or current date semantics',()=>{
  for(const delta of [{kind:'headline'},{field:'industry'},{field:undefined},{appliesTo:'opportunity'},{polarity:'negative'},{observedAt:'2025-01-01T00:00:00Z'},{sourceUrl:url+'#about'},{text:'Invisible title'},{currentExperience:{...role.currentExperience,extra:'unsupported'}}])assert.equal(valid({...role,...delta}),false,JSON.stringify(delta));
  assert.equal(validCurrentExperienceAnchor(role,[raw,timing,role],url,null),false);
});
test('provenance limits reject excess while callers retain the original source',()=>{
  assert.equal(valid({...role,text:'C'.repeat(201)}),false);
  assert.equal(valid({...role,currentExperience:{...role.currentExperience,entryText:'C'.repeat(8001)}}),false);
  assert.equal(raw.text,'Role CEO Company Example Jan 2023 – Present');
});
