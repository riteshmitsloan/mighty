import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {summarizeProfileActivity} from '../src/lib/profile-activity';
import {readProfile} from '../extension/src/profile';
const {parseHTML} = createRequire(import.meta.url)('linkedom');
const url = 'https://www.linkedin.com/in/synthetic-person/', at = '2026-09-13T12:00:00.000Z';
const anchor = (kind: string, text: string, fragment = '#content_collections') => ({kind, text, sourceUrl: url + fragment, observedAt: at});
const item = anchor('activity', 'A visible update about #AI and #ProductDesign.');
const stamp = anchor('timing', 'Rendered activity timestamp: 2d');
const recent = anchor('timing', 'Recent rendered activity: 2d');
const profile = (anchors: unknown[] = [item, stamp, recent]) => ({profileUrl: url, profileReadAt: at, truncated: false, anchors});

test('observed activity is dated to its read, retains literal timestamps, and makes no reply or frequency claim', () => {
  const input = profile(), before = structuredClone(input), result = summarizeProfileActivity(input);
  assert.equal(result.state, 'observed'); assert.equal(result.label, 'Recent activity observed'); assert.equal(result.recentAtRead, true);
  assert.equal(result.visibleItemCount, 1); assert.equal(result.observedAt, at); assert.match(result.detail, /2026-09-13/);
  assert.match(result.detail, /does not establish posting frequency or predict replies/);
  assert.deepEqual(result.timestamps, [{text: '2d', sourceText: stamp.text, sourceUrl: stamp.sourceUrl, observedAt: at, association: 'activity_section'}]);
  assert.deepEqual(result.topics.map(topic => topic.text), ['#AI','#ProductDesign']);
  assert.deepEqual(input, before); assert.ok(Object.isFrozen(result.timestamps));
});
test('missing samples do not imply zero activity, including follower counters and experience dates', () => {
  for (const input of [null, {}, profile([]), profile([stamp,recent]), profile([anchor('about','20,000 followers'),anchor('timing','Recent role start indicated by “Sep 2026 - Present”.','#experience')])]) {
    const result = summarizeProfileActivity(input); assert.equal(result.state, 'unknown'); assert.equal(result.visibleItemCount, null);
    assert.equal(result.recentAtRead, false); assert.match(result.detail, /does not mean the person is inactive/);
  }
});
test('partial, search, truncated and noncanonical snapshots cannot create an activity indicator', () => {
  for (const delta of [{profileReadAt:null},{profileReadAt:'invalid'},{truncated:true},{truncated:undefined},{source:'search_result'},
    {profileUrl:'https://www.linkedin.com/in/another/'},{profileUrl:'https://www.linkedin.com.evil.example/in/synthetic-person/'},
    {profileUrl:'https://user@www.linkedin.com/in/synthetic-person/'},{profileUrl:url+'?target=profile'}])
    assert.equal(summarizeProfileActivity({...profile(),...delta}).state, 'unknown');
});
test('foreign or stale source anchors and typed metadata are ignored rather than combined across subjects', () => {
  for (const delta of [{sourceUrl:url+'#experience'},{sourceUrl:'https://www.linkedin.com/in/another/#content_collections'},
    {observedAt:'2026-09-12T12:00:00Z'},{field:'context'},{currentExperience:{dateRange:'2026 - Present'}}])
    assert.equal(summarizeProfileActivity(profile([{...item,...delta},stamp,recent])).state, 'unknown');
  const result = summarizeProfileActivity(profile([item,{...stamp,observedAt:'2026-09-12T12:00:00Z'},recent]));
  assert.equal(result.state, 'observed'); assert.equal(result.recentAtRead, false); assert.equal(result.timestamps.length, 0);
});
test('section-level timestamps never attach to a particular item or establish authorship', () => {
  const other = anchor('activity','A visible comment or repost about #AI.');
  const result = summarizeProfileActivity(profile([item,other,item,stamp,recent]));
  assert.equal(result.visibleItemCount, 2); assert.equal(result.timestamps.length, 1);
  assert.equal(result.timestamps[0].association, 'activity_section'); assert.ok(!('postId' in result.timestamps[0]));
  assert.equal(result.topics.filter(topic => topic.text === '#AI').length, 1);
  assert.doesNotMatch(result.detail, /authored|posts per|\d+%/);
});
test('a recent marker alone or an unrelated timestamp cannot establish recent activity', () => {
  for (const anchors of [[item,recent],[item,stamp,anchor('timing','Recent rendered activity: 2w')],
    [item,{...stamp,sourceUrl:url+'#activity'},recent],
    [item,anchor('timing','Rendered activity timestamp: A popular professional'),anchor('timing','Recent rendered activity: A popular professional')]]) {
    const result = summarizeProfileActivity(profile(anchors)); assert.equal(result.recentAtRead, false); assert.equal(result.label, 'Activity observed');
  }
});
test('rounded month labels and exact dates remain conservative; future and invalid calendar dates never become recent', () => {
  const read = (text: string, recentText = text) => summarizeProfileActivity(profile([item,anchor('timing','Rendered activity timestamp: '+text),anchor('timing','Recent rendered activity: '+recentText)]));
  assert.equal(read('2w').recentAtRead, true); assert.equal(read('3mo').recentAtRead, false); assert.equal(read('1yr').recentAtRead, false);
  assert.equal(read('Sep 10, 2026').recentAtRead, true);
  assert.equal(read('2d (2025-09-10T12:00:00Z)','2d').recentAtRead, false, 'An old exact date overrides an apparently recent relative label.');
  for (const text of ['2026-10-01','2026-02-30','Feb 30, 2026','2d (2026-10-01T00:00:00Z)','2d (invalid)']) {
    const result = read(text, '2d'); assert.equal(result.recentAtRead, false); assert.equal(result.timestamps.length, 0);
  }
});
test('the existing parser activity fixture is summarized without assigning its dates to individual posts', () => {
  const document = parseHTML(readFileSync(new URL('../extension/tests/fixtures/profile-timing.html',import.meta.url),'utf8')).document;
  const captured = readProfile(document,url,at)!, before = structuredClone(captured), result = summarizeProfileActivity(captured);
  assert.equal(result.visibleItemCount,3); assert.equal(result.recentAtRead,true); assert.equal(result.timestamps.length,2);
  assert.ok(result.timestamps.every(stamp=>stamp.association==='activity_section'));
  assert.ok(result.timestamps.some(stamp=>stamp.text==='1yr (2025-09-10T12:00:00Z)'));
  assert.deepEqual(captured,before); assert.doesNotMatch(JSON.stringify(result),/Hidden recent post/);
});
test('the parser shortens rounded edited timestamps without losing their section-level recent signal', () => {
  const document = parseHTML('<main><section><h1>Synthetic Person</h1></section><section><h2>Activity</h2><article><p>A visible professional update.</p><span data-field="posted-at">2w • Edited</span></article></section></main>').document;
  const captured = readProfile(document,url,at)!, result = summarizeProfileActivity(captured);
  assert.ok(captured.anchors.some(anchor=>anchor.text==='Recent rendered activity: 2w'));
  assert.equal(result.recentAtRead,true); assert.equal(result.timestamps[0].text,'2w • Edited');
});
test('topics are only explicit visible hashtags, never inferred professional interests or follower totals', () => {
  const result = summarizeProfileActivity(profile([anchor('activity','Healthcare founders discussed fundraising. 20,000 followers. #HealthTech #healthtech') ]));
  assert.deepEqual(result.topics.map(topic=>topic.text), ['#HealthTech']); assert.equal(result.visibleItemCount, 1);
  assert.equal(result.recentAtRead, false); assert.deepEqual(result.timestamps, []);
  assert.ok(!('followers' in result)); assert.ok(!('connections' in result)); assert.ok(!('replyProbability' in result));
});
