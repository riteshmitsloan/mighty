import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountLoginLabel, ownerLinkRequest, privatePasswordRequest, signInPrivateAccount, type OwnerAuthClient} from '../src/lib/owner-auth';

test('private IDs map consistently to the reserved account namespace, while real emails retain their address', () => {
  assert.deepEqual(privatePasswordRequest('  JaYaTi  ', ' fixture password '), {email: 'jayati@accounts.mighty.invalid', password: ' fixture password '});
  assert.equal(privatePasswordRequest('TeAm_2-name', 'fixture').email, 'team_2-name@accounts.mighty.invalid');
  assert.equal(privatePasswordRequest('JAYATI@ACCOUNTS.MIGHTY.INVALID', 'fixture').email, 'jayati@accounts.mighty.invalid');
  assert.equal(privatePasswordRequest(' Owner+test@example.test ', 'fixture').email, 'Owner+test@example.test');
});

test('malformed IDs, invalid emails and missing or oversized passwords fail before auth dispatch', async () => {
  let calls = 0;
  const client = {auth: {signInWithPassword: async () => {calls++; return {error: null};}}} as OwnerAuthClient;
  for (const identifier of ['', 'ab', '1jayati', 'jay ati', 'jay.ati', '../jayati', 'jayati@', '<jayati>@example.test', 'a'.repeat(33), 'jаyati', 'x@accounts.mighty.invalid']) {
    await assert.rejects(signInPrivateAccount(client, identifier, 'fixture'));
  }
  for (const password of ['', 'x'.repeat(1025)]) await assert.rejects(signInPrivateAccount(client, 'jayati', password));
  assert.equal(calls, 0);
});

test('password sign-in makes one existing-account request with no signup or mail action', async () => {
  let calls = 0;
  const client: OwnerAuthClient = {auth: {
    signInWithPassword: async request => {calls++; assert.deepEqual(request, {email: 'jayati@accounts.mighty.invalid', password: 'synthetic-fixture'}); return {error: null};},
    signInWithOtp: async () => {throw Error('No email request allowed');},
    signOut: async () => {throw Error('No signout request allowed');},
  }};
  await signInPrivateAccount(client, 'Jayati', 'synthetic-fixture');
  assert.equal(calls, 1);
});

test('returned, thrown and rejected provider errors use the same message without account-state disclosure', async () => {
  const expected = 'Could not sign in. Check your login ID or email and password, then try again.';
  for (const invoke of [async () => ({error: {message: 'Email not confirmed: private-fixture', status: 400}}), () => {throw Error('private-fixture');}, () => Promise.reject(Error('private-fixture'))]) {
    const client = {auth: {signInWithPassword: invoke}} as OwnerAuthClient;
    await assert.rejects(signInPrivateAccount(client, 'jayati', 'fixture'), error => error instanceof Error && error.message === expected);
  }
});

test('internal login identities are never represented as deliverable email links', () => {
  for (const email of ['jayati@accounts.mighty.invalid', 'JAYATI@ACCOUNTS.MIGHTY.INVALID', 'someone@example.invalid']) {
    assert.throws(() => ownerLinkRequest(email, 'https://riteshmitsloan.github.io/mighty/'), /cannot receive email links/);
  }
  assert.equal(accountLoginLabel('jayati@accounts.mighty.invalid'), 'Login ID: jayati');
  assert.equal(accountLoginLabel('owner@example.test'), 'owner@example.test');
});
