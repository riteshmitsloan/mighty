import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import DeviceGoalsPanel from '../src/components/DeviceGoalsPanel';
import {createDeviceGoalHandoff, mergeDeviceGoalCopy, deviceGoalDestinationId, type DeviceGoalHandoff} from '../src/lib/device-goals';
import {createGoal, reviseGoal, type GoalWorkspace} from '../src/lib/goals';
import type {GoalRecord} from '../src/lib/goal-store';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const props = (element: Element) => (element as any)[Object.keys(element).find(key => key.startsWith('__reactProps$'))!];
const button = (name: string) => [...document.querySelectorAll('button')].find(e => e.textContent === name)!;
let pendingReview: Promise<Awaited<ReturnType<DeviceGoalHandoff['prepare']>>> | undefined;
async function settleReview() {try {await pendingReview;} catch {/* The panel owns the visible error. */}}
async function click(name: string) {await act(async () => {assert.ok(button(name), name); pendingReview = undefined; props(button(name)).onClick(); await settleReview(); await tick();});}
let root: Root, uid: string, handoff: DeviceGoalHandoff, busy: boolean, device: GoalWorkspace, account: GoalRecord | undefined, reads: number, writes: number, copied: GoalWorkspace[];
async function render() {await act(async () => {root.render(React.createElement(DeviceGoalsPanel, {uid, busy, handoff, onCopied: value => {copied.push(value);}})); await tick();});}
beforeEach(() => {
  const {window} = parseHTML('<html><body><div id="root"></div></body></html>'); Object.assign(globalThis, {window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
  root = createRoot(document.getElementById('root')!); uid = 'owner-a'; busy = false; reads = 0; writes = 0; copied = []; account = undefined; pendingReview = undefined;
  const goal = createGoal({kind: 'career', title: 'Private device goal', outcome: 'My private career direction'}); device = {goals: [goal], activeGoalId: goal.id};
  const actual = createDeviceGoalHandoff({verifyAccount: async expected => {assert.equal(expected, uid);}, readLocal: async key => {reads++; return key === 'device-draft' ? device : account?.workspace ?? null;},
    readRemote: async () => [], copyLocal: async request => {account = mergeDeviceGoalCopy(request, device, account); writes++; return account.workspace;}});
  handoff = {...actual, prepare(uid, ids) {pendingReview = actual.prepare(uid, ids); return pendingReview;}};
});
afterEach(async () => {await act(async () => root.unmount());});
test('mount and account changes do not read or reveal device goals', async () => {
  await render(); uid = 'owner-b'; await render(); assert.equal(reads, 0); assert.equal(writes, 0); assert.doesNotMatch(document.body.textContent!, /Private device goal/);
});
test('review shows the concrete goals and a separate copy action writes once without cloud saving', async () => {
  await render(); await click('Review device goals'); assert.match(document.body.textContent!, /Private device goal/); assert.equal(writes, 0);
  await act(async () => {const handler = props(button('Copy selected goals')).onClick; handler(); handler(); await tick();});
  assert.equal(writes, 1); assert.equal(copied.length, 1); assert.equal(account!.workspace.goals[0].id, await deviceGoalDestinationId(uid, device.goals[0].id));
  assert.notEqual(account!.workspace.goals[0].id, device.goals[0].id);
  assert.match(document.body.textContent!, /Save a goal to sync/);
});
test('a selected conflict is visible and cannot be forced through the disabled copy control', async () => {
  const conflict = reviseGoal({...device.goals[0], id: await deviceGoalDestinationId(uid, device.goals[0].id)}, {outcome: 'Different account version'}); account = {workspace: {goals: [conflict], activeGoalId: conflict.id}, baselines: {}, conflicts: {}};
  await render(); await click('Review device goals'); assert.match(document.body.textContent!, /versions differ/); assert.equal(button('Copy selected goals').disabled, true);
  await click('Copy selected goals'); assert.equal(writes, 0); assert.equal(account.workspace.goals[0].outcome, conflict.outcome);
});
test('selection edits invalidate the reviewed copy and busy state prevents reads', async () => {
  busy = true; await render(); await click('Review device goals'); assert.equal(reads, 0); busy = false; await render(); await click('Review device goals');
  await act(async () => {props(document.querySelector('input')!).onChange(); await tick();}); assert.equal(button('Copy selected goals'), undefined); assert.equal(button('Review selected goals').disabled, true);
});
test('a delayed private review is ignored after an account changes and returns to the same identity', async () => {
  let resolve!: (value: Awaited<ReturnType<DeviceGoalHandoff['prepare']>>) => void; const pending = new Promise<Awaited<ReturnType<DeviceGoalHandoff['prepare']>>>(yes => {resolve = yes;});
  const actual = handoff; const preview = await actual.prepare(uid); reads = 0; handoff = {...actual, prepare: async () => pending};
  await render(); await click('Review device goals'); uid = 'owner-b'; await render(); uid = 'owner-a'; await render();
  await act(async () => {resolve(preview); await tick();}); assert.doesNotMatch(document.body.textContent!, /Private device goal/); assert.equal(button('Copy selected goals'), undefined);
});
