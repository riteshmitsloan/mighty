import type {LocalSources} from './workspace';

export const HANDOFF_FIELDS = ['archive', 'resume', 'mailbox', 'strategy'] as const;
export type HandoffField = typeof HANDOFF_FIELDS[number];
export type SourceFingerprints = Partial<Record<HandoffField, string>>;
export interface RemoteHandoffSources {
  archive: readonly string[];
  resume: readonly string[];
  mailbox: readonly string[];
  strategy?: string;
}
export interface HandoffConflict {
  field: HandoffField;
  location: 'device' | 'local-account' | 'account';
  reason: 'missing-source' | 'different-source';
}
export interface HandoffPreview {
  readonly destinationUid: string;
  readonly fields: readonly HandoffField[];
  readonly fingerprint: string;
  readonly sourceFingerprints: Readonly<SourceFingerprints>;
  readonly conflicts: readonly HandoffConflict[];
}
export interface PinnedHandoffCopy {
  readonly destinationUid: string;
  readonly fields: readonly HandoffField[];
  readonly fingerprint: string;
  /** Use these captured values and destinationUid for a later explicit account save. */
  readonly snapshot: Readonly<LocalSources>;
}
export interface DeviceCopyRequest {
  destinationUid: string;
  fields: readonly HandoffField[];
  expectedDevice: LocalSources;
  expectedAccount: LocalSources;
}
export interface HandoffDependencies {
  verifyAccount(uid: string): Promise<unknown>;
  readLocal(key: string): Promise<LocalSources>;
  readRemote(uid: string): Promise<RemoteHandoffSources>;
  copyLocal(request: DeviceCopyRequest): Promise<LocalSources>;
  fingerprint(value: unknown): Promise<string>;
}
export class HandoffConflictError extends Error {
  constructor(readonly conflicts: readonly HandoffConflict[]) {
    super('Selected device sources conflict with existing account sources. Keep the account sources or choose fewer device sources.');
    this.name = 'HandoffConflictError';
  }
}

/** This helper is deliberately never connected to an auth-state event. */
export function createDeviceHandoff(dependencies: HandoffDependencies) {
  const plans = new WeakMap<HandoffPreview, {device: LocalSources}>();
  const fieldsFor = (fields: readonly HandoffField[]) => {
    if (!fields.length || fields.some(field => !HANDOFF_FIELDS.includes(field)) || new Set(fields).size !== fields.length) {
      throw new TypeError('Choose one or more distinct device sources.');
    }
    return [...fields];
  };
  async function fingerprints(sources: LocalSources, fields: readonly HandoffField[]): Promise<SourceFingerprints> {
    const result: SourceFingerprints = {};
    for (const field of fields) {
      if (sources[field] === undefined) continue;
      if (field === 'archive' || field === 'resume') {
        const value = sources[field]?.fingerprint;
        if (!value) throw new Error(`The selected ${field} has no content fingerprint. Re-import it before copying.`);
        result[field] = value;
      } else if (field === 'mailbox') {
        result.mailbox = await dependencies.fingerprint({...sources.mailbox!.summary, writingSamples:sources.mailbox!.samples});
      } else result.strategy = await dependencies.fingerprint(sources.strategy);
    }
    return result;
  }
  async function conflictsFor(device: LocalSources, account: LocalSources, remote: RemoteHandoffSources, fields: readonly HandoffField[]) {
    const [source, existing] = await Promise.all([fingerprints(device, fields), fingerprints(account, fields)]);
    const conflicts: HandoffConflict[] = [];
    for (const field of fields) {
      if (source[field] === undefined) { conflicts.push({field, location:'device', reason:'missing-source'}); continue; }
      if (existing[field] !== undefined && existing[field] !== source[field]) {
        conflicts.push({field, location:'local-account', reason:'different-source'});
      }
      if (field === 'strategy') {
        if (remote.strategy?.trim() && remote.strategy !== device.strategy) conflicts.push({field, location:'account', reason:'different-source'});
      } else if (remote[field].length && !remote[field].includes(source[field]!)) {
        conflicts.push({field, location:'account', reason:'different-source'});
      }
    }
    return {source, conflicts};
  }
  async function prepare(destinationUid: string, selected: readonly HandoffField[]): Promise<HandoffPreview> {
    if (!destinationUid || destinationUid === 'device-draft') throw new TypeError('Choose a verified account destination.');
    const fields = fieldsFor(selected);
    await dependencies.verifyAccount(destinationUid);
    const [device, account, remote] = await Promise.all([
      dependencies.readLocal('device-draft'), dependencies.readLocal(destinationUid), dependencies.readRemote(destinationUid),
    ]);
    const {source, conflicts} = await conflictsFor(device, account, remote, fields);
    const fingerprint = await dependencies.fingerprint({destinationUid, fields, sources:source});
    await dependencies.verifyAccount(destinationUid);
    const preview: HandoffPreview = Object.freeze({
      destinationUid, fields:Object.freeze(fields), fingerprint,
      sourceFingerprints:Object.freeze(source), conflicts:Object.freeze(conflicts.map(conflict => Object.freeze(conflict))),
    });
    plans.set(preview, {device:structuredClone(Object.fromEntries(fields.map(field => [field, device[field]])))});
    return preview;
  }
  async function copy(preview: HandoffPreview): Promise<PinnedHandoffCopy> {
    const prepared = plans.get(preview);
    if (!prepared) throw new Error('Prepare the device-source copy again before continuing.');
    if (preview.conflicts.length) throw new HandoffConflictError(preview.conflicts);
    const uid = preview.destinationUid;
    await dependencies.verifyAccount(uid);
    const [device, account, remote] = await Promise.all([
      dependencies.readLocal('device-draft'), dependencies.readLocal(uid), dependencies.readRemote(uid),
    ]);
    const {source, conflicts} = await conflictsFor(device, account, remote, preview.fields);
    const currentFingerprint = await dependencies.fingerprint({destinationUid:uid, fields:preview.fields, sources:source});
    if (currentFingerprint !== preview.fingerprint) throw new Error('The device sources changed. Review the copy again.');
    if (conflicts.length) throw new HandoffConflictError(conflicts);
    await dependencies.verifyAccount(uid);
    // The native transaction rechecks the exact selected device/account fields,
    // closing the read-then-write race without replacing an existing source.
    const snapshot = await dependencies.copyLocal({destinationUid:uid, fields:preview.fields, expectedDevice:prepared.device, expectedAccount:account});
    await dependencies.verifyAccount(uid);
    return Object.freeze({destinationUid:uid, fields:preview.fields, fingerprint:preview.fingerprint, snapshot:structuredClone(snapshot)});
  }
  return {prepare, copy};
}
