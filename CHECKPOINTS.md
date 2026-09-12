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
- Local tests: migrations 001–004 apply in PGlite; RLS, reservation caps, immutable facts, inbox retries, and import retries are covered.
- Local archive/resume tests: generated 19,000-connection archive and a real generated PDF extract successfully. Node parser speed is not a browser performance claim.

## Still to verify

- A complete app journey in the browser and live extension behavior on LinkedIn.
- Actual model credentials, an authenticated provisioned test session, and a real `profile_briefing` call with provider token counts and confirmed cost.
- Existing Google search credentials, web search results, and observed latency.
- Large-mailbox IndexedDB behavior in a real browser.
- Full `supabase db reset`: the local database runtime is unavailable on this machine.
- GitHub destination and checkpoint submissions.

Brand, logo, and typography work begins after the functional build is ready for review.
