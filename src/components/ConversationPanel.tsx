import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Check, Copy, Sparkles} from 'lucide-react';
import type {Goal} from '../lib/goals';
import {evidenceKey, type CandidateEvidence, type EvidenceClaim} from '../lib/evidence';
import type {GatewayCall} from '../lib/platform';
import {CONVERSATION_LIMITS, eligibleConversationClaims, prepareConversation, type ConversationChannel, type ConversationDraft} from '../lib/conversation';
import {recordGoalInteraction, saveMessageDraft, type GoalInteractionInput, type MessageDraft} from '../lib/relationship-context';
import './ConversationPanel.css';

export type ConversationPanelProps = {
  uid: string | null;
  person: {id: string; person: string};
  goal: Goal | null;
  candidate: CandidateEvidence;
  selfEvidence: readonly EvidenceClaim[];
  call: GatewayCall;
  onRemaining?: (remaining: number) => void;
  onRecorded?: () => Promise<void>;
  busy?: boolean;
  savedDrafts?: readonly MessageDraft[];
  onDraftSaved?: (draft: MessageDraft) => void;
};
type Prepared = {
  draft: ConversationDraft; text: string; subject: string; intent: string; ask: string; inputKey: string;
  requestId: string; revision: number; sentRequestId: string; sentEventId?: string; sentBody?: string; savedBody?: string; sentAttemptBody?: string; saveAttempt?: {body:string;revision:number};
  evidenceIds?: string[]; fromStore?: boolean;
};
type FormState = {
  intent: string; ask: string; channel: ConversationChannel; candidateIds: string[]; selfIds: string[];
  prepared: Prepared | null; previous: Prepared | null;
  nextStep: string; nextDate: string; nextRequestId: string; nextAttempt?: {input:GoalInteractionInput;date:string};
};
type Working = 'local' | 'ai' | 'copy' | 'save' | 'sent' | 'next' | 'refresh' | null;
const uuid = () => crypto.randomUUID();
const fresh = (): FormState => ({intent:'',ask:'',channel:'linkedin',candidateIds:[],selfIds:[],prepared:null,previous:null,nextStep:'',nextDate:'',nextRequestId:uuid()});
const messageBody = (prepared: Prepared) => prepared.draft.channel === 'email' && prepared.subject.trim() ? `Subject: ${prepared.subject.trim()}\n\n${prepared.text}` : prepared.text;
const fullKey = (uid: string | null, personId: string, goalId: string) => `mighty:conversation:v1:${[uid ?? 'device-draft',personId,goalId].map(encodeURIComponent).join(':')}`;
const failureDetail = (cause: unknown) => {const value=cause && typeof cause==='object' && 'message' in cause ? (cause as {message:unknown}).message : '';return typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,300) : '';};
const smallText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
function readForm(key: string, personId: string, goalId: string, candidateKey: string): {form:FormState;notice:string} {
  try {
    const raw=window.localStorage.getItem(key);
    if (!raw) return {form:fresh(),notice:''};
    if (new TextEncoder().encode(raw).byteLength > 65_536) throw Error();
    const saved=JSON.parse(raw);const value=saved.form;
    const ids=(items:unknown) => Array.isArray(items) && items.length<=2 && items.every(item=>smallText(item,200)) && new Set(items).size===items.length;
    const validPrepared=(item:Prepared|null) => item===null || Boolean(item && item.draft && item.draft.goalId===goalId && item.draft.candidateKey===candidateKey && Number.isSafeInteger(item.draft.goalVersion) && item.draft.goalVersion>0 && ['email','linkedin'].includes(item.draft.channel) && ['local','ai'].includes(item.draft.mode) && /^[a-f0-9]{64}$/.test(item.draft.fingerprint) && smallText(item.text,4000) && smallText(item.subject,200) && smallText(item.intent,2000) && smallText(item.ask,400) && smallText(item.inputKey,30000) && smallText(item.requestId,100) && smallText(item.sentRequestId,100) && Number.isSafeInteger(item.revision) && item.revision>=0 && Array.isArray(item.draft.citations) && item.draft.citations.length<=4 && item.draft.citations.every(c=>c && ['self','candidate'].includes(c.subject) && smallText(c.claimId,200) && smallText(c.quote,500) && smallText(c.sourceLabel,1000) && (c.sourceRef===undefined || smallText(c.sourceRef,2048))) && Array.isArray(item.draft.unknowns) && item.draft.unknowns.length<=10 && item.draft.unknowns.every(s=>smallText(s,1000)) && (item.draft.notice===null || smallText(item.draft.notice,1000)) && (item.sentEventId===undefined || smallText(item.sentEventId,100)) && (item.sentBody===undefined || smallText(item.sentBody,4300)) && (item.savedBody===undefined || smallText(item.savedBody,4300)) && (item.sentAttemptBody===undefined || smallText(item.sentAttemptBody,4300)) && (item.evidenceIds===undefined || (Array.isArray(item.evidenceIds) && item.evidenceIds.length<=200 && item.evidenceIds.every(value=>smallText(value,200)))) && (item.fromStore===undefined || typeof item.fromStore==='boolean') && (item.saveAttempt===undefined || Boolean(item.saveAttempt && smallText(item.saveAttempt.body,4300) && Number.isSafeInteger(item.saveAttempt.revision) && item.saveAttempt.revision>=0)));
    if (saved.version!==1 || !value || !smallText(value.intent,400) || !smallText(value.ask,400) || !['email','linkedin'].includes(value.channel) || !ids(value.candidateIds) || !ids(value.selfIds) || !validPrepared(value.prepared) || !validPrepared(value.previous) || !smallText(value.nextStep,2000) || !smallText(value.nextDate,10) || !smallText(value.nextRequestId,100) || (value.nextAttempt!==undefined && !(value.nextAttempt && value.nextAttempt.input?.kind==='next_step' && value.nextAttempt.input.relationshipId===personId && value.nextAttempt.input.goalId===goalId && smallText(value.nextAttempt.input.requestId,100) && smallText(value.nextAttempt.input.body,2000) && smallText(value.nextAttempt.date,10)))) throw Error();
    return {form:{intent:value.intent,ask:value.ask,channel:value.channel,candidateIds:value.candidateIds,selfIds:value.selfIds,prepared:value.prepared,previous:value.previous,nextStep:value.nextStep,nextDate:value.nextDate,nextRequestId:value.nextRequestId,nextAttempt:value.nextAttempt},notice:'Your unfinished conversation is restored in this browser.'};
  } catch {return {form:fresh(),notice:'A conversation draft could not be restored. Saved history is unchanged.'};}
}
function dueDate(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw Error('Choose a valid follow-up day.');
  const date=new Date(`${value}T12:00:00`);
  const day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  if (!Number.isFinite(date.getTime()) || day!==value) throw Error('Choose a valid follow-up day.');
  return date.toISOString();
}

export default function ConversationPanel(props: ConversationPanelProps) {
  if (!props.goal) return <section className="panel content-panel conversation-panel"><h2>Prepare a conversation</h2><p>Choose a goal to decide what to ask.</p></section>;
  return <ConversationWorkspace key={fullKey(props.uid,props.person.id,props.goal.id)} {...props} goal={props.goal}/>;
}
function storedForm(saved: MessageDraft, candidateKey: string): FormState {
  const subject=saved.channel==='email'?/^Subject: ([^\r\n]{1,200})\n\n/.exec(saved.body):null;
  const text=subject?saved.body.slice(subject[0].length):saved.body;
  if(text.length>(saved.channel==='email'?CONVERSATION_LIMITS.emailCharacters:CONVERSATION_LIMITS.linkedinCharacters))throw Error('This saved message is longer than the editor allows. Its complete text remains available below to select and copy.');
  const state=fresh();state.intent=saved.purpose.length<=400?saved.purpose:'';state.channel=saved.channel;
  state.prepared={draft:{goalId:saved.goalId,goalVersion:saved.goalVersion,candidateKey,channel:saved.channel,text,subject:subject?.[1]??null,mode:'local',notice:null,citations:[],unknowns:['The original source references are retained. Review the saved wording against your evidence before use.'],fingerprint:saved.evidenceFingerprint},text,subject:subject?.[1]??'',intent:saved.purpose,ask:'',inputKey:`saved:${saved.id}:${saved.revision}`,requestId:saved.requestId,revision:saved.revision,sentRequestId:uuid(),savedBody:saved.body,evidenceIds:[...saved.evidenceIds],fromStore:true};
  return state;
}
function ConversationWorkspace(props: ConversationPanelProps & {goal:Goal}) {
  const base=fullKey(props.uid,props.person.id,props.goal.id);
  const [opened,setOpened]=useState<MessageDraft|null>(null),[pending,setPending]=useState<MessageDraft|null>(null),[notice,setNotice]=useState('');
  const snapshots=useRef(new Map<string,FormState>());
  const key=opened?`${base}:saved:${encodeURIComponent(opened.requestId)}`:base;
  const drafts=(props.savedDrafts??[]).filter(draft=>draft.relationshipId===props.person.id && draft.goalId===props.goal.id).slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const open=(draft:MessageDraft)=>{
    try{storedForm(draft,props.candidate.key);}catch(cause){setNotice(failureDetail(cause));setPending(null);return;}
    setOpened(draft);setPending(null);setNotice('Your other editor is kept separately in this browser.');
  };
  return <>
    {drafts.length>0 && <section className="panel content-panel conversation-saved" aria-label="Saved conversation drafts"><h2>Saved drafts</h2><p className="muted small">For {props.goal.title}. Open a saved draft without replacing your current editor.</p>{drafts.map(draft=><article key={draft.requestId}><div className="section-heading"><div><strong>{draft.channel==='email'?'Email':'LinkedIn message'}</strong><p className="muted small">{new Date(draft.updatedAt).toLocaleString()} · revision {draft.revision}{draft.goalVersion!==props.goal.version?` · goal version ${draft.goalVersion} (current: ${props.goal.version})`:''}{draft.status==='archived'?' · Archived':''}</p></div><button type="button" className="button secondary" disabled={Boolean(props.busy)||opened?.requestId===draft.requestId} onClick={()=>{if(props.busy)return;setNotice('');const current=snapshots.current.get(key);if(current&&(current.prepared||current.intent||current.ask||current.nextStep))setPending(draft);else open(draft);}}>{opened?.requestId===draft.requestId?'Open in editor':'Open saved draft'}</button></div><details><summary>Read saved message</summary><p className="preserve-text">{draft.body}</p></details></article>)}{pending&&<div className="conversation-warning" role="status"><p>Your current text will be kept in its own editor. Open the selected saved draft?</p><div className="row-actions"><button type="button" className="button primary" disabled={Boolean(props.busy)} onClick={()=>{if(!props.busy)open(pending);}}>Keep current and open saved</button><button type="button" className="button secondary" onClick={()=>setPending(null)}>Stay here</button></div></div>}{opened&&<button type="button" className="text-button" disabled={Boolean(props.busy)} onClick={()=>{if(props.busy)return;setOpened(null);setPending(null);setNotice('Your current editor is restored.');}}>Return to current draft</button>}{notice&&<p role="status">{notice}</p>}</section>}
    <ConversationEditor key={key} {...props} goal={props.goal} storageKey={key} savedDraft={opened??undefined} memoryForm={snapshots.current.get(key)} onSnapshot={form=>snapshots.current.set(key,form)}/>
  </>;
}
function ConversationEditor({uid,person,goal,candidate,selfEvidence,call,onRemaining,onRecorded,onDraftSaved,busy=false,storageKey,savedDraft,memoryForm,onSnapshot}: ConversationPanelProps & {goal:Goal;storageKey:string;savedDraft?:MessageDraft;memoryForm?:FormState;onSnapshot:(form:FormState)=>void}) {
  const id=useId();const key=storageKey;
  const [restored]=useState(()=>{
    if(memoryForm)return {form:memoryForm,notice:''};
    const result=readForm(key,person.id,goal.id,candidate.key);
    return savedDraft && !result.form.prepared && !result.form.intent && !result.form.ask?{form:storedForm(savedDraft,candidate.key),notice:'Saved draft opened. Its original goal version and source references are unchanged.'}:result;
  });
  const [form,setForm]=useState(restored.form);
  const [storageNotice,setStorageNotice]=useState(restored.notice);
  const [working,setWorking]=useState<Working>(null);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [refreshError,setRefreshError]=useState(false);
  const [copied,setCopied]=useState(false);
  const state=useRef(form);const lock=useRef(false);const generation=useRef(0);const mounted=useRef(true);const externalBusy=useRef(busy);externalBusy.current=busy;
  useEffect(()=>{mounted.current=true;onSnapshot(state.current);return()=>{mounted.current=false;generation.current++;};},[]);
  const candidateFacts=useMemo(()=>eligibleConversationClaims(candidate.claims,'candidate').filter(claim=>!claim.subjectKey || claim.subjectKey===candidate.key),[candidate]);
  const selfFacts=useMemo(()=>eligibleConversationClaims(selfEvidence,'self'),[selfEvidence]);
  const missingIds=[...form.candidateIds.filter(claimId=>!candidateFacts.some(claim=>claim.id===claimId)),...form.selfIds.filter(claimId=>!selfFacts.some(claim=>claim.id===claimId))];
  const evidenceContext=useMemo(()=>evidenceKey([candidate.claims,selfEvidence]),[candidate.claims,selfEvidence]);
  const inputKey=evidenceKey({goal:[goal.id,goal.version,goal.kind,goal.title,goal.outcome],candidate:[candidate.key,candidate.name],evidenceContext,intent:form.intent,ask:form.ask,channel:form.channel,claims:[...candidateFacts.filter(claim=>form.candidateIds.includes(claim.id)),...selfFacts.filter(claim=>form.selfIds.includes(claim.id))]});
  const changed=Boolean(form.prepared && form.prepared.inputKey!==inputKey);
  const disabled=busy || working!==null;
  const persist=(next:FormState) => {
    state.current=next;onSnapshot(next);setForm(next);
    try {const raw=JSON.stringify({version:1,form:next});if(new TextEncoder().encode(raw).byteLength>65_536)throw Error();window.localStorage.setItem(key,raw);setStorageNotice('');}
    catch {setStorageNotice('This browser couldn’t keep the latest draft between visits. Copy it before leaving.');}
  };
  const change=(patch:Partial<FormState>) => {if(lock.current || externalBusy.current)return;persist({...state.current,...patch});setError('');setNotice('');setCopied(false);};
  const changePrepared=(patch:Partial<Prepared>) => {if(state.current.prepared)change({prepared:{...state.current.prepared,...patch}});};
  const begin=(operation:Working) => {if(!mounted.current || lock.current || externalBusy.current)return false;lock.current=true;setWorking(operation);setError('');setNotice('');return true;};
  const finish=()=>{lock.current=false;if(mounted.current)setWorking(null);};
  const refresh=async()=>{if(!onRecorded)return;try{await onRecorded();if(mounted.current)setRefreshError(false);}catch{if(mounted.current)setRefreshError(true);}};
  const prepare=async(useAi:boolean)=>{
    if(missingIds.length){setError('Some selected facts are no longer available. Clear them and choose again.');return;}
    if(!form.intent.trim() || !form.ask.trim()){setError('Add your purpose and the question you want to ask.');return;}
    if(!begin(useAi?'ai':'local'))return;
    const request=++generation.current;
    try{
      const draft=await prepareConversation({goal,candidate,selfEvidence,selectedCandidateClaimIds:[...form.candidateIds],selectedSelfClaimIds:[...form.selfIds],intent:form.intent,ask:form.ask,channel:form.channel},{useAi,gateway:call});
      if(!mounted.current)return;
      if(draft.remaining!==undefined)onRemaining?.(draft.remaining);
      if(request!==generation.current)return;
      if(useAi && draft.mode==='local' && state.current.prepared){setNotice(draft.notice || 'AI preparation is unavailable. Your current draft is kept.');return;}
      const prepared:Prepared={draft,text:draft.text,subject:draft.subject??'',intent:form.intent,ask:form.ask,inputKey,requestId:uuid(),revision:0,sentRequestId:uuid()};
      persist({...state.current,previous:state.current.prepared,prepared});setCopied(false);setNotice(draft.notice || (draft.mode==='ai'?'AI draft ready to review.':'Draft ready to edit.'));
    }catch(cause){if(mounted.current && request===generation.current)setError(cause instanceof Error?cause.message:'The draft could not be prepared. Your text is still here.');}
    finally{if(request===generation.current)finish();}
  };
  const copy=async()=>{
    const prepared=state.current.prepared;if(!prepared?.text.trim() || !begin('copy'))return;
    try{await navigator.clipboard.writeText(messageBody(prepared));if(mounted.current){setCopied(true);setNotice('Copied. Nothing has been sent or recorded.');}}
    catch{if(mounted.current)setError('Copy is unavailable here. Select and copy the message text below.');}
    finally{finish();}
  };
  const saveDraft=async()=>{
    const prepared=state.current.prepared;if(!prepared?.text.trim() || (!prepared.saveAttempt && prepared.savedBody===messageBody(prepared)) || !begin('save'))return;
    const attempt=prepared.saveAttempt??{body:messageBody(prepared),revision:prepared.revision};
    const body=attempt.body;
    persist({...state.current,prepared:{...prepared,saveAttempt:attempt}});
    try{
      const saved=await saveMessageDraft(uid,{requestId:prepared.requestId,relationshipId:person.id,goalId:prepared.draft.goalId,goalVersion:prepared.draft.goalVersion,evidenceFingerprint:prepared.draft.fingerprint,evidenceIds:prepared.evidenceIds??prepared.draft.citations.map(citation=>citation.claimId),channel:prepared.draft.channel,purpose:prepared.intent,body,status:'draft'},attempt.revision);
      if(!mounted.current)return;
      const current=state.current.prepared!;
      persist({...state.current,prepared:{...current,revision:saved.revision,savedBody:body,saveAttempt:undefined}});setNotice(body!==messageBody(current)?'Earlier draft save confirmed. Your latest edits are still here to save.':uid?'Draft saved to your account.':'Draft saved on this device.');try{onDraftSaved?.(saved);}catch{setRefreshError(true);}await refresh();
    }catch(cause){if(mounted.current)setError(`Draft kept. Couldn’t finish saving. ${failureDetail(cause) || 'Retry to confirm the save.'}`);}
    finally{finish();}
  };
  const recordSent=async()=>{
    const prepared=state.current.prepared;if(!prepared?.text.trim() || prepared.sentEventId || !begin('sent'))return;
    const body=prepared.sentAttemptBody??messageBody(prepared);
    persist({...state.current,prepared:{...prepared,sentAttemptBody:body}});
    try{
      const event=await recordGoalInteraction(uid,{requestId:prepared.sentRequestId,relationshipId:person.id,goalId:prepared.draft.goalId,goalVersion:prepared.draft.goalVersion,kind:'contacted',body});
      if(!mounted.current)return;
      persist({...state.current,prepared:{...state.current.prepared!,sentEventId:event.id,sentBody:body,sentAttemptBody:undefined}});setNotice('Sent activity recorded.');await refresh();
    }catch(cause){if(mounted.current)setError(`Draft kept. Couldn’t confirm the sent record. ${failureDetail(cause) || 'Retry to confirm it.'}`);}
    finally{finish();}
  };
  const recordNext=async()=>{
    const snapshot=state.current;
    if(!snapshot.nextAttempt && !snapshot.nextStep.trim()){setError('Write the next step you want to keep.');return;}
    let attempt=snapshot.nextAttempt;
    if(!attempt){
      let dueAt:string|null;try{dueAt=dueDate(snapshot.nextDate);}catch(cause){setError((cause as Error).message);return;}
      attempt={date:snapshot.nextDate,input:{requestId:snapshot.nextRequestId,relationshipId:person.id,goalId:goal.id,goalVersion:goal.version,kind:'next_step',body:snapshot.nextStep.trim(),dueAt,relatedEventId:snapshot.prepared?.sentEventId??null}};
    }
    if(!begin('next'))return;
    persist({...state.current,nextAttempt:attempt});
    try{
      await recordGoalInteraction(uid,attempt.input);
      if(!mounted.current)return;
      const current=state.current;const unchanged=current.nextStep.trim()===attempt.input.body && current.nextDate===attempt.date;
      persist({...current,nextStep:unchanged?'':current.nextStep,nextDate:unchanged?'':current.nextDate,nextRequestId:uuid(),nextAttempt:undefined});setNotice(unchanged?'Next step recorded.':'Earlier next step confirmed. Your new next step is still here.');await refresh();
    }catch(cause){if(mounted.current)setError(`Next step kept. Couldn’t confirm the record. ${failureDetail(cause) || 'Retry to confirm it.'}`);}
    finally{finish();}
  };
  const prepared=form.prepared;
  const maxCharacters=prepared?.draft.channel==='email'?CONVERSATION_LIMITS.emailCharacters:CONVERSATION_LIMITS.linkedinCharacters;
  return <section className="panel content-panel conversation-panel" aria-labelledby={`${id}-title`}>
    <div className="conversation-heading"><div><h2 id={`${id}-title`}>Prepare a conversation</h2><p className="muted small">For {goal.title}</p></div><span className="pill neutral">{person.person}</span></div>
    <form aria-label="Conversation purpose" onSubmit={event=>{event.preventDefault();void prepare(false);}}>
      <fieldset disabled={disabled}>
        <div className="conversation-purpose-grid"><label>Why are you reaching out?<textarea rows={2} value={form.intent} maxLength={CONVERSATION_LIMITS.intentCharacters} placeholder="State your purpose in your own words." onChange={event=>change({intent:event.target.value})}/></label><label>Channel<select value={form.channel} onChange={event=>change({channel:event.target.value as ConversationChannel})}><option value="linkedin">LinkedIn message</option><option value="email">Email</option></select></label></div>
        <label>What would you like to ask?<textarea rows={2} value={form.ask} maxLength={CONVERSATION_LIMITS.askCharacters} placeholder="A clear question they can respond to." onChange={event=>change({ask:event.target.value})}/></label>
        <details className="conversation-facts"><summary>Add facts to this message <span className="muted">Optional · {form.candidateIds.length+form.selfIds.length} selected</span></summary><p className="muted small">Choose up to two facts about each person. Only these selected facts are used to prepare the message.</p><div className="conversation-evidence-grid">
          <FactPicker title={`About ${person.person}`} claims={candidateFacts} selected={form.candidateIds} disabled={disabled} onSelect={candidateIds=>change({candidateIds})}/>
          <FactPicker title="About you" claims={selfFacts} selected={form.selfIds} disabled={disabled} onSelect={selfIds=>change({selfIds})}/>
        </div>{missingIds.length>0 && <div className="conversation-warning"><p>Some selected facts are no longer available.</p><button type="button" className="text-button" onClick={()=>change({candidateIds:form.candidateIds.filter(claimId=>candidateFacts.some(claim=>claim.id===claimId)),selfIds:form.selfIds.filter(claimId=>selfFacts.some(claim=>claim.id===claimId))})}>Clear unavailable selections</button></div>}</details>
      </fieldset>
      <div className="row-actions conversation-prepare-actions"><button className="button primary" disabled={disabled || missingIds.length>0}>{working==='local'?'Preparing…':prepared?'Prepare another draft':'Prepare draft'}</button>{prepared && <button type="button" className="button secondary" disabled={disabled || missingIds.length>0} onClick={()=>void prepare(true)}><Sparkles size={15}/>{working==='ai'?'Preparing AI draft…':'Try an AI draft'}</button>}{working==='ai' && <button type="button" className="text-button" onClick={()=>{generation.current++;finish();setNotice('Keeping your current draft.');}}>Keep current draft</button>}</div>
    </form>
    {prepared && <div className="conversation-draft">
      <div className="section-heading"><h3>Your message</h3><span className="muted small">{prepared.text.length.toLocaleString()} / {maxCharacters.toLocaleString()}</span></div>
      {prepared.fromStore && <p className="conversation-warning">Saved for goal version {prepared.draft.goalVersion}{prepared.draft.goalVersion!==goal.version?`; the current goal is version ${goal.version}`:''}. The original source references are retained. Review this saved text before using it; preparing another draft uses your current choices.</p>}
      {changed && !prepared.fromStore && <p className="conversation-warning">The goal, details, or selected facts changed. This draft still reflects the earlier choices; review it before using.</p>}
      {prepared.draft.channel==='email' && <label>Subject<input value={prepared.subject} maxLength={200} disabled={disabled} onChange={event=>changePrepared({subject:event.target.value})}/></label>}
      <label className="sr-only" htmlFor={`${id}-message`}>Message text</label><textarea id={`${id}-message`} className="conversation-message" rows={10} value={prepared.text} maxLength={maxCharacters} disabled={disabled} onChange={event=>changePrepared({text:event.target.value})}/>
      <div className="row-actions conversation-message-actions"><button type="button" className="button primary" disabled={disabled || !prepared.text.trim()} onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}Copy message</button><button type="button" className="button secondary" disabled={disabled || !prepared.text.trim() || (!prepared.saveAttempt && prepared.savedBody===messageBody(prepared))} onClick={()=>void saveDraft()}>{working==='save'?'Saving…':prepared.saveAttempt?'Confirm draft save':prepared.savedBody===messageBody(prepared)?'Draft saved':uid?'Save draft to account':'Save draft'}</button><button type="button" className="button secondary" disabled={disabled || !prepared.text.trim() || Boolean(prepared.sentEventId)} onClick={()=>void recordSent()}>{working==='sent'?'Recording…':prepared.sentEventId?'Sent recorded':prepared.sentAttemptBody?'Confirm sent record':'Record sent'}</button></div>
      <p className="muted small conversation-record-help">Record sent only after you send the message yourself.</p>
      {prepared.saveAttempt && prepared.saveAttempt.body!==messageBody(prepared) && <details className="conversation-sources"><summary>Earlier draft awaiting save confirmation</summary><p className="preserve-text">{prepared.saveAttempt.body}</p></details>}
      {prepared.sentAttemptBody && prepared.sentAttemptBody!==messageBody(prepared) && <details className="conversation-sources"><summary>Earlier message awaiting sent confirmation</summary><p className="preserve-text">{prepared.sentAttemptBody}</p></details>}
      {prepared.sentBody && prepared.sentBody!==messageBody(prepared) && <p className="muted small">The sent record keeps the earlier message. Prepare another draft for a new conversation.</p>}
      {form.previous && <button type="button" className="text-button conversation-restore" disabled={disabled} onClick={()=>{if(!lock.current&&!externalBusy.current){persist({...state.current,prepared:state.current.previous,previous:state.current.prepared});setNotice('Previous draft restored.');setCopied(false);}}}>Restore previous draft</button>}
      <details className="conversation-sources"><summary>Facts used and what’s unknown</summary>{prepared.draft.citations.length>0 && <ul>{prepared.draft.citations.map(citation=><li key={citation.claimId}><p>{citation.quote}</p><small>{citation.subject==='self'?'About you':'About them'} · {citation.sourceLabel}</small></li>)}</ul>}<ul>{prepared.draft.unknowns.map(unknown=><li key={unknown}>{unknown}</li>)}</ul></details>
    </div>}
    <details className="conversation-next"><summary>Keep the next step</summary><form aria-label="Record next step" onSubmit={event=>{event.preventDefault();void recordNext();}}><fieldset disabled={disabled}><label>Next step<textarea rows={2} value={form.nextStep} maxLength={2000} placeholder="What happens next, and who will do it?" onChange={event=>change({nextStep:event.target.value})}/></label><label>Follow-up day <span className="muted">Optional</span><input type="date" value={form.nextDate} onChange={event=>change({nextDate:event.target.value})}/></label></fieldset><button className="button secondary" disabled={disabled || (!form.nextAttempt && !form.nextStep.trim())}>{working==='next'?'Recording…':form.nextAttempt?'Confirm next step':'Record next step'}</button>{form.nextAttempt && (form.nextAttempt.input.body!==form.nextStep.trim() || form.nextAttempt.date!==form.nextDate) && <p className="conversation-warning">Confirming the earlier next step: {form.nextAttempt.input.body}</p>}</form></details>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="conversation-notice" role="status">{notice}</p>}{storageNotice && <p className="conversation-notice" role="status">{storageNotice}</p>}
    {refreshError && <p className="conversation-warning">Saved, but history could not refresh. <button type="button" className="text-button" disabled={disabled} onClick={async()=>{if(!begin('refresh'))return;try{await refresh();}finally{finish();}}}>Refresh history</button></p>}
  </section>;
}
function FactPicker({title,claims,selected,onSelect,disabled}:{title:string;claims:readonly EvidenceClaim[];selected:readonly string[];onSelect:(ids:string[])=>void;disabled:boolean}) {
  const [query,setQuery]=useState('');const [visible,setVisible]=useState(6);
  const filtered=claims.filter(claim=>selected.includes(claim.id)||`${claim.text} ${claim.sourceLabel}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen=filtered.filter(claim=>selected.includes(claim.id));const available=filtered.filter(claim=>!selected.includes(claim.id));const shown=[...chosen,...available.slice(0,visible)];
  return <fieldset className="conversation-picker" disabled={disabled}><legend>{title}</legend>{claims.length>6 && <label className="conversation-fact-search">Find a fact<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setVisible(6);}}/></label>}{shown.length?shown.map(claim=><label className="conversation-fact" key={claim.id}><input type="checkbox" checked={selected.includes(claim.id)} disabled={disabled || (!selected.includes(claim.id) && selected.length>=CONVERSATION_LIMITS.factsPerSubject)} onChange={()=>{if(disabled)return;onSelect(selected.includes(claim.id)?selected.filter(item=>item!==claim.id):selected.length<CONVERSATION_LIMITS.factsPerSubject?[...selected,claim.id]:[...selected]);}}/><span><span>{claim.text}</span><small>{claim.sourceLabel}</small></span></label>):<p className="muted small">{query?'No facts match this search.':'No suitable facts yet. You can still write a direct question.'}</p>}{available.length>visible && <button type="button" className="text-button" disabled={disabled} onClick={()=>setVisible(count=>count+6)}>Show more facts</button>}</fieldset>;
}
