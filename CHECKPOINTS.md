# Hackathon checkpoints

Event context supplied by the founder: East v. West 72 Hour Hackathon, kickoff September 12, 2026 at noon EDT. The emails also say environment access ends Monday at noon; that is a 48-hour interval and needs organizer clarification. Plan conservatively for Monday September 14 at noon until confirmed.

The supplied instructions require a GitHub repository and a 60-second progress video at scored check-ins every 12 hours. Five check-in scores are averaged and combined with the final round. Final instructions also list hackofthrones@gmail.com. This document records requirements; no external submission or email has been sent.

Rubric: innovation and creativity 30%, technical implementation 25%, business value and impact 25%, presentation and communication 20%.

Recommended positioning: Human Flourishing, with AI Apps as an alternative. The value is helping people sustain professional relationships. The demonstration should show one complete journey, not a tour of unfinished features.

## Demo journey

1. State one goal.
2. Import your own context and show live counts.
3. Find relevant existing connections instantly, with reasons grounded in records.
4. Read a rendered LinkedIn profile with the extension; explain fit to the goal.
5. Save that person and capture one next step.

## Current evidence

- Live Supabase: anonymous relationship reads return an empty array; anonymous writes and publishable-key `ai_precheck` calls are refused with SQLSTATE 42501.
- Live gateway: a valid anonymous request returns 401; an invalid body returns 400.
- Live quota test: a transactional cap of three admitted three calls and refused the fourth. The test rolled back afterward.
- Local tests: migrations 001–006 apply in PGlite; RLS, reservation caps, immutable facts, inbox retries, import retries, atomic settings patches, and explicit device-source copies are covered. 186 core tests and 41 UI checks pass. The previous extension checkpoint passed 35 extension/parser/popup tests. UI checks cover app drafts and saves, owner sign-in, and device-source selection; see tests/ui/README.md for their scope.
- The production build passes and packages the versioned extension ZIP for the app download.
- Browser parser checks: a synthetic 19,000-connection ZIP parsed in 0.39 seconds; an exact 2 GiB synthetic mailbox scanned in 1.65 seconds using a Worker and native IndexedDB. This is a synthetic received-body-heavy fixture, not a measured memory ceiling or a guarantee for every real mailbox. All four browser fixture checks passed.
- Browser UI: reviewed desktop and 390-pixel mobile layouts, goal persistence across navigation/reload, keyboard dialog dismissal, and local import entry.
- Native browser storage: eight isolated checks passed for legacy imports, empty goals, ordered saves, account isolation, concurrent merges, and rollback of combined updates. Goal-only edits now write a small separate record without reading or rewriting imported sources; the existing version-1 database needs no upgrade. The fixture uses synthetic data and removes its temporary database.
- Native device-source transfer: four isolated checks passed for preserving device and unrelated account data, refusing conflicts, refusing stale plans, and rolling back combined source/goal writes. Copying is explicit and separate from uploading; the synthetic fixture removes its temporary database.
- Private owner sign-in: public signup is disabled, email confirmation remains enabled, and local redirect origins were corrected. An activated owner was provisioned and the live app successfully requested an email link. The owner's completed sign-in and subsequent account save still require verification.
- Live temporary-account security: own-row roundtrip passed; cross-account writes were refused with 42501. The cross-account read used an empty random namespace, not a populated second account.
- Gemini features were enabled with explicit approval. Real profile and routing calls were rejected upstream; the diagnostic routing call returned provider HTTP 404 NOT_FOUND. A bounded model-list probe succeeded and listed the configured models with generation support. The rolled-back reservation check returned the expected exact model ID. Generation remains unresolved; reservations were released, and no confirmed model cost is claimed.
- The canonical GEMINI_API_KEY secret is now present and AI_PROCESSING_ENABLED is true. The canonical key's digest still matches the credential used in the earlier failed generation calls; its presence alone is not a successful provider test.

- The approved disposable account and all scoped records were deleted after failed reservations were released. Cleanup verified zero Auth and application rows; its local credential file was removed.

## Still to verify

- A complete app journey in the browser and live extension behavior on LinkedIn.
- Resolve the provider model/access rejection and complete a real `profile_briefing` call with measured usage and confirmed cost.
- Existing Google search credentials, web search results, and observed latency.
- Full `supabase db reset`: the local database runtime is unavailable on this machine.
- Checkpoint submissions. The GitHub destination is https://github.com/riteshmitsloan/mighty.

The founder selected the top-level Mighty Today, List, Explore, Person, and You concepts as the visual reference. The warm backgrounds, indigo and coral palette, logo, and Schibsted Grotesk typography are approved for implementation; the app and popup now use that direction. CONTENT-REVIEW.md records wording changes and deliberate cuts. Reference-design example people and counts are not product data.
