import{firstRendered,rendered,textOf}from'./dom.js';
import{currentExperienceFields}from'./experience-fields.js';
import{canonicalProfileURL,isSearchURL}from'./urls.js';
import type{Anchor,AnchorKind,PageSnapshot,PageState,Profile,SearchResult}from'./types.js';
export function blockedState(doc:Document,url:string,status=200):PageState|null{
 let path='';try{path=new URL(url).pathname.toLowerCase();}catch{return 'unknown';}
 if(status===401||/\/(authwall|login|uas\/login|signup)(?:\/|$)/.test(path))return 'auth_required';
 if([403,429].includes(status)||/\/(checkpoint|challenge|security-verification)(?:\/|$)/.test(path))return 'blocked';
 if(status<200||status>=300)return 'unknown';
 const main=doc.querySelector('main')||doc.body;const headings=Array.from(main?.querySelectorAll('h1,h2,[role="alert"]')||[]).filter(rendered).map(x=>textOf(x,300)).join(' ').toLowerCase();
 if(/security verification|verify (?:that )?you(?:'re| are) human|unusual activity|automated (?:activity|requests)|temporarily restricted|search (?:is )?(?:blocked|restricted|unavailable)|commercial use limit|search limit/.test(headings))return 'blocked';
 if(firstRendered(doc,'iframe[src*="recaptcha"],iframe[src*="captcha"],form[action*="checkpoint"]'))return 'blocked';
 if(/^(?:sign in|join linkedin|log in)(?:\s|$)/.test(headings)||firstRendered(main,'form[action*="login"],form[action*="uas/login"]'))return 'auth_required';return null;
}
const sections:Array<[AnchorKind,RegExp,string[]]>=[
 ['about',/^about$/i,['about']],['experience',/^experience$/i,['experience']],['education',/^education$/i,['education']],
 ['skills',/^skills$/i,['skills']],['languages',/^languages$/i,['languages']],
 ['certifications',/^(?:licenses? (?:&|and) certifications?|certifications?)$/i,['licenses_and_certifications']],
 ['activity',/^activity(?:\s|$)/i,['content_collections','recent-activity','activity']]
];
const substantiveKinds=new Set<AnchorKind>(['about','experience','education','skills','languages','certifications','activity']);
export function hasSubstantiveProfile(profile:Pick<Profile,'anchors'>|null):boolean{
 return Boolean(profile?.anchors.some(anchor=>substantiveKinds.has(anchor.kind)&&anchor.text.trim().length>0));
}
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DAY=86_400_000;
/** A visible start month is evidence of timing, never an invented exact start day. */
export function recentRoleStart(dateRange:string,now:string):boolean{
 if(!/\b(?:Present|Current)\b/i.test(dateRange))return false;
 const exact=dateRange.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\s*(?:[-–—]|to)\s*(?:Present|Current)\b/i);
 let start:number;
 if(exact){start=Date.UTC(Number(exact[1]),Number(exact[2])-1,Number(exact[3]));const date=new Date(start);if(date.getUTCMonth()!==Number(exact[2])-1||date.getUTCDate()!==Number(exact[3]))return false;}
 else{const match=dateRange.match(new RegExp('\\b('+MONTH+')\\s+((?:19|20)\\d{2})\\s*(?:[-–—]|to)\\s*(?:Present|Current)\\b','i'));if(!match)return false;start=Date.UTC(Number(match[2]),MONTHS.indexOf(match[1].slice(0,3).toLowerCase()),1);}
 const observed=Date.parse(now);return Number.isFinite(observed)&&start<=observed&&start>=observed-90*DAY;
}
function dateRanges(text:string):string[]{
 const expression=new RegExp('(?:'+MONTH+'\\s+)?(?:19|20)\\d{2}(?:-\\d{2}-\\d{2})?\\s*(?:[-–—]|to)\\s*(?:(?:'+MONTH+'\\s+)?(?:19|20)\\d{2}(?:-\\d{2}-\\d{2})?|Present|Current)','gi');
 return [...text.matchAll(expression)].map(match=>match[0].trim());
}
/** Recency comes only from a rendered timestamp associated with an activity item. */
function recentActivityDate(item:Element,now:string):string|null{
 const element=firstRendered(item,'time,[data-field="posted-at"],[data-posted-at],.update-components-actor__sub-description,.feed-shared-actor__sub-description');
 if(!element)return null;
 const visible=textOf(element,Infinity),iso=element.getAttribute('datetime')||element.getAttribute('data-posted-at')||'';
 const observed=Date.parse(now);if(!Number.isFinite(observed)||!visible)return null;
 // A machine-readable date on a rendered timestamp is evidence; hidden time elements are excluded.
 if(iso){const date=Date.parse(iso);if(Number.isFinite(date)&&date<=observed&&date>=observed-90*DAY)return visible||iso;return null;}
 const relative=visible.match(/(?:^|\s)(\d+)\s*(months?|mo|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|secs?|s)(?:\b|$)/i);
 if(relative){const value=Number(relative[1]),unit=relative[2].toLowerCase();const factor=unit.startsWith('mo')?31:unit.startsWith('w')?7:unit.startsWith('d')?1:unit.startsWith('h')?1/24:unit.startsWith('m')?1/1440:1/86400;
  // Relative labels are rounded; use their upper bound to avoid turning "3mo" into a precise 90 days.
  if(value>=0&&(value+1)*factor<=90)return relative[0].trim();return null;}
 if(/^(?:just now|today|yesterday)(?:\s|[•·]|$)/i.test(visible))return visible;
 if(new RegExp('\\b'+MONTH+'\\s+\\d{1,2},?\\s+(?:19|20)\\d{2}\\b','i').test(visible)||/^\d{4}-\d{2}-\d{2}/.test(visible)){
  const date=Date.parse(visible);if(Number.isFinite(date)&&date<=observed&&date>=observed-90*DAY)return visible;
 }
 return null;
}
export function readProfile(doc:Document,url:string,now=new Date().toISOString()):Profile|null{
 const profileUrl=canonicalProfileURL(url),main=doc.querySelector('main');if(!profileUrl||!main||blockedState(doc,url))return null;
 const heading=firstRendered(main,'h1'),name=textOf(heading,Infinity);if(!name)return null;
 const truncationReasons:string[]=[];if(name.length>200)truncationReasons.push('name_limit');
 const top=heading?.closest('section')||main,anchors:Anchor[]=[],seen=new Set<string>();
 // Preserve complete rendered evidence. Storage limits reject a whole save, never trim its facts.
 const add=(kind:AnchorKind,text:string,fragment:string,typed?:Pick<Anchor,'field'|'currentExperience'>)=>{text=text.replace(/\s+/g,' ').trim();const key=kind+'\0'+(typed?.field||'')+'\0'+text+'\0'+(typed?.currentExperience?.entryText||'');if(text&&text!==name&&!seen.has(key)){seen.add(key);anchors.push({kind,text,sourceUrl:profileUrl+'#'+fragment,observedAt:now,...typed});}};
 add('headline',textOf(firstRendered(top,'[data-field="headline"],.text-body-medium.break-words,.pv-text-details__left-panel .text-body-medium'),Infinity),'profile');
 add('location',textOf(firstRendered(top,'[data-field="location"],.text-body-small.inline.t-black--light.break-words,.pv-text-details__left-panel .text-body-small'),Infinity),'profile');
 for(const[kind,label,ids]of sections){
  let section:Element|null=null;for(const id of ids){const exact=main.querySelector('[id="'+id+'"]');if(exact){section=exact.closest('section');if(section)break;}}
  if(!section){const h=Array.from(main.querySelectorAll('h2,h3')).find(x=>rendered(x)&&label.test(textOf(x,100)));section=h?.closest('section')||null;}
  if(!section||!rendered(section))continue;
  const id=ids[0];
  if(kind==='activity'){
   const selector='article,[data-activity-item],[data-urn*="urn:li:activity:"],.feed-shared-update-v2';
   const semantic=Array.from(section.querySelectorAll(selector)).filter(rendered);
   const candidates=semantic.length?semantic:Array.from(section.querySelectorAll('li')).filter(rendered);
   const items=candidates.filter(item=>!candidates.some(other=>other!==item&&other.contains(item)));
   for(const item of items){
    const text=textOf(item,Infinity);if(!text)continue;
    // Activity tabs and follower counters are not actual activity evidence.
    const hasPost=Boolean(firstRendered(item,'time,[data-field="posted-at"],[data-posted-at],a[href*="/feed/update/"],a[href*="/posts/"],.update-components-actor__sub-description,.feed-shared-actor__sub-description'))||item.matches('article,[data-activity-item],[data-urn*="urn:li:activity:"],.feed-shared-update-v2');
    if(!hasPost)continue;add('activity',text,id);
    const stamp=firstRendered(item,'time,[data-field="posted-at"],[data-posted-at],.update-components-actor__sub-description,.feed-shared-actor__sub-description'),stampText=textOf(stamp,Infinity);
    if(stampText){const exact=stamp?.getAttribute('datetime')||stamp?.getAttribute('data-posted-at');add('timing','Rendered activity timestamp: '+stampText+(exact?' ('+exact+')':''),id);}
    const date=recentActivityDate(item,now);
    if(date)add('timing','Recent rendered activity: '+date,id);
   }
   continue;
  }
  const items=Array.from(section.querySelectorAll('li')).filter(x=>rendered(x)&&!x.parentElement?.closest('li'));
  for(const item of(items.length?items:[section])){
   const text=textOf(item,Infinity);if(!text||label.test(text))continue;
   const bodyOnly=text.replace(/^(?:about|experience|education|skills|languages|licenses? (?:&|and) certifications?|certifications?)\s*/i,'').replace(/(?:show all(?: \d+)?[^.]*|see more|show more|add (?:experience|education|skills))$/i,'').trim();if(!bodyOnly)continue;
   add(kind,text,id);
   if(kind==='experience'||kind==='education')for(const date of dateRanges(text)){add('timing',date,id);if(kind==='experience'&&recentRoleStart(date,now))add('timing','Recent role start indicated by “'+date+'”. The rendered start date or month falls within the last 90 days.',id);}
   if(kind==='experience')for(const field of currentExperienceFields(item,now))add('experience',field.text,id,field);
  }
 }
 const missingSections:AnchorKind[]=(['experience','education','location','skills','languages','certifications','activity'] as AnchorKind[]).filter(kind=>!anchors.some(anchor=>anchor.kind===kind));
 const profile:Profile={profileUrl,name,anchors,profileReadAt:null,truncated:truncationReasons.length>0,truncationReasons,missingSections};
 profile.profileReadAt=!truncationReasons.length&&hasSubstantiveProfile(profile)?now:null;
 if(new TextEncoder().encode(JSON.stringify(profile)).byteLength>49152){profile.truncationReasons.push('snapshot_size_limit');profile.truncated=true;profile.profileReadAt=null;}
 return profile;
}
export function readSearchResults(doc:Document,url:string):SearchResult[]{
 if(!isSearchURL(url)||blockedState(doc,url))return [];const main=doc.querySelector('main');if(!main)return [];const results:SearchResult[]=[],seen=new Set<string>();
 for(const a of main.querySelectorAll('a[href]')){if(!rendered(a))continue;const profileUrl=canonicalProfileURL(a.getAttribute('href')||'',url);if(!profileUrl||seen.has(profileUrl))continue;const card=a.closest('li,article,[data-search-result],.reusable-search__result-container')||a.parentElement;const rawName=textOf(firstRendered(card||a,'[data-field="name"],.entity-result__title-text,h3')||a,201),name=rawName.slice(0,200);if(!name||/^(?:view|visit) profile$/i.test(name))continue;seen.add(profileUrl);const rawSubtitle=textOf(firstRendered(card||a,'[data-field="headline"],.entity-result__primary-subtitle'),901);results.push({profileUrl,name,subtitle:rawSubtitle.slice(0,900),profileReadAt:null,truncated:rawName.length>200||rawSubtitle.length>900});}return results;
}
export function classifySearchPage(doc:Document,url:string,status=200):{state:PageState;results:SearchResult[];message:string}{
 const blocked=blockedState(doc,url,status);if(blocked)return{state:blocked,results:[],message:blocked==='auth_required'?'Sign in to LinkedIn in this tab, then reopen the extension.':blocked==='blocked'?'LinkedIn is blocking this search. Complete any verification yourself before trying again.':'The search page could not be read yet.'};
 const results=readSearchResults(doc,url);if(results.length)return{state:'ready',results,message:'Select up to five people. Search snippets do not count as reading a profile.'};
 const main=doc.querySelector('main');const headings=Array.from(main?.querySelectorAll('h1,h2,h3,[role="status"],.search-reusables__no-results')||[]).filter(rendered).map(x=>textOf(x,400)).join(' ');
 if(/no (?:matching )?results(?: found)?|could(?:n['’]t| not) find (?:any )?results|no people found/i.test(headings))return{state:'empty',results:[],message:'LinkedIn explicitly reports no results for this search.'};
 return{state:'unknown',results:[],message:'No readable search results yet. The page may still be loading or its layout may have changed.'};
}
export function snapshot(doc:Document,url:string):PageSnapshot{
 if(isSearchURL(url))return{kind:'search',pageUrl:url,...classifySearchPage(doc,url)};
 if(canonicalProfileURL(url)){const blocked=blockedState(doc,url),profile=blocked?null:readProfile(doc,url);return{kind:'profile',state:blocked||(profile?.profileReadAt?'ready':'unknown'),profile,message:blocked?'This profile is not available to read in the current LinkedIn session.':profile?.profileReadAt?'Context read from this rendered profile.':'Open the profile and let its sections load. There is not enough context yet.'};}
 return{kind:'unsupported',state:'unknown',message:'Open a LinkedIn profile or a people search in this tab.'};
}
