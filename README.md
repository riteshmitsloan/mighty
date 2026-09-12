# Mighty

Mighty. Intentional, intelligent networking.

Mighty helps a person turn a networking intention into a relationship they continue: bring their own context, find someone relevant, understand the evidence, save that person, and capture the next step. The user always decides and sends.

## Run locally

Requires Node.js 22 or newer. Run `npm ci`, copy `.env.example` to `.env`, set the public Supabase URL and publishable key, then run `npm run dev`. Only public values belong in `VITE_` variables. No model key, service key, raw archive, or mailbox belongs in Git.

`npm test` runs parser, database isolation, metering, search, and telemetry checks. `npm run build` checks application types and creates the production bundle.

## Backend

Apply the numbered migrations in order. `supabase db reset` requires a working local Supabase database runtime. The test suite also runs the migrations against PGlite with Supabase-compatible auth/storage fixtures; that is not a substitute for a full local Supabase reset.

Deploy `supabase/functions/ai-gateway` with `verify_jwt=false`. The function verifies the actual user session through Supabase Auth. Legacy-only platform JWT verification must be off so the function can accept current signing keys and enforce its documented 400/401 responses. Model registries and metering functions are private to the service role.

Provider features start disabled. Set the server environment from `.env.example`, verify the account's provider data controls, and enable reviewed registry entries. Google Programmable Search requires an existing eligible search account. Free model features still have daily call and dollar limits.

The authentication/signup/onboarding module is deliberately out of scope. Account-backed operations require an existing provisioned account session; local import parsing does not.

## Privacy and evidence

LinkedIn archives are parsed in the browser. The connection pool is independent of tracked relationships. Raw career facts and complete profile reads are immutable snapshots. Received LinkedIn messages contribute counts only. The private rebuild archive is sanitized; original received bodies are excluded. Mailboxes are never uploaded, and received mailbox bodies are never decoded.

AI synthesis references original evidence and cannot update it. Search snippets are unscored and do not qualify as a complete profile read. Telemetry permits only a closed vocabulary, counts, and booleans.

## Hackathon checkpoint

See [CHECKPOINTS.md](CHECKPOINTS.md) for the submission context, demo story, and verified versus pending acceptance checks. Credentials, personal files, and generated test output are excluded from source control.
