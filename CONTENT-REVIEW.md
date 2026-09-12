# Mighty content review

The approved top-level Mighty concepts remain the visual reference: warm surfaces, indigo and coral, Schibsted Grotesk, overlapping-circle mark, and the Today / Relationships / Explore / Me structure.

The content needed fewer explanations and more precise actions. The implementation makes these changes:

- Use **goal** consistently instead of alternating between intention, direction, strategy, and goal. Keep the editable goal in Me and a short summary on Today; avoid repeating the full goal as every page title.
- Give an empty workspace one useful starting action: import an archive, then explore its connections. Remove empty recent-activity filler and hide update capture until someone has been saved.
- Use **Record an update** for notes, replies, conversations, and promises. “Capture a note” understated what that action does.
- Explain source storage once in an expandable disclosure. Distinguish local parsing from saving processed data to an account. State that received message bodies are excluded and the raw mailbox never uploads.
- Label public search results **No score yet**. Keep a brief explanation of why a real profile read is needed. Remove repeated warnings, the repeated question above an answer, and a misleading claim that every matched archive record reached the model.
- Keep the search headline and snippet after a person is saved, clearly labeled as unverified search context. They never count as a completed profile read.
- Remove duplicate navigation, headings, marketing lines, and descriptions of internal queues or profile anchors. Keep status and error messages that help someone recover.
- Keep actual imported facts and actual relationship history. Reference-design names, activity, counts, and scores are not seeded into the app.

The review also uncovered behavior defects. A committed save is now separate from a failed list refresh, with a read-only refresh action. Notes belong to a specific person and do not follow navigation to another person. Account changes clear the active drafts.

Remaining product decisions: the extension currently opens as a Chrome popup; an inline LinkedIn panel has not been implemented. Account sign-up remains excluded as requested, so cloud saves and model calls need an existing connected account. Google web search still needs its provider configuration.
