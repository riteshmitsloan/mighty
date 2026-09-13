import {currentExperienceDateRanges, validCurrentExperienceDate, CURRENT_EXPERIENCE_LIMITS, type CurrentExperience} from '../../src/lib/current-experience';
import {rendered, textOf} from './dom.js';
import {canonicalProfileURL} from './urls.js';

export type CurrentExperienceField = {field: 'role' | 'company'; text: string; currentExperience: CurrentExperience};
const labelField = new Map<string, 'role' | 'company'>([['job title','role'],['role','role'],['position','role'],['company','company'],['employer','company']]);
const visible = (root: Element, selector: string) => Array.from(root.querySelectorAll(selector)).filter(rendered);
const entitySelector = 'div[componentkey^="entity-collection-item-"]';
const experiencePrefix = 'Profile_Top_Level_ExperienceTopLevelSection';

/** This observed SDUI collection belongs to the URL-bound subject, not a sidebar card. */
function sduiExperienceScope(section: Element, profileUrl: string): Element | null {
  const canonical = canonicalProfileURL(profileUrl);
  if (!canonical || !section.matches('section') || !rendered(section)) return null;
  const slug = new URL(canonical).pathname.slice(4, -1), expected = new Set([experiencePrefix + slug, experiencePrefix + decodeURIComponent(slug)]);
  const headings = visible(section, 'h2[componentkey="ProfileNullStateCardAnchor_Experience"]')
    .filter(heading => heading.closest('section') === section && /^experience$/i.test(textOf(heading, Infinity)));
  const markers = visible(section, 'div[componentkey^="' + experiencePrefix + '"]');
  if (headings.length !== 1 || markers.length !== 1 || !expected.has(markers[0].getAttribute('componentkey') || '') || markers[0].closest('section') !== section) return null;
  // In SDUI the URL-bound marker can be an empty layout sibling of the heading
  // and entries. It identifies this exact section; it need not contain the entries.
  return section;
}
/** Keep each complete top-level entry, including grouped/historical entries, as raw evidence. */
export function sduiExperienceEntries(section: Element, profileUrl: string): Element[] {
  const scope = sduiExperienceScope(section, profileUrl);
  if (!scope) return [];
  return visible(scope, entitySelector).filter(item => item.closest('section') === section
    && !item.parentElement?.closest(entitySelector));
}
function companyURL(value: string): string | null {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    if (url.protocol !== 'https:' || !['linkedin.com','www.linkedin.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/company\/([\w-]{1,200})\/?$/);
    return match ? 'https://www.linkedin.com/company/' + match[1] + '/' : null;
  } catch {return null;}
}
/** An unlinked employer needs an independent logo label and the observed job-block hierarchy. */
function unlinkedJobParagraphs(item: Element): {paragraphs: Element[]; logoLabel: string} | null {
  if (item.querySelector('a')) return null;
  const figures = visible(item, 'figure'), paragraphs = visible(item, 'p');
  if (figures.length !== 1 || paragraphs.length < 3 || paragraphs.length > 4) return null;
  const figure = figures[0], logos = visible(figure, 'svg[role="img"][aria-label]');
  if (logos.length !== 1 || paragraphs.some(p => visible(p, 'p').length || figure.contains(p))) return null;
  const siblings = Array.from(figure.parentElement?.children || []).filter(node => node.matches('div') && rendered(node)
    && paragraphs.every(p => node.contains(p)));
  if (siblings.length !== 1) return null;
  const container = siblings[0], [role, employer, date, location] = paragraphs, titles = role.parentElement;
  if (!titles?.matches('div') || titles === container || titles !== employer.parentElement || titles.contains(date)
    || !date.parentElement?.matches('div') || !date.parentElement.contains(titles)
    || (location && location.parentElement !== date.parentElement)) return null;
  return {paragraphs, logoLabel: (logos[0].getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()};
}
/** Only an observed, dated employer layout establishes the semantics of these paragraphs. */
function sduiCurrentFields(item: Element, observedAt: string, profileUrl: string): CurrentExperienceField[] {
  const section = item.closest('section');
  if (!section || !sduiExperienceEntries(section, profileUrl).includes(item) || visible(item, entitySelector + ',li,[itemscope]').length) return [];
  const entryText = textOf(item, Infinity);
  if (!entryText || entryText.length > CURRENT_EXPERIENCE_LIMITS.entry) return [];
  const ranges = [...new Set(currentExperienceDateRanges(entryText))];
  if (ranges.length !== 1 || !validCurrentExperienceDate(ranges[0], observedAt)) return [];
  const dateRange = ranges[0], links = visible(item, 'a[href]');
  const textLinks = links.filter(link => visible(link, 'p').length);
  let paragraphs: Element[], logoLabel: string | null = null;
  if (!item.querySelector('a')) {
    const unlinked = unlinkedJobParagraphs(item);
    if (!unlinked) return [];
    paragraphs = unlinked.paragraphs; logoLabel = unlinked.logoLabel;
  } else {
    if (textLinks.length !== 1) return [];
    const link = textLinks[0], employerUrl = companyURL(link.getAttribute('href') || '');
    if (!employerUrl || links.some(other => /\/company\//.test(other.getAttribute('href') || '') && companyURL(other.getAttribute('href') || '') !== employerUrl)) return [];
    paragraphs = visible(link, 'p');
    if (paragraphs.length < 3 || paragraphs.length > 4 || paragraphs.some(p => p.closest('a') !== link || visible(p, 'p').length)) return [];
  }
  const [role, employer, renderedDate] = paragraphs.map(p => textOf(p, Infinity));
  if (!renderedDate.startsWith(dateRange)) return [];
  const suffix = renderedDate.slice(dateRange.length).trim();
  if (suffix && !/^[·•]\s*\d+\s+(?:yrs?|years?|mos?|months?|wks?|weeks?|days?)(?:\s+\d+\s+(?:yrs?|years?|mos?|months?|wks?|weeks?|days?)){0,2}$/i.test(suffix)) return [];
  // Employment type is a displayed suffix, never part of the employer's name.
  const employerParts = employer.split(/\s+[·•]\s+/);
  if (employerParts.length > 2 || (employerParts.length === 2 && !/^(?:Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Apprenticeship|Seasonal|Co-op)$/i.test(employerParts[1]))) return [];
  const company = employerParts[0];
  if (logoLabel !== null && logoLabel !== company + ' logo') return [];
  if ([role, company].some(value => !value.trim() || value.length > CURRENT_EXPERIENCE_LIMITS.field || currentExperienceDateRanges(value).length)) return [];
  return (['role','company'] as const).map(field => ({field, text: field === 'role' ? role : company, currentExperience: {dateRange, entryText}}));
}

/** Narrow semantic support, not a heuristic for generic LinkedIn title/div layouts. */
export function currentExperienceFields(item: Element, observedAt: string, profileUrl?: string): CurrentExperienceField[] {
  if (profileUrl && item.matches(entitySelector) && rendered(item)) return sduiCurrentFields(item, observedAt, profileUrl);
  if (!item.matches('li') || !rendered(item) || visible(item, 'li').length) return [];
  // A nested person/occupation could describe somebody else; an explicit employer organization is allowed.
  if (visible(item, '[itemscope]').some(node => !node.matches('[itemprop~="worksFor"]'))) return [];
  const entryText = textOf(item, Infinity);
  if (!entryText || entryText.length > CURRENT_EXPERIENCE_LIMITS.entry) return [];
  const ranges = [...new Set(currentExperienceDateRanges(entryText))];
  if (ranges.length !== 1 || !validCurrentExperienceDate(ranges[0], observedAt)) return [];
  const dateRange = ranges[0];
  // A date phrase inside a description is insufficient: a separate visible field must contain that exact range.
  if (!visible(item, '*').some(node => textOf(node, Infinity) === dateRange)) return [];
  if (visible(item, '[itemprop~="endDate"]').some(node => !/^(?:present|current)$/i.test(textOf(node, Infinity)))) return [];
  const values: Record<'role' | 'company', Set<string>> = {role: new Set(), company: new Set()};
  let invalid = false;
  const add = (field: 'role' | 'company', node: Element) => {
    const value = textOf(node, Infinity);
    if (!value || value.length > CURRENT_EXPERIENCE_LIMITS.field || currentExperienceDateRanges(value).length) invalid = true;
    else values[field].add(value);
  };
  for (const node of visible(item, '[itemprop~="jobTitle"]')) {
    if (node.closest('[itemprop~="worksFor"]')) invalid = true;
    else add('role', node);
  }
  for (const employer of visible(item, '[itemprop~="worksFor"]')) {
    const names = visible(employer, '[itemprop~="name"]');
    if (names.length === 1) add('company', names[0]);
    else if (!names.length && !employer.children.length) add('company', employer);
    else invalid = true;
  }
  for (const term of visible(item, 'dl > dt')) {
    const label = textOf(term, Infinity).toLowerCase(), field = labelField.get(label);
    const definition = term.nextElementSibling;
    if (field) {
      if (term.closest('[itemprop~="worksFor"]') || !definition?.matches('dd') || !rendered(definition) || definition.nextElementSibling?.matches('dd')) invalid = true;
      else add(field, definition);
    }
    if (['end date', 'ended'].includes(label) && definition?.matches('dd') && rendered(definition) && !/^(?:present|current)$/i.test(textOf(definition, Infinity))) invalid = true;
  }
  if (invalid || values.role.size > 1 || values.company.size > 1) return [];
  return (['role','company'] as const).flatMap(field => [...values[field]].map(text => ({field, text, currentExperience: {dateRange, entryText}})));
}
