import{hasSubstantiveProfile}from'./profile.js';
import type{GoalFit,Profile}from'./types.js';
const stop=new Set('a an and are as at be build building by connect connections find for from grow help i in interested is it looking me meet my network networking of on or people professional professionals relationships seeking that the their them to want with work working would your'.split(' '));
function terms(text:string){return new Set((text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[]).filter(x=>!stop.has(x)&&(x.length>2||['ai','ml','ux','vc'].includes(x))));}
export function goalFit(strategy:string,profile:Profile|null):GoalFit{
 if(!strategy.trim())return{label:'Not enough context',reason:'Set your strategy in the app to compare the profile with your goal.',evidence:[]};
 if(profile?.truncated)return{label:'Not enough context',reason:'The complete rendered profile exceeds the save limit. No shortened profile will be saved.',evidence:[]};
 if(!profile?.profileReadAt||!hasSubstantiveProfile(profile))return{label:'Not enough context',reason:'This profile has not been read. Search snippets are not enough for a profile brief.',evidence:[]};
 const goals=terms(strategy),matches=profile.anchors.filter(a=>a.kind!=='timing'&&[...terms(a.text)].some(t=>goals.has(t)));
 if(!matches.length)return{label:'No clear goal overlap',reason:'No clear overlap with your strategy appears in the profile sections read. Other relevant context may be missing.',evidence:[]};
 const evidence=matches.slice(0,3),first=evidence[0],matched=[...terms(first.text)].find(t=>goals.has(t))!;
 return{label:evidence.some(a=>['headline','about','experience','skills'].includes(a.kind))?'Goal overlap':'Possible goal overlap',reason:'Your strategy mentions “'+matched+'.” The '+first.kind+' section says: “'+first.text.slice(0,260)+'”',evidence};
}
export function canRequestBrief(profile:Profile|null):boolean{return Boolean(profile?.profileReadAt&&!profile.truncated&&hasSubstantiveProfile(profile));}
