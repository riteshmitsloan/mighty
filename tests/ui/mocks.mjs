// Only App's external boundaries are stubbed. Discover matching, React state and
// the rendered components use their real implementation. Fixtures are installed
// by app.test.cjs and never reach network calls or account storage.
const state = 'const state = () => globalThis.__MIGHTY_UI_TEST__;';

export const appDependencyStubs = {
  './lib/goal-local-update': `${state}
    const records=()=>state().goalRecords??=(new Map());
    export class LocalGoalChangedError extends Error {}
    const upsert=async(key,goal)=>{const old=records().get(key)??{goals:[],activeGoalId:null};const next={goals:old.goals.some(g=>g.id===goal.id)?old.goals.map(g=>g.id===goal.id?goal:g):[...old.goals,goal],activeGoalId:old.activeGoalId??goal.id};records().set(key,next);return next;};
    export const saveLocalGoal=upsert;
    export const addLocalGoal=upsert;
    export const selectLocalGoal=async(key,id)=>{const next={...records().get(key),activeGoalId:id};records().set(key,next);return next;};
  `,
  './lib/device-goals': `export const deviceGoalHandoff={prepare:async()=>({goals:[],conflicts:[]}),copy:async()=>({goals:[],activeGoalId:null})};`,
  './lib/relationship-context': `${state}
    export const normalizeCandidateObservation=value=>({...value,goalId:value.goalId??null});
    export const normalizeGoalInteraction=value=>({...value,goalId:value.goalId??null,goalVersion:value.goalVersion??null,dueAt:value.dueAt??null});
    export const listRelationshipContext=async()=>({observations:[],drafts:[],events:[]});
    export const observationsToClaims=()=>[];
    export const saveCandidateObservation=async()=>{throw Error('Unexpected observation save in this fixture.');};
    export const recordGoalInteraction=async()=>{throw Error('Unexpected interaction in this fixture.');};
    export const saveMessageDraft=async()=>{throw Error('Unexpected draft save in this fixture.');};
  `,
  './lib/goal-store': `${state}
    const records=()=>state().goalRecords??=(new Map());
    export class GoalConflictError extends Error {}
    export const readGoalWorkspace=async key=>records().get(key)??null;
    export const saveGoalWorkspace=async(key,workspace)=>{records().set(key,workspace);(state().goalWrites??=[]).push({key,workspace});};
    export const loadAccountGoals=async key=>records().get(key)??{goals:[],activeGoalId:null};
    export const readGoalSyncState=async()=>({versions:{},conflicts:[]});
    export const saveAccountGoal=async(uid,goal)=>state().saveAccountGoal?state().saveAccountGoal(uid,goal):goal;
    export const resolveGoalConflict=async()=>{};
  `,
  './lib/platform': `${state}
    export const authCallbackNotice = null;
    export const db = {
      auth: {
        getSession: async () => ({
          data: {session: state().uid ? {user: {id: state().uid}} : null},
          error: null,
        }),
        onAuthStateChange: listener => {
          state().authListeners.add(listener);
          return {data: {subscription: {
            unsubscribe: () => state().authListeners.delete(listener),
          }}};
        },
      },
      from: () => ({select: () => ({eq: () => ({
        maybeSingle: () => state().settings(),
      })})}),
    };
    export const gatewayForAccount = uid => request => state().gateway(uid, request);
    export const saveSettings = (patch, uid) => state().saveSettings(patch, uid);
  `,
  './lib/workspace': `${state}
    export const localSources = key => state().localSources(key);
    export const keepLocal = async (key, patch) => {
      state().localWrites.push({key, patch});
    };
    export const allConnections = uid => state().allConnections(uid);
    export const accountSources = async () => ({});
    export const readRelationships = uid => state().readRelationships(uid);
    export const savePerson = (uid, input) => state().savePerson(uid, input);
    export const capture = (...args) => state().capture(...args);
    export const changeStage = async () => {};
    export const archiveConnections = archive => (archive?.connections || []).map(person => ({
      person: person.firstName + ' ' + person.lastName,
      profile_url: person.url,
      company: person.company,
      position: person.position,
    }));
    export const saveArchive = async () => {};
    export const saveResume = async () => {};
    export const saveMailbox = async () => {};
    export const savedArchiveBlob = async () => new Blob();
    export const synthesizer = () => async () => {};
  `,
  './lib/archive': `${state}
    export const readLinkedInArchive = (file, options) => state().readArchive(file, options);
  `,
  './lib/resume': `${state}
    export const extractResumePdf = (file, options) => state().readResume(file, options);
  `,
  './lib/inbox': 'export const watchInbox = () => () => {};',
  './lib/local-sources': `${state} export const localSources=key=>state().localSources(key);`,
  './lib/owner-handoff': `${state}
    export const HANDOFF_FIELDS=['archive','resume','mailbox','strategy'];
    export const prepareDeviceHandoff=(...args)=>state().prepareHandoff(...args);
    export const copyDeviceHandoff=(...args)=>state().copyHandoff(...args);
  `,
  './lib/extension-bridge': 'export const startExtensionBridge = () => ({dispose() {}, sync() {}});',
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url': 'export default "unused-test-worker";',
};
