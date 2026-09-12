/** Postgres jsonb rejects NUL; strip nonprinting controls while retaining line breaks. */
export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}
export function normalizeName(value: string): string {
  return cleanText(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
/** Conservative: reply and signature markers end the sample. */
export function stripQuotedRepliesAndSignature(value: string, accountHolderName?: string): string {
  const withoutHtmlQuotes = cleanText(value).split(/<blockquote\b|<[^>]*class=["'][^"']*(?:gmail_quote|gmail_signature|yahoo_quoted)[^"']*["']/i)[0];
  const lines = withoutHtmlQuotes.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0 && accountHolderName && normalizeName(line) === normalizeName(accountHolderName)) break;
    if (/^\s*On\s/i.test(line) && lines.slice(i, i + 4).some(candidate => /wrote:\s*$/i.test(candidate.slice(0, 800)))) break;
    if (/^\s*>/.test(line)
      || /^\s*On .{1,400}wrote:\s*$/i.test(line)
      || /^\s*-{2,}\s*(original message|forwarded message)/i.test(line)
      || /^\s*(begin forwarded message|from|sent|to|subject):/i.test(line)
      || /^\s*--\s*$/.test(line)
      || /^\s*sent from my\b/i.test(line)
      || /^\s*(best(?: regards| wishes)?|kind regards|regards|sincerely|cheers|thanks|thank you)[,!]?\s*$/i.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n').trim().slice(0, 12_000);
}
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function contentFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}
