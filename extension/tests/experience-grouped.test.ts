import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile} from '../src/profile.js';
import {renderedCandidate} from '../src/goal-assessment.js';
import {validateSave, inboxPayload} from '../src/messaging.js';
import {validCurrentExperienceAnchor} from '../../src/lib/current-experience';
import {buildSavedPersonEvidence, savedPersonHeadline} from '../../src/lib/person-evidence';
import {assessCandidate} from '../../src/lib/assessment';
import {createGoal} from '../../src/lib/goals';
import type {Profile, Session} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const url = 'https://www.linkedin.com/in/synthetic-grouped-person/', at = '2026-09-13T12:00:00.000Z';
const employerUrl = 'https://www.linkedin.com/company/123456789/', company = 'Example Industrial Group';
const uid = '11111111-1111-4111-a111-111111111111', operationId = '22222222-2222-4222-a222-222222222222';
const session: Session = {userId: uid, accessToken: 'synthetic-only', expiresAt: Date.parse(at) + 3600000, strategy: ''};
// Anonymized shape of the rendered SDUI group: linked employer header, sibling direct UL, linked LI roles.
const child = (role = 'Chief Technology Officer', date = 'Mar 2023 - Present · 3 yrs 6 mos', href = employerUrl, extra = '', location = 'Example City') =>
  `<li><div><div></div></div><div><a href="${href}"><div><p>${role}</p><p>${date}</p>${location ? '<p>' + location + '</p>' : ''}</div></a><div>${extra}</div></div></li>`;
const history = () => child('Engineering Director', 'Jun 2020 - Jun 2023 · 3 yrs', undefined, '', '')
  + child('Engineering Manager', 'Sep 2018 - Jun 2020 · 1 yr 9 mos', undefined, '<p>HISTORICAL_RAW_END</p>');
const group = (children = child() + history(), name = company, href = employerUrl, tenure = '8 yrs') =>
  `<div componentkey="entity-collection-item-synthetic-group"><div><div><div><a href="${href}"><figure><svg role="img" aria-label="${name} logo"></svg><img></figure></a>
  <div><a href="${href}"><div><div><div><p>${name}</p><p>${tenure}</p></div></div></div></a></div></div></div></div><ul>${children}</ul></div>`;
const section = (entries = group(), slug = 'synthetic-grouped-person') => `<section><h2 componentkey="ProfileNullStateCardAnchor_Experience">Experience</h2>
  <div componentkey="Profile_Top_Level_ExperienceTopLevelSection${slug}"></div>${entries}</section>`;
const documentOf = (experience = section()) => parseHTML(`<main><section aria-label="Primary content">
  <div componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"><section><a componentkey="ProfileVerificationTriggerRef-synthetic-grouped-person"><h2>Synthetic Person</h2></a></section></div>
  <section><h2>About</h2><p>Synthetic professional context.</p></section>${experience}</section></main>`).document as Document;
const read = (experience = section()) => readProfile(documentOf(experience), url, at)!;
const typed = (profile: Profile) => profile.anchors.filter(anchor => anchor.field !== undefined);
const payload = (profile: Profile) => inboxPayload(validateSave({operationId, userId: uid, profile, source: 'rendered_profile'}, session));

test('a grouped current role retains exact parent, child and timing evidence through extension save and app interpretation', () => {
  const profile = read(), original = structuredClone(profile);
  assert.deepEqual(typed(profile).map(anchor => [anchor.field, anchor.text]), [['role', 'Chief Technology Officer'], ['company', company]]);
  for (const anchor of typed(profile)) {
    const provenance = anchor.currentExperience!;
    assert.equal(provenance.dateRange, 'Mar 2023 - Present'); assert.equal(provenance.group!.company, company);
    assert.ok(!provenance.entryText.includes(company));
    assert.ok(provenance.group!.entryText.includes('Engineering Manager')); assert.ok(provenance.group!.entryText.endsWith('HISTORICAL_RAW_END'));
    assert.equal(validCurrentExperienceAnchor(anchor, profile.anchors, url, at), true);
    assert.ok(profile.anchors.some(raw => raw.field === undefined && raw.text === provenance.entryText));
    assert.ok(profile.anchors.some(raw => raw.field === undefined && raw.text === provenance.group!.entryText));
  }
  const saved = payload(profile); assert.deepEqual(saved.snapshot.anchors, profile.anchors);
  const person = {id: operationId, person: profile.name, profile_url: url, stage: 'saved', context: {source: 'extension'}, created_at: at, profile: saved.snapshot};
  const extension = renderedCandidate(profile), app = buildSavedPersonEvidence(person);
  const facts = (candidate: typeof extension) => candidate.claims.filter(claim => ['role','company'].includes(claim.field)).map(claim => [claim.field, claim.text]);
  assert.deepEqual(facts(app), facts(extension)); assert.equal(app.company, company);
  assert.equal(savedPersonHeadline(person), 'Chief Technology Officer · ' + company);
  assert.deepEqual(profile, original);
});

test('current status uses the child date rather than ordering, employer tenure or overlapping historical dates', () => {
  assert.deepEqual(typed(read(section(group(history() + child())))).map(anchor => anchor.text), ['Chief Technology Officer', company]);
  for (const entries of [group(history()), group(child('Engineering Director', '2020 - 2023') + history()), group(child() + history(), undefined, undefined, 'Jan 2020 - Present')])
    assert.equal(typed(read(section(entries))).length, 0);
});

test('multiple current children and hidden, missing, future or invalid child date fields remain untyped', () => {
  const variants = [group(child() + child('Board Member', 'Jan 2025 - Present')),
    group(child(undefined, '') + history()), group(child(undefined, 'Present') + history()),
    group(child(undefined, 'Oct 2026 - Present') + history()), group(child(undefined, '2026-02-30 - Present') + history()),
    group(child().replace('<p>Mar 2023', '<p hidden>Mar 2023') + history()),
    group(child().replace('<p>Chief Technology Officer', '<p hidden>Chief Technology Officer') + history())];
  for (const entries of variants) assert.equal(typed(read(section(entries))).length, 0);
});

test('a child must link to the exact unambiguous employer header, not another group or arbitrary site', () => {
  for (const entries of [group(child(undefined, undefined, 'https://www.linkedin.com/company/987654321/') + history()),
    group(child() + history(), undefined, 'https://example.org/company/123456789/'),
    group().replace('<p>' + company + '</p>', '<p hidden>' + company + '</p>'),
    group().replace(company + ' logo', 'Another Employer logo'),
    group().replace('<ul>', '<a href="https://www.linkedin.com/company/987654321/"><p>Another Employer</p><p>4 yrs</p></a><ul>'),
    group().replace('<ul>', '<a href="' + employerUrl + '"><p>Another Employer</p><p>4 yrs</p></a><ul>')])
    assert.equal(typed(read(section(entries))).length, 0);
});

test('nested lists, extra entity scopes, adjacent sections and stale subject markers cannot authorize grouped roles', () => {
  const variants = [group().replace('<ul>', '<div><ul>').replace('</ul>', '</ul></div>'),
    group(child(undefined, undefined, undefined, '<ul><li>CEO 2025 - Present</li></ul>') + history()),
    group(child(undefined, undefined, undefined, '<div componentkey="entity-collection-item-another">Other job</div>') + history())];
  for (const entries of variants) assert.equal(typed(read(section(entries))).length, 0);
  assert.equal(typed(read(section(group(), 'another-person'))).length, 0);
  assert.equal(typed(read(section('') + '<section>' + group() + '</section>')).length, 0);
});

test('descriptions stay raw and cannot supply the role, its date, industry or opportunity geography', () => {
  const profile = read(section(group(child('Engineer', undefined, undefined, '<p>Reports to CEO. Healthcare investor and recruiter.</p>') + history())));
  const candidate = renderedCandidate(profile);
  assert.deepEqual(candidate.claims.filter(claim => claim.field === 'role').map(claim => claim.text), ['Engineer']);
  assert.ok(!candidate.claims.some(claim => ['industry','stage','location','check_size'].includes(claim.field)));
  assert.ok(profile.anchors.some(anchor => anchor.text.includes('Reports to CEO.')));
  for (const entries of [group(child(undefined, 'Discussed Mar 2023 - Present with a colleague') + history()),
    group(child(undefined, '', undefined, '<p>Mar 2023 - Present</p>') + history()),
    group(child(undefined, undefined, undefined, '<p>Earlier role 2020 - 2022</p>') + history())])
    assert.equal(typed(read(section(entries))).length, 0);
});

test('two separate employer groups keep both current roles without selecting a primary company', () => {
  const second = 'https://www.linkedin.com/company/987654321/';
  const profile = read(section(group() + group(child('Board Member', '2024 - Present', second) + child('Advisor', '2022 - 2024', second), 'Example Foundation', second)));
  assert.equal(typed(profile).length, 4); assert.equal(renderedCandidate(profile).company, '');
  assert.ok(renderedCandidate(profile).claims.every(claim => claim.exclusive !== true));
});

test('long group evidence remains whole while typed promotion refuses its provenance limit', () => {
  const sentinel = 'SOURCE_END', profile = read(section(group(child(undefined, undefined, undefined, '<p>' + 'Evidence '.repeat(1000) + sentinel + '</p>') + history())));
  assert.equal(typed(profile).length, 0);
  assert.ok(profile.anchors.some(anchor => anchor.text.includes(sentinel)));
  assert.doesNotThrow(() => payload(profile));
});

test('tampering with group source, company or current child cannot survive save validation or app role promotion', () => {
  for (const missing of ['parent','child','timing']) {
    const profile = read(), provenance = typed(profile)[0].currentExperience!;
    const text = missing === 'parent' ? provenance.group!.entryText : missing === 'child' ? provenance.entryText : provenance.dateRange;
    profile.anchors = profile.anchors.filter(anchor => !(anchor.field === undefined && anchor.text === text));
    assert.throws(() => payload(profile), /current experience field/);
    const app = buildSavedPersonEvidence({id: operationId, person: profile.name, profile_url: url, stage: 'saved', context: {source: 'extension'}, created_at: at, profile: {...profile, source: 'rendered_profile'}});
    assert.equal(app.claims.some(claim => claim.field === 'role'), false);
  }
  const profile = read(); profile.anchors = profile.anchors.map(anchor => anchor.field === 'company'
    ? {...anchor, currentExperience: {...anchor.currentExperience!, group: {company: 'Unrelated Employer', entryText: 'Unrelated Employer'}}} : anchor);
  assert.throws(() => payload(profile), /current experience field/);
});

test('grouped role evidence supports exact contact criteria while opportunity and investment mandate remain unknown', () => {
  const candidate = renderedCandidate(read());
  const goal = createGoal({kind: 'career', title: 'Technology leadership', outcome: 'Find a relevant professional contact', criteria: [
    {id: 'contact', field: 'role', label: 'Contact role', terms: ['Chief Technology Officer'], importance: 'preferred', appliesTo: 'contact', origin: 'user'},
    {id: 'opening', field: 'role', label: 'Opportunity role', terms: ['Chief Technology Officer'], importance: 'preferred', appliesTo: 'opportunity', origin: 'user'},
  ]}, {id: operationId, now: at});
  const assessment = assessCandidate(goal, candidate);
  assert.deepEqual(assessment.criteria.map(row => row.status), ['supported','unknown']);
  const funding = createGoal({kind: 'fundraising', title: 'Raise financing', outcome: 'Find an investor', criteria: [
    {id: 'stage', field: 'stage', label: 'Investment stage', terms: ['seed'], importance: 'preferred', appliesTo: 'opportunity', origin: 'user'},
  ]}, {id: uid, now: at});
  assert.equal(assessCandidate(funding, candidate).criteria[0].status, 'unknown');
});
