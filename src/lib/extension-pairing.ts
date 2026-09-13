/** An extension ID is a proposed recipient, never permission to send an account session. */
export function requestedExtensionId(currentUrl: string): string | null {
  try {
    const values = new URL(currentUrl).searchParams.getAll('mighty_extension');
    return values.length === 1 && /^[a-p]{32}$/.test(values[0]) ? values[0] : null;
  } catch { return null; }
}

/** Remove only pairing navigation; preserve unrelated query and callback state. */
export function withoutExtensionRequest(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete('mighty_extension');
  if (url.hash === '#connect-extension') url.hash = '';
  return url.href;
}
