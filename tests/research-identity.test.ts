import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalResearchLinkedInUrl, createResearchIdentityAnchor, matchResearchSources,
  type ResearchIdentityAnchor, type ObservedResearchSource, type ObservedProfessionalFact,
} from '../src/lib/research-identity';
import {canonicalProfileURL} from '../extension/src/urls';

// Reserved example domains and synthetic fixtures only. No production identities.
const profile = 'https://www.linkedin.com/in/mighty-identity-test-only/';
const otherProfile = 'https://www.linkedin.com/in/mighty-other-identity-test-only/';
const date = '2026-09-13T12:00:00.000Z';
function anchor(): ResearchIdentityAnchor {
  return {linkedinUrl: profile, name: 'Example Taylor', facts: [
    {id: 'known-company', field: 'company', value: 'Sample Systems', sourceRef: 'record:synthetic/company', period: '2020'},
    {id: 'known-role', field: 'role', value: 'Engineering Director', sourceRef: 'record:synthetic/role'},
    {id: 'known-education', field: 'education', value: 'Test Institute', sourceRef: 'record:synthetic/education'},
  ]};
}
function source(changes: Partial<ObservedResearchSource> = {}): ObservedResearchSource {
  const text = 'Example Taylor\nCompany: Sample Systems\nRole: Engineering Director\nEducation: Test Institute';
  return {id: 'observed-one', url: 'https://example.com/team/example-taylor', observedAt: date, attribution: 'Example publisher, observed team biography', contentKind: 'source_page', text,
    subjects: [{id: 'person-one', name: 'Example Taylor', text,
      links: [{href: profile, relation: 'subject_profile'}], facts: [
        {id: 'company', field: 'company', value: 'Sample Systems', quote: 'Company: Sample Systems', basis: 'labelled', polarity: 'positive'},
        {id: 'role', field: 'role', value: 'Engineering Director', quote: 'Role: Engineering Director', basis: 'structured', polarity: 'positive'},
        {id: 'education', field: 'education', value: 'Test Institute', quote: 'Education: Test Institute', basis: 'labelled', polarity: 'positive'},
      ]}], ...changes};
}
function withSubject(changes: Partial<ObservedResearchSource['subjects'][number]>): ObservedResearchSource {
  const input = source(); return {...input, subjects: [{...input.subjects[0], ...changes}]};
}
const decision = (input: ObservedResearchSource, target = anchor()) => matchResearchSources(target, [input]).sources[0];

test('canonical identity agrees with the extension and never unwraps search queries or redirects', () => {
  for (const raw of [profile, 'https://linkedin.com/in/MIGHTY-IDENTITY-TEST-ONLY?tracking=yes#about', 'https://www.linkedin.com/in/%C3%A9xample/']) {
    assert.equal(canonicalResearchLinkedInUrl(raw), canonicalProfileURL(raw));
  }
  for (const raw of [
    `https://example.com/search?q=${encodeURIComponent(profile)}`, `https://www.linkedin.com/search/results/people/?keywords=${profile}`,
    'http://www.linkedin.com/in/example/', 'https://linkedin.com.evil.example/in/example/', 'https://www.linkedin.com@evil.example/in/example/',
    'https://user@www.linkedin.com/in/example/', 'https://www.linkedin.com:444/in/example/', 'https://www.linkedin.com/in/example%2Fother/',
    'https://www.linkedin.com/in/example/experience/', 'javascript:alert(1)',
  ]) assert.equal(canonicalResearchLinkedInUrl(raw), null, raw);
});

test('a direct observed profile needs and retains supported name and professional fields', () => {
  const result = decision({...withSubject({links: []}), url: profile});
  assert.equal(result.status, 'matched');
  assert.ok(result.reasons.some(reason => reason.code === 'direct_profile_url'));
  assert.ok(result.reasons.some(reason => reason.anchorFactId === 'known-company' && reason.sourceFactId === 'company'));
  assert.equal(result.facts[0].quote, 'Company: Sample Systems');
  assert.equal(result.facts[0].sourceUrl, profile);
  assert.equal(result.facts[0].attribution, source().attribution);
  assert.equal(result.facts[0].observedAt, date);
  assert.equal(result.facts[0].corroboration, 'anchor_match');
});

test('a person-scoped link and field corroboration can match an independently observed biography', () => {
  const result = matchResearchSources(anchor(), [source()]);
  assert.deepEqual(result.matchedSourceIds, ['observed-one']);
  assert.equal(result.sources[0].status, 'matched');
  assert.ok(result.sources[0].reasons.some(reason => reason.code === 'subject_profile_link'));
  assert.equal(result.sources[0].facts.length, 3);
  assert.equal('confidence' in result.sources[0], false);
});

test('a name, matching company and role never substitute for source linkage', () => {
  const input = withSubject({links: []});
  const result = decision(input);
  assert.equal(result.status, 'unverified');
  assert.equal(result.reasons[0].code, 'no_source_linkage');
  assert.deepEqual(result.facts, []);
});

test('a query containing the target URL, even in a supplied link, does not link the source subject', () => {
  const input = withSubject({links: [{href: `https://example.com/search?profile=${encodeURIComponent(profile)}`, relation: 'subject_profile'}]});
  const result = decision({...input, url: `https://example.com/search?q=${encodeURIComponent(profile)}`, text: `${input.text}\nSearch term: ${profile}`});
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.facts, []);
});

test('an unrelated page link does not become a subject identity link', () => {
  const result = decision(withSubject({links: [{href: profile, relation: 'other'}]}));
  assert.equal(result.status, 'unverified');
});

test('search and copied results remain unverified even when they echo every target field and URL', () => {
  for (const contentKind of ['search_result', 'copied_result'] as const) {
    const result = decision(source({contentKind, url: profile}));
    assert.equal(result.status, 'unverified');
    assert.deepEqual(result.facts, []);
  }
});

test('copied page content on different domains is withheld rather than counted as corroboration', () => {
  const inputs = [source(), source({id: 'mirror', url: 'https://example.net/copied-biography'})];
  const result = matchResearchSources(anchor(), inputs);
  assert.deepEqual(result.matchedSourceIds, []);
  assert.ok(result.sources.every(item => item.status === 'ambiguous' && item.facts.length === 0));
  assert.ok(result.sources.every(item => item.reasons.some(reason => reason.code === 'duplicate_content')));
});

test('repeated source identifiers and repeated page observations are not independent matches', () => {
  const first = source();
  for (const second of [
    source({url: 'https://example.net/second', text: first.text + '\nDifferent footer'}),
    source({id: 'second', text: first.text + '\nLater footer'}),
  ]) {
    const result = matchResearchSources(anchor(), [first, second]);
    assert.deepEqual(result.matchedSourceIds, []);
    assert.ok(result.sources.every(item => item.facts.length === 0));
  }
});

test('different page wrappers cannot make a copied subject biography independent evidence', () => {
  const first = source({text: 'Publisher one\n' + source().text});
  const second = source({id: 'different-publisher', url: 'https://example.net/biography', text: 'Publisher two\n' + source().text + '\nDifferent footer'});
  const result = matchResearchSources(anchor(), [first, second]);
  assert.deepEqual(result.matchedSourceIds, []);
  assert.ok(result.sources.every(item => item.status === 'ambiguous' && item.facts.length === 0));
});

test('different independently observed sections preserve separate source reasons without a numerical confidence', () => {
  const first = source();
  const secondText = 'Biography of Example Taylor\nEducation: Test Institute\nWork: Sample Systems';
  const second = source({id: 'source-two', url: 'https://example.net/speaker', text: secondText, subjects: [{...first.subjects[0], text: secondText, facts: [first.subjects[0].facts[2]]}]});
  const result = matchResearchSources(anchor(), [first, second]);
  assert.deepEqual(result.matchedSourceIds, ['observed-one', 'source-two']);
  assert.equal(result.sources[1].facts[0].sourceUrl, second.url);
  assert.equal(result.sources[1].facts[0].sourceId, second.id);
  assert.equal(result.sources[1].reasons.some(reason => reason.sourceFactId === 'company'), false);
});

test('a subject linked to two different LinkedIn identities is ambiguous', () => {
  const result = decision(withSubject({links: [{href: profile, relation: 'subject_profile'}, {href: otherProfile, relation: 'subject_profile'}]}));
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reasons[0].code, 'conflicting_profile_links');
  assert.deepEqual(result.facts, []);
});

test('two distinct named subjects claiming the same target identity invalidate that source', () => {
  const original = source();
  const secondText = original.text.replaceAll('Example Taylor', 'Example Morgan');
  const result = decision({...original, text: original.text + '\n' + secondText, subjects: [...original.subjects, {...original.subjects[0], id: 'person-two', name: 'Example Morgan', text: secondText}]});
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reasons[0].code, 'conflicting_subjects');
  assert.deepEqual(result.facts, []);
});

test('a separately scoped unrelated biography does not leak its fields into the matched person', () => {
  const original = source();
  const second = {...original.subjects[0], id: 'other-person', name: 'Example Morgan', text: 'Example Morgan\nCompany: Other Systems', links: [{href: otherProfile, relation: 'subject_profile' as const}], facts: [{...original.subjects[0].facts[0], id: 'other-company', value: 'Other Systems', quote: 'Company: Other Systems'}]};
  const result = decision({...original, text: original.text + '\n' + second.text, subjects: [...original.subjects, second]});
  assert.equal(result.status, 'matched');
  assert.equal(result.facts.some(fact => fact.value === 'Other Systems'), false);
});

test('a different LinkedIn source page cannot be rescued by an embedded target link or matching job', () => {
  const result = decision(source({url: otherProfile}));
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reasons[0].code, 'different_profile_url');
  assert.deepEqual(result.facts, []);
});

test('names are exact after Unicode normalization, case and whitespace only', () => {
  const original = source();
  const text = original.text.replaceAll('Example Taylor', 'EXAMPLE   TAYLOR');
  assert.equal(decision({...original, text, subjects: [{...original.subjects[0], name: 'EXAMPLE   TAYLOR', text}]}).status, 'matched');
  assert.equal(decision(withSubject({name: 'Ex Taylor'})).status, 'ambiguous');
  assert.equal(decision(withSubject({name: 'Éxample Taylor'})).status, 'ambiguous');
});

test('neither a URL plus name alone nor unsourced declared fields is enough', () => {
  const linkedName = decision(withSubject({facts: []}));
  assert.equal(linkedName.status, 'unverified');
  assert.ok(linkedName.reasons.some(reason => reason.code === 'subject_profile_link'));
  assert.ok(linkedName.reasons.some(reason => reason.code === 'exact_name'));
  assert.ok(linkedName.reasons.some(reason => reason.code === 'no_field_match'));
  assert.equal(decision(source(), {...anchor(), facts: []}).status, 'unverified');
  const input = withSubject({text: 'Company: Sample Systems', facts: [source().subjects[0].facts[0]]});
  assert.equal(decision(input).status, 'unverified');
});

test('a quotation elsewhere on a page cannot support a fact in the target subject section', () => {
  const original = source();
  const subject = {...original.subjects[0], text: 'Example Taylor', facts: [original.subjects[0].facts[0]]};
  const result = decision({...original, subjects: [subject]});
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.facts, []);
  assert.ok(result.unknowns.some(message => message.includes('complete quotation')));
});

test('partial string coincidences and differing field types cannot corroborate an anchor', () => {
  const original = source();
  const text = 'Example Taylor\nCompany: Sample Systemscape';
  const fact = {...original.subjects[0].facts[0], quote: 'Company: Sample Systemscape'};
  assert.equal(decision({...original, text, subjects: [{...original.subjects[0], text, facts: [fact]}]}).status, 'unverified');
  const changedField = {...original.subjects[0].facts[0], field: 'skill' as const};
  assert.equal(decision(withSubject({facts: [changedField]})).status, 'unverified');
});

test('negative or uncertain assertions are neither corroborating nor accepted facts', () => {
  for (const polarity of ['negative', 'uncertain'] as const) {
    const result = decision(withSubject({facts: source().subjects[0].facts.map(fact => ({...fact, polarity}))}));
    assert.equal(result.status, 'unverified'); assert.deepEqual(result.facts, []);
  }
});

test('employment changes are source-only observations, not automatic identity conflicts or current-role promotions', () => {
  const original = source();
  const text = 'Example Taylor\nCompany: Other Systems, 2024\nEducation: Test Institute';
  const newer: ObservedProfessionalFact = {id: 'new-company', field: 'company', value: 'Other Systems', quote: 'Company: Other Systems, 2024', basis: 'labelled', polarity: 'positive', period: '2024'};
  const result = decision({...original, text, subjects: [{...original.subjects[0], text, facts: [newer, original.subjects[0].facts[2]]}]});
  assert.equal(result.status, 'matched');
  const change = result.facts.find(fact => fact.id === 'new-company')!;
  assert.equal(change.corroboration, 'source_only');
  assert.equal(change.period, '2024');
  assert.equal('current' in change, false);
  assert.ok(result.unknowns.some(message => message.includes('temporal meaning')));
  const withoutEducation = {...original, text, subjects: [{...original.subjects[0], text, facts: [newer]}]};
  assert.equal(decision(withoutEducation).status, 'unverified');
  assert.ok(decision(withoutEducation).unknowns.some(message => message.includes('do not prove a different identity')));
});

test('unquoted temporal metadata is not retained as an observed fact', () => {
  const original = source();
  const result = decision(withSubject({facts: [{...original.subjects[0].facts[0], period: 'Present'}]}));
  assert.equal(result.status, 'unverified');
  assert.deepEqual(result.facts, []);
});

test('malformed observations, provenance and nonprofessional fields are refused without fallback', () => {
  for (const changes of [{observedAt: '2026-02-31T12:00:00Z'}, {observedAt: 'yesterday'}, {attribution: ''}, {url: 'javascript:alert(1)'}, {text: 'Wrong underlying source text'}]) {
    assert.equal(decision(source(changes)).status, 'invalid');
  }
  const raw = source();
  const privateField = {...raw.subjects[0].facts[0], field: 'email'} as unknown as ObservedProfessionalFact;
  assert.equal(decision(withSubject({facts: [privateField]})).status, 'invalid');
  const badAnchor = {...anchor(), facts: [{...anchor().facts[0], field: 'location'}]} as unknown as ResearchIdentityAnchor;
  assert.throws(() => createResearchIdentityAnchor(badAnchor), /professional facts/);
  assert.throws(() => createResearchIdentityAnchor({...anchor(), linkedinUrl: 'https://example.com/?target='+profile}), /LinkedIn profile/);
  assert.equal(decision(Object.create(source())).status, 'invalid');
});

test('oversized collections are refused rather than silently dropping evidence', () => {
  assert.throws(() => matchResearchSources(anchor(), Array.from({length: 21}, () => source())), /at most 20/);
  assert.equal(decision(source({text: 'x'.repeat(200_001)})).status, 'invalid');
  assert.equal(decision(withSubject({facts: Array.from({length: 101}, (_, index) => ({...source().subjects[0].facts[0], id: String(index)}))})).status, 'invalid');
});

test('caller data stays mutable while returned observations are immutable independent copies', () => {
  const input = source(), target = anchor(), before = JSON.stringify([target, input]);
  const result = matchResearchSources(target, [input]);
  assert.equal(JSON.stringify([target, input]), before);
  assert.equal(Object.isFrozen(input.subjects[0].facts), false);
  assert.equal(Object.isFrozen(target.facts), false);
  assert.ok(Object.isFrozen(result.sources[0].facts[0]));
  (input.subjects[0].facts[0] as {value: string}).value = 'Later edit';
  assert.equal(result.sources[0].facts[0].value, 'Sample Systems');
});
