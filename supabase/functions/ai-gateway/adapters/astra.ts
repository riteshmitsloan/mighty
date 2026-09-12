import {ProviderError,type Config,type GatewayInput,type ProviderResult} from '../../_shared/contracts.ts';
export function astraUsage(data:any){const u=data?.usage;if(!u||!Number.isInteger(u.input_tokens)||!Number.isInteger(u.output_tokens))throw new ProviderError('Astra did not return billable token counts.');return {tokensIn:u.input_tokens,tokensOut:u.output_tokens,cachedTokensIn:u.input_tokens_details?.cached_tokens??0,cacheWriteTokensIn:u.input_tokens_details?.cache_write_tokens??0};}
export async function astra(input:GatewayInput,config:Config,key:string,fetcher:typeof fetch=fetch):Promise<ProviderResult>{
 let response:Response;try{response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,store:false,instructions:input.system,input:input.user,max_output_tokens:input.maxTokens,reasoning:{effort:'low'}}),signal:AbortSignal.timeout(45000)});}catch{throw new ProviderError('Astra response is uncertain. Reservation retained.');}
 if(!response.ok)throw new ProviderError('Astra request failed.',[400,401,403,404,429].includes(response.status));
 const data=await response.json();const usage=astraUsage(data);const text=(data.output||[]).filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content||[]).filter((part:any)=>part.type==='output_text'&&typeof part.text==='string').map((part:any)=>part.text).join('\n');
 return {text:data.status==='completed'?text:'',usage};
}
