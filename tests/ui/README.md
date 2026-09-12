# App UI regression checks

Run `npm run test:ui`, configured as `node tests/ui/run.mjs`.

The runner resolves the checkout from its own location, builds the actual App into a unique operating-system temporary directory, runs the checks, and removes generated files. It does not modify the checkout. Dependencies are the project's existing React, React DOM, esbuild, and linkedom packages; no browser or new package is required.

The 15 App checks cover delayed goal hydration, account transitions, a late archive completion, retained search context, save-versus-refresh errors, explicit dialog cancellation, update prerequisites, drafts owned by each person, dropdown switching, account-bound drafts, read-only refresh retry, and preservation after a write refusal. Additional regressions cover saving a copied device goal, explicitly clearing a saved goal, and preserving newer typing during a file transfer.

Sixteen account checks cover existing-account-only email links, safe redirects, retryable errors, duplicate requests, cooldowns, local sign-out, account changes, and unmounts. Ten device-panel checks cover explicit review, source selection, conflict refusal, duplicate actions, changed accounts, and stale previews. Every fixture is synthetic; gateway, account storage, parsers, and extension calls are stubbed.

These are React DOM behavior checks. The helpers invoke React's registered callbacks on rendered controls, and linkedom's dialog methods are stubbed. They do not certify native keyboard input events, focus trapping, backdrop behavior, layout, real IndexedDB, mailbox workers, or live account behavior. Existing parser, database, and browser checks cover those separate boundaries.
