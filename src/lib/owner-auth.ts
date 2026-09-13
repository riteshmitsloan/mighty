export type OwnerLinkRequest = {
  email: string;
  options: {shouldCreateUser: false; emailRedirectTo: string};
};
type AuthResult = {error: {message: string; status?: number} | null};
export type OwnerAuthClient = {auth: {
  signInWithOtp: (request: OwnerLinkRequest) => Promise<AuthResult>;
  signOut: (options: {scope: 'local'}) => Promise<AuthResult>;
}};

/** Accept only a trusted current-page URL; never pass a query-string redirect. */
export function ownerLinkRequest(email: string, currentUrl: string): OwnerLinkRequest {
  const normalized = email.trim();
  if (normalized.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(normalized)) {
    throw Error('Enter a valid email address.');
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
