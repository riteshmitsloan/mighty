import type {SupabaseClient} from '@supabase/supabase-js';
import type {EvidenceClaim, EvidenceField} from './evidence';
import type {GoalWorkspace} from './goals';
import type {LocalRelationshipState} from './local-relationships';

export type InteractionKind = 'contacted' | 'replied' | 'coffee_chat' | 'note' | 'promise_made' | 'promise_kept' | 'stage_change' | 'next_step' | 'next_step_completed';
export interface GoalInteractionInput {
  requestId: string; relationshipId: string; goalId?: string | null; goalVersion?: number | null;
  kind: InteractionKind; body?: string; relatedEventId?: string | null; dueAt?: string | null;
}
export interface InteractionRecord {
  id: string; requestId: string | null; relationshipId: string; goalId: string | null; goalVersion: number | null;
  kind: InteractionKind; body: string; relatedEventId: string | null; dueAt: string | null; createdAt: string;
}
export interface CandidateObservationInput {
  requestId: string; relationshipId: string; goalId?: string | null;
  field: Exclude<EvidenceField, 'writing' | 'proof_point'>; text: string;
  sourceKind: 'manual' | 'authorized_export' | 'public_source'; sourceLabel: string; sourceRef?: string;
  appliesTo: 'contact' | 'opportunity'; polarity?: 'positive' | 'negative'; observedAt?: string;
  confirmed: true; supersedesId?: string | null;
}
export interface CandidateObservation extends CandidateObservationInput {
  id: string; goalId: string | null; observedAt: string; confirmedAt: string; createdAt: string;
}
export interface MessageDraftInput {
  requestId: string; relationshipId: string; goalId: string; goalVersion: number;
  evidenceFingerprint: string; evidenceIds: readonly string[]; channel: 'email' | 'linkedin';
  purpose: string; body: string; status?: 'draft' | 'copied' | 'archived';
}
export interface MessageDraft extends MessageDraftInput {
  id: string; revision: number; status: 'draft' | 'copied' | 'archived'; createdAt: string; updatedAt: string;
}
export interface RelationshipContext {
  observations: CandidateObservation[]; drafts: MessageDraft[]; events: InteractionRecord[];
}

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unsafe=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function uuid(value:unknown,label:string):string {if(typeof value!=='string'||!uuidPattern.test(value))throw new TypeError(`${label} must be a UUID.`);return value.toLowerCase();}
function readable(value:unknown,label:string,max:number,allowEmpty=false):string {if(typeof value!=='string'||(!allowEmpty&&!value.trim())||value.length>max||unsafe.test(value))throw new TypeError(`${label} is missing, unsafe, or too long.`);return value;}
function oneOf<T extends string>(value:unknown,values:readonly T[],label:string):T {if(!values.includes(value as T))throw new TypeError(`${label} is invalid.`);return value as T;}
function timestamp(value:string|undefined|null):string|null {if(value===null||value===undefined)return null;if(!Number.isFinite(Date.parse(value)))throw new TypeError('The date is invalid.');return new Date(value).toISOString();}
function version(value:number|undefined|null):number|null {if(value===undefined||value===null)return null;if(!Number.isSafeInteger(value)||value<1||value>2147483647)throw new TypeError('The goal version is invalid.');return value;}
const kinds:readonly InteractionKind[]=['contacted','replied','coffee_chat','note','promise_made','promise_kept','stage_change','next_step','next_step_completed'];
export function normalizeGoalInteraction(input:GoalInteractionInput):GoalInteractionInput {
  const result={requestId:uuid(input.requestId,'Request'),relationshipId:uuid(input.relationshipId,'Person'),goalId:input.goalId?uuid(input.goalId,'Goal'):null,goalVersion:version(input.goalVersion),kind:oneOf(input.kind,kinds,'Interaction'),body:readable(input.body??'','Update',8000,!['note','promise_made','next_step'].includes(input.kind)),relatedEventId:input.relatedEventId?uuid(input.relatedEventId,'Related update'):null,dueAt:timestamp(input.dueAt)};
  if(result.goalVersion&&!result.goalId)throw new TypeError('A goal version needs a goal.');
  if(['promise_kept','next_step_completed'].includes(result.kind)&&!result.relatedEventId)throw new TypeError('Choose the commitment to complete.');
  if(result.dueAt&&!['promise_made','next_step'].includes(result.kind))throw new TypeError('Only commitments have due dates.');
  return result;
}
export function normalizeCandidateObservation(input:CandidateObservationInput):CandidateObservationInput {
  if(input.confirmed!==true)throw new TypeError('Confirm the evidence before saving.');
  const sourceKind=oneOf(input.sourceKind,['manual','authorized_export','public_source'],'Evidence source');
  const sourceRef=readable(input.sourceRef??'','Source reference',2000,true);
  if(sourceKind==='public_source'){let url:URL;try{url=new URL(sourceRef);}catch{throw new TypeError('Public evidence needs a source URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new TypeError('Public evidence needs a public HTTP source URL.');}
  return {requestId:uuid(input.requestId,'Request'),relationshipId:uuid(input.relationshipId,'Person'),goalId:input.goalId?uuid(input.goalId,'Goal'):null,field:oneOf(input.field,['name','company','role','industry','location','stage','check_size','education','skill','email','url','context','custom'],'Evidence field'),text:readable(input.text,'Evidence',8000),sourceKind,sourceLabel:readable(input.sourceLabel,'Source label',200),sourceRef,appliesTo:oneOf(input.appliesTo,['contact','opportunity'],'Evidence subject'),polarity:oneOf<'positive'|'negative'>(input.polarity??'positive',['positive','negative'],'Evidence polarity'),...(input.observedAt?{observedAt:timestamp(input.observedAt)!}:{}),confirmed:true,supersedesId:input.supersedesId?uuid(input.supersedesId,'Corrected observation'):null};
}
export function normalizeMessageDraft(input:MessageDraftInput):MessageDraftInput {
  if(version(input.goalVersion)===null)throw new TypeError('A draft needs a goal version.');
  if(!/^[a-f0-9]{64}$/.test(input.evidenceFingerprint))throw new TypeError('Use the SHA-256 evidence fingerprint for this draft.');
  if(!Array.isArray(input.evidenceIds)||input.evidenceIds.length>200)throw new TypeError('The draft has too many evidence references.');
  return {requestId:uuid(input.requestId,'Request'),relationshipId:uuid(input.relationshipId,'Person'),goalId:uuid(input.goalId,'Goal'),goalVersion:version(input.goalVersion)!,evidenceFingerprint:input.evidenceFingerprint,evidenceIds:[...new Set(input.evidenceIds.map(id=>readable(id,'Evidence identifier',200)))],channel:oneOf(input.channel,['email','linkedin'],'Channel'),purpose:readable(input.purpose,'Draft purpose',2000),body:readable(input.body,'Draft',16000,true),status:oneOf<'draft'|'copied'|'archived'>(input.status??'draft',['draft','copied','archived'],'Draft status')};
}
type Row=Record<string,any>;
function observation(row:Row):CandidateObservation {return {id:row.id,requestId:row.request_id,relationshipId:row.relationship_id,goalId:row.goal_id??null,field:row.field,text:row.text,sourceKind:row.source_kind,sourceLabel:row.source_label,sourceRef:row.source_ref,appliesTo:row.applies_to,polarity:row.polarity,observedAt:row.observed_at,confirmed:true,confirmedAt:row.confirmed_at,createdAt:row.created_at,supersedesId:row.supersedes_id??null};}
function draft(row:Row):MessageDraft {return {id:row.id,requestId:row.request_id,relationshipId:row.relationship_id,goalId:row.goal_id,goalVersion:row.goal_version,evidenceFingerprint:row.evidence_fingerprint,evidenceIds:row.evidence_ids,channel:row.channel,purpose:row.purpose,body:row.body,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};}
function interaction(row:Row):InteractionRecord {return {id:row.id,requestId:row.request_id??null,relationshipId:row.relationship_id,goalId:row.goal_id??null,goalVersion:row.goal_version??null,kind:row.kind,body:row.body,relatedEventId:row.related_event_id??null,dueAt:row.due_at??null,createdAt:row.created_at};}
export function observationToClaim(value:CandidateObservation,subjectKey=value.relationshipId):EvidenceClaim {
  return {id:`observation:${value.id}`,subject:'candidate',subjectKey,field:value.field,text:value.text,sourceLabel:value.sourceLabel,sourceRef:value.sourceRef||`observation:${value.id}`,sourceKind:value.sourceKind==='authorized_export'?'archive':value.sourceKind==='public_source'?'record':'manual',observedAt:value.observedAt,confidence:'user_confirmed',appliesTo:value.appliesTo,polarity:value.polarity??'positive'};
}
export function observationsToClaims(values:readonly CandidateObservation[],subjectKey:string,goalId:string|null=null):EvidenceClaim[] {
  const superseded=new Set(values.map(o=>o.supersedesId).filter(Boolean));
  return values.filter(o=>!superseded.has(o.id)&&(o.goalId===null||o.goalId===goalId)).map(o=>observationToClaim(o,subjectKey));
}
interface LocalAdapter {
  read():Promise<LocalRelationshipState>;
  update<T>(change:(state:LocalRelationshipState)=>T):Promise<T>;
  goals():Promise<GoalWorkspace|null>;
}
export interface RelationshipContextOptions {local?:LocalAdapter;cloud?:{client:SupabaseClient;assertAccount:(uid:string)=>Promise<unknown>}}
async function localDefault():Promise<LocalAdapter> {const [local,goals]=await Promise.all([import('./local-relationships'),import('./goal-store')]);return {read:local.readLocalRelationships,update:local.updateLocalRelationships,goals:()=>goals.readGoalWorkspace('device-draft')};}
async function cloudDefault(){const platform=await import('./platform');if(!platform.db)throw new Error('Account storage is unavailable.');return {client:platform.db,assertAccount:(uid:string)=>platform.accountId(uid)};}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const failure=(message:string,code:string)=>Object.assign(new Error(message),{code});
export function createRelationshipContextStore(options:RelationshipContextOptions={}) {
  const local=()=>options.local?Promise.resolve(options.local):localDefault();
  const cloud=()=>options.cloud?Promise.resolve(options.cloud):cloudDefault();
  async function localGoal(api:LocalAdapter,id:string|null|undefined,requested?:number|null) {
    if(!id){if(requested)throw new Error('A goal version needs a goal.');return null;}
    const goal=(await api.goals())?.goals.find(g=>g.id===id);
    if(!goal||requested&&requested>goal.version)throw failure('This goal is unavailable in the local workspace.','42501');
    return requested??goal.version;
  }
  function localPerson(state:LocalRelationshipState,id:string) {if(!state.people.some(p=>p.id===id))throw failure('This person is unavailable in the local workspace.','42501');}
  async function rpc(uid:string,name:string,input:unknown,extra:Record<string,unknown>={}) {
    uuid(uid,'Account');const api=await cloud();await api.assertAccount(uid);
    const {data,error}=await api.client.rpc(name,{p_user_id:uid,p_input:input,...extra});
    if(error)throw failure(error.message,error.code??'request_error');
    if(!data||typeof data!=='object'||!data.id)throw new Error('The change was not saved. Your draft is preserved.');
    await api.assertAccount(uid);return data as Row;
  }
  async function listRelationshipContext(uid:string|null,relationshipId:string):Promise<RelationshipContext> {
    uuid(relationshipId,'Person');
    if(uid===null){const api=await local();const state=await api.read();localPerson(state,relationshipId);return {observations:(state.observations as Row[]).filter(r=>r.relationship_id===relationshipId).map(observation),drafts:(state.drafts as Row[]).filter(r=>r.relationship_id===relationshipId).map(draft),events:state.events.filter(r=>r.relationship_id===relationshipId).map(interaction)};}
    uuid(uid,'Account');const api=await cloud();await api.assertAccount(uid);
    const owned=await api.client.from('outreach_log').select('id').eq('user_id',uid).eq('id',relationshipId).maybeSingle();if(owned.error)throw Error(owned.error.message);if(!owned.data)throw failure('This person is unavailable in this account.','42501');
    const all=async(table:string)=>{const rows:Row[]=[];let after:string|undefined;for(;;){let query=api.client.from(table).select('*').eq('user_id',uid).eq('relationship_id',relationshipId).order('id').limit(500);if(after)query=query.gt('id',after);const {data,error}=await query;if(error)throw Error(error.message);if(!data?.length)return rows;const next=data[data.length-1].id;if(after&&next<=after)throw Error('Relationship context could not be paged safely.');rows.push(...data);after=next;}};
    const [observations,drafts,events]=await Promise.all([all('candidate_observations'),all('message_drafts'),all('outreach_events')]);await api.assertAccount(uid);
    return {observations:observations.map(observation),drafts:drafts.map(draft),events:events.map(interaction)};
  }
  async function saveCandidateObservation(uid:string|null,input:CandidateObservationInput):Promise<CandidateObservation> {
    const p=normalizeCandidateObservation(input);
    if(uid!==null)return observation(await rpc(uid,'save_candidate_observation',p));
    const api=await local();await localGoal(api,p.goalId);
    return api.update(state=>{
      localPerson(state,p.relationshipId);const rows=state.observations as Row[];const old=rows.find(r=>r.request_id===p.requestId);
      if(old){if(!same(old.request_payload,p))throw failure('This request already contains different evidence.','23505');return observation(old);}
      if(p.supersedesId){const previous=rows.find(r=>r.id===p.supersedesId&&r.relationship_id===p.relationshipId&&r.goal_id===(p.goalId??null));if(!previous)throw failure('The corrected observation is outside this context.','42501');if(rows.some(r=>r.supersedes_id===p.supersedesId))throw failure('This observation was already corrected. Reload it first.','23505');}
      const now=new Date().toISOString();const row={id:crypto.randomUUID(),request_id:p.requestId,relationship_id:p.relationshipId,goal_id:p.goalId??null,field:p.field,text:p.text,source_kind:p.sourceKind,source_label:p.sourceLabel,source_ref:p.sourceRef??'',applies_to:p.appliesTo,polarity:p.polarity??'positive',observed_at:p.observedAt??now,confirmed_at:now,created_at:now,supersedes_id:p.supersedesId??null,request_payload:p};rows.push(row);return observation(row);
    });
  }
  async function recordGoalInteraction(uid:string|null,input:GoalInteractionInput):Promise<InteractionRecord> {
    const p=normalizeGoalInteraction(input);
    if(uid!==null)return interaction(await rpc(uid,'record_goal_interaction',p));
    const api=await local();const goalVersion=await localGoal(api,p.goalId,p.goalVersion);
    return api.update(state=>{
      localPerson(state,p.relationshipId);const rows=state.events as unknown as Row[];const previous=rows.find(r=>r.request_id===p.requestId);
      if(previous){if(!same(previous.request_payload,p))throw failure('This request already recorded a different interaction.','23505');return interaction(previous);}
      let gid=p.goalId??null,gv=goalVersion;
      if(['promise_kept','next_step_completed'].includes(p.kind)){
        const related=rows.find(r=>r.id===p.relatedEventId&&r.relationship_id===p.relationshipId);
        if(!related||related.kind!==(p.kind==='promise_kept'?'promise_made':'next_step')||(gid!==null&&gid!==(related.goal_id??null)))throw failure('Choose the matching commitment for this person and goal.','23514');
        gid=related.goal_id??null;gv=p.goalVersion??related.goal_version??null;
        const completed=rows.find(r=>r.related_event_id===related.id&&r.kind===p.kind);if(completed)return interaction(completed);
      } else if(p.relatedEventId&&!rows.some(r=>r.id===p.relatedEventId&&r.relationship_id===p.relationshipId))throw failure('The related update is outside this context.','42501');
      const row={id:crypto.randomUUID(),relationship_id:p.relationshipId,goal_id:gid,goal_version:gv,request_id:p.requestId,request_payload:p,kind:p.kind,body:p.body??'',related_event_id:p.relatedEventId??null,due_at:p.dueAt??null,created_at:new Date().toISOString()};rows.push(row);return interaction(row);
    });
  }
  async function saveMessageDraft(uid:string|null,input:MessageDraftInput,expectedRevision=0):Promise<MessageDraft> {
    const p=normalizeMessageDraft(input);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new TypeError('The expected draft revision is invalid.');
    if(uid!==null)return draft(await rpc(uid,'save_message_draft',p,{p_expected_revision:expectedRevision}));
    const api=await local();await localGoal(api,p.goalId,p.goalVersion);
    return api.update(state=>{
      localPerson(state,p.relationshipId);const rows=state.drafts as Row[];const previous=rows.find(r=>r.request_id===p.requestId);const now=new Date().toISOString();
      if(previous){
        if(same(previous.request_payload,p)&&expectedRevision<=previous.revision)return draft(previous);
        if(previous.revision!==expectedRevision)throw failure('This draft changed elsewhere. Reload before saving.','40001');
        if(previous.relationship_id!==p.relationshipId||previous.goal_id!==p.goalId||previous.goal_version!==p.goalVersion||previous.evidence_fingerprint!==p.evidenceFingerprint||!same(previous.evidence_ids,p.evidenceIds))throw failure('Changed context requires a new draft request.','22023');
        Object.assign(previous,{channel:p.channel,purpose:p.purpose,body:p.body,status:p.status,revision:previous.revision+1,updated_at:now,request_payload:p});return draft(previous);
      }
      if(expectedRevision!==0)throw failure('This draft is unavailable. Reload before saving.','40001');
      const row={id:crypto.randomUUID(),request_id:p.requestId,relationship_id:p.relationshipId,goal_id:p.goalId,goal_version:p.goalVersion,evidence_fingerprint:p.evidenceFingerprint,evidence_ids:p.evidenceIds,channel:p.channel,purpose:p.purpose,body:p.body,status:p.status,revision:1,created_at:now,updated_at:now,request_payload:p};rows.push(row);return draft(row);
    });
  }
  return {listRelationshipContext,saveCandidateObservation,recordGoalInteraction,saveMessageDraft};
}
const defaultContextStore=createRelationshipContextStore();
export const {listRelationshipContext,saveCandidateObservation,recordGoalInteraction,saveMessageDraft}=defaultContextStore;
