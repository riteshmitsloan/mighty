# Mighty

Mighty. Intentional, intelligent networking.

Mighty helps a person turn a networking intention into a relationship they continue: bring their own context, find someone relevant, understand the evidence, save that person, and capture the next step. The user always decides and sends.

## Run locally

Requires Node.js 22 or newer. Run `npm ci`, copy `.env.example` to `.env`, set the public Supabase URL and publishable key, then run `npm run dev`. Only public values belong in `VITE_` variables. No model key, service key, raw archive, or mailbox belongs in Git.

`npm test` runs parser, database isolation, metering, search, and telemetry checks. `npm run test:ui` covers account transitions and save/draft regressions; `npm run test:extension` covers the extension and popup. `npm run build` checks application types and packages both the production app and versioned extension download.

## Backend

Apply the numbered migrations in order. `supabase db reset` requires a working local Supabase database runtime. The test suite also runs the migrations against PGlite with Supabase-compatible auth/storage fixtures; that is not a substitute for a full local Supabase reset.

Deploy `supabase/functions/ai-gateway` with `verify_jwt=false`. The function verifies the actual user session through Supabase Auth. Legacy-only platform JWT verification must be off so the function can accept current signing keys and enforce its documented 400/401 responses. Model registries and metering functions are private to the service role.

Provider features start disabled. Set the server environment from `.env.example`, verify the account's provider data controls, and enable reviewed registry entries. Google Programmable Search requires an existing eligible search account. Free model features still have daily call and dollar limits.

Private owner sign-in is available in **Me → Settings**. Provision an existing owner in Supabase Auth, activate that account, and create its application profile and usage limits before sending a link. Public signup, invites, and onboarding remain excluded. Local imports work without signing in.

The sign-in form sends a one-time email link with account creation disabled. Open it in the browser where the imports were added. Signing in does not move or upload device files: use **Review device files**, choose the sources, then **Use selected files**. **Save to account** stores the selected sources and goal online. Conflicting account sources are preserved and must be deselected before copying. Signing out only ends the session on that device.

For local development, Supabase's Site URL is `http://127.0.0.1:5173/`, with that address and `http://localhost:5173/` explicitly allowed as redirects. Keep public signup disabled and email confirmation enabled. A deployed app requires its exact origin in the Auth redirect list and gateway allowed origins before sign-in can work there.

## Privacy and evidence

LinkedIn archives are parsed in the browser. The connection pool is independent of tracked relationships. Raw career facts and complete profile reads are immutable snapshots. Received LinkedIn messages contribute counts only. The private rebuild archive is sanitized; original received bodies are excluded. Mailboxes are never uploaded, and received mailbox bodies are never decoded.

AI synthesis references original evidence and cannot update it. Search snippets are unscored and do not qualify as a complete profile read. Telemetry permits only a closed vocabulary, counts, and booleans.

## Hackathon checkpoint

See [CHECKPOINTS.md](CHECKPOINTS.md) for the submission context, demo story, and verified versus pending acceptance checks. Credentials, personal files, and generated test output are excluded from source control.

## Living product plan

The [product plan and build record](https://riteshmitsloan.github.io/mighty/) is published from `main` and `/docs` on GitHub Pages. It records implemented features, verification results, remaining work, algorithms, pricing assumptions and the approved brand book. Local review notes stay in the viewer's browser.

The editable plan remains in the local `work/product-plan` directory. On that workspace, a successful production build regenerates the plan and `scripts/publish-product-plan.mjs` prepares the public snapshot with an explicit list of brand assets. It checks document links, fragments and CSS font references before publication. Commit the refreshed `docs/` snapshot and push `main` to update the website. A checkout without the local plan source retains the published snapshot and still builds the app normally.

## Design and content

The approved warm Mighty concepts are implemented with a bundled Schibsted Grotesk font. See [CONTENT-REVIEW.md](CONTENT-REVIEW.md) for the critique, condensed wording, and remaining product choices.
