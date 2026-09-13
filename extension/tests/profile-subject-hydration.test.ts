import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile, snapshot} from '../src/profile.js';
import {validateSave} from '../src/messaging.js';
import type {Session} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const at = '2026-09-13T12:00:00.000Z', url = 'https://www.linkedin.com/in/second-person/';
const uid = '11111111-1111-4111-a111-111111111111', operationId = '22222222-2222-4222-a222-222222222222';
const session: Session = {userId: uid, accessToken: 'synthetic-only', expiresAt: Date.parse(at) + 3600000, strategy: ''};
const top = (slug: string) => `<div componentkey="com.linkedin.sdui.profile.card.ref.fixtureTopcard"><section>
  <div componentkey="ProfileVerificationTriggerRef-${slug}"><h2>Second Synthetic Person</h2></div><button>Message</button></section></div>`;
const section = (label: string, key: string, body = '<p>PREVIOUS_SUBJECT_ONLY</p>') => `<section><div componentkey="${key}"></div><h2>${label}</h2>${body}</section>`;
const ownAbout = section('About', 'Profile_Top_Level_AboutSectionsecond-person', '<p>CURRENT_SUBJECT_EVIDENCE</p>');
const documentOf = (sections: string, outside = '', slug = 'second-person') => parseHTML(`<main><section aria-label="Primary content">${top(slug)}${sections}</section>${outside}</main>`).document as Document;

test('a new header cannot relabel the previous subject’s Experience as a complete profile read', () => {
  const document = documentOf(ownAbout + section('Experience', 'Profile_Top_Level_ExperienceTopLevelSectionfirst-person'));
  const profile = readProfile(document, url, at)!;
  assert.equal(profile.name, 'Second Synthetic Person');
  assert.equal(profile.profileReadAt, null);
  assert.ok(!JSON.stringify(profile).includes('PREVIOUS_SUBJECT_ONLY'));
  assert.ok(profile.anchors.some(anchor => anchor.text.includes('CURRENT_SUBJECT_EVIDENCE')));
  assert.ok(profile.missingSections?.includes('experience'));
  assert.equal(snapshot(document, url).state, 'unknown');
  assert.throws(() => validateSave({operationId, userId: uid, source: 'rendered_profile', profile}, session), /Read the actual profile/);
});

test('every parsed section carrying the explicit subject-marker family receives the same attribution gate', () => {
  // Synthetic section-name variants exercise the shared family, not a claim of live layout coverage.
  const sections = [['About', 'About'], ['Experience', 'ExperienceTopLevel'], ['Education', 'Education'], ['Skills', 'Skills'],
    ['Languages', 'Languages'], ['Certifications', 'Certifications'], ['Activity', 'Activity']];
  for (const [label, key] of sections) {
    const body = label === 'Activity' ? '<article><p>PREVIOUS_SUBJECT_ONLY</p><time>1 day</time></article>' : '<p>PREVIOUS_SUBJECT_ONLY</p>';
    const document = documentOf(section(label, 'Profile_Top_Level_' + key + 'Sectionfirst-person', body));
    const profile = readProfile(document, url, at)!;
    assert.equal(profile.profileReadAt, null, label);
    assert.equal(profile.anchors.length, 0, label);
  }
});

test('foreign nested, direct or competing markers never escape through a whole-section fallback', () => {
  const fixtures = [
    section('Experience', 'Profile_Top_Level_ExperienceTopLevelSectionsecond-person', '<section><div componentkey="Profile_Top_Level_ExperienceTopLevelSectionfirst-person"></div><p>PREVIOUS_SUBJECT_ONLY</p></section>'),
    '<section componentkey="Profile_Top_Level_ExperienceTopLevelSectionfirst-person"><h2>Experience</h2><p>PREVIOUS_SUBJECT_ONLY</p></section>',
    section('Experience', 'Profile_Top_Level_ExperienceTopLevelSectionsecond-person', '<div componentkey="Profile_Top_Level_ExperienceTopLevelSectionfirst-person"></div><p>PREVIOUS_SUBJECT_ONLY</p>'),
    section('About', 'ProfileVerificationTriggerRef-first-person'),
  ];
  for (const html of fixtures) {
    const profile = readProfile(documentOf(html), url, at)!;
    assert.equal(profile.profileReadAt, null); assert.equal(profile.anchors.length, 0);
  }
});

test('pending or malformed explicit markers cannot accidentally canonicalize into the current subject', () => {
  for (const suffix of ['', '%ZZ', 'second-person?old=first-person', 'second-person#first-person', 'second-person/other', 'second-person%2Fother']) {
    const profile = readProfile(documentOf(section('Experience', 'Profile_Top_Level_ExperienceTopLevelSection' + suffix)), url, at)!;
    assert.equal(profile.profileReadAt, null, suffix); assert.equal(profile.anchors.length, 0, suffix);
  }
  assert.equal(readProfile(documentOf(section('Experience', 'Profile_Top_Level_pending')), url, at)?.profileReadAt, null);
});

test('a matching empty marker permits exact raw context and hydration then makes the current read usable', () => {
  const document = documentOf(ownAbout + section('Experience', 'Profile_Top_Level_ExperienceTopLevelSectionfirst-person'));
  assert.equal(readProfile(document, url, at)?.profileReadAt, null);
  const experience = document.querySelector('[componentkey="Profile_Top_Level_ExperienceTopLevelSectionfirst-person"]')!.closest('section')!;
  experience.querySelector('p')!.textContent = 'CURRENT_JOB_EVIDENCE';
  experience.querySelector('[componentkey]')!.setAttribute('componentkey', 'Profile_Top_Level_ExperienceTopLevelSectionsecond-person');
  const profile = readProfile(document, url, at)!;
  assert.equal(profile.profileReadAt, at);
  assert.ok(profile.anchors.some(anchor => anchor.text.includes('CURRENT_JOB_EVIDENCE')));
  assert.ok(!JSON.stringify(profile).includes('PREVIOUS_SUBJECT_ONLY'));
  assert.doesNotThrow(() => validateSave({operationId, userId: uid, source: 'rendered_profile', profile}, session));
});

test('encoded and decoded subject identifiers agree without case or Unicode spelling loss', () => {
  const target = 'https://www.linkedin.com/in/second-r%C3%ADver/';
  for (const slug of ['second-r%C3%ADver', 'second-ríver', 'SECOND-RÍVER']) {
    const document = documentOf(section('About', 'Profile_Top_Level_AboutSection' + slug, '<p>CURRENT_SUBJECT_EVIDENCE</p>'), '', 'second-ríver');
    assert.equal(readProfile(document, target, at)?.profileReadAt, at);
  }
});

test('hidden foreign sections and outside-primary recommendations do not block a valid read', () => {
  const hidden = section('Experience', 'Profile_Top_Level_ExperienceTopLevelSectionfirst-person').replace('<section>', '<section hidden>');
  const outside = '<aside>' + section('Education', 'Profile_Top_Level_EducationSectionfirst-person') + '</aside>';
  const profile = readProfile(documentOf(ownAbout + hidden, outside), url, at)!;
  assert.equal(profile.profileReadAt, at);
  assert.ok(!JSON.stringify(profile).includes('PREVIOUS_SUBJECT_ONLY'));
});

test('unmarked SDUI sections and the existing classical path retain their established support', () => {
  const plain = '<section><h2>About</h2><p>UNMARKED_CONTEXT</p></section>';
  assert.equal(readProfile(documentOf(plain), url, at)?.profileReadAt, at);
  const classic = parseHTML('<main><section><h1>Classic Synthetic Person</h1></section>' + plain + '</main>').document;
  assert.equal(readProfile(classic, url, at)?.profileReadAt, at);
});
