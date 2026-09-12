import{config,configured}from'./config.js';
import{inboxPayload,isExternalSender,matchingPending,parseExternalMessage,pendingKey,sessionFromVerifiedToken,validSession,validateSave}from'./messaging.js';
import{canonicalProfileURL,isSearchURL}from'./urls.js';
import type{PageSnapshot,PendingSave,Session}from'./types.js';
const setup=Promise.all([chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})]);
const ports=new Set<chrome.runtime.Port>();let accountGeneration=0;const inFlight=new Map<string,Promise<void>>();
const session=async()=>{await setup;return(await chrome.storage.session.get('account')).account as Session|null||null;};
const headers=(s:Session)=>({'apikey':config.publishableKey,Authorization:'Bearer '+s.accessToken,'Content-Type':'application/json'});
function status(s:Session|null){return{connected:validSession(s),userId:s?.userId||null,strategy:s?.strategy||'',configured:configured(),appOrigin:config.appOrigins[0]};}
function broadcast(){for(const port of ports){try{port.postMessage({type:'mighty:account_changed'});}catch{ports.delete(port);}}}
async function verifiedHandoff(accessToken:string):Promise<Session>{
 if(!configured())throw Error('The prototype is not connected to a Supabase project.');
 const response=await fetch(config.supabaseUrl+'/auth/v1/user',{headers:{apikey:config.publishableKey,Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('The account session could not be verified.');const user=await response.json();const s=sessionFromVerifiedToken(accessToken,user.id,config.supabaseUrl);
 const endpoint=new URL(config.supabaseUrl+'/rest/v1/settings');endpoint.searchParams.set('user_id','eq.'+s.userId);endpoint.searchParams.set('select','data');
 const settings=await fetch(endpoint,{headers:headers(s),signal:AbortSignal.timeout(10000)});if(!settings.ok)throw Error('The account strategy could not be loaded.');
 const rows=await settings.json();s.strategy=typeof rows[0]?.data?.strategy==='string'?rows[0].data.strategy.slice(0,16000):'';return s;
}
async function deliver(save:PendingSave,s:Session){
 const current=await session();if(!validSession(current)||current.userId!==s.userId||save.userId!==s.userId)throw Error('Reconnect the account that owns this pending save.');
 s=current;validateSave(save,s);const key=pendingKey(save);const existing=inFlight.get(key);if(existing)return existing;
 const job=(async()=>{const response=await fetch(config.supabaseUrl+'/rest/v1/outreach_inbox?on_conflict=user_id,operation_id',{method:'POST',headers:{...headers(s),Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(inboxPayload(save)),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(response.status===401?'Your session expired. Reconnect in the app.':response.status===403?'This account cannot save right now.':'The save is still pending. Try again when the app connection is available.');
 // A duplicate operation is a successful acknowledgement of the same immutable save.
 await chrome.storage.local.remove(key);
 })();inFlight.set(key,job);try{await job;}finally{inFlight.delete(key);}
}
async function flush(s:Session){const all=await chrome.storage.local.get(null);const pending=matchingPending(Object.entries(all).filter(([k])=>k.startsWith('pending:')).map(([,v])=>v as PendingSave),s);for(let offset=0;offset<pending.length;offset+=4)await Promise.allSettled(pending.slice(offset,offset+4).map(row=>deliver(row,s)));}
async function readActive():Promise<PageSnapshot>{
 const[tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!tab.url||(!canonicalProfileURL(tab.url)&&!isSearchURL(tab.url)))return{kind:'unsupported',state:'unknown',message:'Open a LinkedIn profile or people search in the active tab.'};
 try{return await chrome.tabs.sendMessage(tab.id,{type:'mighty:read'});}catch{
 // Content contexts are invalidated on reload. Reinject immediately, without a polling delay.
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
 return await chrome.tabs.sendMessage(tab.id,{type:'mighty:read'});
 }
}
chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
 if(!isExternalSender(sender,config.appOrigins)){respond({ok:false,message:'This origin is not allowed.'});return;}
 void(async()=>{await setup;const parsed=parseExternalMessage(message);
 if(parsed.type==='status')return{ok:true,...status(await session())};
 const generation=++accountGeneration;if(parsed.type==='disconnect'){await chrome.storage.session.remove('account');broadcast();return{ok:true};}
 const s=await verifiedHandoff(parsed.accessToken);if(generation!==accountGeneration)throw Error('A newer account handoff replaced this request.');
 await chrome.storage.session.set({account:s});broadcast();void flush(s);return{ok:true,...status(s)};
 })().then(respond).catch(()=>respond({ok:false,message:'The account handoff could not be completed. Reconnect from the app.'}));return true;
});
chrome.runtime.onConnect.addListener(port=>{if(port.name!=='mighty:popup'||port.sender?.id!==chrome.runtime.id)return;ports.add(port);port.onDisconnect.addListener(()=>ports.delete(port));});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='mighty:page_changed'&&sender.tab){for(const port of ports){try{port.postMessage({type:'mighty:page_changed',tabId:sender.tab.id});}catch{ports.delete(port);}}return;}
 if(sender.url!==chrome.runtime.getURL('popup.html'))return;
 void(async()=>{await setup;if(message?.type==='mighty:status')return{ok:true,...status(await session())};if(message?.type==='mighty:read_active')return{ok:true,snapshot:await readActive()};
 if(message?.type==='mighty:save'){const s=await session();if(!validSession(s))throw Error('Connect your account in the app before saving.');
 const save=validateSave(message.save,s),key=pendingKey(save);const old=(await chrome.storage.local.get(key))[key] as PendingSave|undefined;
 if(old&&JSON.stringify(inboxPayload(old))!==JSON.stringify(inboxPayload(save)))throw Error('This save identifier already belongs to a different snapshot.');
 const queued:PendingSave=old||{...save,queuedAt:new Date().toISOString()};await chrome.storage.local.set({[key]:queued});await deliver(queued,s);return{ok:true,operationId:save.operationId};}
 throw Error('Unsupported extension request.');
 })().then(respond).catch((e:unknown)=>respond({ok:false,message:e instanceof Error?e.message:'The extension request could not be completed.'}));return true;
});

chrome.runtime.onConnectExternal.addListener(port=>{
 if(port.name!=='mighty:bridge'||!isExternalSender(port.sender||{},config.appOrigins)){port.disconnect();return;}
 // Keeping the port open makes extension reload immediately visible to the app.
 port.postMessage({type:'mighty:ready',protocol:1});
});
