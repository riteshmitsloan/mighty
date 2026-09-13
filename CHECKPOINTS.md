# Hackathon checkpoints

## Sunday noon check-in: September 13, 2026, Boston time

Mighty supports intentional professional networking: choose a goal, inspect the evidence for a person, prepare a conversation and remember the next step. Career moves and fundraising are separate goals, so the same person can have different relevance to each. Current ordering uses transparent rules, not a probability that someone will help.

- Repository: https://github.com/riteshmitsloan/mighty
- Working app: /mighty/; living product plan: /mighty/plan/ on the published GitHub Pages site.
- Confirmed deployed checkpoint: b44795c. The existing signed-in Chrome tab now renders Today and the goal editor with the current app bundle. No new Mighty application error appeared after reload; the old crash logs remain historical.
- Team: Ritesh Mohan Srivastava and Jayati Kambhampati.
- This document records progress and a demo agenda. Updating it sends no submission or email.

## Open on the best-fitting goal: 0.3.10

The automatic profile panel now selects Strong potential before Possible fit, keeping saved goal order for ties or when no goal has a relevant fit. Raw ranking values are not compared across goals. A deliberate pill selection remains selected while the same profile loads more evidence; moving to a different profile restores automatic selection. This changes only the displayed goal, not saved goals, account state or scoring evidence.

Validation: all 249 extension checks, strict TypeScript and production packaging pass. The unchanged app retains the prior 482 core and 146 UI results. All 19 installed files match ZIP SHA256 70bb8a90fc5166383af2d7e101bb58c3a26187dce4f675943a66d66646fb2ec7. Native 0.3.10 default-selection acceptance awaits Reload.

Native 0.3.9 comparison confirmed independent results: Richard Fearn had Possible fit for funding and No clear connection yet for career; Jason Gerding had Strong potential for career and No clear connection yet for funding after Experience loaded. Both had one connected panel with the correct name. Richard's photo appeared; Jason used initials. No save, model call or outreach was performed.

## SDUI headline recovery: 0.3.9

The owner reloaded 0.3.8 and confirmed that Richard Fearn's panel appeared. Native feedback exposed a second, separate omission: the visible investor headline was absent from the assessment because that layout uses an unlabelled paragraph. The markerless test had explicitly expected that paragraph to be ignored; a successful panel mount did not verify input coverage.

Version 0.3.9 recovers the headline only when the independently URL/name-bound toolbar's headline also occurs uniquely in the verified profile's name section. This applies to both supported SDUI identity layouts. The headline remains provisional context, not a typed current role, employer, investor mandate or opportunity claim. A headline can suggest a fundraising conversation without proving that the person will invest. The captured native DOM replays as Possible fit for funding from the exact investor headline and No clear connection yet for the career goal. All 241 extension checks, strict TypeScript and production packaging pass; the unchanged app retains the prior 482 core and 146 UI results. All 19 installed files match ZIP SHA256 5bc126e51f9b2f8c33ca9b8953fe101fc31ec85207d6e0b838cae8c28ec6d9a7. Native 0.3.9 profile and cross-goal acceptance passed as recorded above.

Version 0.3.8 was published as bdb0bb3. Pages run 34778944663 succeeded; the public app, plan and extension ZIP matched the tested bytes. That deployment includes the goal-chat repair. Its native panel appearance is confirmed; headline coverage required the follow-up above.

## Profile visibility, contact tiers and goal-chat repair: 0.3.8

Native Chrome inspection reproduced a missing panel on a markerless LinkedIn profile. Its unique top card had a valid name and Contact info link but no verification-trigger marker. The new fallback requires agreement between that name, the exact Contact info URL and an independent rendered toolbar name/URL. Conflicting identities, incomplete navigation and self-edit controls still suppress the panel. Ten new regressions cover this layout and its boundaries; layouts without either supported identity path remain unread.

A native comparison on the previously installed extension showed Possible fit for one senior contact's career goal and No clear connection yet for fundraising after Experience loaded. The initial repeated unknown label came from incomplete evidence. Separately, the old Strong potential rule required all opportunity criteria to be supported by contact-only evidence, making Strong unreachable for the owner's mixed career goal and single-criterion funding goal. Version 0.3.8 judges the compact contact tier separately: a verified user-chosen contact role can be Strong; provisional headlines, generic routes and partial preferences remain Possible. Opportunity unknowns remain unknown, and explicit contradictions still surface. Synthetic cross-goal cases cover executive, recruiter, investor and unrelated roles. No percentage or success probability is introduced.

After explicit approval, only the owner's latest cached Ask response was read to reproduce the goal-chat error. The provider omitted origin metadata on unchanged criteria and invented a year in display text. The client restores omitted metadata only for the same existing identifier and exactly unchanged meaning. Unsupported displayed numbers or dates produce a neutral clarification with no proposal, no extra call and no goal change. The actual cached failure now replays as a timing question. Public tests contain an anonymized equivalent, not the private response. This is a replay, not a new live model-quality acceptance test.

Validation: 482 release core, 146 UI and 234 extension checks passed, plus strict TypeScript and production packaging. All 19 installed files match the packaged ZIP, SHA256 a44fb58b029772c97dc02cbe76ab373b1baacb2b4ac0b3caa844d0dbaad210f1. Native 0.3.8 acceptance awaits Chrome Reload. Production deployment of 0.3.7 was verified at commit 55b0c6c, successful Pages run 34777460762, with matching app, plan and ZIP bytes.

## Contact relevance, common ground and activity: 0.3.7

The owner confirmed 0.3.6 works across profiles. The remaining assessment gap involved contact-versus-opportunity logic and grouped Experience parsing. Version 0.3.7 adds conservative senior, recruiter, hiring-headline and investor routes. Explicit current child jobs retain both child and employer-group provenance. A headline supplies only a provisional route, not a current-role claim or Strong potential by itself.

With the owner's authorization, both goals were saved through the signed-in hosted editor. Existing targets were preserved. Career now includes preferred hiring, recruiting and senior-leader contacts; funding includes investor, angel and VC contacts. Each account save was confirmed. No model call or outreach was needed.

Shared employer, education, skill and work-history topics retain citations from both people. At most 40 factual self claims are tied to the verified extension account with a 15-minute lease. The panel shows one talking point. The app displays source facts and allows explicit selection for a draft without replacing text. Account/source races and draft preservation are covered by regressions.

Activity summarizes only visible preserved items, literal hashtags and dated section-level timestamps. It does not establish posting cadence, authored-post counts, follower totals or reply probability. Missing data is not inactivity. Cross-account responsiveness remains a future opt-in proposal.

Validation: 477 release core, 146 UI and 219 extension checks passed, plus both TypeScript checks and production packaging. The 24 unrelated uncommitted research tests are excluded. The real compact renderer was visually inspected in Chrome using fictional profile data. All 19 files in the existing installed folder match extension ZIP SHA256 75ac4e456cd1926d9c86de0901e84a4b832ff6f8e212c65e3693adfbb5a44578. Native installed 0.3.7 acceptance remains pending Reload; earlier native Save/navigation evidence is not a new claim for this release.

## Extension reload repair: 0.3.6

The reported native Chrome error was `Extension context invalidated` at the panel's font URL lookup. An old content script could keep running after an extension reload and throw before the font loader's own error handling. Version 0.3.6 guards that lookup and stops the invalidated controller's observers, route polling, timers and pending UI updates. Teardown tolerates invalid runtime access, removes only its own panel, and ignores callbacks from replaced connection ports.

Seven regression cases cover invalid resource lookup, listener teardown, scheduled reads and controller replacement. All 196 extension checks and strict extension TypeScript pass. In a fresh native Chrome tab on installed 0.3.5, exactly one connected panel appeared at top 82/right 22 pixels and changed to Possible fit when the current executive role rendered. That verifies the fresh-tab path, not native 0.3.6 reload recovery. Installing the new package cannot rewrite already executing 0.3.5 callbacks: Chrome Reload and a one-time LinkedIn page refresh are still needed.

The AI goal conversation and 0.3.5 download were published in commit 057aefc. GitHub Pages run 34772573558 succeeded; the public app assets matched the built files and the public ZIP matched SHA256 bd825d2d5bc1c2029142cbdadfc377fc100cd6cd33470e562d5ea087d31bc63d. Version 0.3.6 passes strict app TypeScript and production packaging. All 19 installed files in Documents/mighty-extension match the download, SHA256 4e67e3cbedb0bead0eaa9d404d5848b1154988a56b291293d2f55685204755b2. Chrome Reload and native 0.3.6 acceptance are pending.

## Goal conversation and profile navigation: September 13 afternoon

The Goals page now offers an AI conversation above the manual editor. It asks focused follow-ups through the enabled, metered Ask slot, validates a compact JSON proposal, and requires Review, Use these details, then the existing Save goal action. Answers persist by account and goal; late responses cannot overwrite edits or cross account boundaries. Exact owner-sourced quotes ground new criteria, individual investor check size stays separate from the total round, unknowns remain questions, and explicit role inflections are normalized for matching. No file or network archive accompanies the request.

19 goal-coach domain checks, 141 UI checks and 189 extension checks pass. Three live requests in one fictional career interview returned a contextual follow-up and two valid reviewable proposals, including the final singular contact-role normalization; no goal was saved. Automatic approval review refused the attempted private-goal test before dispatch, so only fictional inputs were used for live model acceptance. This establishes a bounded interview/proposal path, not every goal's recommendation quality or a measured price per user.

Native Chrome 0.3.4 followed a LinkedIn profile link without a page refresh, showed the new person's name/photo in exactly one top-right panel, and updated to Possible fit when that person's Experience section rendered. Source version 0.3.5 also refuses old-person section evidence while the new header hydrates. Eight regression cases cover this source-attribution guard, alongside the navigation observer tests. The user confirmed Chrome had loaded 0.3.5. A fresh-tab native check and the subsequent reload error are recorded above. Toolbar connection-only behavior and the earlier Save-to-app acceptance remain as recorded below.

## Private login ID and password

Private accounts now support direct login ID/password sign-in alongside existing email links. Login IDs use reserved internal identifiers and do not receive email or recovery links. No signup is added, passwords are never placed in application storage, and generic failure copy avoids revealing account state. Five new password-domain checks, all 126 UI checks, strict TypeScript and production packaging pass.

A targeted live check confirmed exactly two Auth accounts. Jayati's current MIT account was missing public.users, settings and AI-limit records, explaining successful login followed by the active-account goal-save refusal. After explicit approval, a transaction pinned to that exact Auth ID and email created her active workspace, settings and standard limits. The result verified active status, settings present, 20 Assists/day, 40 total calls/day, a $5 monthly ceiling and standard tier. Existing rows were not overwritten and her password was not changed. The earlier temporary internal-identifier login is no longer present. Jayati can retry her preserved goal; a successful save from her device remains to be confirmed.

## Final reader and role repair: 0.3.3

The second observed layout has no employer link. Its current role and company are recognized only when the rendered company-logo label, job-entry hierarchy and valid current date agree. VP/Vice President, dotted V.P., SVP/EVP and CAIO aliases now establish possible career contact routes while preserving unknown openings, negative role statements and assistant/advisor exclusions. No fundraising mandate is inferred from a job title.

415 release core, 120 UI and 177 extension checks pass. The 24 unrelated uncommitted Tavily checks are excluded. The native connected top-right panel, photo and Save-to-app acceptance below passed on 0.3.1. After Reload, native Chrome showed Possible fit for an actual current V.P. R&D entry with a career-contact reason; no vacancy was asserted. A later report of profile-to-profile navigation failure is being investigated separately.

## Native extension follow-up: 0.3.2

Native Chrome confirmed one connected top-right panel with the bundled font, profile photo and independent goal switching. A real Save reached the owner's Relationships list and survived reload; the photo, profile-read status and rendered profile context were visible in the main app. No LinkedIn invitation or message was sent.

That test also caught an incorrect assumption in the first SDUI repair: the URL-bound Experience marker is an empty sibling of the entries. Version 0.3.2 searches for entries within that exact verified section and retains the cross-section rejection rules. Three new sibling-layout and boundary regressions cover the observed structure. 166 extension domain checks and 8 toolbar-render checks pass, alongside strict TypeScript and production packaging. All 19 files in the installed Documents/mighty-extension folder match ZIP SHA256 8756f8db1d631b6ca39a4f871ad8411fb9deb06a272951b964719afc6617717e.

The native connection and Save evidence above is from 0.3.1. Native typed-current-role acceptance for the corrected 0.3.2 reader awaits Reload. Broader assessment usefulness, opportunity facts and fundraising stage remain unresolved; a possible contact route is not proof of hiring authority or investment intent.

## Extension repair: 0.3.1

The toolbar popup now shows connection status only. A single compact assessment appears automatically at the top right of a verified other-person profile. Own profiles, feed, articles and search stay clear. The bundled font loads in the page panel with a sans-serif fallback.

Native Chrome inspection found two independent failures: stale sender-tab metadata rejected the on-page account connection during navigation, and the current LinkedIn Experience layout retained raw text without recognizing its role/company fields. The worker now checks the current committed tab URL and rechecks the same profile around asynchronous operations. The parser recognizes a narrowly verified current Experience entry, preserving raw text and date provenance. Historical, grouped and ambiguous entries stay context.

Missing goal criteria now ask for goal details; missing profile evidence names the actual gap. A current executive role can establish a possible contact route without asserting an open job. A funding goal title alone does not establish an investor mandate. The owner's explicitly supplied career targets were restored through the signed-in goal editor and the account save was confirmed. Investment stage remains awaiting clarification.

Extension 0.3.1 passed 163 domain checks and 8 toolbar-render checks, strict extension TypeScript and production packaging. All 19 installed files in Documents/mighty-extension match the published ZIP, SHA256 4e02d3919e191f359e59a62dc34ef935351339cb304f07e472be5eec8f4e67a7. Native installed 0.3.1 connection, profile read, Save and app reopen remain pending Chrome Reload. The 0.3.0 figures below are historical release checks, not acceptance of this repair.

## Verified current evidence

| Area | Evidence | Boundary |
| --- | --- | --- |
| Goals and assessment | Independently versioned goals, required/preferred criteria, switching, source-linked reasons, contradictions and unknowns are implemented. Two goals were saved locally. A real 19,521-connection archive produced a verified browser shortlist. | Working retrieval is not measured recommendation usefulness or calibrated success probability. |
| Conversation loop | The native local goal → person fact → editable draft → next step → completion journey passed. Saved drafts reopen for the current goal and person with provenance and revisions retained. | Copy, Save draft and Record sent are separate. No automatic sending. Current local templates need no model call. |
| Release-source checks | 411 release core tests, 120 UI checks and 153 extension checks pass. App and extension 0.3.0 production packages build. Compact panel, ownership, photo, toolbar and session regressions are included. | The full working directory has 435 core checks because it also contains 24 tests for the uncommitted Tavily adapter. Those 24 are excluded from the release-source count. |
| Sign-in repair | Chrome exposed a crash from malformed saved knowledge. The fix validates derived summaries while preserving original source data; three UI regressions cover the sign-in flow. | Repair deployed and verified in the existing Chrome session. No browser storage was cleared, no draft was changed, and no account record was deleted. A new account-backed save/reload was not part of this repair check. |
| Database and access | Migrations 001–009 pass PGlite checks; 007 and 008 are applied live. Twelve live HTTP checks passed, including anonymous gateway rejection, malformed-body rejection, empty anonymous new-table reads, denied writes and zero other-user usage logs. | Full supabase db reset remains unavailable because the local runtime is missing. Targeted access tests do not establish the owner's full account workflow. |
| Quotas and cleanup | A temporary cap admitted three requests and refused the fourth. Rollback restored the cap to 95. The temporary account was deleted, all six checked tables had zero rows for it, and temporary credential files were removed. | No permanent cap increase or retained test account. |
| Extension | Version 0.3.0 implements the approved compact panel: two goal pills, one evidence-based fit label and reason, subject photo, equal Skip/Save actions and minimize/reopen. Automatic appearance requires a URL-bound other-person profile top card. Self-profile controls suppress it; feed, articles and search stay clear. Toolbar colors reflect verified account state. A goal-loading failure clears stale goals while preserving verified identity. Native current LinkedIn self/other top-card controls were inspected, and the actual renderer was visually checked using synthetic data. | Native installed 0.3.0 profile read → Save → app reopen still requires Chrome reload and acceptance. Unsupported or uncertain profile layouts remain manual-only. The 0.3.1 change above supersedes the assessment and search UI in the toolbar. Photos are validated LinkedIn image URLs; expired/unavailable images fall back to initials. No new extension permissions or automatic outreach. |
| Person research | The pure identity-matching module is implemented. An isolated bounded Tavily adapter and 24 tests exist in the working directory. | Uncommitted, unconnected and no configured key. No live person-research result or completed research workflow is claimed. |

### Live AI evidence

Gemini 3.1 Flash-Lite completed two synthetic smoke tests successfully. Earlier model-access failures are historical, not the current provider status.

| Request | Result | Input / total output tokens | Latency | Audited gateway usage cost |
| --- | --- | --- | --- | --- |
| Classification | HTTP 200; valid person route | 153 / 11 | 1.341 seconds | $0.00005475 |
| Profile briefing | HTTP 200; validated small synthetic summary | 165 / 161 | 1.577 seconds | $0.00028275 |
| Combined | Both reservations completed, neither pending | | | $0.00033750 |

The approved classification, profile-briefing, Ask and search-keyword slots use Gemini 3.1 Flash-Lite. The goal conversation now exercises the Ask slot with a fictional interview; general network-answering and web search still need separate paid acceptance. These checks establish narrow compatibility and usage accounting, not monthly cost per user, general answer quality or provider-invoice reconciliation. Optional Astra drafting remains disabled and unverified. Source: work/product-plan/build-log.json.

### Business evidence

The founders report roughly 30–40 informal batchmate conversations, positive qualitative feedback and some interest around $15–20 per month. The number expressing price interest is not established. These are not paid customers or measured conversion. Mighty serves people with professional goals; MIT and cohort networks are an accessible initial acquisition channel, not a student-only product definition.

## Noon video: 60-second agenda

Prepare one clearly labeled synthetic person and two goals. The hosted sign-in repair now passes. Verify the exact demo goal and person are available before recording. Keep unfinished research and extension work in the closing status.

| Time | Show | Say |
| --- | --- | --- |
| 0–8 seconds | Mighty, repository and one professional goal | “Connections accumulate. Mighty helps turn a professional goal into a supported reason to reach out.” |
| 8–22 seconds | Switch between two goals for the same person | Explain the actual source-backed reason and one visible unknown. Do not invent a match or a probability. |
| 22–38 seconds | Inspect a source fact, then prepare and edit a draft | Show how selected evidence informs the conversation. The user reviews and sends. |
| 38–48 seconds | Record a next step and show relationship history | Demonstrate continuity after the introduction using a synthetic action, not a claim that an actual message was sent. |
| 48–60 seconds | Compact proof and remaining work | “The goal-to-next-step loop works. Today we are completing bounded person research and verifying the real extension-to-app journey.” State the live sign-in status accurately. |

An unverified extension is not a required demo step. Person research is required today, but not yet complete. A previously recorded video exists per the founder; this agenda does not claim a new recording or submission.

## Next 12 hours: measurable focus

1. **Complete the hosted account journey.** The b44795c sign-in repair is live and the existing Chrome session renders. Next verify the exact demo goal and imported context, then complete an account-backed save/reload. Keep that broader acceptance separate from the completed crash repair.
2. **Finish bounded person research today.** Connect the implemented identity gate and isolated retrieval adapter after a server-side key and relevant data-use conditions are resolved. Add the explicit research action, bounded usage accounting, inspectable source excerpts and identity review. Accept supported facts for the intended person; ambiguous identity remains unresolved. Acceptance: one user-selected person researched, reviewed, saved and usable in a draft, with failure and no-evidence states preserved.
3. **Verify the real extension journey.** Exercise explicit profile read, independent reasons for two active saved account goals, Save, inbox drain and app review. Check current-role provenance, missing evidence and account handoff. Record native results separately from passing DOM fixtures.
4. **Observe usefulness.** Prepare three task observations around a near-term professional goal. Capture whether a person can explain a recommendation, prepare a useful message and choose a next step. Recruitment and observations are proposed work, not completed validation or promised conversions.
5. **Package the next checkpoint.** Update the plan with the tested commit, record the short demo and assemble the repository and video. External submission remains a separate action.

Gmail is excluded from today's scope. Public signup, onboarding, passive LinkedIn monitoring, automatic sending, trained ranking and success-probability claims are also excluded. Prioritize the research and relationship loop over additional connectors.

## Event requirements and timing

Founder-supplied context: East v. West 72 Hour Hackathon, kickoff September 12, 2026 at noon EDT. The emails also say environment access ends Monday at noon, a 48-hour interval that needs organizer clarification. Plan conservatively for Monday September 14 at noon until confirmed.

The supplied instructions require a GitHub repository and a 60-second progress video at scored check-ins every 12 hours. Five checkpoint scores are averaged and combined with the final round. Final instructions also list hackofthrones@gmail.com. This records requirements without asserting a submission has occurred.

Rubric: innovation and creativity 30%, technical implementation 25%, business value and impact 25%, presentation and communication 20%. Recommended category: Human Flourishing, with AI Apps as an alternative.

The approved current identity uses Warm editorial, the existing Mighty mark, indigo and coral, and Schibsted Grotesk. Reference names and counts are design placeholders, not product data.
