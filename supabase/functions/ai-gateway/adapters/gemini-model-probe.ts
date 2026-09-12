const candidates={flash25:'gemini-2.5-flash',pro25:'gemini-2.5-pro',flashLite25:'gemini-2.5-flash-lite',flashLite31:'gemini-3.1-flash-lite',flashLite35:'gemini-3.5-flash-lite',flash35:'gemini-3.5-flash',flash36:'gemini-3.6-flash',flash37:'gemini-3.7-flash',flash38:'gemini-3.8-flash',pro31Preview:'gemini-3.1-pro-preview',flash3Preview:'gemini-3-flash-preview'} as const;
type Availability={listSucceeded:boolean;listComplete:boolean}&Record<keyof typeof candidates,boolean>;
export type GeminiModelProbeEvent=Availability&{event:'ai_provider_models';requestId:string};
/** One metadata GET after a 404. No generation, pagination, raw names, or provider text in output. */
export async function geminiModelProbe(key:string,fetcher:typeof fetch=fetch):Promise<Availability>{
 const empty={listSucceeded:false,listComplete:false,...Object.fromEntries(Object.keys(candidates).map(k=>[k,false]))} as Availability;
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let ended=false;
 try{
  const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{method:'GET',headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(2500)});
  reader=response.body?.getReader();if(!response.ok||!reader)return empty;
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const next=await reader.read();if(next.done){ended=true;break;}size+=next.value.length;if(size>262144)return empty;chunks.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(data?.models)||data.models.length>1000)return empty;
  const result={...empty,listSucceeded:true,listComplete:data.nextPageToken===undefined||data.nextPageToken===''};
  for(const [label,id] of Object.entries(candidates))result[label as keyof typeof candidates]=data.models.some((m:unknown)=>{const x=m as {name?:unknown;supportedGenerationMethods?:unknown}|null;return x?.name==='models/'+id&&Array.isArray(x.supportedGenerationMethods)&&x.supportedGenerationMethods.includes('generateContent');});
  return result;
 }catch{return empty;}
 finally{if(reader&&!ended)void reader.cancel().catch(()=>{});}
}
