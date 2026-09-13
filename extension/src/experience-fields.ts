import {currentExperienceDateRanges, validCurrentExperienceDate, CURRENT_EXPERIENCE_LIMITS, type CurrentExperience} from '../../src/lib/current-experience';
import {rendered, textOf} from './dom.js';

export type CurrentExperienceField = {field: 'role' | 'company'; text: string; currentExperience: CurrentExperience};
const labelField = new Map<string, 'role' | 'company'>([['job title','role'],['role','role'],['position','role'],['company','company'],['employer','company']]);
const visible = (root: Element, selector: string) => Array.from(root.querySelectorAll(selector)).filter(rendered);

/** Narrow semantic support, not a heuristic for generic LinkedIn title/div layouts. */
export function currentExperienceFields(item: Element, observedAt: string): CurrentExperienceField[] {
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
