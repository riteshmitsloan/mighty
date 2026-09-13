import{hasSubstantiveProfile}from'./profile.js';
import{validCurrentExperienceAnchor}from'../../src/lib/current-experience';
import{canonicalProfileURL,exactOrigin}from'./urls.js';
import type{PendingSave,Profile,PublicConfig,SaveInput,Session}from'./types.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isExternalSender(sender:{url?:string;origin?:string;id?:string},allowedOrigins:string[]):boolean{
 if(sender.id)return false;return Boolean(sender.url&&allowedOrigins.some(origin=>exactOrigin(sender.url!,origin))&&(!sender.origin||allowedOrigins.some(origin=>exactOrigin(sender.origin!,origin))));
}
export function parseExternalMessage(input:unknown):{type:'connect';accessToken:string}|{type:'disconnect'}|{type:'status'}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid bridge message.');
 const v=input as Record<string,unknown>;if(v.protocol!==1)throw Error('Unsupported bridge protocol.');
 if(v.type==='mighty:connect'){if(Object.keys(v).some(x=>!['protocol','type','accessToken'].includes(x))||typeof v.accessToken!=='string'||v.accessToken.length>8192)throw Error('Invalid account handoff.');return{type:'connect',accessToken:v.accessToken};}
 if(['mighty:disconnect','mighty:status'].includes(String(v.type))&&Object.keys(v).every(x=>['protocol','type'].includes(x)))return{type:v.type==='mighty:disconnect'?'disconnect':'status'};
 throw Error('Unsupported bridge message.');
}
export function sessionFromVerifiedToken(accessToken:string,verifiedUserId:string,projectUrl:string,now=Date.now()):Session{
 try{const parts=accessToken.split('.');if(parts.length!==3)throw Error();const encoded=parts[1].replace(/-/g,'+').replace(/_/g,'/');const claims=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
 if(!uuid.test(verifiedUserId)||claims.sub!==verifiedUserId||claims.iss!==projectUrl.replace(/\/$/,'')+'/auth/v1'||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now||claims.exp*1000>now+3900000)throw Error();
 return{userId:verifiedUserId,accessToken,expiresAt:claims.exp*1000,strategy:''};
 }catch{throw Error('The handoff must contain a verified, short-lived account session.');}
}
export function validSession(session:Session|null,now=Date.now()):session is Session{return Boolean(session&&session.expiresAt>now+5000);}
export function validateSave(value:unknown,session:Session):SaveInput{
 if(!value||typeof value!=='object')throw Error('Invalid save request.');const x=value as SaveInput;
 if(!uuid.test(x.operationId)||x.userId!==session.userId||!['rendered_profile','search_result'].includes(x.source))throw Error('The save belongs to a different account or is invalid.');
 const p=x.profile;if(!p||canonicalProfileURL(p.profileUrl)!==p.profileUrl||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!Array.isArray(p.anchors)||typeof p.truncated!=='boolean'||!Array.isArray(p.truncationReasons))throw Error('The profile snapshot is invalid.');
 if(x.source==='search_result'&&(p.profileReadAt!==null||p.anchors.length))throw Error('Search snippets cannot be marked as a profile read.');
 if(x.source==='rendered_profile'&&(!hasSubstantiveProfile(p)||(!p.truncated&&(!p.profileReadAt||!Number.isFinite(Date.parse(p.profileReadAt))))))throw Error('Read the actual profile before saving this snapshot.');
 const kinds=['headline','location','about','experience','education','skills','languages','certifications','activity','timing'];
 for(const a of p.anchors){
  if(!a||!kinds.includes(a.kind)||typeof a.text!=='string'||!a.text.trim()||typeof a.sourceUrl!=='string'||!a.sourceUrl.startsWith(p.profileUrl+'#')||!Number.isFinite(Date.parse(a.observedAt)))throw Error('An evidence anchor is invalid.');
  if((a.field!==undefined||a.currentExperience!==undefined)&&!validCurrentExperienceAnchor(a,p.anchors,p.profileUrl,p.profileReadAt??a.observedAt))throw Error('A current experience field needs valid visible source and date evidence.');
 }
 if(p.truncationReasons.includes('snapshot_size_limit')||new TextEncoder().encode(JSON.stringify(p)).length>49152)throw Error('This profile exceeds the snapshot size limit. Its full context has not been saved.');
 return{operationId:x.operationId,userId:x.userId,profile:p,source:x.source};
}
export function inboxPayload(save:SaveInput){const readAt=save.source==='rendered_profile'&&!save.profile.truncated?save.profile.profileReadAt:null;return{operation_id:save.operationId,user_id:save.userId,profile_url:save.profile.profileUrl,person:save.profile.name,snapshot:{...save.profile,profileReadAt:readAt,source:save.source},profile_read_at:readAt};}
export function pendingKey(save:Pick<SaveInput,'userId'|'operationId'>){return 'pending:'+save.userId+':'+save.operationId;}
export function matchingPending(rows:PendingSave[],session:Session){return rows.filter(row=>row.userId===session.userId);}
