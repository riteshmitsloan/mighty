import {createClient} from '@supabase/supabase-js';
export const PROJECT_URL=import.meta.env.VITE_SUPABASE_URL||'';
export const PUBLIC_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'';
export const db=PROJECT_URL&&PUBLIC_KEY?createClient(PROJECT_URL,PUBLIC_KEY):null;
export type GatewayCall=(request:{feature:string;system:string;user:string;maxTokens?:number;tools?:{name:'people_search';query:string}[]})=>Promise<{text:string;remaining:number}>;
export const gateway:GatewayCall=async request=>{
 if(!db)throw Error('The account connection is not configured.');
 const {data:{session},error}=await db.auth.getSession();if(error||!session)throw Error('An active account session is needed for AI and web search. Local file tools are available now.');
 const response=await fetch(`${PROJECT_URL}/functions/v1/ai-gateway`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:PUBLIC_KEY,'Content-Type':'application/json','x-request-id':crypto.randomUUID()},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok)throw Error(result.message||'This request could not be completed.');return result;
};
export async function accountId(){if(!db)throw Error('Account connection is unavailable.');const {data,error}=await db.auth.getUser();if(error||!data.user)throw Error('An account session is required to save to Supabase.');return data.user.id;}
let settingsChain:Promise<unknown>=Promise.resolve();
export function saveSettings(patch:Record<string,unknown>){const job=settingsChain.catch(()=>{}).then(async()=>{const uid=await accountId();const {data,error}=await db!.from('settings').select('data').eq('user_id',uid).single();if(error)throw Error(error.message);const result=await db!.from('settings').update({data:{...data.data,...patch},updated_at:new Date().toISOString()}).eq('user_id',uid);if(result.error)throw Error(result.error.message);});settingsChain=job;return job;}
