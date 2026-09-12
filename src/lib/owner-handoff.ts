import {db, accountId} from './platform';
import {localSources, copyDeviceSources} from './local-sources';
import {readAllById} from './data-access';
import {contentFingerprint} from './text';
import {createDeviceHandoff, type RemoteHandoffSources} from './device-handoff';

async function remoteSources(uid: string): Promise<RemoteHandoffSources> {
  await accountId(uid);
  const [sources, settings] = await Promise.all([
    readAllById<{id:string;source:string;fingerprint:string}>(db!, 'knowledge_sources', 'id,source,fingerprint', uid),
    db!.from('settings').select('data').eq('user_id', uid).maybeSingle(),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  await accountId(uid);
  const result: RemoteHandoffSources = {archive:[], resume:[], mailbox:[]};
  for (const source of sources) {
    if (source.source === 'archive' || source.source === 'resume' || source.source === 'mailbox') {
      (result[source.source] as string[]).push(source.fingerprint);
    }
  }
  if (typeof settings.data?.data?.strategy === 'string' && settings.data.data.strategy.trim()) result.strategy = settings.data.data.strategy;
  return result;
}

// Constructing this helper performs no reads, copies, uploads, or sign-in work.
// Call prepare and copy only from explicit user actions in the connected UI.
const handoff = createDeviceHandoff({
  verifyAccount:accountId,
  readLocal:localSources,
  readRemote:remoteSources,
  copyLocal:copyDeviceSources,
  fingerprint:contentFingerprint,
});
export const prepareDeviceHandoff = handoff.prepare;
export const copyDeviceHandoff = handoff.copy;
export {HandoffConflictError, HANDOFF_FIELDS} from './device-handoff';
export type {HandoffField, HandoffPreview, PinnedHandoffCopy} from './device-handoff';
