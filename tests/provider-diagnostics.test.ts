import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiFailureDiagnostic, sanitizeProviderDiagnostic } from '../supabase/functions/_shared/provider-diagnostics.ts';

test('unknown provider codes, reasons, extra fields, and raw text cannot enter diagnostics', async () => {
 const marker='SECRET_PROMPT_APIKEY_MARKER';
 const result=await geminiFailureDiagnostic(Response.json({error:{status:marker,message:marker,details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:marker,metadata:{consumer:marker}}]}},{status:400}));
 assert.deepEqual(result,{provider:'gemini',httpStatus:400,code:'UNSPECIFIED',reason:'UNSPECIFIED'});
 assert.deepEqual(sanitizeProviderDiagnostic({...result,code:'INVALID_ARGUMENT\n'+marker,reason:'API_KEY_INVALID '+marker,raw:marker}),result);
 assert.equal(sanitizeProviderDiagnostic({...result,httpStatus:Infinity}),undefined);
 assert.equal(sanitizeProviderDiagnostic({...result,provider:marker}),undefined);
});

test('canonical quota details and tightly matched messages become finite labels only', async () => {
 const cases=[
  [{status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{description:'PRIVATE'}]}]},'QUOTA_EXCEEDED'],
  [{status:'INVALID_ARGUMENT',message:'thinkingBudget must be between 128 and 32768. PRIVATE'},'INVALID_FIELD_THINKING_BUDGET'],
  [{status:'PERMISSION_DENIED',message:'Your API key was reported as leaked. Please use another API key. PRIVATE'},'API_KEY_BLOCKED'],
  [{status:'FAILED_PRECONDITION',message:'User location is not supported for the API use. PRIVATE'},'LOCATION_UNSUPPORTED'],
 ] as const;
 for(const [error,reason] of cases){const result=await geminiFailureDiagnostic(Response.json({error},{status:400}));assert.equal(result.reason,reason);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);}
});

test('invalid, empty, oversized, and unreadable error bodies preserve the known HTTP status', async () => {
 let oversizedCancelled=false;
 const bodies=[
  new Response('not json PRIVATE',{status:403}),
  new Response(null,{status:401}),
  new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));},cancel(){oversizedCancelled=true;}}),{status:429}),
  new Response(new ReadableStream({start(controller){controller.error(new Error('PRIVATE'));}}),{status:500}),
 ];
 for(const response of bodies)assert.deepEqual(await geminiFailureDiagnostic(response),{provider:'gemini',httpStatus:response.status,code:'UNSPECIFIED',reason:'UNSPECIFIED'});
 assert.equal(oversizedCancelled,true);
});

test('a hanging error body is cancelled within the diagnostic deadline', async () => {
 let cancelled=false;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:403});
 const result=await geminiFailureDiagnostic(response,5);
 assert.deepEqual(result,{provider:'gemini',httpStatus:403,code:'UNSPECIFIED',reason:'UNSPECIFIED'});assert.equal(cancelled,true);
});
