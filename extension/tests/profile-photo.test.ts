import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readProfile} from '../src/profile.js';
import {inboxPayload,validateSave} from '../src/messaging.js';
import {canonicalProfilePhotoUrl} from '../../src/lib/profile-photo';
import type {Session} from '../src/types.js';
const deps=process.env.MIGHTY_DEPS_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const {parseHTML}=createRequire(resolve(deps,'package.json'))('linkedom');
const doc=(html:string)=>parseHTML(html).document as Document;
const url='https://www.linkedin.com/in/alex-river/',at='2026-09-13T12:00:00.000Z';
const photo='https://media.licdn.com/dms/image/v2/SYNTHETIC_PHOTO/profile-displayphoto-shrink_100_100/0/1?e=1800000000&v=beta&t=synthetic_signature';
const other=photo.replace('SYNTHETIC_PHOTO','OTHER_SYNTHETIC_PHOTO');
const image=(src=photo,alt='Alex River')=>`<img src="${src}" alt="${alt}">`;
const about='<section><h2>About</h2><p>A synthetic professional biography.</p></section>';
const classic=(images:string,extra='')=>doc(`<main><section><h1>Alex River</h1>${images}</section>${about}${extra}</main>`);
const sdui=(images:string,extra='')=>doc(`<main>${extra}<section aria-label="Primary content"><div componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"><section>${images}<a componentkey="ProfileVerificationTriggerRef-alex-river"><div componentkey="ProfileVerificationTriggerRef-alex-river"><h2>Alex River</h2></div></a></section></div>${about}</section></main>`);
const subjectPhoto=(href=url)=>`<a componentkey="topcard-logo-image-referencekey" href="${href}"><div aria-label="Profile photo" componentkey="topcard-logo-image-referencekey"><figure aria-hidden="true"><img alt="" data-loaded="true" src="${photo}" srcset="${other} 800w"><svg aria-label="Generic fallback person"></svg></figure></div></a>`;

test('the actual SDUI photo wrapper identifies the subject despite a decorative aria-hidden figure',()=>{
 const p=readProfile(sdui(subjectPhoto(),'<aside>'+image(other,'Sidebar Person')+'</aside>'),url,at)!;
 assert.equal(p.photoUrl,photo);
 assert.equal(p.name,'Alex River');
 assert.equal(p.profileReadAt,at);
 assert.ok(!JSON.stringify(p).includes(other),'The unrelated srcset candidate is not guessed to be the visible photo.');
});

test('an exact subject-photo reference works in a sibling verified top-card subsection only',()=>{
 const document=sdui('');
 const card=document.querySelector('[componentkey="com.linkedin.sdui.profile.card.ref.syntheticTopcard"]')!;
 card.insertAdjacentHTML('beforeend','<section>'+subjectPhoto()+'</section>');
 document.querySelector('main')!.insertAdjacentHTML('beforeend','<aside>'+subjectPhoto().replaceAll(photo,other)+'</aside>');
 assert.equal(readProfile(document,url,at)?.photoUrl,photo);
 card.querySelector('section:last-child')!.innerHTML=image(other);
 assert.equal(readProfile(document,url,at)?.photoUrl,undefined,'A matching alt alone cannot cross the subject section boundary.');
 card.querySelector('section:last-child')!.innerHTML=subjectPhoto('https://www.linkedin.com/in/another-person/');
 assert.equal(readProfile(document,url,at)?.photoUrl,undefined);
});

test('a classical subject-named photo is captured while cover, company and sidebar images are ignored',()=>{
 const p=readProfile(classic(image(other,'Cover image')+image(photo)+image(other,'Company logo'),'<aside>'+image(other,'Alex River')+'</aside>'),url,at)!;
 assert.equal(p.photoUrl,photo);
});

test('wrong-person links, unrelated selectors and placeholder SVGs cannot supply the SDUI photo',()=>{
 for(const html of [subjectPhoto('https://www.linkedin.com/in/another-person/'),
  subjectPhoto().replace('aria-label="Profile photo"','aria-label="Company logo"'),
  subjectPhoto().replace('data-loaded="true"','data-loaded="false"'),
  '<svg aria-label="Profile photo"></svg>',image(photo,''),image(other,'Another Person')]){
  assert.equal(readProfile(sdui(html),url,at)?.photoUrl,undefined);
 }
});

test('hidden, foreign-section and contradictory named images never replace the subject photo',()=>{
 for(const html of [image().replace('<img ','<img hidden '),image().replace('<img ','<img style="display:none" '),
  '<section>'+image()+'</section>',image(other,'Another Person').replace('<img ','<img class="pv-top-card-profile-picture__image" ')]){
  assert.equal(readProfile(classic(html),url,at)?.photoUrl,undefined);
 }
 assert.equal(readProfile(classic('',`<section>${image()}</section>`),url,at)?.photoUrl,undefined);
});

test('ambiguous rendered photo URLs refuse selection while exact duplicate images deduplicate',()=>{
 assert.equal(readProfile(classic(image()+image(other)),url,at)?.photoUrl,undefined);
 assert.equal(readProfile(classic(image()+image()),url,at)?.photoUrl,photo);
 const document=classic(image());
 Object.defineProperty(document.querySelector('img')!,'naturalWidth',{value:0});
 assert.equal(readProfile(document,url,at)?.photoUrl,undefined);
});

test('currentSrc is the rendered resource, but arbitrary CDN paths and external image URLs are refused',()=>{
 const document=classic(image());Object.defineProperty(document.querySelector('img')!,'currentSrc',{value:other});
 assert.equal(readProfile(document,url,at)?.photoUrl,other);
 const urls=['https://evil.example.org/photo.png','http://media.licdn.com/dms/image/v2/a/profile-displayphoto-shrink_100_100/0/1',
  photo.replace('media.licdn.com','media.licdn.com.evil.example.org'),photo.replace('https://','https://user:pass@'),
  photo.replace('media.licdn.com','media.licdn.com:444'),photo.replace('profile-displayphoto','company-logo'),
  photo+'&redirect=https://example.org',photo+'#fragment','data:image/png;base64,AAAA','blob:https://www.linkedin.com/example'];
 for(const value of urls){assert.equal(canonicalProfilePhotoUrl(value),null);assert.equal(readProfile(classic(image(value)),url,at)?.photoUrl,undefined);}
 assert.equal(canonicalProfilePhotoUrl(photo),photo);
 assert.equal(canonicalProfilePhotoUrl(photo.replace('media.licdn.com','media-exp1.licdn.com')),photo.replace('media.licdn.com','media-exp1.licdn.com'));
});

test('the validated photo survives the extension inbox payload and unsafe photo injection is rejected',()=>{
 const profile=readProfile(sdui(subjectPhoto()),url,at)!;
 const userId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
 const session:Session={userId,accessToken:'synthetic-only',expiresAt:Date.parse(at)+3600000,strategy:''};
 const payload=inboxPayload(validateSave({operationId,userId,profile,source:'rendered_profile'},session));
 assert.equal(payload.snapshot.photoUrl,photo);
 assert.equal(payload.snapshot.profileUrl,url);
 assert.equal(payload.profile_read_at,at);
 assert.deepEqual(payload.snapshot.anchors,profile.anchors);
 assert.throws(()=>validateSave({operationId,userId,profile:{...profile,photoUrl:'https://other.example.org/picture'},source:'rendered_profile'},session),/photo/);
});
