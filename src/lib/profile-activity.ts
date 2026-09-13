/** A summary of the rendered sample, never a prediction of replies or a complete activity history. */
export type ActivityTimestamp = Readonly<{text: string; sourceText: string; sourceUrl: string; observedAt: string; association: 'activity_section'}>;
export type ActivityTopic = Readonly<{text: string; sourceUrl: string; observedAt: string}>;
export type ProfileActivitySummary = Readonly<{
  state: 'observed' | 'unknown'; label: string; detail: string;
  visibleItemCount: number | null; observedAt: string | null; recentAtRead: boolean;
  timestamps: readonly ActivityTimestamp[]; topics: readonly ActivityTopic[];
}>;
const DAY = 86_400_000;
const recentPrefix = 'Recent rendered activity: ', timestampPrefix = 'Rendered activity timestamp: ';
const fragments = new Set(['#content_collections','#recent-activity','#activity']);
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unknown = (): ProfileActivitySummary => Object.freeze({state: 'unknown', label: 'Activity not available',
  detail: 'No verified activity sample is available. This does not mean the person is inactive.',
  visibleItemCount: null, observedAt: null, recentAtRead: false, timestamps: Object.freeze([]), topics: Object.freeze([])});
function profileURL(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.linkedin.com' || url.username || url.password || url.port || url.search || url.hash
      || !/^\/in\/[^/?#]+\/$/.test(url.pathname) || url.href !== value) return null;
    decodeURIComponent(url.pathname); return value;
  } catch {return null;}
}
function absoluteDate(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text)
    && !/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}$/i.test(text)) return null;
  const value = Date.parse(text); if (!Number.isFinite(value)) return null;
  const date = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (date) {const day = new Date(Date.UTC(+date[1], +date[2] - 1, +date[3])); if (day.getUTCFullYear() !== +date[1] || day.getUTCMonth() !== +date[2] - 1 || day.getUTCDate() !== +date[3]) return null;}
  const named = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[1].slice(0,3).toLowerCase());
    const day = new Date(Date.UTC(+named[3], month, +named[2])); if (day.getUTCFullYear() !== +named[3] || day.getUTCMonth() !== month || day.getUTCDate() !== +named[2]) return null;}
  return value;
}
/** Upper bounds keep rounded labels such as 3mo from becoming an exact date. */
function relativeUpperDays(text: string): number | null {
  text = text.replace(/\s*(?:[•·]\s*)?edited$/i, '').trim();
  if (/^just now$/i.test(text)) return 1 / 1440;
  if (/^today$/i.test(text)) return 1;
  if (/^yesterday$/i.test(text)) return 2;
  const match = text.match(/^(\d+)\s*(years?|yrs?|y|months?|mo|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|secs?|s)(?:\s*(?:[•·]\s*)?edited)?$/i);
  if (!match) return null;
  const number = Number(match[1]), unit = match[2].toLowerCase();
  const factor = unit.startsWith('y') ? 366 : unit.startsWith('mo') ? 31 : unit.startsWith('w') ? 7 : unit.startsWith('d') ? 1
    : unit.startsWith('h') ? 1 / 24 : unit.startsWith('m') ? 1 / 1440 : 1 / 86400;
  return Number.isSafeInteger(number) ? (number + 1) * factor : null;
}
function timestampInfo(text: string, observed: number): {recent: boolean} | null {
  const exact = text.match(/^(.*?) \(([^()]+)\)$/);
  if (exact) {
    const time = absoluteDate(exact[2]);
    if (time === null || time > observed) return null;
    return {recent: time >= observed - 90 * DAY};
  }
  const relative = relativeUpperDays(text);
  if (relative !== null) return {recent: relative <= 90};
  const time = absoluteDate(text);
  return time === null || time > observed ? null : {recent: time >= observed - 90 * DAY};
}

export function summarizeProfileActivity(input: unknown): ProfileActivitySummary {
  const profile = record(input), url = profileURL(profile?.profileUrl), at = profile?.profileReadAt;
  if (!profile || !url || typeof at !== 'string' || absoluteDate(at) === null || profile.truncated !== false
    || profile.source !== undefined && profile.source !== 'rendered_profile' || !Array.isArray(profile.anchors)) return unknown();
  const observed = Date.parse(at);
  const anchors = profile.anchors.map(record).filter((anchor): anchor is Record<string, unknown> => Boolean(anchor
    && anchor.observedAt === at && anchor.field === undefined && anchor.currentExperience === undefined
    && typeof anchor.sourceUrl === 'string' && anchor.sourceUrl.startsWith(url)
    && fragments.has(anchor.sourceUrl.slice(url.length)) && typeof anchor.text === 'string' && anchor.text.trim()));
  const items = anchors.filter(anchor => anchor.kind === 'activity');
  if (!items.length) return unknown();
  const itemSources = new Set(items.map(anchor => anchor.sourceUrl));
  const timing = anchors.filter(anchor => anchor.kind === 'timing' && itemSources.has(anchor.sourceUrl));
  const timestamps: ActivityTimestamp[] = [], seenTimes = new Set<string>();
  for (const anchor of timing) {
    const sourceText = anchor.text as string;
    if (!sourceText.startsWith(timestampPrefix)) continue;
    const text = sourceText.slice(timestampPrefix.length);
    if (!timestampInfo(text, observed)) continue;
    const key = anchor.sourceUrl + '\0' + text; if (seenTimes.has(key)) continue; seenTimes.add(key);
    timestamps.push(Object.freeze({text, sourceText, sourceUrl: anchor.sourceUrl as string, observedAt: at, association: 'activity_section'}));
  }
  // The parser does not retain per-item timestamp IDs. Do not attach dates or
  // recency to a particular post, even if there is only one visible item.
  const recentAtRead = timing.some(anchor => {
    const sourceText = anchor.text as string; if (!sourceText.startsWith(recentPrefix)) return false;
    const literal = sourceText.slice(recentPrefix.length);
    return timestamps.some(stamp => stamp.sourceUrl === anchor.sourceUrl && (stamp.text.replace(/\s*(?:[•·]\s*)?edited$/i, '').trim() === literal || stamp.text.startsWith(literal + ' ('))
      && timestampInfo(stamp.text, observed)?.recent === true);
  });
  const topics: ActivityTopic[] = [], seenTopics = new Set<string>();
  for (const item of items) for (const match of (item.text as string).matchAll(/(?<![\p{L}\p{N}_])#[\p{L}][\p{L}\p{N}_]{1,63}(?![\p{L}\p{N}_])/gu)) {
    const text = match[0], key = text.toLocaleLowerCase('en-US'); if (seenTopics.has(key)) continue; seenTopics.add(key);
    topics.push(Object.freeze({text, sourceUrl: item.sourceUrl as string, observedAt: at}));
  }
  const visibleItemCount = new Set(items.map(item => item.sourceUrl + '\0' + item.text)).size;
  return Object.freeze({state: 'observed', label: recentAtRead ? 'Recent activity observed' : 'Activity observed',
    detail: `${visibleItemCount} distinct activity ${visibleItemCount === 1 ? 'item was' : 'items were'} visible at the ${new Date(observed).toISOString().slice(0,10)} profile read. This sample does not establish posting frequency or predict replies.`,
    visibleItemCount, observedAt: at, recentAtRead, timestamps: Object.freeze(timestamps), topics: Object.freeze(topics)});
}
