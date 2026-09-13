import test from 'node:test';
import assert from 'node:assert/strict';
import {toolbarState} from '../src/toolbar.js';
import {accountGoalContext} from '../src/goal-context.js';
import type {Session} from '../src/types.js';

const owner = '11111111-1111-4111-a111-111111111111';
const now = Date.parse('2026-09-13T12:00:00Z');
const account: Session = {userId: owner, accessToken: 'never-display-this-token', expiresAt: now + 60_000, strategy: '', goalContext: accountGoalContext(owner, [], new Date(now).toISOString())};
test('verified account with an empty but successfully loaded goal set is colored and needs no warning', () => {
  const result = toolbarState(account, now);
  assert.match(result.path['16'], /mighty-connected/);
  assert.equal(result.badge, '');
  assert.match(result.title, /account connected/);
  assert.doesNotMatch(JSON.stringify(result), /never-display-this-token|11111111/);
});
test('goal failure retains a colored identity indicator and has a separate warning', () => {
  const result = toolbarState({...account, goalContext: undefined}, now);
  assert.match(result.path['32'], /mighty-connected/);
  assert.equal(result.badge, '!');
  assert.match(result.title, /goals unavailable/);
});
test('sign-out and near-expiry cannot display a usable connection', () => {
  for (const value of [null, {...account, expiresAt: now + 5000}, {...account, expiresAt: now - 1}]) {
    const result = toolbarState(value, now);
    assert.match(result.path['48'], /mighty-disconnected/);
    assert.equal(result.expiresAt, null);
    assert.equal(result.badge, '');
  }
});
