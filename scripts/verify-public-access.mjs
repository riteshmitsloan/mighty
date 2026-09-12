import {readFile,mkdir,writeFile} from 'node:fs/promises';
const env=Object.fromEntries((await readFile('.env','utf8')).split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('Public Supabase connection values are required.');
const result=[];
for(const [name,path,body,expected] of [
 ['anonymous relationship read','outreach_log?select=id',undefined,200],
 ['anonymous relationship write','outreach_log',{user_id:'11111111-1111-4111-8111-111111111111',person:'RLS refusal verification'},401],
 ['publishable-key precheck denial','rpc/ai_precheck',{p_user_id:'11111111-1111-4111-8111-111111111111',p_feature:'profile_briefing'},401]
]){const response=await fetch(url+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();const passed=body?data.code==='42501':response.status===expected&&Array.isArray(data)&&data.length===0;result.push({name,status:response.status,code:data.code??null,passed});if(!passed)process.exitCode=1;}
await mkdir('outputs',{recursive:true});await writeFile('outputs/live-access-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),project:url,checks:result},null,2));console.log(JSON.stringify(result,null,2));
