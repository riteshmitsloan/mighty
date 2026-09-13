export interface CompanyOverlap { readonly company: string; readonly count: number; readonly statement: string; }

/** Normalize only the lookup key; the company name remains an original fact. */
export function companyKey(company: string): string {
  return company.normalize('NFKC').replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&').replace(/&quot;/gi, '"').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
export function companyOverlapFor(index: Readonly<Record<string, CompanyOverlap>>, company: string): CompanyOverlap | null {
  return Object.hasOwn(index, companyKey(company)) ? index[companyKey(company)] : null;
}
