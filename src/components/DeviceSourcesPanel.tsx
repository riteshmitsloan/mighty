import {useEffect, useRef, useState} from 'react';
import {localSources} from '../lib/local-sources';
import {HANDOFF_FIELDS, prepareDeviceHandoff, type HandoffField, type HandoffPreview} from '../lib/owner-handoff';
import type {LocalSources} from '../lib/workspace';

type Props = {uid: string; busy: boolean; onCopy: (preview: HandoffPreview) => Promise<boolean>};
const names: Record<HandoffField, string> = {archive: 'LinkedIn archive', resume: 'Resume', mailbox: 'Mailbox', strategy: 'Goal'};
function labels(sources: LocalSources): Partial<Record<HandoffField, string>> {
  const result: Partial<Record<HandoffField, string>> = {};
  if (sources.archive) result.archive = `${sources.archive.counts.connections.toLocaleString()} connections`;
  if (sources.resume) result.resume = `${sources.resume.pages.toLocaleString()} pages`;
  if (sources.mailbox) result.mailbox = `${sources.mailbox.summary.counts.messages.toLocaleString()} messages`;
  if (typeof sources.strategy === 'string') result.strategy = sources.strategy.length ? `${sources.strategy.length.toLocaleString()} characters` : 'Empty goal';
  return result;
}
export default function DeviceSourcesPanel({uid, busy, onCopy}: Props) {
  const [available, setAvailable] = useState<Partial<Record<HandoffField, string>> | null>(null);
  const [selected, setSelected] = useState<HandoffField[]>([]);
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false), generation = useRef(0), identity = useRef(uid);
  identity.current = uid;
  useEffect(() => {
    generation.current++; lock.current = false;
    setAvailable(null); setSelected([]); setPreview(null); setPending(false); setNotice('');
    return () => {generation.current++;};
  }, [uid]);
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (busy || lock.current || !uid) return;
    lock.current = true; setPending(true); setNotice('');
    const version = generation.current, account = uid;
    const current = () => generation.current === version && identity.current === account;
    try {await action(current);}
    catch (error) {if (current()) setNotice(error instanceof Error ? error.message : 'The device files could not be reviewed. Try again.');}
    finally {if (current()) {lock.current = false; setPending(false);}}
  }
  const review = () => run(async current => {
    setPreview(null);
    const found = labels(await localSources('device-draft'));
    if (!current()) return;
    const fields = available === null ? HANDOFF_FIELDS.filter(field => found[field] !== undefined) : selected;
    setAvailable(found); setSelected([...fields]);
    if (!fields.length) {setNotice(Object.keys(found).length ? 'Choose at least one item.' : 'No files or goal from before sign-in are available in this browser.'); return;}
    const result = await prepareDeviceHandoff(uid, fields);
    if (current()) setPreview(result);
  });
  const copy = () => run(async current => {
    if (!preview || preview.destinationUid !== uid || preview.conflicts.length) return;
    const copied = await onCopy(preview);
    if (current()) {setPreview(null); setNotice(copied ? 'Selected files are available in this account on this device.' : 'Files were not copied. Review your selection and try again.');}
  });
  function toggle(field: HandoffField) {
    if (busy || lock.current) return;
    setSelected(fields => fields.includes(field) ? fields.filter(value => value !== field) : [...fields, field]);
    setPreview(null); setNotice('');
  }
  const disabled = busy || pending;
  const visible = HANDOFF_FIELDS.filter(field => available?.[field] !== undefined || selected.includes(field));
  return <section className="panel content-panel device-sources-panel">
    <h2>Files from before sign-in</h2>
    <p>Use these files in this account on this device. Nothing is uploaded.</p>
    {available !== null && visible.length > 0 && <fieldset disabled={disabled}><legend>Choose what to use</legend>{visible.map(field => <label key={field}><input type="checkbox" checked={selected.includes(field)} onChange={() => toggle(field)}/><span>{names[field]} · {available?.[field] ?? 'No longer available'}</span></label>)}</fieldset>}
    {Boolean(preview?.conflicts.length) && <div role="status"><p>Deselect conflicting items to continue.</p><ul>{preview!.conflicts.map((conflict, index) => <li key={`${conflict.field}-${index}`}>{names[conflict.field]}: {conflict.reason === 'missing-source' ? 'no longer available on this device.' : conflict.location === 'local-account' ? 'this account already has a different version on this device.' : 'a different version is already saved to this account.'}</li>)}</ul></div>}
    <div className="row-actions"><button type="button" className="button secondary" disabled={disabled || (available !== null && visible.length > 0 && !selected.length)} onClick={() => void review()}>{pending ? 'Working…' : available === null || !visible.length ? 'Review device files' : 'Review selection'}</button>{preview && <button type="button" className="button primary" disabled={disabled || Boolean(preview.conflicts.length)} onClick={() => void copy()}>Use selected files</button>}</div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
