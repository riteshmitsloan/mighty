import test from 'node:test';import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';import {readConnectionsData} from '../src/lib/data-access';
test('actual Supabase query builders page by ID and request the stored JSON overlap index',async()=>{
 const requests:URL[]=[];const overlap={company:'Acme',count:3,statement:'You already know 3 people at Acme'};
 const fetcher:typeof fetch=async(input)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);requests.push(url);
  if(url.pathname.endsWith('/knowledge_sources')){assert.equal(url.searchParams.get('select'),'companyIndex:facts->companyIndex');assert.equal(url.searchParams.get('user_id'),'eq.A');return new Response(JSON.stringify([{companyIndex:{acme:overlap}}]),{status:200,headers:{'Content-Type':'application/json'}});}
  assert.ok(url.pathname.endsWith('/connections'));assert.equal(url.searchParams.get('order'),'id.asc');assert.equal(url.searchParams.get('user_id'),'eq.A');
  const after=url.searchParams.get('id');const rows=after===null?[{id:'01',person:'One',company:'Acme',role:'Leader'}]:after==='gt.01'?[{id:'02',person:'Two',company:'Acme',role:'Leader'}]:[];
  return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const client=createClient('https://test-only.supabase.co','test-publishable-key',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const rows=await readConnectionsData(client,'A');assert.equal(rows.length,2);assert.deepEqual(rows[1].companyOverlap,overlap);assert.equal(requests.length,4);
});
