import {ArrowRight, Download, FileText, Mail, Upload, Users} from 'lucide-react';
import type {ReactNode} from 'react';
import type {LocalSources, Person} from '../lib/workspace';
import {formatDate, Tabs} from './DesignPrimitives';

export const meTabs = ['Profile', 'Goal', "Things you've learned", 'Settings'] as const;
export type MeTab = typeof meTabs[number];
type Props = {
  tab: MeTab; onTab: (tab: MeTab) => void; sources: LocalSources; people: Person[]; connectionCount: number;
  strategy: string; onStrategy: (value: string) => void; onSaveStrategy: () => Promise<void>; onExplore: () => void;
  uid: string | null; busy: boolean; ownEmail: string; onOwnEmail: (value: string) => void;
  onArchive: (file: File) => Promise<void>; onResume: (file: File) => Promise<void>; onMailbox: (file: File) => Promise<void>;
  onRebuild: () => Promise<void>; onSync: () => Promise<void>;
  extensionId: string; extensionStatus: string; onExtensionId: (value: string) => void;
  accountPanel: ReactNode;
  devicePanel?: ReactNode;
  goalsPanel?: ReactNode;
};
export default function MePanel(props: Props) {
  const {tab, onTab, sources, strategy, uid, busy} = props;
  const archive=sources.archive||sources.accountFacts?.archive,resume=sources.resume||sources.accountFacts?.resume,mailbox=sources.mailbox||sources.accountFacts?.mailbox;
  const hasSources = Boolean(archive || resume || mailbox);
  const name = sources.archive?.verifiedAccountHolder?.fullName;
  return <>
    <header className="page-heading with-actions"><div><h1>{tab === 'Profile' ? 'Your profile' : tab === 'Goal' ? 'Your goals' : tab === "Things you've learned" ? "Things you've learned" : 'Settings'}</h1></div></header>
    <Tabs label="Me section" items={meTabs} value={tab} onChange={onTab}/>
    <div className="me-content">
      {(tab==='Settings'||tab==="Things you've learned")&&props.devicePanel}
      {tab === 'Profile' && (!hasSources ? <section className="profile-empty gradient-card"><h2>Add a little context.</h2><p>Import your LinkedIn archive, resume, or mailbox.</p><button className="button primary" onClick={() => onTab("Things you've learned")}>Import sources<ArrowRight size={16}/></button></section> : <>
        {archive ? <section className="profile-overview gradient-card"><div className="section-heading"><p className="eyebrow">{name ? `${name} · Your sources` : 'What your sources hold'}</p>{archive && <span className="muted small">Imported {formatDate(archive.layer1.importedAt)}</span>}</div><div className="source-counts"><div className="source-orb primary-orb"><strong>{props.connectionCount.toLocaleString()}</strong><span>imported connections</span></div><div className="source-orb coral-orb"><strong>{archive.writingSamples.length}</strong><span>own writing samples</span></div><div className="source-orb pale-orb"><strong>{archive?.counts.positions || 0}</strong><span>recorded positions</span></div><div className="source-orb green-orb"><strong>{archive.counts.skills}</strong><span>recorded skills</span></div></div><p className="muted small">From your LinkedIn archive.</p></section> : <section className="panel content-panel"><h2>Your saved sources</h2>{resume && <p>Resume · {resume.pages} pages</p>}{mailbox && <p>Mailbox · {mailbox.summary.counts.messages.toLocaleString()} messages · {mailbox.samples.length} own writing samples</p>}</section>}
        {Boolean(archive?.layer1.positions.length) && <section className="panel content-panel"><p className="eyebrow">Career history</p><div className="career-facts">{archive!.layer1.positions.map((position, index) => <article key={index}><span className="career-dot"/><div><h3>{position.Title || position.Position || 'Position in your archive'}</h3><p>{position['Company Name'] || position.Company || ''}</p>{(position['Started On'] || position['Finished On']) && <small>{[position['Started On'], position['Finished On']].filter(Boolean).join(' — ')}</small>}</div></article>)}</div></section>}
        {resume && <section className="panel content-panel"><div className="section-heading"><h2>Your resume</h2><span className="pill neutral">{resume.pages} pages</span></div><details className="source-details"><summary>Read the imported text</summary><p className="preserve-text">{resume.text}</p></details></section>}
        <button className="text-button" onClick={() => onTab("Things you've learned")}>Manage sources<ArrowRight size={14}/></button>
      </>)}
      {tab === 'Goal' && (props.goalsPanel || <section className="panel content-panel goal-editor"><p>What do you want to achieve, and who could help?</p><form onSubmit={event => {event.preventDefault(); void props.onSaveStrategy();}}><label htmlFor="goal">Your goal</label><textarea id="goal" value={strategy} onChange={event => props.onStrategy(event.target.value)} rows={7} maxLength={16000} placeholder="I want to meet product leaders building useful tools for…"/><div className="row-actions"><button className="button primary" disabled={busy}>Save goal</button><button type="button" className="button secondary" onClick={props.onExplore}>Explore your network</button></div><p className="muted small">Your words are saved on this device as you type.</p></form></section>)}
      {tab === "Things you've learned" && <><div className="source-grid">
        <section className="panel source-card"><span className="source-icon"><Users size={22}/></span><h2>LinkedIn archive</h2><p>{archive ? `${archive.counts.connections.toLocaleString()} connections · ${archive.counts.positions} positions · ${archive.counts.threads.toLocaleString()} threads` : 'Connections and career history.'}</p><p className="muted small">Your archive includes other people’s messages. Received bodies are discarded before saving.</p><FileButton label="Choose archive ZIP" accept=".zip" disabled={busy} onFile={props.onArchive}/><button className="text-button" disabled={busy || !uid} onClick={() => void props.onRebuild()}>Rebuild from my archive</button></section>
        <section className="panel source-card"><span className="source-icon coral"><FileText size={22}/></span><h2>Resume</h2><p>{resume ? `${resume.pages} pages read. Original facts preserved.` : 'A PDF with selectable text.'}</p><FileButton label="Choose resume PDF" accept=".pdf,application/pdf" disabled={busy} onFile={props.onResume}/></section>
        <section className="panel source-card"><span className="source-icon coral"><Mail size={22}/></span><h2>Mailbox</h2><p>Your Google Takeout .mbox file.</p><p className="muted small">The mailbox stays on this device. Only tallies and up to forty samples of your own writing can be saved.</p><label htmlFor="mailbox-addresses">Your email address or aliases</label><input id="mailbox-addresses" value={props.ownEmail} onChange={event => props.onOwnEmail(event.target.value)} placeholder="me@example.com" autoComplete="email"/><FileButton label="Choose mailbox" accept=".mbox" disabled={busy} onFile={props.onMailbox}/>{mailbox && <p className="muted small">{mailbox.summary.counts.messages.toLocaleString()} messages · {mailbox.summary.globalMetrics.bidirectionalContacts.toLocaleString()} two-way contacts · {mailbox.samples.length} own writing samples</p>}</section>

      </div><section className="gradient-card save-sources"><div><h2>Save your sources</h2><p>Save processed sources to your account.</p></div><button className="button primary" disabled={busy || !hasSources} onClick={() => void props.onSync()}><Upload size={16}/>Save to account</button></section><details className="source-details privacy-details"><summary>What gets saved?</summary><p>Your connections, career facts, resume text, mailbox tallies, and up to forty samples of your own writing per import. Received message bodies are excluded; the raw mailbox is never uploaded.</p><p>Account data is private to you, encrypted at rest, and deletable on request.</p></details></>}
      {tab === 'Settings' && <>
        {props.accountPanel}
        <details className="panel content-panel billing-details"><summary>AI usage</summary><p>AI-generated drafts use Assists. Saving people and notes is free.</p></details>
        <section className="panel content-panel extension-settings"><h2>LinkedIn extension</h2><p>See how someone fits your goals while viewing their LinkedIn profile. Save them to Mighty, or Skip.</p><a className="button primary" href={`${import.meta.env.BASE_URL || "/"}downloads/mighty-extension.zip`} download><Download size={16}/>Download extension</a><ol className="setup-steps"><li>Unzip the download.</li><li>In Chrome, open Extensions and enable Developer mode.</li><li>Choose Load unpacked and select the unzipped folder.</li><li>Open the Mighty extension, choose Connect to Mighty, then approve the connection here.</li></ol><p className="muted small">Updating? Replace the files in your existing extension folder, click Reload on Mighty’s Extensions card, then refresh LinkedIn.</p><p className="muted small">The panel stays closed on your own profile, the feed, articles and search pages. On a people search, click the toolbar icon to choose up to five.</p><label htmlFor="extension-id">Extension ID</label><input id="extension-id" value={props.extensionId} onChange={event => props.onExtensionId(event.target.value.trim())} placeholder="Copy the ID from Chrome’s Extensions page" autoComplete="off"/><p className="extension-status" role="status"><span className="status-dot"/>{props.extensionStatus}</p></section>
      </>}
    </div>
  </>;
}

function FileButton({label, accept, disabled, onFile}: {label: string; accept: string; disabled: boolean; onFile: (file: File) => Promise<void>}) {
  return <label className={`button secondary file-button ${disabled ? 'disabled' : ''}`}><Upload size={15}/>{label}<input type="file" accept={accept} disabled={disabled} aria-label={label} onChange={event => {const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = '';}}/></label>;
}
