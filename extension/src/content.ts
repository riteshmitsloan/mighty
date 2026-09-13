import {snapshot} from './profile.js';
import {createProfilePanel, relevantPageMutation} from './profile-panel.js';
import {profilePanelEligibility} from './panel-eligibility.js';
import {canonicalProfileURL, isSearchURL} from './urls.js';

type Mount = {dispose: () => void};
const scope = globalThis as typeof globalThis & {__mightyResearch?: Mount};
scope.__mightyResearch?.dispose();
const supportedReadURL = () => Boolean(canonicalProfileURL(location.href) || isSearchURL(location.href));
if (supportedReadURL()) {
  let panel: ReturnType<typeof createProfilePanel> | null = null;
  let disposed = false, lastUrl = location.href;
  let timer: ReturnType<typeof setTimeout> | undefined, maximum: ReturnType<typeof setTimeout> | undefined;
  const listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object' || !('type' in message) || message.type !== 'mighty:read') return;
    respond(snapshot(document, location.href));
  };
  chrome.runtime.onMessage.addListener(listener);
  function read() {
    clearTimeout(timer); clearTimeout(maximum); timer = maximum = undefined;
    if (disposed) return;
    if (!supportedReadURL()) {dispose(); return;}
    lastUrl = location.href;
    if (profilePanelEligibility(document, location.href) === 'other') {
      if (!panel) panel = createProfilePanel({document, runtime: chrome.runtime, url: () => location.href});
      else panel.readPage();
    } else {
      panel?.dispose(); panel = null;
      // The parser remains available without mounting an automatic assessment.
      try {void chrome.runtime.sendMessage({type: 'mighty:page_changed'}).catch(() => {});} catch {}
    }
  }
  function changed(records?: MutationRecord[]) {
    if (disposed || (records && panel && !relevantPageMutation(records, panel.host))) return;
    if (location.href !== lastUrl) {panel?.dispose(); panel = null;}
    clearTimeout(timer); timer = setTimeout(read, 180);
    // A continuously updating LinkedIn page cannot postpone the read indefinitely.
    if (!maximum) maximum = setTimeout(read, 900);
  }
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'alt', 'class', 'style', 'hidden', 'aria-hidden', 'aria-label']});
  const routeChanged = () => {if (location.href !== lastUrl) {panel?.dispose(); panel = null; read();}};
  const focus = () => {if (disposed) return; read(); if (!disposed && panel) void panel.refreshAccount(true);};
  addEventListener('popstate', routeChanged); addEventListener('focus', focus);
  // URL checks catch pushState navigation without modifying LinkedIn's history functions.
  const routes = setInterval(routeChanged, 500);
  function dispose() {
    if (disposed) return; disposed = true;
    observer.disconnect(); clearTimeout(timer); clearTimeout(maximum); clearInterval(routes);
    chrome.runtime.onMessage.removeListener(listener); removeEventListener('popstate', routeChanged); removeEventListener('focus', focus);
    panel?.dispose(); panel = null;
  }
  scope.__mightyResearch = {dispose};
  read();
}
