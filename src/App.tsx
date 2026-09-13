import {useCallback,useEffect,useMemo,useRef,useState,useId,type FormEvent} from 'react';
import {ArrowLeft,ArrowRight,ChevronRight,Compass,ExternalLink,House,Plus,Sparkles,Target,Users,X} from 'lucide-react';
import {db,gatewayForAccount,saveSettings,authCallbackNotice} from './lib/platform';
import {readLinkedInArchive,type ArchiveProgress} from './lib/archive';
import {extractResumePdf} from './lib/resume';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {accountSources,allConnections,archiveConnections,capture,changeStage,keepLocal,localSources,readRelationships,saveArchive,savePerson,saveResume,saveMailbox,savedArchiveBlob,synthesizer,type Capture,type LocalSources,type Person} from './lib/workspace';
import {watchInbox} from './lib/inbox';
import type {MboxWorkerResponse,MailboxWorkerResult} from './lib/mbox.worker';
import {startExtensionBridge} from './lib/extension-bridge';
import {requestedExtensionId,withoutExtensionRequest} from './lib/extension-pairing';
import type {Connection} from './lib/discover';
import DiscoverPanel from './components/DiscoverPanel';
import {Avatar,Dialog,EmptyState,formatDate,MightyMark,StagePill,stageLabels,Tabs} from './components/DesignPrimitives';
import RelationshipViews,{personHeadline,Timeline,type RelationshipView} from './components/RelationshipViews';
import MePanel,{type MeTab} from './components/MePanel';
import AccountPanel from './components/AccountPanel';
import DeviceSourcesPanel from './components/DeviceSourcesPanel';
import GoalsPanel from './components/GoalsPanel';
import GoalSwitcher from './components/GoalSwitcher';
import PersonEvidencePanel from './components/PersonEvidencePanel';
import DeviceGoalsPanel from './components/DeviceGoalsPanel';
import {goalHookDependencies,useGoals} from './lib/use-goals';
import type {Goal} from './lib/goals';
import {buildSelfEvidence} from './lib/evidence';
import {completeRelationshipCommitment,openGoalCommitments} from './lib/relationship-events';
import {copyDeviceHandoff,type HandoffPreview} from './lib/owner-handoff';
const personTabs=['Context','Updates','History'] as const;
const stages=['saved','contacted','in_conversation','staying_in_touch'];
const label=(s:string)=>s.replaceAll('_',' ');
const message=(e:unknown)=>e instanceof Error?e.message:'The action could not be completed.';
export default function App(){
 const [extensionRequest,setExtensionRequest]=useState(()=>requestedExtensionId(window.location?.href||''));
 const extensionRequestRef=useRef(extensionRequest);extensionRequestRef.current=extensionRequest;
 const [page,setPage]=useState<string>(authCallbackNotice||extensionRequest?'Me':'Today'),[uid,setUid]=useState<string|null>(null),[ready,setReady]=useState(false),[sources,setSources]=useState<LocalSources>({}),[pool,setPool]=useState<Connection[]>([]),[people,setPeople]=useState<Person[]>([]),[events,setEvents]=useState<Capture[]>([]),[strategy,setStrategy]=useState(''),[notice,setNotice]=useState(authCallbackNotice||''),[busy,setBusy]=useState(''),[progress,setProgress]=useState(''),[remaining,setRemaining]=useState<number|null>(null),[modal,setModal]=useState(false),[selected,setSelected]=useState(''),[noteDrafts,setNoteDrafts]=useState<Record<string,{body:string;kind:string}>>({}),[refreshPending,setRefreshPending]=useState(false);
 const [extensionId,setExtensionId]=useState(()=>localStorage.getItem('mighty-extension-id')||''),[extensionStatus,setExtensionStatus]=useState('Not connected'),[ownEmail,setOwnEmail]=useState('');
 const [accountEmail,setAccountEmail]=useState('');
 const [loadedSourcesKey,setLoadedSourcesKey]=useState('');
 const [relationshipView,setRelationshipView]=useState<RelationshipView>('List');
 const [meTab,setMeTab]=useState<MeTab>(authCallbackNotice||extensionRequest?'Settings':'Profile');
 const [personTab,setPersonTab]=useState<typeof personTabs[number]>('Context');
 const [captureOpen,setCaptureOpen]=useState(false);
 const selectedRef=useRef(selected);selectedRef.current=selected;
 const activeDraft=noteDrafts[selected];
 const note=activeDraft?.body||'';const noteKind=activeDraft?.kind||'note';
 const setNote=(body:string)=>{if(selected)setNoteDrafts(drafts=>({...drafts,[selected]:{body,kind:drafts[selected]?.kind||'note'}}));};
 const setNoteKind=(kind:string)=>{if(selected)setNoteDrafts(drafts=>({...drafts,[selected]:{body:drafts[selected]?.body||'',kind}}));};
 // Selecting another person opens that person's draft; it never retargets existing text.
 const selectDraftPerson=(personId:string)=>setSelected(personId);
 const [exploreMode,setExploreMode]=useState<'explore'|'ask'>('explore');
 const [exploreFocus,setExploreFocus]=useState(0);
 const mailboxWorker=useRef<Worker|null>(null);
 const extensionBridge=useRef<ReturnType<typeof startExtensionBridge>|null>(null);
 const key=uid||'device-draft';
 const localKey=useRef(key);const accountGeneration=useRef(0);const renderGeneration=accountGeneration.current;
 const actionLock=useRef(false);const goalDirty=useRef(false);const refreshGeneration=useRef(0);
 const goalEditVersion=useRef(0);
 const isCurrent=()=>localKey.current===key&&accountGeneration.current===renderGeneration;
 const goalDependencies=useMemo(()=>({...goalHookDependencies,saveAccountGoal:async(accountId:string,goal:Goal,expectedVersion:number)=>{
  const saved=await goalHookDependencies.saveAccountGoal(accountId,goal,expectedVersion);
  // Refresh after the confirmed account write, even if the editor's later local read fails.
  // Copying, conflict choices and selecting a goal stay local until an explicit account save.
  if(accountId===uid&&isCurrent())void extensionBridge.current?.sync();
  return saved;
 }}),[key,uid,renderGeneration]);
 const goals=useGoals(key,uid,ready&&loadedSourcesKey===key,strategy,goalDependencies);
 const activeStrategy=goals.activeGoal?.outcome||strategy;
 const refresh=useCallback(async()=>{
  if(localKey.current!==key||accountGeneration.current!==renderGeneration)return;
  const request=++refreshGeneration.current;const result=await readRelationships(uid);
  if(localKey.current!==key||accountGeneration.current!==renderGeneration||request!==refreshGeneration.current)return;
  setPeople(result.people);setEvents(result.events);
 },[uid,renderGeneration]);
 useEffect(()=>{
  if(!db){setReady(true);return;}
  let mounted=true;let authEvents=0;
  const applyAccount=(nextUid:string|null,email='')=>{
   if(!mounted)return;
   const nextKey=nextUid||'device-draft';
   if(localKey.current!==nextKey){
    localKey.current=nextKey;accountGeneration.current++;goalDirty.current=false;
    setPeople([]);setEvents([]);setPool([]);setSources({});setStrategy('');setLoadedSourcesKey('');setSelected('');setNoteDrafts({});setRefreshPending(false);setModal(false);setCaptureOpen(false);setPage(extensionRequestRef.current?'Me':'Today');setRemaining(null);setOwnEmail('');setNotice('');setProgress('');
   }
   setUid(nextUid);setAccountEmail(email);setReady(true);
  };
  void db.auth.getSession().then(({data,error})=>{if(!mounted||authEvents)return;if(error)setNotice(error.message);applyAccount(data.session?.user.id||null,data.session?.user.email||'');}).catch(error=>{if(mounted&&!authEvents){setReady(true);setNotice(message(error));}});
  const {data}=db.auth.onAuthStateChange((_event,session)=>{authEvents++;applyAccount(session?.user.id||null,session?.user.email||'');});
  return()=>{mounted=false;data.subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!ready)return;let active=true;goalDirty.current=false;
  const current=()=>active&&localKey.current===key&&accountGeneration.current===renderGeneration;
  const settings=uid?db!.from('settings').select('data').eq('user_id',uid).maybeSingle():Promise.resolve(null);
  void Promise.allSettled([localSources(key),settings]).then(([local,remote])=>{
   if(!current())return;
   const stored=local.status==='fulfilled'?local.value:{};
   const remoteValue=remote.status==='fulfilled'?remote.value:null;
   // Preserve imports or edits made while either store was loading.
   setSources(currentSources=>({...stored,...(remoteValue?.data?.data?.knowledge?{knowledge:remoteValue.data.data.knowledge}:{}),...currentSources}));
   if(!goalDirty.current)setStrategy(typeof stored.strategy==='string'?stored.strategy:remoteValue?.data?.data?.strategy||'');
   setLoadedSourcesKey(key);
   const error=local.status==='rejected'?local.reason:remote.status==='rejected'?remote.reason:remoteValue?.error;
   if(error)setNotice(message(error instanceof Error?error:Error(error.message||String(error))));
  });
  if(uid){
   void accountSources(uid).then(accountFacts=>{if(current())setSources(previous=>({...previous,accountFacts}));}).catch(e=>{if(current())setNotice(message(e));});
   void allConnections(uid).then(connections=>{if(current())setPool(connections);}).catch(e=>{if(current())setNotice(message(e));});
  }
  void refresh().catch(e=>{if(current())setNotice(message(e));});
  return()=>{active=false;};
 },[key,uid,ready,refresh,renderGeneration]);
 useEffect(()=>{if(!uid)return;return watchInbox(result=>{if(!isCurrent())return;if(result.saved){void refresh().catch(e=>{if(isCurrent())setNotice(message(e));});setNotice(`${result.saved} ${result.saved===1?'person':'people'} received from your extension.`);}if(result.failed)setNotice(`${result.failed} extension saves are still pending and will retry on focus.`);},e=>{if(isCurrent())setNotice(e.message);},uid);},[uid,refresh]);
 useEffect(()=>{
  let active=true;
  if(!extensionId){setExtensionStatus('Not connected. Add the extension ID from Chrome.');return;}
  if(!/^[a-p]{32}$/.test(extensionId)){setExtensionStatus('Check the extension ID: 32 letters, a through p.');return;}
  setExtensionStatus('Connecting to your account…');
  const bridge=startExtensionBridge({extensionId,getAccessToken:async()=>((await db?.auth.getSession())?.data.session?.access_token||null),onStatus:(status:any)=>{if(active)setExtensionStatus(status?.connected?'Connected to your account':status?.message||'Account session needed');}});
  extensionBridge.current=bridge;
  const subscription=db?.auth.onAuthStateChange(()=>void bridge.sync());
  return()=>{active=false;if(extensionBridge.current===bridge)extensionBridge.current=null;bridge.dispose();subscription?.data.subscription.unsubscribe();};
 },[extensionId]);
 const dismissExtensionRequest=()=>{
  setExtensionRequest(null);
  if(window.location?.href)window.history.replaceState(window.history.state,'',withoutExtensionRequest(window.location.href));
 };
 const approveExtensionRequest=()=>{
  if(!ready||!uid||!extensionRequest||!isCurrent())return;
  try{
   localStorage.setItem('mighty-extension-id',extensionRequest);
   if(extensionId===extensionRequest)void extensionBridge.current?.sync();
   else setExtensionId(extensionRequest);
   dismissExtensionRequest();
  }catch{setNotice('Chrome could not save this connection. Keep this page open and try again.');}
 };
 const run=async(name:string,work:()=>Promise<void>)=>{
  if(actionLock.current||!isCurrent())return;actionLock.current=true;setBusy(name);setProgress('');setNotice('');
  try{await work();}catch(e){if(isCurrent())setNotice(message(e));}
  finally{setBusy('');if(isCurrent())setProgress('');actionLock.current=false;}
 };
 // A committed write stays successful even if its follow-up read fails.
 // Retrying this warning reads the list again; it never repeats the write.
 const refreshAfterWrite=async(success:string)=>{
  if(!isCurrent())return false;
  setNotice(success);
  try{await refresh();if(!isCurrent())return false;setRefreshPending(false);return true;}
  catch(error){if(isCurrent()){setRefreshPending(true);setNotice(`${success} Your list could not refresh. ${message(error)}`);}return false;}
 };
 const retryRefresh=()=>run('Refreshing list',async()=>{await refresh();if(isCurrent()){setRefreshPending(false);setNotice('Your list is up to date.');}});
 const updateSources=async(patch:LocalSources,destination:string)=>{await keepLocal(destination,patch);if(isCurrent()&&localKey.current===destination)setSources(s=>({...s,...patch}));};
 const useDeviceSources=async(preview:HandoffPreview):Promise<boolean>=>{
  if(!uid||preview.destinationUid!==uid||!isCurrent()||actionLock.current)return false;
  let copied=false;const goalVersion=goalEditVersion.current;
  await run('Using device files',async()=>{
   const result=await copyDeviceHandoff(preview);
   if(!isCurrent()||result.destinationUid!==uid)return;
   setSources(current=>({...current,...result.snapshot}));
   if(typeof result.snapshot.strategy==='string'&&goalEditVersion.current===goalVersion){goalDirty.current=true;setStrategy(result.snapshot.strategy);await goals.importStrategy(result.snapshot.strategy);}
   copied=true;setNotice('Your selected files are available here. Use Save to account to store them online.');
   setPage('Me');setMeTab("Things you've learned");
  });
  return copied;
 };
 const connections=useMemo(()=>sources.archive?archiveConnections(sources.archive):pool,[sources.archive,pool]);
 const selfEvidence=useMemo(()=>buildSelfEvidence(sources),[sources]);
 const employers=useMemo(()=>(sources.archive||sources.accountFacts?.archive)?.layer1.positions.map(p=>p['Company Name']||p.Company||'').filter(Boolean)||[],[sources.archive,sources.accountFacts]);
 const savedUrls=useMemo(()=>new Set(people.map(p=>p.profile_url).filter((s):s is string=>!!s)),[people]);
 const selectedPerson=people.find(p=>p.id===selected);const selectedEvents=events.filter(e=>e.relationship_id===selected);
 const newPerson=async(p:Connection,reason:string)=>{if(!isCurrent())throw Error('Your account changed. Please try again.');await savePerson(uid,{person:p.person,url:p.profile_url,reason,company:p.company,position:p.position||p.role,source:p.context?.source==='web_search'?'web_search':'discovery',searchHeadline:typeof p.context?.searchHeadline==='string'?p.context.searchHeadline:undefined,searchSnippet:typeof p.context?.searchSnippet==='string'?p.context.searchSnippet:undefined});await refreshAfterWrite(`${p.person} saved.`);};
 const importArchive=async(file:Blob)=>{const destination=key;await run('Reading archive',async()=>{const result=await readLinkedInArchive(file,{onProgress:(p:ArchiveProgress)=>{if(isCurrent())setProgress(`${p.connections.toLocaleString()} connections · ${p.positions} positions · ${p.threads.toLocaleString()} threads`);}});await updateSources({archive:result},destination);if(isCurrent())setNotice(`Archive ready on this device. ${result.counts.connections.toLocaleString()} connections, ${result.counts.receivedMessages.toLocaleString()} received messages counted and discarded.${result.warnings.length?' '+result.warnings.join(' '):''}`);});};
 const importResume=async(file:File)=>{const destination=key;await run('Reading resume',async()=>{const resume=await extractResumePdf(file,{workerSrc,onProgress:(done,total)=>{if(isCurrent())setProgress(`${done} of ${total} pages read`);}});await updateSources({resume},destination);if(isCurrent())setNotice('Resume text is ready on this device.');});};
 const syncSources=async()=>run('Saving sources',async()=>{
  if(!uid)throw Error('An active account session is needed to save sources. Your imports are still on this device.');
  const goalToSave=typeof sources.strategy==='string'||goalDirty.current?strategy:undefined;
  if(sources.archive)await saveArchive(uid,sources.archive,n=>{if(isCurrent())setProgress(`${n.toLocaleString()} connections saved`);});
  if(sources.resume)await saveResume(uid,sources.resume);if(sources.mailbox)await saveMailbox(uid,sources.mailbox);
  if(goalToSave!==undefined)await saveSettings({strategy:goalToSave},uid);
  if(isCurrent())setNotice('Sources saved to your account.');
  if((!sources.archive&&!sources.resume)||!isCurrent())return;
  try{await synthesizer(key)({layer1:sources.archive?.layer1||null,resumeText:sources.resume?.text||''});if(isCurrent())setNotice('Sources saved to your account.');}
  catch(e){if(isCurrent())setNotice('Sources saved. Mighty could not finish preparing your context. Try again later.');}
 });
 const importMailbox=async(file:File)=>{const destination=key;await run('Reading mailbox',async()=>{const result=await new Promise<MailboxWorkerResult>((resolve,reject)=>{const worker=new Worker(new URL('./lib/mbox.worker.ts',import.meta.url),{type:'module'});mailboxWorker.current=worker;const requestId=crypto.randomUUID();worker.onmessage=(event:MessageEvent<MboxWorkerResponse>)=>{const result=event.data;if(result.requestId!==requestId)return;if(result.type==='progress'){if(isCurrent())setProgress(`${result.progress.counts.messages.toLocaleString()} messages · ${result.progress.counts.contacts.toLocaleString()} contacts counted · ${Math.round(result.progress.bytesRead / 1048576).toLocaleString()} MB read`);return;}worker.terminate();mailboxWorker.current=null;if(result.type==='complete')resolve(result.result);else reject(Error(result.type==='cancelled'?'Mailbox import cancelled. Your earlier sources remain available.':result.message));};worker.onerror=()=>{worker.terminate();mailboxWorker.current=null;reject(Error('The mailbox worker stopped. Your earlier imports remain available.'));};worker.postMessage({type:'parse',requestId,accountKey:destination,file,ownAddresses:ownEmail.split(/[,;\s]+/).filter(Boolean),accountHolderName:sources.archive?.verifiedAccountHolder?.fullName});});await updateSources({mailbox:result},destination);if(isCurrent())setNotice(`Mailbox analyzed locally: ${result.summary.counts.messages.toLocaleString()} messages, ${result.summary.globalMetrics.bidirectionalContacts.toLocaleString()} two-way contacts. Received bodies were never decoded.`);});};
 function editStrategy(value:string){goalEditVersion.current++;goalDirty.current=true;setStrategy(value);void keepLocal(key,{strategy:value}).catch(e=>{if(isCurrent())setNotice(message(e));});}
 async function saveStrategy(){const destination=key;await run('Saving goal',async()=>{await updateSources({strategy},destination);if(uid)await saveSettings({strategy},uid);if(isCurrent())setNotice(uid?'Your goal is saved.':'Your goal is saved on this device.');});}
 const rebuildArchive=async()=>{const destination=key;await run('Loading saved archive',async()=>{const blob=await savedArchiveBlob(uid);const result=await readLinkedInArchive(blob);await updateSources({archive:result},destination);if(isCurrent())setNotice('Knowledge base rebuilt from the sanitized saved archive.');});};
 function selectPerson(person: Person) {setSelected(person.id); setPersonTab('Context'); setPage('Person');}
 function openMe(tab: MeTab) {setMeTab(tab); setPage('Me');}
 function openAsk() {setExploreMode('ask'); setExploreFocus(value => value + 1); setPage('Explore');}
 function openExplore() {setExploreMode('explore'); setPage('Explore');}
 const saveCapture = () => run('Saving update', async () => {
  const personId=selected;const body=note;const kind=noteKind;
  await capture(uid, personId, kind, body);
  if (isCurrent()) {
   setNoteDrafts(drafts=>{
    // Clear only the exact draft that committed, even if navigation changed meanwhile.
    if(drafts[personId]?.body!==body||drafts[personId]?.kind!==kind)return drafts;
    const next={...drafts};delete next[personId];return next;
   });
   if(selectedRef.current===personId)setCaptureOpen(false);
  }
  await refreshAfterWrite('Update saved.');
 });
 const updateStage = (personId: string, stage: string) => run('Updating stage', async () => {await changeStage(uid, personId, stage); await refreshAfterWrite('Stage saved.');});
 const completeReminder = (event: Capture) => run('Completing next step', async () => {await completeRelationshipCommitment(uid,event); await refreshAfterWrite(event.kind==='next_step'?'Next step marked complete.':'Promise marked kept.');});
 const personName = sources.archive?.verifiedAccountHolder?.fullName || '';
 const firstName = personName.trim().split(/\s+/)[0];
 const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
 const openPromise = openGoalCommitments(events,{activeGoalId:goals.activeGoal?.id??null,relationshipIds:new Set(people.map(person=>person.id))})[0];
 const featuredPerson = people.find(person => person.id === openPromise?.relationship_id) || people[0];
 const otherPeople = people.filter(person => person.id !== featuredPerson?.id).slice(0, 4);
 const captureForm = <CaptureForm people={people} selected={selected} setSelected={selectDraftPerson} note={note} setNote={setNote} kind={noteKind} setKind={setNoteKind} disabled={Boolean(busy)} onSave={saveCapture}/>;
 return <div className="app">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <aside className="sidebar">
   <button type="button" className="brand" onClick={() => setPage('Today')} aria-label="Mighty home"><MightyMark/><span>Mighty</span></button>
   <nav aria-label="Main navigation">
    <button className={`nav-item ${page === 'Today' ? 'active' : ''}`} onClick={() => setPage('Today')} aria-current={page === 'Today' ? 'page' : undefined}><House size={18}/><span>Today</span></button>
    <button className={`nav-item ${page === 'Relationships' || page === 'Person' ? 'active' : ''}`} onClick={() => setPage('Relationships')} aria-current={page === 'Relationships' || page === 'Person' ? 'page' : undefined}><Users size={18}/><span>Relationships</span><span className="nav-count">{people.length}</span></button>
    <button className={`nav-item ${page === 'Explore' ? 'active' : ''}`} onClick={openExplore} aria-current={page === 'Explore' ? 'page' : undefined}><Compass size={18}/><span>Explore</span></button>
    <button className={`nav-item ${page === 'Me' ? 'active' : ''}`} onClick={() => setPage('Me')} aria-current={page === 'Me' ? 'page' : undefined}><Target size={18}/><span>Me</span></button>
   </nav>
   <div className="sidebar-bottom">
    <button className="ask-button" onClick={openAsk}><Sparkles size={16}/><span>Ask Mighty</span></button>
    {remaining !== null && <p className="assist-count" title="AI-generated drafts use Assists. Saving people and notes is free.">{remaining} Assists remaining today</p>}
    <button className="workspace-account" onClick={() => openMe('Settings')}><Avatar name={personName || 'You'} size="small"/><span><strong>{personName || 'Your workspace'}</strong><small>{uid ? 'Account connected' : 'On this device'}</small></span></button>
   </div>
  </aside>
  <main id="main-content" tabIndex={-1} className={`main main-${page.toLowerCase()}`}>
   <div className="ambient ambient-indigo" aria-hidden="true"/><div className="ambient ambient-coral" aria-hidden="true"/>
   <div className={`content content-${page.toLowerCase()}`}>
    {!uid && ready && !(page==='Me'&&meTab==='Settings') && <div className="account-entry"><span className="muted small">Local workspace</span><button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>openMe('Settings')}>Sign in<ArrowRight size={14}/></button></div>}
    {notice && <div className="notice" role="status"><span>{notice}</span>{refreshPending && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void retryRefresh()}>Refresh list</button>}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {busy && <div className="import-progress" role="status"><span className="busy-dot"/><strong>{busy}</strong>{progress && <span>{progress}</span>}</div>}
    {extensionRequest && page==='Me' && <section className="panel content-panel" aria-label="Extension connection request">
     <h2>Connect the Mighty extension</h2>
     <p>Allow this extension to use your Mighty account, load your saved goals and save people you choose.</p>
     <p className="muted small">Approve only if you opened this page from your installed Mighty extension.</p>
     <p className="muted small">Extension ID: <code>{extensionRequest}</code></p>
     {!uid && <p>Sign in below, then return to the extension and choose Connect to Mighty.</p>}
     <div className="row-actions"><button className="button primary" disabled={!ready||!uid} onClick={approveExtensionRequest}>Connect extension</button><button className="button secondary" onClick={dismissExtensionRequest}>Cancel connection</button></div>
    </section>}
    {['Today','Explore','Person'].includes(page)&&<GoalSwitcher key={key} {...goals.workspace} onSelect={goals.select} busy={goals.busy}/>}
    {page === 'Today' && <>
     <header className="today-heading"><h1>{greeting}{firstName ? `, ${firstName}` : ''}.</h1></header>
     <section className="start-card">
      {featuredPerson ? <Avatar name={featuredPerson.person} tone={1}/> : <span className="start-symbol"><Users size={23}/></span>}
      <div><p className="eyebrow">{openPromise ? (openPromise.kind==='next_step'?'Open next step':'Open promise') : featuredPerson ? 'Recently saved' : 'Start here'}</p><h2>{openPromise ? featuredPerson.person : featuredPerson ? featuredPerson.person : connections.length ? 'Find your next connection.' : 'Start with your network.'}</h2><p>{openPromise?.body || (featuredPerson ? String(featuredPerson.context.saveReason || 'No reason recorded yet.') : connections.length ? 'Search your connections by role or company.' : uid ? 'Import sources or use the files already in this browser.' : 'Import your LinkedIn archive to explore your connections.')}</p></div>
      <button className="button primary" onClick={() => featuredPerson ? selectPerson(featuredPerson) : connections.length ? openExplore() : openMe("Things you've learned")}>{featuredPerson ? 'Open context' : connections.length ? 'Explore network' : uid ? 'Choose sources' : 'Import archive'}</button>
     </section>
     <div className="today-prompts">{!connections.length && <button className="button secondary" onClick={openExplore}>Explore</button>}{people.length > 0 && <button className="button secondary" onClick={() => setCaptureOpen(true)}>Record an update</button>}</div>
     {otherPeople.length > 0 && <section className="today-next"><div className="section-heading"><h2 className="eyebrow muted">{otherPeople.length ? 'Keep in mind' : 'Recent activity'}</h2>{otherPeople.length > 0 && <button className="text-button" onClick={() => setPage('Relationships')}>View all<ArrowRight size={13}/></button>}</div>{otherPeople.length ? otherPeople.map((person, index) => <button className="today-row" key={person.id} onClick={() => selectPerson(person)}><Avatar name={person.person} size="small" tone={index}/><span><strong>{person.person}</strong><span>{String(person.context.saveReason || personHeadline(person) || 'Saved by you')}</span></span><ChevronRight size={16}/></button>) : <div className="quiet-empty"><span className="quiet-line"/><p>{featuredPerson ? 'No other saved people.' : 'No activity captured yet.'}</p></div>}</section>}
     <section className="strategy-summary"><div><button className="eyebrow text-button" onClick={() => openMe('Goal')}>{goals.activeGoal?.title || (strategy ? 'Your goal' : 'Set a goal')}</button><p>{activeStrategy || 'Set a goal to guide who you look for.'}</p></div><button className="icon-button" aria-label="Edit your goal" onClick={() => openMe('Goal')}><ArrowRight size={18}/></button></section>
    </>}
    {page === 'Relationships' && <RelationshipViews key={key} goals={goals.workspace.goals} onComplete={completeReminder} people={people} events={events} strategy={activeStrategy} view={relationshipView} onView={setRelationshipView} busy={Boolean(busy)} onOpen={selectPerson} onAdd={() => setModal(true)} onExplore={openExplore} onStage={updateStage}/>}
    {page === 'Explore' && <><header className="page-heading"><p className="eyebrow">Explore</p><h1>{exploreMode === 'ask' ? 'What’s on your mind?' : 'Who should I know?'}</h1></header><DiscoverPanel key={key} goal={goals.activeGoal} selfEvidence={selfEvidence} all={connections} strategy={activeStrategy} employers={employers} savedUrls={savedUrls} call={gatewayForAccount(uid)} onSave={newPerson} onRemaining={value => {if (isCurrent()) setRemaining(value);}} focusRequest={exploreFocus} mode={exploreMode}/></>}
    {page === 'Me' && <MePanel goalsPanel={<>{uid&&<DeviceGoalsPanel key={uid} uid={uid} busy={goals.busy} onCopied={()=>goals.adoptCopiedWorkspace()}/>}{goals.conflicts.map(conflict=><section key={conflict.goalId} className="panel content-panel"><h2>Two versions of {conflict.local.title}</h2><p>Your version: {conflict.local.outcome}</p><p>Account version: {conflict.remote.outcome}</p><div className="row-actions"><button className="button secondary" onClick={()=>void goals.resolve(conflict.goalId,'local')}>Keep my version</button><button className="button secondary" onClick={()=>void goals.resolve(conflict.goalId,'remote')}>Use account version</button></div></section>)}<GoalsPanel key={key} draftKey={key} {...goals.workspace} onSelect={goals.select} onSave={goals.save} notice={goals.notice} busy={goals.busy}/></>} key={key} tab={meTab} onTab={setMeTab} sources={sources} people={people} connectionCount={connections.length} strategy={strategy} onStrategy={editStrategy} onSaveStrategy={saveStrategy} onExplore={openExplore} devicePanel={uid?<DeviceSourcesPanel key={uid} uid={uid} busy={Boolean(busy)} onCopy={useDeviceSources}/>:null} accountPanel={<AccountPanel client={db} uid={uid} email={accountEmail} busy={Boolean(busy)} ready={ready}/>} uid={uid} busy={Boolean(busy)} ownEmail={ownEmail} onOwnEmail={setOwnEmail} onArchive={importArchive} onResume={importResume} onMailbox={importMailbox} onRebuild={rebuildArchive} onSync={syncSources} extensionId={extensionId} extensionStatus={extensionStatus} onExtensionId={value => {setExtensionId(value); localStorage.setItem('mighty-extension-id', value);}}/>}
    {page === 'Person' && (selectedPerson ? <>
     <button className="back-link" onClick={() => setPage('Relationships')}><ArrowLeft size={15}/>Relationships</button>
     <header className="person-heading"><Avatar name={selectedPerson.person} size="large" tone={3}/><div><h1>{selectedPerson.person}</h1>{personHeadline(selectedPerson) && <p>{personHeadline(selectedPerson)}</p>}</div><StagePill stage={selectedPerson.stage}/></header>
     <p className="person-meta">Saved {formatDate(selectedPerson.created_at)}{selectedPerson.profile ? ' · Profile read' : ' · Profile not read yet'}</p>
     <div className="row-actions person-actions"><button className="button primary" onClick={() => setPersonTab('Updates')}><Plus size={15}/>Record an update</button>{selectedPerson.profile_url && <a className="button secondary" href={selectedPerson.profile_url} target="_blank" rel="noreferrer">LinkedIn<ExternalLink size={14}/></a>}</div>
     <section className="panel person-why"><p className="eyebrow muted">Why you saved them</p><p>{String(selectedPerson.context.saveReason || 'No reason recorded. Add one as a note.')}</p></section>
     <Tabs label="Person section" items={personTabs} value={personTab} onChange={setPersonTab}/>
     <div className="person-tab-content">
      {personTab === 'Context' && <div className="person-context-grid"><section className="panel content-panel">{selectedPerson.profile ? <><h2>Profile context</h2><ProfileEvidence profile={selectedPerson.profile}/></> : <><h2>Available context</h2>{typeof selectedPerson.context.searchSnippet === 'string' && <div className="search-context"><p className="eyebrow muted">From search · unverified</p><p>{selectedPerson.context.searchSnippet}</p></div>}<p>Add facts you can confirm below to assess this person and prepare a conversation. Search snippets stay unverified.</p></>}</section><section className="panel content-panel"><p className="eyebrow">Your relationship</p><label htmlFor="stage">Relationship stage</label><select id="stage" value={selectedPerson.stage} disabled={Boolean(busy)} onChange={event => void updateStage(selectedPerson.id, event.target.value)}>{stages.map(stage => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></section></div>}
      {personTab === 'Context' && <PersonEvidencePanel key={`${key}:${selectedPerson.id}`} uid={uid} person={selectedPerson} goals={goals.workspace.goals} activeGoal={goals.activeGoal} selfEvidence={selfEvidence} companyIndex={sources.archive?.companyIndex ?? sources.accountFacts?.archive?.companyIndex} call={gatewayForAccount(uid)} onRemaining={setRemaining} onRecorded={refresh}/>}
      {personTab === 'Updates' && <section className="panel content-panel capture-panel"><h2>Record an update</h2>{captureForm}</section>}
      {personTab === 'History' && <Timeline people={[selectedPerson]} events={selectedEvents} busy={Boolean(busy)} goals={goals.workspace.goals} onComplete={completeReminder}/>}
     </div>
    </> : <section className="panel"><EmptyState title="Choose a person to continue." action={<button className="button primary" onClick={() => setPage('Relationships')}>Your relationships</button>}>Open a saved person from Relationships.</EmptyState></section>)}
   </div>
  </main>
  {modal && <Dialog title="Save a person" onClose={() => setModal(false)}>{notice && <p className="form-error" role="alert">{notice}</p>}<form onSubmit={(event: FormEvent<HTMLFormElement>) => {event.preventDefault(); const data = new FormData(event.currentTarget); void run('Saving person', async () => {const id = await savePerson(uid, {person: String(data.get('name')), url: String(data.get('url')), reason: String(data.get('reason'))}); if (!isCurrent()) return; setSelected(id); setModal(false); setPersonTab('Context'); const refreshed = await refreshAfterWrite('Person saved.'); if (isCurrent()) setPage(refreshed ? 'Person' : 'Relationships');});}}><label>Name<input name="name" required maxLength={200} autoFocus/></label><label>LinkedIn profile<input name="url" inputMode="url" placeholder="linkedin.com/in/their-name"/></label><label>Why do you want to stay in touch?<textarea name="reason" maxLength={4000} rows={3}/></label><button className="button primary" disabled={Boolean(busy)}>Save person</button></form></Dialog>}
  {captureOpen && <Dialog title="Record an update" onClose={() => setCaptureOpen(false)}>{notice && <p className="form-error" role="alert">{notice}</p>}{captureForm}</Dialog>}
 </div>;
}

function CaptureForm({people, selected, setSelected, note, setNote, kind, setKind, disabled, onSave}: {people: Person[]; selected: string; setSelected: (value: string) => void; note: string; setNote: (value: string) => void; kind: string; setKind: (value: string) => void; disabled: boolean; onSave: () => Promise<void>}) {
 const id = useId();
 return <form className="capture-form" onSubmit={event => {event.preventDefault(); void onSave();}}><div className="form-columns"><label htmlFor={`${id}-person`}>Person<select id={`${id}-person`} value={selected} onChange={event => setSelected(event.target.value)} required disabled={disabled}><option value="">Choose a person</option>{people.map(person => <option key={person.id} value={person.id}>{person.person}</option>)}</select></label><label htmlFor={`${id}-kind`}>What happened?<select id={`${id}-kind`} value={kind} onChange={event => setKind(event.target.value)} disabled={disabled || !selected}>{['note', 'contacted', 'replied', 'coffee_chat', 'promise_made'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></label></div><label htmlFor={`${id}-note`}>What would you like to remember?<textarea id={`${id}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={8000} rows={4} required={['note', 'promise_made'].includes(kind)} disabled={disabled || !selected} placeholder="A detail, a next step, a promise…"/></label><button className="button primary" disabled={disabled || !selected}>Save update</button>{!people.length && <p className="muted small">Save a person before recording an update.</p>}</form>;
}
function ProfileEvidence({profile}: {profile: Record<string, unknown>}) {
 const anchors = Array.isArray(profile.anchors) ? profile.anchors : [];
 return <div className="profile-evidence">{anchors.length ? anchors.map((anchor, index) => <article key={index}><p className="eyebrow muted">{String(anchor.kind || anchor.field || 'Profile')}</p><p>{String(anchor.text || '')}</p></article>) : <p className="muted">No profile details were captured. Read the profile again with the extension.</p>}</div>;
}
