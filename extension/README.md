# Mighty extension research prototype

Bundled Manifest V3 source for integration by the parent task. It does not alter the Site checkout and contains no runtime sample people.

## What works

- Reads the current rendered LinkedIn profile: headline, location, About, experience, education, skills, languages, certifications, and explicit date ranges.
- Uses deterministic local matching against the account strategy. Explanation precedes the goal-fit label. No numerical person score and no model API.
- Popup actions are Save and Skip. Search shows all rendered results, preselects at most five once per search, and leaves others unchecked.
- Distinguishes explicit empty search, login/authwall, blocked/challenge, and ambiguous unready states even with HTTP 200.
- Does not fetch LinkedIn hidden APIs, scrape connections, paginate, auto-scroll, click Connect/Message, or send messages.
- Keeps truncated snapshots visibly incomplete, with null profileReadAt and no brief eligibility.
- Saves to the account inbox with stable operation IDs and a durable, account-bound pending queue. Connection errors retain pending saves.
- Reinjects an invalidated content script immediately on popup read. DOM changes refresh the open popup through a short debounced message rather than a 25-second poll.

## Build and checks

Run from this directory:

```sh
node scripts/test.mjs
node scripts/check.mjs
node scripts/build.mjs
```

The scripts use the root task's existing esbuild, tsx, TypeScript, Chrome type definitions, and linkedom. Set MIGHTY_DEPS_ROOT to another dependency project when integrating. This prototype does not install or modify dependencies.

The build produces an unpacked extension in dist/. Before integration configure:

- MIGHTY_APP_ORIGINS: comma-separated exact origins. Defaults to http://127.0.0.1:5173,http://localhost:5173.
- MIGHTY_SUPABASE_URL: the HTTPS project origin.
- MIGHTY_SUPABASE_PUBLISHABLE_KEY: a public sb_publishable_ key or legacy anon JWT.

The build rejects service-role and other secret keys. The default build has no project configured and says so. No model keys are read by the build or extension.

Chrome manifest patterns cannot enforce development ports; the worker additionally checks the exact origin, including port.

## App bridge

Use src/app-bridge.ts in the app:

```ts
const bridge = startExtensionBridge({
  extensionId,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  onStatus: status => { /* update extension connection state */ },
});
// Call bridge.sync() for TOKEN_REFRESHED, SIGNED_IN and SIGNED_OUT.
// Call bridge.dispose() on app unmount.
```

The bridge opens an external runtime port named mighty:bridge. The worker replies {type:'mighty:ready',protocol:1}. The app then sends a fresh short-lived access token using chrome.runtime.sendMessage. The port disconnects when the extension reloads; the first reconnect attempt is immediate, then bounded backoff up to one second. There is no fixed 25-second wait.

Wire protocol:

- Connect: {type:'mighty:connect',protocol:1,accessToken}
- Disconnect: {type:'mighty:disconnect',protocol:1}
- Status: {type:'mighty:status',protocol:1}
- Successful connect/status: {ok:true,connected,userId,strategy,configured,appOrigin}

Project configuration comes from the build, never from the handoff. The worker validates the token with Supabase /auth/v1/user, then verifies subject, issuer, and short expiration. No refresh token crosses the bridge. Session tokens stay in chrome.storage.session, and both session and pending-save storage are restricted to TRUSTED_CONTEXTS.

A Supabase user access token retains the user's own-account permissions. This prototype does not claim that the credential is limited to inbox writes; a dedicated scoped credential endpoint would be needed for that additional restriction.

## Inbox contract with migration 004

POST /rest/v1/outreach_inbox?on_conflict=user_id,operation_id with Prefer: resolution=ignore-duplicates,return=representation.

Body:

```ts
{
  operation_id: string, user_id: string, profile_url: string, person: string,
  snapshot: {
    profileUrl: string, name: string, anchors: Anchor[],
    profileReadAt: string | null, truncated: boolean,
    truncationReasons: string[],
    source: 'rendered_profile' | 'search_result'
  },
  profile_read_at: string | null
}
```

There is no top-level source column. Search snapshots always have null profile_read_at and no anchors. Incomplete real profile snapshots retain anchors but have null profile_read_at. Anchor shape: {kind,text,sourceUrl,observedAt}.

The extension expects own-account RLS, active-account inserts, and UNIQUE(user_id,operation_id). The app/database own consumption and relationship deduplication. No extension code writes outreach_log, profile_reads, stored facts, or ai_call_log.

The extension uses a 49,152-byte profile limit below the database's 60,000-byte snapshot limit. Larger UTF-8 payloads are refused with an explanation, not silently cut. Anchor text, anchor count, and section-item limits mark the read incomplete. It cannot authorize a brief.

## Font and browser verification

The existing app font has not been supplied. The popup uses system fonts. public/assets/README.txt documents assets/mighty-ui.woff2 as an integration placeholder; the manifest references no missing asset.

Tests use synthetic HTML fixtures only. Live LinkedIn layouts, unpacked-extension lifecycle, clipboard/browser permissions, actual account handoff, and database writes still need root's browser QA and configured project. No live account or LinkedIn operation was performed by this prototype task.

## Profile-read hardening (September 12)

The profile parser now requires a substantive rendered section (About, Experience, Education, Skills, Languages, Certifications, or a real Activity item). A name plus headline cannot unlock a brief, and the save validator independently enforces that rule.

Rendered Activity items are preserved as `activity` anchors. Visible timestamps are retained as factual timing anchors, including old dates. A separate recent-activity signal is added only when a visible timestamp establishes recency. Body text that happens to say “2d”, hidden timestamps, follower counters, and activity tabs do not create recent-post claims. Explicit current-role start dates or months can produce a cautious “recent role start” signal. Year-only dates and ambiguous boundary months do not imply a recent change.

The popup groups timing into a separate **Timing signals** card and lists fields not visible in the read. Parsed profile fields are no longer clipped to 900 characters, 16 items, or 40 anchors. All rendered anchor content remains in the snapshot, including over-limit content, and the validator refuses the whole save when the UTF-8 profile snapshot exceeds 49,152 bytes. No shortened snapshot is saved as complete. The legacy `truncated` flag is retained for compatibility; for new profile reads its `snapshot_size_limit` reason means the complete captured data is present but cannot be saved within the limit.

The search-result reader still has its existing explicit name/subtitle limits; search snippets remain incomplete and never become profile evidence. This review did not change that separate search contract.

Validation uses rendered HTML fixtures, the actual save validator, strict TypeScript checking, and the extension build. It does not claim a real LinkedIn session or real Chrome reload/save acceptance run.

The app font is bundled at assets/mighty-ui.woff2 with its license. Run tools/build-zip.sh from the root to regenerate both the versioned zip and current download. Tests are synthetic; no sample people are included at runtime.
