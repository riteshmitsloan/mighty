import {geminiFailureDiagnostic} from '../../_shared/provider-diagnostics.ts';
import {ProviderError,type Config,type GatewayInput,type ProviderResult} from '../../_shared/contracts.ts';
export function geminiUsage(data:any){const u=data?.usageMetadata;if(!u||!Number.isInteger(u.promptTokenCount)||(!Number.isInteger(u.candidatesTokenCount)&&!Number.isInteger(u.thoughtsTokenCount)))throw new ProviderError('Gemini did not return billable token counts.');return {tokensIn:u.promptTokenCount,tokensOut:(u.candidatesTokenCount??0)+(u.thoughtsTokenCount??0),cachedTokensIn:u.cachedContentTokenCount??0,cacheWriteTokensIn:0};}
/** Exact reviewed model compatibility; the combined thinking/text output cap stays unchanged. */
export function geminiGenerationConfig(input:GatewayInput,config:Config){
 const maxOutputTokens=Math.min(input.maxTokens,config.max_tokens);
 if(config.model==='gemini-3.1-flash-lite'){
  // Gemini 3 uses levels. Minimal can still reason; usage includes every returned thought token.
  // The reserved allowance chooses effort, while maxOutputTokens bounds the combined output.
  return {maxOutputTokens,thinkingConfig:{thinkingLevel:config.reasoning_token_allowance===0?'minimal':'low'}};
 }
 return {maxOutputTokens,thinkingConfig:{thinkingBudget:config.reasoning_token_allowance},candidateCount:1};
}
export async function gemini(input:GatewayInput,config:Config,key:string,fetcher:typeof fetch=fetch):Promise<ProviderResult>{
 let response:Response;try{response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({store:false,systemInstruction:{parts:[{text:input.system}]},contents:[{role:'user',parts:[{text:input.user}]}],generationConfig:geminiGenerationConfig(input,config)}),signal:AbortSignal.timeout(45000)});}catch{throw new ProviderError('Gemini response is uncertain. Reservation retained.');}
 if(!response.ok)throw new ProviderError('Gemini request failed.',[400,401,403,404,429].includes(response.status),await geminiFailureDiagnostic(response));
 const data=await response.json();const usage=geminiUsage(data);const text=(data.candidates?.[0]?.content?.parts||[]).filter((p:any)=>typeof p.text==='string'&&!p.thought).map((p:any)=>p.text).join('\n');
 return {text,usage};
}
