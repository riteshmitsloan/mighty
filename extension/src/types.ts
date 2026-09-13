import type {AccountGoalContext} from './goal-context.js';
import type {CurrentExperience} from '../../src/lib/current-experience';
export const PROTOCOL=1;
export type AnchorKind='headline'|'location'|'about'|'experience'|'education'|'skills'|'languages'|'certifications'|'activity'|'timing';
export type Anchor={kind:AnchorKind;text:string;sourceUrl:string;observedAt:string;field?:'role'|'company';currentExperience?:CurrentExperience};
export type Profile={profileUrl:string;name:string;photoUrl?:string;anchors:Anchor[];profileReadAt:string|null;truncated:boolean;truncationReasons:string[];missingSections?:AnchorKind[]};
export type SearchResult={profileUrl:string;name:string;photoUrl?:string;subtitle:string;profileReadAt:null;truncated:boolean};
export type PageState='ready'|'empty'|'blocked'|'auth_required'|'unknown';
export type PageSnapshot={kind:'profile';state:PageState;profile:Profile|null;message:string}|{kind:'search';state:PageState;results:SearchResult[];message:string;pageUrl?:string}|{kind:'unsupported';state:'unknown';message:string};
export type GoalFit={reason:string;label:'Goal overlap'|'Possible goal overlap'|'No clear goal overlap'|'Not enough context';evidence:Anchor[]};
/** appOrigins preserves the legacy config name; entries include an optional app base path. */
export type PublicConfig={appOrigins:string[];supabaseUrl:string;publishableKey:string};
export type Session={userId:string;accessToken:string;expiresAt:number;strategy:string;goalContext?:AccountGoalContext};
export type SaveInput={operationId:string;userId:string;profile:Profile;source:'rendered_profile'|'search_result'};
export type PendingSave=SaveInput&{queuedAt:string};
