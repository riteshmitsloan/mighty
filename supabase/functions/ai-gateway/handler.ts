import {cacheKey,clampPrompt,GatewayError,parseBody,priceUsage,ProviderError,type Config,type GatewayInput,type ProviderResult} from '../_shared/contracts.ts';
import {gemini} from './adapters/gemini.ts';
import {astra} from './adapters/astra.ts';
type Dependencies={env:(key:string)=>string|undefined;client:(url:string,key:string)=>any;fetcher?:typeof fetch};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function boundedJSON(req:Request){const reader=req.body?.getReader();if(!reader)throw new GatewayError(400,'A JSON body is required.');let length=0;const chunks:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>96000){await reader.cancel();throw new GatewayError(400,'The request is too large.');}chunks.push(value);}const buffer=new Uint8Array(length);let offset=0;for(const c of chunks){buffer.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder().decode(buffer));}catch{throw new GatewayError(400,'The body must contain valid JSON.');}}
function sqlError(error:any){const m=String(error?.message||'');if(/limit|ceiling|budget/i.test(m))return new GatewayError(429,m,'budget_refused');if(/already reserved/i.test(m))return new GatewayError(409,'This request already exists. It will not be sent to the model again.','duplicate_request');if(/locked|plan|limits are not configured/i.test(m))return new GatewayError(403,m,'account_unavailable');return new GatewayError(503,'The metering service could not reserve this request.','metering_unavailable');}
export function createGateway(deps:Dependencies){return async(req:Request):Promise<Response>=>{
 const origin=req.headers.get('origin');const allowed=(deps.env('ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-request-id','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&allowed.includes(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!allowed.includes(origin))return reply(403,{error:'origin_refused',message:'This app origin is not allowed.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'method_not_allowed',message:'Use POST.'});
 try{
  // Validate shape before auth so malformed bodies consistently return 400, without touching data.
  const raw=parseBody(await boundedJSON(req));
  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return reply(401,{error:'unauthorized',message:'A signed-in account is required.'});
  const url=deps.env('SUPABASE_URL'),key=deps.env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)throw new GatewayError(503,'The platform connection is not configured.');
  const db=deps.client(url,key);
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth?.user)return reply(401,{error:'unauthorized',message:'The session is missing or expired.'});
  const uid=auth.user.id;const requestId=req.headers.get('x-request-id')||crypto.randomUUID();
  if(!uuid.test(requestId))throw new GatewayError(400,'x-request-id must be a UUID.');
  const {data:owner,error:ownerError}=await db.from('users').select('account_status').eq('user_id',uid).maybeSingle();
  if(ownerError)throw new GatewayError(503,'The account could not be checked.');
  if(!owner)throw new GatewayError(403,'This account has not been provisioned for the platform.');
  async function remaining(){const {data,error}=await db.rpc('ai_remaining',{p_user_id:uid});if(error||!Number.isInteger(data))throw new GatewayError(503,'The usage counter could not be read.');return data as number;}
  async function run(input:GatewayInput,id:string):Promise<string>{
   const {data:registered,error}=await db.from('ai_config').select('*').eq('feature',input.feature).maybeSingle();
   if(error)throw new GatewayError(503,'The feature registry could not be read.');
   if(!registered)throw new GatewayError(400,'This feature is not registered.');
   let config=registered as Config;
   if(!config.enabled||config.rates_valid_until<new Date().toISOString().slice(0,10))throw new GatewayError(503,'This feature is not enabled with current pricing.');
   let prepared=clampPrompt(input,config);let hash=await cacheKey(uid,prepared,config);
   if(Number(config.cache_ttl_days)>0){
    const {data:cache,error:cacheError}=await db.from('ai_cache').select('text').eq('user_id',uid).eq('cache_key',hash).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(cacheError)throw new GatewayError(503,'The account cache could not be checked.');
    if(cache){
     const {error:logError}=await db.from('ai_call_log').insert({id,user_id:uid,feature:config.feature,cache_hit:true,pending:false,reserved_usd:0,weight:0,model:config.model,input_rate:config.input_usd_per_million,cached_input_rate:config.cached_input_usd_per_million,cache_write_rate:config.cache_write_usd_per_million,output_rate:config.output_usd_per_million,max_tokens:prepared.maxTokens,confirmed_at:new Date().toISOString()});
     if(logError){if(logError.code==='23505')throw new GatewayError(409,'This request already exists.');throw new GatewayError(503,'The cache read could not be metered.');}
     return cache.text;
    }
   }
   if(owner.account_status!=='active')throw new GatewayError(403,'The account is locked. Existing content is preserved.');
   if(deps.env('AI_PROCESSING_ENABLED')!=='true'||deps.env('AI_PROVIDER_DATA_CONTROLS_CONFIRMED')!=='true')throw new GatewayError(503,'AI processing is not enabled with the required data controls.');
   const {data:reservation,error:reserveError}=await db.rpc('ai_reserve_call',{p_feature:config.feature,p_user_id:uid,p_request_id:id,p_max_tokens:prepared.maxTokens});
   if(reserveError)throw sqlError(reserveError);
   let dispatched=false;
   try{
    // Use the config snapshot returned by the same transaction that reserved its cost.
    config=reservation.config;prepared=clampPrompt(input,config);hash=await cacheKey(uid,prepared,config);
    // Keys and provider-specific policy checks use the authoritative reserved configuration.
    const providerKey=deps.env(config.provider==='gemini'?'GEMINI_API_KEY':config.provider==='astra'?'OPENAI_API_KEY':'GOOGLE_SEARCH_API_KEY');
    if(!providerKey)throw new GatewayError(503,'The model provider is not configured.');
    if(config.provider==='gemini'&&deps.env('GEMINI_PAID_PROJECT_CONFIRMED')!=='true')throw new GatewayError(503,'Gemini requires a paid project with no training use.');
    if(config.provider==='google_search'&&(deps.env('GOOGLE_SEARCH_ENABLED')!=='true'||!deps.env('GOOGLE_SEARCH_ENGINE_ID')))throw new GatewayError(503,'Existing Google Programmable Search access is not configured.');
    // Reserve the parent first: rejected or duplicate requests cannot spend on child tools.
    if(input.tools.length){
     if(new TextEncoder().encode(prepared.system+prepared.user).length+6000>config.max_prompt_bytes)throw new GatewayError(400,'Leave at least 6,000 prompt bytes for search context.');
     const childHash=await cacheKey(id,{...input,feature:'people_search',tools:[]},config);
     const childId=childHash.slice(0,8)+'-'+childHash.slice(8,12)+'-4'+childHash.slice(13,16)+'-8'+childHash.slice(17,20)+'-'+childHash.slice(20,32);
     const searchResponse=await run({feature:'people_search',system:'',user:input.tools[0].query,maxTokens:64,tools:[]},childId);
     const searchText=JSON.stringify(JSON.parse(searchResponse).slice(0,5));
     prepared=clampPrompt({...input,user:input.user+'\n\nUnverified public search snippets:\n'+searchText,tools:[]},config);
    }
    if(config.provider==='google_search'){
     const {data:quota,error:quotaError}=await db.rpc('claim_people_search');
     if(quotaError)throw new GatewayError(503,'Search quota could not be checked.');
     if(!quota.allowed)throw new GatewayError(429,quota.reason,'search_quota_refused');
    }
    const {error:dispatchError}=await db.from('ai_call_log').update({dispatched_at:new Date().toISOString()}).eq('id',id).eq('user_id',uid).eq('pending',true);
    if(dispatchError)throw new GatewayError(503,'The request could not be marked for dispatch.');
    dispatched=true;
    let output:ProviderResult;
    if(config.provider==='gemini')output=await gemini(prepared,config,providerKey,deps.fetcher);
    else if(config.provider==='astra')output=await astra(prepared,config,providerKey,deps.fetcher);
    else {
     let query=input.user;let start=1;
     if(input.user.trim().startsWith('{')){let search;try{search=JSON.parse(input.user);}catch{throw new GatewayError(400,'Search input is invalid.');}if(typeof search.query!=='string'||search.query.length>256||!Number.isInteger(search.start)||search.start<1||search.start>91)throw new GatewayError(400,'Search input is invalid.');query=search.query;start=search.start;}
     const endpoint=new URL('https://customsearch.googleapis.com/customsearch/v1');endpoint.searchParams.set('key',providerKey);endpoint.searchParams.set('cx',deps.env('GOOGLE_SEARCH_ENGINE_ID')!);endpoint.searchParams.set('q',query.slice(0,256));endpoint.searchParams.set('num','10');endpoint.searchParams.set('start',String(start));
     const response=await(deps.fetcher||fetch)(endpoint,{signal:AbortSignal.timeout(20000)});
     if(!response.ok)throw new ProviderError('Search provider request failed.',[400,401,403,429].includes(response.status));
     const data=await response.json();const items=(data.items||[]).slice(0,10).map((x:any)=>({title:String(x.title||'').slice(0,160),url:String(x.link||'').slice(0,400),snippet:String(x.snippet||'').slice(0,400)}));
     output={text:JSON.stringify(items),usage:{tokensIn:0,tokensOut:0,cachedTokensIn:0,cacheWriteTokensIn:0}};
    }
    const cost=priceUsage(output.usage,config);
    const {data:confirmed,error:confirmError}=await db.rpc('ai_confirm_call',{p_id:id,p_tokens_in:output.usage.tokensIn,p_tokens_out:output.usage.tokensOut,p_cached_tokens_in:output.usage.cachedTokensIn,p_cache_write_tokens_in:output.usage.cacheWriteTokensIn,p_cost_usd:cost});
    if(confirmError||!confirmed)throw new GatewayError(503,'The provider replied, but metering confirmation is pending. Do not retry this request.','confirmation_pending');
    if(!output.text.trim())throw new GatewayError(502,'The provider returned no usable text. Its actual usage has been recorded.','empty_provider_output');
    if(new TextEncoder().encode(output.text).length>131072)throw new GatewayError(502,'The provider output exceeded the storage limit. Usage has been recorded.');
    if(Number(config.cache_ttl_days)>0){
     const {error:writeError}=await db.from('ai_cache').upsert({user_id:uid,cache_key:hash,feature:config.feature,text:output.text,expires_at:new Date(Date.now()+Number(config.cache_ttl_days)*86400000).toISOString()},{onConflict:'user_id,cache_key'});
     if(writeError)throw new GatewayError(503,'The reply was metered but could not be saved to the account cache.','cache_write_failed');
    }
    return output.text;
   }catch(e){
    if(!dispatched||(e instanceof ProviderError&&e.noCharge)){
     const {error:releaseError}=await db.rpc('ai_release_call',{p_id:id,p_definitive_no_charge:e instanceof ProviderError&&e.noCharge});
     if(releaseError)throw new GatewayError(503,'The failed request still has a pending reservation. Do not retry automatically.','release_pending');
    }
    // Unknown provider outcomes retain reservations. Releasing them could bypass budgets.
    if(e instanceof GatewayError)throw e;
    throw new GatewayError(502,dispatched&&!(e instanceof ProviderError&&e.noCharge)?'The provider outcome is uncertain. Its reservation is retained for reconciliation.':'The provider request failed without a charge.','provider_failed');
   }
  }
  const text=await run(raw,requestId);
  return reply(200,{text,remaining:await remaining()});
 }catch(e){if(e instanceof GatewayError)return reply(e.status,{error:e.code,message:e.message});return reply(503,{error:'platform_unavailable',message:'The platform could not complete this request. No automatic retry was made.'});}
};}
