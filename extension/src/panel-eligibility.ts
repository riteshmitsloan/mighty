import {profileTopCard} from './profile.js';
import {rendered, textOf} from './dom.js';
import {canonicalProfileURL} from './urls.js';

/** Automatic UI needs explicit top-card ownership evidence. Names never establish account ownership. */
export function profilePanelEligibility(doc: Document, value: string): 'other' | 'self' | 'unknown' | 'unsupported' {
  const profileUrl = canonicalProfileURL(value); if (!profileUrl) return 'unsupported';
  const top = profileTopCard(doc, value); if (!top) return 'unknown';
  // A legacy h1 can survive a client-side navigation or worker reinjection. Only
  // the SDUI card has a subject marker verified against the current profile URL.
  // Unbound layouts remain readable through the manual toolbar popup.
  if (!top.matches('div[id^="com.linkedin.sdui.profile.card.ref"][id$="Topcard"],div[componentkey^="com.linkedin.sdui.profile.card.ref"][componentkey$="Topcard"]')) return 'unknown';
  let other = false;
  for (const control of top.querySelectorAll('button,a,[role="button"]')) {
    if (!rendered(control)) continue;
    const labels = [control.getAttribute('aria-label') || '', textOf(control, 300)].map(label => label.replace(/\s+/g, ' ').trim().toLowerCase());
    let ownEdit = false;
    const href = control.getAttribute('href');
    if (href) {try {
      const url = new URL(href, profileUrl); ownEdit = url.href.startsWith(profileUrl + 'edit/');
      if (url.protocol === 'https:' && ['www.linkedin.com', 'linkedin.com'].includes(url.hostname)
        && url.pathname === '/messaging/compose/' && url.searchParams.get('screenContext') === 'NON_SELF_PROFILE_VIEW') other = true;
    } catch {}}
    if (ownEdit || labels.some(label => /^(?:edit(?: intro(?:duction)?| profile(?: photo)?| your profile)?|add profile section|add section|enhance profile)$/.test(label))) return 'self';
    if (labels.some(label => /^(?:connect|message|follow)(?:\s|$)/.test(label) || /^invite .+ to connect$/.test(label))) other = true;
  }
  return other ? 'other' : 'unknown';
}
