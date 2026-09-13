import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProfile, snapshot, profileTopCard} from '../src/profile.js';

const deps=process.env.MIGHTY_DEPS_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const {parseHTML}=createRequire(resolve(deps,'package.json'))('linkedom');
const documentOf=(html:string)=>parseHTML(html).document as Document;
const url='https://www.linkedin.com/in/alex-river/',now='2026-09-13T12:00:00.000Z';
const about='<section><h2>About</h2><p>I build accessible professional tools.</p></section>';
const experience='<section><h2>Experience</h2><ul><li>Research engineer at Example Company, Jan 2024 – Present</li></ul></section>';
const marker=(heading='<h2>Alex River</h2>',slug='alex-river')=>`<div componentkey="ProfileVerificationTriggerRef-${slug}">${heading}</div>`;
const card=(body=marker(),attribute='componentkey',key='com.linkedin.sdui.profile.card.ref.syntheticTopcard')=>`<div ${attribute}="${key}"><section>${body}</section></div>`;
const page=(top=card(),sections=about,extra='')=>documentOf(`<main>${extra}<section aria-label="Primary content">${top}${sections}</section></main>`);

test('ownership controls receive only the verified top card or an unambiguous classic subject section',()=>{
 const doc=page();assert.equal(profileTopCard(doc,url),doc.querySelector('[componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"]'));
 assert.equal(profileTopCard(doc,'https://www.linkedin.com/in/another-person/'),null);
 assert.equal(profileTopCard(page(card(marker('<h2 hidden>Alex River</h2>'))),url),null);
 assert.equal(profileTopCard(page('',about,card()),url),null);
 const classic=documentOf('<main><section id="subject"><h1>Alex River</h1><button>Edit profile</button></section><aside><button>Message</button></aside></main>');
 assert.equal(profileTopCard(classic,url),classic.querySelector('#subject'));
 assert.equal(profileTopCard(documentOf('<main><h1>Alex River</h1><button>Message</button></main>'),url),null);
 classic.querySelector('main')!.insertAdjacentHTML('beforeend','<section><h1>Another Person</h1></section>');
 assert.equal(profileTopCard(classic,url),null);
});

test('the exact SDUI subject marker unlocks a real About/Experience read without an h1',()=>{
 const doc=page(card(),about+experience),profile=readProfile(doc,url,now)!;
 assert.equal(doc.querySelector('h1'),null);
 assert.equal(profile.name,'Alex River');
 assert.equal(profile.profileUrl,url);
 assert.equal(profile.profileReadAt,now);
 assert.ok(profile.anchors.some(anchor=>anchor.kind==='about'&&anchor.text==='About I build accessible professional tools.'));
 assert.ok(profile.anchors.some(anchor=>anchor.kind==='experience'&&anchor.text.includes('Research engineer')));
 assert.ok(profile.anchors.every(anchor=>anchor.sourceUrl.startsWith(url+'#')&&anchor.observedAt===now));
 assert.equal(snapshot(doc,url).state,'ready');
});

test('Topcard identification accepts the observed id or componentkey attribute, including both on one element',()=>{
 for(const attribute of ['id','componentkey'])assert.equal(readProfile(page(card(marker(),attribute)),url,now)?.name,'Alex River');
 const both=card().replace('<div componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"',
  '<div id="com.linkedin.sdui.profile.card.ref.syntheticTopcard" componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"');
 assert.equal(readProfile(page(both),url,now)?.name,'Alex River');
});

test('nested A and DIV copies of the same verification marker identify one rendered subject',()=>{
 const nested='<a componentkey="ProfileVerificationTriggerRef-alex-river"><div data-display="flex">'
  +marker('<div><h2>Alex River</h2></div>')+'</div></a>';
 const profile=readProfile(page(card(nested),about+experience),url,now)!;
 assert.equal(profile.name,'Alex River');
 assert.equal(profile.profileReadAt,now);
 assert.ok(profile.anchors.some(anchor=>anchor.kind==='about'));
 assert.equal(readProfile(page(card(nested+marker(''))),url,now),null,'A disjoint matching wrapper is not part of the verified name chain.');
 assert.equal(readProfile(page(card(nested.replace('<a componentkey="ProfileVerificationTriggerRef-alex-river"','<a componentkey="ProfileVerificationTriggerRef-another-person"'))),url,now),null);
});

test('SDUI reads are tied to the canonical profile slug, not the displayed name or page query',()=>{
 assert.equal(readProfile(page(),url+'?trk=synthetic#about',now)?.name,'Alex River');
 assert.equal(readProfile(page(),'https://www.linkedin.com/in/another-person/',now),null);
 for(const slug of ['another-person','alex-river-extra','alex-river?target=alex-river','https://www.linkedin.com/in/alex-river/']){
  assert.equal(readProfile(page(card(marker('<h2>Alex River</h2>',slug))),url,now),null,slug);
 }
 const unicodeUrl='https://www.linkedin.com/in/alex-r%C3%ADver/';
 assert.equal(readProfile(page(card(marker('<h2>Alex Ríver</h2>','alex-ríver'))),unicodeUrl,now)?.name,'Alex Ríver');
 for(const bad of ['https://www.linkedin.com/in/%ZZ/','https://www.linkedin.com/in/%E0%A4/']){
  assert.doesNotThrow(()=>readProfile(page(),bad,now));assert.equal(readProfile(page(),bad,now),null);
 }
});

test('ambiguous rendered headings, verification markers, top cards or primary regions refuse the read',()=>{
 const candidates=[
  page(card(marker('<h2>Alex River</h2><h2>Another Person</h2>'))),
  page(card(marker()+marker('<h2>Another Person</h2>'))),
  page(card(marker()+marker('<h2>Another Person</h2>','another-person'))),
  page(card()+card()),
  documentOf(`<main><section aria-label="Primary content">${card()}${about}</section><section aria-label="Primary content">${card()}${about}</section></main>`),
 ];
 for(const doc of candidates)assert.equal(readProfile(doc,url,now),null);
});

test('unrelated h2 headings and sidebar recommendations never substitute for the marked name',()=>{
 const extra='<aside><h2>Popular Person</h2>'+card(marker('<h2>Sidebar Person</h2>'))+'</aside><section><h2>People you may know</h2><h2>Someone Else</h2></section>';
 assert.equal(readProfile(page(card(),about,extra),url,now)?.name,'Alex River');
 assert.equal(readProfile(page(card('<h2>Unmarked Person</h2>'),about,extra),url,now),null);
 assert.equal(readProfile(documentOf('<main><section><h2>About</h2><h2>Activity</h2></section>'+extra+'</main>'),url,now),null);
});

test('hidden name headings, verification markers and top-card ancestors cannot supply an identity',()=>{
 for(const heading of ['<h2 hidden>Alex River</h2>','<h2 style="display:none">Alex River</h2>',
  '<h2 style="visibility:hidden">Alex River</h2>','<h2 class="sr-only">Alex River</h2>']){
  assert.equal(readProfile(page(card(marker(heading))),url,now),null);
 }
 assert.equal(readProfile(page(card(marker().replace('<div ','<div hidden '))),url,now),null);
 assert.equal(readProfile(page(card().replace('<div ','<div style="display:none" ')),url,now),null);
 assert.equal(readProfile(page(card(marker('<h2 hidden>Another Person</h2><h2>Alex River</h2>'))),url,now)?.name,'Alex River');
});

test('the marker must live inside a nested top-card section within the verified primary region',()=>{
 const candidates=[
  documentOf(`<main>${card()}<section aria-label="Primary content">${about}</section></main>`),
  documentOf(`<main><section>${card()}${about}</section></main>`),
  page(card(marker(),'componentkey','unrelated.syntheticTopcard')),
  page(card(marker(),'componentkey','com.linkedin.sdui.profile.card.ref.syntheticAbout')),
  page(`<div componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard">${marker()}</div>`),
  page(card(marker('<section><h2>Nested recommended person</h2></section>'))),
 ];
 for(const doc of candidates)assert.equal(readProfile(doc,url,now),null);
});

test('SDUI section extraction stays inside Primary content and excludes sibling sidebar evidence',()=>{
 const unrelated='<div><section><div id="about"></div><h2>About</h2><p>SIDEBAR_ABOUT</p></section>'
  +'<section><div id="experience"></div><h2>Experience</h2><ul><li>SIDEBAR_EXPERIENCE</li></ul></section></div>';
 const profile=readProfile(page(card(),about+experience,unrelated),url,now)!;
 assert.equal(profile.profileReadAt,now);
 assert.equal(JSON.stringify(profile).includes('SIDEBAR'),false);
 assert.ok(profile.anchors.some(anchor=>anchor.text.includes('accessible professional tools')));
 assert.ok(profile.anchors.some(anchor=>anchor.text.includes('Research engineer')));
 const withoutOwnSections=readProfile(page(card(),'',unrelated),url,now)!;
 assert.equal(withoutOwnSections.anchors.length,0);
 assert.equal(withoutOwnSections.profileReadAt,null);
});

test('unsectioned primary-region headings do not turn the entire profile container into one evidence anchor',()=>{
 const profile=readProfile(page(card(),'<h2>About</h2><p>Unscoped text</p><h2>Experience</h2>'),url,now)!;
 assert.equal(profile.name,'Alex River');
 assert.equal(profile.anchors.length,0);
 assert.equal(profile.profileReadAt,null);
});

test('unlabelled top-card paragraphs remain unknown rather than guessed headline, location or typed roles',()=>{
 const profile=readProfile(page(card(marker()+'<p>CEO at an example company</p><p>Chicago, Illinois</p><p>500+ connections</p>')),url,now)!;
 assert.ok(!profile.anchors.some(anchor=>anchor.kind==='headline'||anchor.kind==='location'||anchor.field!==undefined));
 assert.ok(profile.missingSections?.includes('location'));
 assert.ok(profile.missingSections?.includes('experience'));
});

test('explicit rendered top-card field selectors still work and name-only SDUI reads stay incomplete',()=>{
 const body=marker()+'<p data-field="headline">A public headline</p><p data-field="location">A stated place</p>';
 const profile=readProfile(page(card(body)),url,now)!;
 assert.equal(profile.anchors.find(anchor=>anchor.kind==='headline')?.text,'A public headline');
 assert.equal(profile.anchors.find(anchor=>anchor.kind==='location')?.text,'A stated place');
 const nameOnly=readProfile(page(card(),''),url,now)!;
 assert.equal(nameOnly.name,'Alex River');
 assert.equal(nameOnly.profileReadAt,null);
});

test('the classic rendered h1 path and main-scoped evidence remain supported',()=>{
 const doc=documentOf('<main><section><h1>Classic Profile</h1><p data-field="headline">Public headline</p></section>'+about+'</main>');
 const profile=readProfile(doc,url,now)!;
 assert.equal(profile.name,'Classic Profile');
 assert.equal(profile.profileReadAt,now);
 assert.ok(profile.anchors.some(anchor=>anchor.kind==='about'));
 assert.equal(readProfile(page(card(),about,'<section><h1>Classic Profile</h1></section>'),url,now)?.name,'Classic Profile');
});
