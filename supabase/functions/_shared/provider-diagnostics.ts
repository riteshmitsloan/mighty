/** Only these finite values may cross into server diagnostics. No provider text or metadata. */
const codes = ['INVALID_ARGUMENT','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','OUT_OF_RANGE','INTERNAL','UNAVAILABLE','DEADLINE_EXCEEDED','UNKNOWN','UNIMPLEMENTED','ABORTED','CANCELLED','DATA_LOSS','UNSPECIFIED'] as const;
const reasons = ['API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_NOT_FOUND','API_KEY_SERVICE_BLOCKED','API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_ANDROID_APP_BLOCKED','API_KEY_IOS_APP_BLOCKED','API_KEY_BLOCKED','CONSUMER_INVALID','SERVICE_DISABLED','BILLING_DISABLED','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','IAM_PERMISSION_DENIED','INVALID_FIELD_STORE','INVALID_FIELD_THINKING_BUDGET','LOCATION_UNSUPPORTED','UNSPECIFIED'] as const;
export type ProviderDiagnostic = Readonly<{ provider:'gemini'; httpStatus:number; code:typeof codes[number]; reason:typeof reasons[number] }>;
export type ProviderDiagnosticEvent = ProviderDiagnostic & Readonly<{ event:'ai_provider_failure'; requestId:string }>;
const codeSet = new Set<string>(codes), reasonSet = new Set<string>(reasons);
function record(value:unknown):Record<string,unknown>|undefined { return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined; }
export function sanitizeProviderDiagnostic(value:unknown):ProviderDiagnostic|undefined {
 const x=record(value);
 if(x?.provider!=='gemini'||!Number.isInteger(x.httpStatus)||Number(x.httpStatus)<300||Number(x.httpStatus)>599)return undefined;
 return {provider:'gemini',httpStatus:Number(x.httpStatus),code:typeof x.code==='string'&&codeSet.has(x.code)?x.code as ProviderDiagnostic['code']:'UNSPECIFIED',reason:typeof x.reason==='string'&&reasonSet.has(x.reason)?x.reason as ProviderDiagnostic['reason']:'UNSPECIFIED'};
}
function extract(httpStatus:number,body:unknown):ProviderDiagnostic {
 const error=record(record(body)?.error); const details=Array.isArray(error?.details)?error.details.slice(0,8):[];
 let reason:ProviderDiagnostic['reason']='UNSPECIFIED';
 for(const item of details){
  const detail=record(item);
  if(detail?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo'&&typeof detail.reason==='string'&&reasonSet.has(detail.reason)) { reason=detail.reason as ProviderDiagnostic['reason'];break; }
  if(detail?.['@type']==='type.googleapis.com/google.rpc.QuotaFailure')reason='QUOTA_EXCEEDED';
 }
 // Derive only fixed labels. Never retain or log the message, field descriptions, or metadata.
 if(reason==='UNSPECIFIED'&&typeof error?.message==='string'){
  const message=error.message;
  if(/Unknown (?:name|field) ["']store["']/i.test(message))reason='INVALID_FIELD_STORE';
  else if(/thinking[_ ]?budget/i.test(message)&&/(?:invalid|must be|between|cannot|unsupported)/i.test(message))reason='INVALID_FIELD_THINKING_BUDGET';
  else if(/API key was reported as leaked/i.test(message))reason='API_KEY_BLOCKED';
  else if(/(?:user )?location is not supported/i.test(message))reason='LOCATION_UNSUPPORTED';
 }
 return sanitizeProviderDiagnostic({provider:'gemini',httpStatus,code:error?.status,reason})!;
}
/** Error-body inspection is capped at 16 KiB and 1.5 seconds. Failure to inspect never changes billing semantics. */
export async function geminiFailureDiagnostic(response:Response,timeoutMs=1500):Promise<ProviderDiagnostic> {
 const fallback:ProviderDiagnostic={provider:'gemini',httpStatus:response.status,code:'UNSPECIFIED',reason:'UNSPECIFIED'};
 const reader=response.body?.getReader();if(!reader)return fallback;
 let ended=false,timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),timeoutMs);});
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const next=await Promise.race([reader.read(),timeout]);if(next===undefined)return fallback;
   if(next.done){ended=true;break;}size+=next.value.length;if(size>16384)return fallback;chunks.push(next.value);
  }
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  return extract(response.status,JSON.parse(new TextDecoder().decode(buffer)));
 }catch{return fallback;}
 finally{if(timer!==undefined)clearTimeout(timer);if(!ended)void reader.cancel().catch(()=>{});}
}
