/** The URL identifies an installed extension only. Account approval and token handoff happen in the app. */
export function mightyAppLink(appBase: string, extensionId: string, connected: boolean): string {
  const url = new URL(appBase);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw Error('The Mighty app address is invalid.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (!connected) {
    if (!/^[a-p]{32}$/.test(extensionId)) throw Error('The extension identifier is invalid.');
    url.searchParams.set('mighty_extension', extensionId);
    url.hash = 'connect-extension';
  }
  return url.href;
}
