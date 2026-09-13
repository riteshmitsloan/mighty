export type OwnerLinkRequest = {
  email: string;
  options: {shouldCreateUser: false; emailRedirectTo: string};
};
type AuthResult = {error: {message: string; status?: number} | null};
export type PrivatePasswordRequest = {email: string; password: string};
export type OwnerAuthClient = {auth: {
  signInWithOtp: (request: OwnerLinkRequest) => Promise<AuthResult>;
  signInWithPassword: (request: PrivatePasswordRequest) => Promise<AuthResult>;
  signOut: (options: {scope: 'local'}) => Promise<AuthResult>;
}};

const PRIVATE_ACCOUNT_DOMAIN = 'accounts.mighty.invalid';
const LOGIN_ID = /^[a-z][a-z0-9_-]{2,31}$/;
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u;
const PASSWORD_FAILURE = 'Could not sign in. Check your login ID or email and password, then try again.';

/** Login IDs are provisioned by an administrator, never created by this mapping. */
export function privatePasswordRequest(identifier: string, password: string): PrivatePasswordRequest {
  const normalized = identifier.trim();
  let email: string;
  if (normalized.includes('@')) {
    if (normalized.length > 254 || !EMAIL.test(normalized)) throw Error('Enter a valid login ID or email.');
    const [local, domain] = normalized.split('@');
    if (domain.toLowerCase() === PRIVATE_ACCOUNT_DOMAIN) {
      if (!LOGIN_ID.test(local.toLowerCase())) throw Error('Enter a valid login ID or email.');
      email = `${local.toLowerCase()}@${PRIVATE_ACCOUNT_DOMAIN}`;
    } else email = normalized;
  } else {
    const loginId = normalized.toLowerCase();
    if (!LOGIN_ID.test(loginId)) throw Error('Use a login ID with 3–32 letters, numbers, underscores or hyphens, starting with a letter.');
    email = `${loginId}@${PRIVATE_ACCOUNT_DOMAIN}`;
  }
  // Do not trim passwords or persist them in application storage.
  if (!password || password.length > 1024) throw Error('Enter your password (up to 1,024 characters).');
  return {email, password};
}

export async function signInPrivateAccount(client: OwnerAuthClient, identifier: string, password: string): Promise<void> {
  const request = privatePasswordRequest(identifier, password);
  try {
    const {error} = await client.auth.signInWithPassword(request);
    if (error) throw Error(PASSWORD_FAILURE);
  } catch {
    // Provider messages may reveal account state or contain untrusted details.
    throw Error(PASSWORD_FAILURE);
  }
}

export function accountLoginLabel(email: string): string {
  const [local, domain] = email.split('@');
  return domain?.toLowerCase() === PRIVATE_ACCOUNT_DOMAIN && LOGIN_ID.test(local.toLowerCase())
    ? `Login ID: ${local.toLowerCase()}` : email;
}

/** Accept only a trusted current-page URL; never pass a query-string redirect. */
export function ownerLinkRequest(email: string, currentUrl: string): OwnerLinkRequest {
  const normalized = email.trim();
  if (normalized.length > 254 || !EMAIL.test(normalized)) {
    throw Error('Enter a valid email address.');
  }
  if (normalized.split('@')[1].toLowerCase().endsWith('.invalid')) {
    throw Error('Login IDs use password sign-in and cannot receive email links.');
  }
  const url = new URL(currentUrl);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw Error('Sign in from the secure Mighty site or the local app.');
  }
  let appBase = `${url.origin}/`;
  if (url.hostname === 'riteshmitsloan.github.io') {
    if (url.port || (url.pathname !== '/mighty' && !url.pathname.startsWith('/mighty/')) || /%(?:2f|5c)/i.test(url.pathname)) {
      throw Error('Open the Mighty app at https://riteshmitsloan.github.io/mighty/ to sign in.');
    }
    appBase = 'https://riteshmitsloan.github.io/mighty/';
  }
  return {email: normalized, options: {shouldCreateUser: false, emailRedirectTo: appBase}};
}

export async function sendOwnerLink(client: OwnerAuthClient, email: string, currentUrl: string): Promise<string> {
  const request = ownerLinkRequest(email, currentUrl);
  const {error} = await client.auth.signInWithOtp(request);
  if (error) throw Error(error.message);
  return request.email;
}

export async function signOutOwner(client: OwnerAuthClient): Promise<void> {
  const {error} = await client.auth.signOut({scope: 'local'});
  if (error) throw Error(error.message);
}

export function authErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'This request could not be completed. Try again.';
}

/** Read before auth initialization; inspect only error keys, never error text or tokens. */
export function ownerCallbackError(currentUrl: string): string | null {
  try {
    const url = new URL(currentUrl);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if ([url.searchParams, fragment].some(params => params.has('error') || params.has('error_code'))) {
      return 'That sign-in link could not be used. Request a new link and open it in this browser.';
    }
  } catch { /* A malformed URL is not an auth callback. */ }
  return null;
}
