import {snapshot} from './profile.js';
import {createProfilePanel, relevantPageMutation, panelRuntimeAvailable, runtimeInvalidation} from './profile-panel.js';
import {profilePanelEligibility} from './panel-eligibility.js';
import {canonicalProfileURL, isSearchURL} from './urls.js';

type Mount = {dispose: () => void};
const scope = globalThis as typeof globalThis & {__mightyResearch?: Mount};
let availableRuntime: typeof chrome.runtime | undefined;
try {availableRuntime = chrome.runtime;} catch { /* The old isolated context may already be invalid. */ }
const validRuntime = availableRuntime && panelRuntimeAvailable(availableRuntime);
if (validRuntime) {
  // Only a live bootstrap may replace another mount. Capture its host before
  // teardown so an older controller never looks up a later replacement.
  const previousHost = document.getElementById('mighty-profile-panel');
  try {scope.__mightyResearch?.dispose();} catch { /* An older controller may use an invalid runtime during teardown. */ }
  previousHost?.remove();
}
const supportedReadURL = () => Boolean(canonicalProfileURL(location.href) || isSearchURL(location.href));
if (availableRuntime && validRuntime && supportedReadURL()) {
  const runtime = availableRuntime;
  let panel: ReturnType<typeof createProfilePanel> | null = null;
  let disposed = false, lastUrl = location.href;
  let timer: ReturnType<typeof setTimeout> | undefined, maximum: ReturnType<typeof setTimeout> | undefined;
  function runtimeReady() {if (disposed) return false; if (panelRuntimeAvailable(runtime)) return true; dispose(); return false;}
  const listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (!runtimeReady()) return;
    try {
      if (sender.id !== runtime.id || !message || typeof message !== 'object' || !('type' in message) || message.type !== 'mighty:read') return;
      respond(snapshot(document, location.href));
    } catch (error) {if (runtimeInvalidation(error) || !panelRuntimeAvailable(runtime)) dispose(); else throw error;}
  };
  function read() {
    clearTimeout(timer); clearTimeout(maximum); timer = maximum = undefined;
    if (!runtimeReady()) return;
    if (!supportedReadURL()) {dispose(); return;}
    lastUrl = location.href;
    if (profilePanelEligibility(document, location.href) === 'other') {
      if (!panel) {
        const created = createProfilePanel({document, runtime, url: () => location.href, onRuntimeInvalidated: dispose});
        if (disposed) created.dispose(); else panel = created;
      }
      else panel.readPage();
    } else {
      panel?.dispose(); panel = null;
      // The parser remains available without mounting an automatic assessment.
      try {void runtime.sendMessage({type: 'mighty:page_changed'}).catch(error => {if (runtimeInvalidation(error) || !panelRuntimeAvailable(runtime)) dispose();});}
      catch (error) {if (runtimeInvalidation(error) || !panelRuntimeAvailable(runtime)) dispose();}
    }
  }
  function changed(records?: MutationRecord[]) {
    if (!runtimeReady() || (records && panel && !relevantPageMutation(records, panel.host))) return;
    if (location.href !== lastUrl) {panel?.dispose(); panel = null;}
    clearTimeout(timer); timer = setTimeout(read, 180);
    // A continuously updating LinkedIn page cannot postpone the read indefinitely.
    if (!maximum) maximum = setTimeout(read, 900);
  }
  const observer = new MutationObserver(changed);
  // SDUI can hydrate the new subject/control identity after the URL and visible
  // text change. Those final attribute-only updates must retry eligibility too.
  observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['componentkey', 'id', 'href', 'src', 'alt', 'class', 'style', 'hidden', 'aria-hidden', 'aria-label']});
  const routeChanged = () => {if (runtimeReady() && location.href !== lastUrl) {panel?.dispose(); panel = null; read();}};
  const focus = () => {if (disposed) return; read(); if (!disposed && panel) void panel.refreshAccount(true);};
  addEventListener('popstate', routeChanged); addEventListener('focus', focus);
  // URL checks catch pushState navigation without modifying LinkedIn's history functions.
  const routes = setInterval(routeChanged, 500);
  function dispose() {
    if (disposed) return; disposed = true;
    observer.disconnect(); clearTimeout(timer); clearTimeout(maximum); clearInterval(routes);
    try {runtime.onMessage.removeListener(listener);} catch { /* Cleanup must continue after invalidation. */ }
    removeEventListener('popstate', routeChanged); removeEventListener('focus', focus);
    panel?.dispose(); panel = null;
    if (scope.__mightyResearch === mount) delete scope.__mightyResearch;
  }
  const mount = {dispose}; scope.__mightyResearch = mount;
  try {runtime.onMessage.addListener(listener); read();} catch (error) {dispose(); if (!runtimeInvalidation(error) && panelRuntimeAvailable(runtime)) throw error;}
}
