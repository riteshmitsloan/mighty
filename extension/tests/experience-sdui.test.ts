import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile} from '../src/profile.js';
import {currentExperienceFields} from '../src/experience-fields.js';
import {assessProfileGoals, renderedCandidate} from '../src/goal-assessment.js';
import {compactFit} from '../src/compact-profile.js';
import {accountGoalContext} from '../src/goal-context.js';
import {inboxPayload, validateSave} from '../src/messaging.js';
import {createGoal} from '../../src/lib/goals';
import {validCurrentExperienceAnchor} from '../../src/lib/current-experience';
import type {Profile, Session} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const url = 'https://www.linkedin.com/in/synthetic-person/', at = '2026-09-13T12:00:00.000Z';
const company = 'https://www.linkedin.com/company/123456789/';
const uid = '11111111-1111-4111-a111-111111111111', operationId = '22222222-2222-4222-a222-222222222222';
const session: Session = {userId: uid, accessToken: 'synthetic-only', expiresAt: Date.parse(at) + 3600000, strategy: ''};
const title = '<section><a componentkey="ProfileVerificationTriggerRef-synthetic-person"><div componentkey="ProfileVerificationTriggerRef-synthetic-person"><h2>Synthetic Person</h2></div></a></section>';
const about = '<section><h2>About</h2><p>Synthetic professional context.</p></section>';
const card = `<div componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard">${title}</div>`;
const fields = (role = 'Chief Technology Officer', employer = 'Example Systems · Full-time', date = 'Jul 2026 - Present · 3 mos', location = 'Example City · On-site') =>
  `<p>${role}</p><p>${employer}</p><p>${date}</p>${location ? `<p>${location}</p>` : ''}`;
const entry = (paragraphs = fields(), extra = '<p>Description outside the company anchor. RAW_END</p>', href = company) =>
  `<div componentkey="entity-collection-item-synthetic"><a href="${href}"><figure><img alt="Example Systems logo"></figure></a><a href="${href}"><div>${paragraphs}</div></a>${extra}</div>`;
const section = (entries = entry(), slug = 'synthetic-person') => `<section id="synthetic-experience"><h2 componentkey="ProfileNullStateCardAnchor_Experience">Experience</h2><div componentkey="Profile_Top_Level_ExperienceTopLevelSection${slug}">${entries}</div></section>`;
// Observed SDUI hierarchy: an empty identity marker and the content wrapper are siblings.
const siblingSection = (entries = entry(), slug = 'synthetic-person') => `<section id="synthetic-experience"><div>
  <div data-display-contents="true"><div componentkey="Profile_Top_Level_ExperienceTopLevelSection${slug}"></div></div>
  <div data-display-contents="true"><div><h2 componentkey="ProfileNullStateCardAnchor_Experience">Experience</h2></div><div>${entries}</div></div>
</div></section>`;
const page = (experience = section(), extra = '') => parseHTML(`<main><section aria-label="Primary content">${card}${about}${experience}</section>${extra}</main>`).document as Document;
const read = (experience = section(), extra = '') => readProfile(page(experience, extra), url, at)!;
const typed = (profile: Profile) => profile.anchors.filter(anchor => anchor.field !== undefined);

test('an empty SDUI identity marker binds sibling current entries inside the exact same section', () => {
  const document = page(siblingSection(entry(fields('Founding Partner (Region)', 'Example Ventures · Full-time', 'Jan 2024 - Present · 2 yrs 8 mos'))));
  assert.equal(document.querySelector('[componentkey="Profile_Top_Level_ExperienceTopLevelSectionsynthetic-person"]')!.children.length, 0);
  const profile = readProfile(document, url, at)!;
  assert.deepEqual(typed(profile).map(anchor => [anchor.field, anchor.text]), [['role', 'Founding Partner (Region)'], ['company', 'Example Ventures']]);
  for (const anchor of typed(profile)) assert.equal(validCurrentExperienceAnchor(anchor, profile.anchors, url, at), true);
  const payload = inboxPayload(validateSave({operationId, userId: uid, profile, source: 'rendered_profile'}, session));
  assert.deepEqual(payload.snapshot.anchors, profile.anchors);
  assert.ok(profile.anchors.some(anchor => anchor.field === undefined && anchor.text.endsWith('RAW_END')));
});

test('an empty marker does not authorize entries from a different, nested or adjacent section', () => {
  const nested = siblingSection('<section>' + entry() + '</section>');
  const adjacent = siblingSection('') + '<section>' + entry() + '</section>';
  const foreign = siblingSection(entry(), 'another-person');
  const misplaced = siblingSection(entry()).replace('<div componentkey="Profile_Top_Level_ExperienceTopLevelSectionsynthetic-person"></div>', '')
    + '<section><div componentkey="Profile_Top_Level_ExperienceTopLevelSectionsynthetic-person"></div></section>';
  for (const html of [nested, adjacent, foreign, misplaced]) assert.equal(typed(read(html)).length, 0);
});

test('ambiguous empty markers or duplicate Experience headings refuse typed promotion', () => {
  const duplicateMarker = siblingSection(entry()).replace('</div></section>', '<div componentkey="Profile_Top_Level_ExperienceTopLevelSectionsynthetic-person"></div></div></section>');
  const duplicateHeading = siblingSection(entry()).replace('</div></section>', '<h2 componentkey="ProfileNullStateCardAnchor_Experience">Experience</h2></div></section>');
  for (const html of [duplicateMarker, duplicateHeading]) assert.equal(typed(read(html)).length, 0);
});

test('the observed SDUI leaf entry yields the exact current role/company while retaining raw and timing evidence', () => {
  const profile = read();
  assert.deepEqual(typed(profile).map(anchor => [anchor.field, anchor.text]), [['role', 'Chief Technology Officer'], ['company', 'Example Systems']]);
  for (const anchor of typed(profile)) {
    assert.equal(anchor.currentExperience?.dateRange, 'Jul 2026 - Present');
    assert.ok(anchor.currentExperience?.entryText.endsWith('RAW_END'));
    assert.equal(validCurrentExperienceAnchor(anchor, profile.anchors, url, at), true);
  }
  assert.equal(profile.profileReadAt, at);
  assert.ok(profile.anchors.some(anchor => anchor.kind === 'timing' && anchor.text === 'Jul 2026 - Present'));
  assert.ok(profile.anchors.some(anchor => anchor.field === undefined && anchor.text.includes('Example Systems · Full-time')));
  const payload = inboxPayload(validateSave({operationId, userId: uid, profile, source: 'rendered_profile'}, session));
  assert.deepEqual(payload.snapshot.anchors, profile.anchors);
});

test('a hydrated Experience section is re-read within the same primary region, never widened into a sidebar', () => {
  const document = page('', '<aside>' + section(entry(fields('CEO', 'Sidebar Company'))) + '</aside>');
  assert.equal(typed(readProfile(document, url, at)!).length, 0);
  document.querySelector('[aria-label="Primary content"]')!.insertAdjacentHTML('beforeend', section());
  const profile = readProfile(document, url, at)!;
  assert.deepEqual(typed(profile).map(anchor => anchor.text), ['Chief Technology Officer', 'Example Systems']);
  assert.ok(!JSON.stringify(profile).includes('Sidebar Company'));
});

test('historical, future, missing and invalid dates preserve context without current-role promotion', () => {
  for (const date of ['Jul 2020 - Jun 2022 · 2 yrs', 'Oct 2026 - Present · 1 mo', '2026-02-30 - Present', '', 'Present']) {
    const profile = read(section(entry(fields(undefined, undefined, date))));
    assert.equal(typed(profile).length, 0, date);
    assert.ok(profile.anchors.some(anchor => anchor.text.includes('Chief Technology Officer')));
  }
});

test('current role semantics require the exact subject collection and Experience heading', () => {
  for (const html of [section(entry(), 'another-person'), section().replace('ProfileNullStateCardAnchor_Experience', 'UnrelatedHeading'),
    section().replace('Profile_Top_Level_ExperienceTopLevelSection', 'UnrelatedCollection'), section().replace('>Experience</h2>', '>Recommendations</h2>')]) {
    assert.equal(typed(read(html)).length, 0);
  }
  const document = page();
  const item = document.querySelector('[componentkey="entity-collection-item-synthetic"]')!;
  assert.deepEqual(currentExperienceFields(item, at, 'https://www.linkedin.com/in/another-person/'), []);
});

test('generic paragraphs outside the exact company link layout cannot become a role', () => {
  const layouts = [
    entry(fields()).replaceAll('href="' + company + '"', 'href="https://example.org/company"'),
    `<div componentkey="entity-collection-item-synthetic">${fields()}<p>RAW_END</p></div>`,
    entry('<p>Chief Technology Officer</p><p>Example Systems</p>') + '<p>Jul 2026 - Present</p>',
    entry('<p>Chief Technology Officer</p><p>Example Systems</p><p>Discussed Jul 2026 - Present with a colleague</p>'),
    entry(fields()).replace('<p>Chief Technology Officer</p>', '<div>Chief Technology Officer</div>'),
  ];
  for (const html of layouts) assert.equal(typed(read(section(html))).length, 0);
});

test('grouped employers and nested entries remain full raw context without selecting a primary job', () => {
  for (const nested of ['<ul><li>Another position</li></ul>', entry(fields('CEO')), '<div itemscope>Another role</div>']) {
    const profile = read(section(entry(fields(), nested + '<p>GROUP_END</p>')));
    assert.equal(typed(profile).length, 0);
    assert.ok(profile.anchors.some(anchor => anchor.text.endsWith('GROUP_END')));
  }
});

test('competing text-bearing company anchors, employer links, or extra dates refuse a whole entry', () => {
  for (const extra of [`<a href="${company}">${fields('CEO')}</a>`, '<a href="https://www.linkedin.com/company/987654321/"><figure></figure></a>',
    '<p>Jul 2020 - Jun 2022</p>', '<p>Jan 2025 - Present</p>']) {
    assert.equal(typed(read(section(entry(fields(), extra)))).length, 0);
  }
});

test('the description, optional location and employer name do not invent role, industry or opportunity geography', () => {
  const profile = read(section(entry(fields('Engineer'), '<p>Reports to CEO. Healthcare investors in seed companies.</p>')));
  const candidate = renderedCandidate(profile);
  assert.deepEqual(candidate.claims.filter(claim => claim.field === 'role').map(claim => claim.text), ['Engineer']);
  assert.ok(!candidate.claims.some(claim => ['industry', 'stage', 'check_size', 'location'].includes(claim.field)));
  assert.ok(candidate.claims.every(claim => claim.appliesTo === 'contact'));
});

test('hidden paragraphs, ambiguous suffixes and unsafe company links cannot promote a role', () => {
  for (const html of [entry(fields()).replace('<p>Chief Technology Officer', '<p hidden>Chief Technology Officer'),
    entry(fields()).replace('<p>Jul 2026', '<p style="display:none">Jul 2026'),
    entry(fields(undefined, 'Example Systems · Unknown affiliation')), entry(fields(undefined, undefined, 'Jul 2026 - Present · allegedly')),
    entry(fields(), '', 'https://linkedin.com.evil.example/company/123456789/'), entry(fields(), '', 'https://user:pass@www.linkedin.com/company/123456789/'),
    entry(fields(), '', 'http://www.linkedin.com/company/123456789/')]) {
    assert.equal(typed(read(section(html))).length, 0);
  }
});

test('separate current jobs retain both exact roles without claiming an exclusive employer', () => {
  const profile = read(section(entry() + entry(fields('Board Member', 'Example Foundation · Part-time', 'Jan 2025 - Present · 1 yr 8 mos'))));
  assert.deepEqual(typed(profile).map(anchor => anchor.text), ['Chief Technology Officer', 'Example Systems', 'Board Member', 'Example Foundation']);
  const candidate = renderedCandidate(profile);
  assert.equal(candidate.company, '');
  assert.ok(candidate.claims.every(claim => claim.exclusive !== true));
});

test('exactly three fields are supported while longer fields are kept raw and never clipped into a typed fact', () => {
  assert.equal(typed(read(section(entry(fields(undefined, 'Example Systems', undefined, ''))))).length, 2);
  const role = 'X'.repeat(201) + 'ROLE_END', profile = read(section(entry(fields(role))));
  assert.equal(typed(profile).length, 0);
  assert.ok(profile.anchors.some(anchor => anchor.text.includes(role)));
});

test('the observed current CTO role supports a career route but does not manufacture an opening or investor mandate', () => {
  const profile = read();
  const career = createGoal({kind: 'career', title: 'Technology leadership', outcome: 'Find a technology leadership opportunity', criteria: [
    {id: 'role', field: 'role', label: 'Role', terms: ['CTO'], importance: 'preferred', appliesTo: 'opportunity', origin: 'user'},
  ]}, {id: operationId, now: at});
  const fundraising = createGoal({kind: 'fundraising', title: 'Seed financing', outcome: 'Find a seed investor', criteria: [
    {id: 'stage', field: 'stage', label: 'Investment stage', terms: ['seed'], importance: 'preferred', appliesTo: 'opportunity', origin: 'user'},
  ]}, {id: '33333333-3333-4333-a333-333333333333', now: at});
  const goals = [career, fundraising], context = accountGoalContext(uid, goals.map(goal => ({id: goal.id, user_id: uid, version: goal.version, document: goal})), at);
  const result = assessProfileGoals(uid, context, {kind: 'profile', state: 'ready', profile, message: ''});
  assert.equal(result.state, 'ready'); if (result.state !== 'ready') return;
  const [job, funding] = result.assessments;
  assert.equal(job.assessment.status, 'possible_route');
  assert.equal(compactFit(job.assessment, job.goal).label, 'Possible fit');
  assert.ok(job.assessment.contactRoutes.some(route => route.kind === 'peer'));
  assert.equal(job.assessment.criteria[0].status, 'unknown');
  assert.equal(funding.assessment.status, 'unknown');
  assert.equal(compactFit(funding.assessment, funding.goal).label, 'Not enough information');
});
