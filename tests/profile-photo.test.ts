import test from 'node:test';
import assert from 'node:assert/strict';
import {readRelationshipData,savePersonData} from '../src/lib/data-access';
import {insertLocalPerson,type LocalRelationshipState} from '../src/lib/local-relationships';
import {personPhotoUrl,snapshotPhotoUrl} from '../src/lib/profile-photo';
import {MemoryServer} from './fake-client';
const url='https://www.linkedin.com/in/synthetic-profile/',otherUrl='https://www.linkedin.com/in/synthetic-other/';
const photo='https://media.licdn.com/dms/image/v2/SYNTHETIC_PHOTO/profile-displayphoto-shrink_100_100/0/1?e=1800000000&v=beta&t=synthetic_signature';
const newerPhoto=photo.replace('SYNTHETIC_PHOTO','NEWER_SYNTHETIC_PHOTO');
const snapshot=(photoUrl:string|undefined,profileUrl=url)=>({profileUrl,source:'rendered_profile',profileReadAt:'2026-09-13T12:00:00Z',truncated:false,anchors:[],...(photoUrl?{photoUrl}:{})});
const person={id:'person-a',user_id:'A',person:'Synthetic Person',profile_url:url,stage:'saved',created_at:'2026-09-10T12:00:00Z',context:{source:'extension',profileComplete:true,profile:snapshot(photo)}};

test('the newest usable same-profile photo is derived without rewriting any saved source snapshot',async()=>{
 const old=snapshot(photo),latest=snapshot(undefined);
 const server=new MemoryServer({outreach_log:[person],outreach_events:[],profile_reads:[
  {id:'read-1',user_id:'A',relationship_id:person.id,snapshot:old,observed_at:'2026-09-11T12:00:00Z',created_at:'2026-09-11T12:00:00Z'},
  {id:'read-2',user_id:'A',relationship_id:person.id,snapshot:latest,observed_at:'2026-09-13T12:00:00Z',created_at:'2026-09-13T12:00:00Z'},
 ]});
 const before=structuredClone(server.tables);
 const loaded=(await readRelationshipData(server.client,'A')).people[0];
 assert.equal(loaded.photoUrl,photo);assert.equal(personPhotoUrl(loaded),photo);
 assert.deepEqual(loaded.profile,latest,'Completeness and other anchors still use the latest actual read.');
 assert.deepEqual(server.tables,before);
 server.tables.profile_reads.push({id:'read-3',user_id:'A',relationship_id:person.id,snapshot:snapshot(newerPhoto),observed_at:'2026-09-14T12:00:00Z',created_at:'2026-09-14T12:00:00Z'});
 assert.equal((await readRelationshipData(server.client,'A')).people[0].photoUrl,newerPhoto);
});

test('foreign account, wrong profile and malformed newer photo records cannot replace the owned photo',async()=>{
 const rows=[
  {id:'read-wrong-person',user_id:'A',relationship_id:person.id,snapshot:snapshot(newerPhoto,otherUrl)},
  {id:'read-malformed',user_id:'A',relationship_id:person.id,snapshot:snapshot('https://arbitrary.example.org/portrait')},
  {id:'read-other-account',user_id:'B',relationship_id:person.id,snapshot:snapshot(newerPhoto)},
 ].map(row=>({...row,observed_at:'2026-09-14T12:00:00Z',created_at:'2026-09-14T12:00:00Z'}));
 const server=new MemoryServer({outreach_log:[person],profile_reads:rows});
 const loaded=(await readRelationshipData(server.client,'A')).people[0];
 assert.equal(loaded.photoUrl,photo);
 assert.equal(snapshotPhotoUrl(snapshot(photo,otherUrl),url),null);
 assert.equal(snapshotPhotoUrl({photoUrl:photo},url),null);
 assert.equal(snapshotPhotoUrl({...snapshot(photo),source:'web_search'},url),null);
});

test('initial saved metadata preserves a valid photo on repeated saves and drops arbitrary image URLs',async()=>{
 const server=new MemoryServer();
 const id=await savePersonData(server.client,'A',{person:'Synthetic Person',reason:'Explicit save',photoUrl:photo},url);
 await savePersonData(server.client,'A',{person:'Synthetic Person',reason:'Repeated save'},url);
 const loaded=(await readRelationshipData(server.client,'A')).people.find(row=>row.id===id)!;
 assert.equal(personPhotoUrl(loaded),photo);
 const invalid=await savePersonData(server.client,'A',{person:'Other Person',reason:'Explicit save',photoUrl:'https://other.example.org/face'},otherUrl);
 assert.equal(personPhotoUrl((await readRelationshipData(server.client,'A')).people.find(row=>row.id===invalid)!),null);
});

test('explicit device saves keep the same photo when a later save supplies none',()=>{
 const state:LocalRelationshipState={people:[],events:[],observations:[],drafts:[]};
 const id=insertLocalPerson(state,{person:'Synthetic Person',reason:'Explicit save',photoUrl:photo},url);
 assert.equal(insertLocalPerson(state,{person:'Synthetic Person',reason:'Retry'},url),id);
 assert.equal(state.people.length,1);
 assert.equal(personPhotoUrl(state.people[0]),photo);
});
