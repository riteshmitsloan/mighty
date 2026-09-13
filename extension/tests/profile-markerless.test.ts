import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readProfile, profileTopCard, snapshot} from '../src/profile.js';
import {profilePanelEligibility} from '../src/panel-eligibility.js';
import {canRequestBrief} from '../src/scoring.js';
import {validateSave} from '../src/messaging.js';
import type {Session} from '../src/types.js';

const {parseHTML} = createRequire(import.meta.url)('linkedom');
const url = 'https://www.linkedin.com/in/synthetic-markerless/', now = '2026-09-13T12:00:00.000Z';
const other = 'https://www.linkedin.com/in/second-synthetic/';
const uid = '11111111-1111-4111-a111-111111111111', operationId = '22222222-2222-4222-a222-222222222222';
const session: Session = {userId: uid, accessToken: 'synthetic-only', expiresAt: Date.parse(now) + 3600000, strategy: ''};
const contact = (target = url) => `<p><a href="${target}overlay/contact-info/">Contact info</a></p>`;
// The actual unverified-name layout uses a plain h2, a URL-bound Contact info
// link, and an independently linked toolbar summary with name then headline.
const toolbar = (target = url, name = 'Synthetic Person') => `<div role="toolbar" aria-hidden="true" inert><a href="${target}"><figure></figure><p>${name}</p><p>Investor at Example Organization</p></a></div>`;
const controls = '<a href="/messaging/compose/?screenContext=NON_SELF_PROFILE_VIEW">Message</a><button aria-label="Follow Synthetic Person">Follow</button>';
const card = (extra = '', name = 'Synthetic Person', target = url) => `<div id="com.linkedin.sdui.profile.card.refSyntheticTopcard" componentkey="com.linkedin.sdui.profile.card.refSyntheticTopcard"><div><section id="subject"><div><div><div componentkey="synthetic-name-wrapper"><h2>${name}</h2></div></div></div>
  <p>Investor at Example Organization</p><p>Example City</p>${contact(target)}${controls}${extra}</section></div></div>`;
const about = '<section><h2>About</h2><p>Synthetic professional experience.</p></section>';
const documentOf = (top = card(), sections = about, summary = toolbar(), outside = '') => parseHTML(`<html><body>${summary}<main><section aria-label="Primary content">${top}${sections}</section>${outside}</main></body></html>`).document as Document;
const save = (profile: NonNullable<ReturnType<typeof readProfile>>) => validateSave({operationId, userId: uid, source: 'rendered_profile', profile}, session);

test('the observed markerless top card reads its unique URL-bound name and enables the other-person panel', () => {
  const document = documentOf(), profile = readProfile(document,url,now)!;
  assert.equal(document.querySelector('[componentkey^="ProfileVerificationTriggerRef-"]'), null);
  assert.equal(profile.name,'Synthetic Person'); assert.equal(profile.profileReadAt,now);
  assert.equal(profileTopCard(document,url),document.querySelector('[id$="Topcard"]'));
  assert.equal(profilePanelEligibility(document,url),'other'); assert.equal(snapshot(document,url).state,'ready');
  assert.ok(profile.anchors.some(anchor=>anchor.kind==='about'&&anchor.text.includes('Synthetic professional experience')));
  assert.doesNotThrow(()=>save(profile));
  assert.equal(profile.anchors.find(anchor=>anchor.kind==='headline')?.text,'Investor at Example Organization');
  assert.ok(!profile.anchors.some(anchor=>anchor.kind==='location'||anchor.field!==undefined), 'The corroborated headline stays context; unlabelled paragraphs are not invented typed fields.');
});

test('a markerless name and verified headline can save as incomplete without unlocking a brief', () => {
  const document = documentOf(card(),''), profile = readProfile(document,url,now)!;
  assert.equal(profilePanelEligibility(document,url),'other'); assert.equal(profile.profileReadAt,null);
  assert.equal(canRequestBrief(profile),false); assert.equal(snapshot(document,url).state,'unknown');
  const saved=save(profile);assert.equal(saved.profile.profileReadAt,null);
  assert.deepEqual(saved.profile.anchors,profile.anchors);assert.equal(saved.profile.anchors.length,1);
});

test('missing, foreign, duplicated and unsafe Contact info links cannot establish the markerless identity', () => {
  const cases = [card().replace(contact(),''), card(contact()), card(contact(other)), card('',undefined,other),
    card().replace('href="'+url+'overlay/contact-info/"','href="https://example.org/in/synthetic-markerless/overlay/contact-info/"'),
    card().replace('href="'+url+'overlay/contact-info/"','href="'+url+'overlay/contact-info/?target=synthetic-markerless"'),
    card().replace('href="'+url+'overlay/contact-info/"','href="https://user@www.linkedin.com/in/synthetic-markerless/overlay/contact-info/"'),
    card().replace('>Contact info</a>','>Other details</a>')];
  for (const top of cases) assert.equal(readProfile(documentOf(top),url,now),null);
  assert.equal(readProfile(documentOf(card().replace(contact(),''),about,toolbar(),'<aside>'+contact()+'</aside>'),url,now),null);
  assert.equal(readProfile(documentOf(card().replace(contact(),'<section>'+contact()+'</section>')),url,now),null);
});

test('the toolbar must independently bind the same name and exact URL, without accepting sidebar substitutes', () => {
  for (const summary of ['',toolbar(other),toolbar(url,'Different Person'),toolbar()+toolbar(),toolbar()+toolbar(other),
    toolbar().replace('role="toolbar"','role="navigation"'),toolbar().replace('<div role=','<div hidden role='),
    toolbar().replace('href="'+url+'"','href="'+url+'?source=stale"')])
    assert.equal(readProfile(documentOf(card(),about,summary),url,now),null);
  assert.equal(readProfile(documentOf(card(),about,'','<aside>'+toolbar()+'</aside>'),url,now),null);
});

test('multiple or hidden subject names and duplicate top cards or Primary regions fail closed', () => {
  const cases = [documentOf(card('<h2>Another Person</h2>')),documentOf(card().replace('<h2>','<h2 hidden>')),
    documentOf(card().replace('<h2>','<h2 style="display:none">')),documentOf(card().replace('id="subject"','id="subject" hidden')),
    documentOf(card()+card()),documentOf(card(),about+'<section aria-label="Primary content">'+card()+'</section>')];
  for (const document of cases) assert.equal(readProfile(document,url,now),null);
});

test('a conflicting or incomplete verification marker vetoes the markerless fallback', () => {
  for (const extra of ['<div componentkey="ProfileVerificationTriggerRef-another-person"></div>',
    '<div componentkey="ProfileVerificationTriggerRef-synthetic-markerless"></div>',
    '<div componentkey="ProfileVerificationTriggerRef-%ZZ"></div>'])
    assert.equal(readProfile(documentOf(card(extra)),url,now),null);
});

test('profile-to-profile navigation waits for matching contact, toolbar URL and name before changing subject', () => {
  const document = documentOf(); assert.equal(readProfile(document,url,now)?.name,'Synthetic Person');
  assert.equal(readProfile(document,other,now),null);
  document.querySelector('#subject a[href*="contact-info"]')!.setAttribute('href',other+'overlay/contact-info/');
  assert.equal(readProfile(document,other,now),null,'Old toolbar identity cannot follow the newly hydrated contact link.');
  const summary=document.querySelector('[role="toolbar"] a')!; summary.setAttribute('href',other);
  summary.querySelector('p')!.textContent='Second Synthetic Person';
  assert.equal(readProfile(document,other,now),null,'New toolbar identity cannot relabel the stale top-card name.');
  document.querySelector('#subject h2')!.textContent='Second Synthetic Person';
  assert.equal(readProfile(document,other,now)?.name,'Second Synthetic Person');
  assert.equal(readProfile(document,url,now),null,'Back navigation cannot reuse the new profile under the old URL.');
});

test('markerless identity keeps the existing stale-section attribution guard', () => {
  const stale='<section><div componentkey="Profile_Top_Level_ExperienceTopLevelSectionanother-person"></div><h2>Experience</h2><p>OLD_SUBJECT_ONLY</p></section>';
  const document=documentOf(card(),about+stale), profile=readProfile(document,url,now)!;
  assert.equal(profile.name,'Synthetic Person');assert.equal(profile.profileReadAt,null);
  assert.ok(!JSON.stringify(profile).includes('OLD_SUBJECT_ONLY'));
  assert.throws(()=>save(profile),/actual profile/);
});

test('self-edit controls always suppress the markerless automatic panel, regardless of other-person controls', () => {
  for (const own of ['<button>Edit profile</button>','<button>Add profile section</button>',
    '<a href="'+url+'edit/intro/">Edit introduction</a>']) {
    const document=documentOf(card(own));assert.equal(readProfile(document,url,now)?.name,'Synthetic Person');
    assert.equal(profilePanelEligibility(document,url),'self');
  }
  const document=documentOf(card().replace(controls,''));
  assert.equal(profilePanelEligibility(document,url),'unknown');
});

test('sidebar names and contact links never contaminate the accepted subject or its source anchors', () => {
  const outside='<aside><h2>Another Person</h2>'+contact(other)+'<section><h2>About</h2><p>SIDEBAR_ONLY</p></section></aside>';
  const profile=readProfile(documentOf(card(),about,toolbar(),outside),url,now)!;
  assert.equal(profile.name,'Synthetic Person');assert.ok(!JSON.stringify(profile).includes('SIDEBAR_ONLY'));
  assert.ok(profile.anchors.every(anchor=>anchor.sourceUrl.startsWith(url+'#')));
});
