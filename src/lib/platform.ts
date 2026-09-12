import {createClient} from '@supabase/supabase-js';
export const PROJECT_URL=import.meta.env.VITE_SUPABASE_URL||'';
export const PUBLIC_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
export const db=PROJECT_URL&&PUBLIC_KEY?createClient(PROJECT_URL,PUBLIC_KEY):null;
export type GatewayCall=(request:{feature:string;system:string;user:string;maxTokens?:number;tools?:{name:'people_search';query:string}[]})=>Promise<{text:string;remaining:number}>;
export function gatewayForAccount(expectedUid:string|null):GatewayCall{return async request=>{
 if(!db)throw Error('The account connection is not configured.');
 const {data:{session},error}=await db.auth.getSession();if(error||!session||!expectedUid||session.user.id!==expectedUid)throw Error('An active account session is needed for AI and web search. Local file tools are available now.');
 const response=await fetch(`${PROJECT_URL}/functions/v1/ai-gateway`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:PUBLIC_KEY,'Content-Type':'application/json','x-request-id':crypto.randomUUID()},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok)throw Error(result.message||'This request could not be completed.');return result;
};}
export const gateway:GatewayCall=async request=>{const session=await db?.auth.getSession();return gatewayForAccount(session?.data.session?.user.id||null)(request);};
export async function accountId(expectedUid?:string|null){if(!db)throw Error('Account connection is unavailable.');const {data,error}=await db.auth.getUser();if(error||!data.user||expectedUid===null||(expectedUid!==undefined&&data.user.id!==expectedUid))throw Error('The account session changed or expired. Your draft is preserved.');return data.user.id;}
let settingsChain:Promise<unknown>=Promise.resolve();
export function saveSettings(patch:Record<string,unknown>,expectedUid:string){const snapshot=structuredClone(patch);const job=settingsChain.catch(()=>{}).then(async()=>{const uid=await accountId(expectedUid);const result=await db!.rpc('patch_settings',{p_user_id:uid,p_patch:snapshot});if(result.error)throw Error(result.error.message);if(!result.data)throw Error('The settings patch was not saved. Your local draft is preserved.');});settingsChain=job;return job;}
