# Hackathon checkpoints

## Sunday noon check-in: September 13, 2026, Boston time

Mighty supports intentional professional networking: choose a goal, inspect the evidence for a person, prepare a conversation and remember the next step. Career moves and fundraising are separate goals, so the same person can have different relevance to each. Current ordering uses transparent rules, not a probability that someone will help.

- Repository: https://github.com/riteshmitsloan/mighty
- Working app: /mighty/; living product plan: /mighty/plan/ on the published GitHub Pages site.
- Confirmed deployed checkpoint: b44795c. The existing signed-in Chrome tab now renders Today and the goal editor with the current app bundle. No new Mighty application error appeared after reload; the old crash logs remain historical.
- Team: Ritesh Mohan Srivastava and Jayati Kambhampati.
- This document records progress and a demo agenda. Updating it sends no submission or email.

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

The approved classification, profile-briefing, Ask and search-keyword slots use Gemini 3.1 Flash-Lite. Ask and search have not had separate paid acceptance calls. These checks establish narrow compatibility and usage accounting, not monthly cost per user, general answer quality or provider-invoice reconciliation. Optional Astra drafting remains disabled and unverified. Source: work/product-plan/build-log.json.

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
