import {useEffect,useMemo,useRef,useState} from 'react';
import type {Goal} from '../lib/goals';
import {rankGoalNetwork,type RankedGoalCandidate} from '../lib/assessment';
import {candidateKey,type EvidenceClaim} from '../lib/evidence';
import type {Connection} from '../lib/discover';
import {Avatar} from './DesignPrimitives';
import './GoalShortlist.css';

export default function GoalShortlist({goal,all,selfEvidence,savedUrls,onSave,query=''}:{goal:Goal;all:Connection[];selfEvidence:readonly EvidenceClaim[];savedUrls:Set<string>;onSave:(person:Connection,reason:string)=>Promise<void>;query?:string}){
 const ranked=useMemo(()=>rankGoalNetwork(goal,all.map(person=>({...person,sourceKind:'archive' as const,sourceLabel:'Your imported connection record'})),selfEvidence,{limit:500}),[goal,all,selfEvidence]);
 const [skipped,setSkipped]=useState(new Set<string>()),[page,setPage]=useState(0),[saving,setSaving]=useState(new Set<string>()),[saved,setSaved]=useState(new Set<string>()),[error,setError]=useState('');
 const inflight=useRef(new Set<string>()),mounted=useRef(true);
 const viewKey=`${goal.id}:${goal.version}:${query}`,currentView=useRef(viewKey);currentView.current=viewKey;
 const normalizedSaved=useMemo(()=>new Set([...savedUrls].map(url=>candidateKey({url}))),[savedUrls]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setSkipped(new Set());setPage(0);setError('');},[goal.id,goal.version,query]);
 const available=ranked.filter(row=>!skipped.has(row.candidateKey));
 const pageIndex=Math.min(page,Math.max(0,Math.ceil(available.length/5)-1));
 const visible=available.slice(pageIndex*5,pageIndex*5+5);
 async function save(row:RankedGoalCandidate){
  if(inflight.current.has(row.candidateKey)||saved.has(row.candidateKey))return;
  const view=viewKey;const current=()=>mounted.current&&currentView.current===view;
  inflight.current.add(row.candidateKey);setSaving(new Set(inflight.current));setError('');
  try{await onSave(row.person as Connection,row.reasons.join(' '));if(current())setSaved(previous=>new Set(previous).add(row.candidateKey));}
  catch(cause){if(current())setError(cause instanceof Error?cause.message:'This person could not be saved.');}
  finally{inflight.current.delete(row.candidateKey);if(mounted.current)setSaving(new Set(inflight.current));}
 }
 return <section className="goal-shortlist" aria-label="People for your goal">
  <div className="section-heading"><div><p className="eyebrow">Your network · {goal.title}</p><h2>A reason to reconnect</h2></div><span className="pill neutral">{available.length}{ranked.length===500?'+':''} possible contacts</span></div>
  {!all.length?<p className="panel content-panel">{query?'No records match these words.':'Import your connections to find people you already know.'}</p>:!visible.length?<p className="panel content-panel">{skipped.size?'You’ve reviewed this batch. Change your criteria to explore a different route.':'There isn’t enough evidence for this goal yet. Add a contact criterion or confirm more context on a saved person.'}</p>:<div className="shortlist-grid">{visible.map(row=>{
   const wasSaved=saved.has(row.candidateKey)||Boolean(row.person.profile_url&&normalizedSaved.has(candidateKey({url:row.person.profile_url})));
   const claims=[...row.candidate.claims,...selfEvidence];
   return <article className="panel shortlist-card" key={row.candidateKey}>
    <div className="shortlist-person"><Avatar name={row.candidate.name}/><div><h3>{row.candidate.name}</h3><p className="muted small">{[row.person.position||row.person.role,row.candidate.company].filter(Boolean).join(' · ')}</p></div></div>
    <span className="pill neutral">{row.label}</span>
    <p className="shortlist-reason">{row.reasons[0]}</p>
    {row.unknowns.length>0&&<p className="muted small">{row.unknowns[0]}</p>}
    <details className="shortlist-evidence"><summary>Why this person?</summary>{row.reasonDetails.map((reason,index)=><div key={index}><p>{reason.text}</p>{reason.claimIds.map(id=>{const claim=claims.find(c=>c.id===id);return claim?<blockquote key={id}>{claim.text}<cite>{claim.sourceLabel}</cite></blockquote>:null;})}</div>)}{row.unknowns.length>0&&<><h4>Still unknown</h4><ul>{row.unknowns.map(unknown=><li key={unknown}>{unknown}</li>)}</ul></>}</details>
    <div className="row-actions"><button type="button" className="button primary" disabled={wasSaved||saving.has(row.candidateKey)} onClick={()=>void save(row)} aria-label={wasSaved?`${row.candidate.name} is saved`:`Save ${row.candidate.name}`}>{wasSaved?'Saved':saving.has(row.candidateKey)?'Saving…':'Save'}</button><button type="button" className="button secondary" disabled={saving.has(row.candidateKey)} onClick={()=>setSkipped(previous=>new Set(previous).add(row.candidateKey))} aria-label={`Skip ${row.candidate.name} for ${goal.title}`}>Skip for this goal</button></div>
   </article>;
  })}</div>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {available.length>5&&<div className="shortlist-pagination"><p className="muted small">{pageIndex*5+1}–{Math.min(pageIndex*5+5,available.length)} of {available.length}</p><div className="row-actions">{pageIndex>0&&<button className="button secondary" onClick={()=>setPage(pageIndex-1)}>Previous five</button>}{(pageIndex+1)*5<available.length&&<button className="button secondary" onClick={()=>setPage(pageIndex+1)}>Next five</button>}</div></div>}
 </section>;
}
