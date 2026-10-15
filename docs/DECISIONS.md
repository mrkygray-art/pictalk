# SiteSnap AI: decisions

## 2026-10-14, voice + photo → Procore record (`SPEC_voice-photo-to-procore-record.md`)

**A. Who writes to Procore: each person, with their own Procore sign-in.**
- Ky: "All people in the project will have logins."
- So every record is created with the signed-in reporter's own Procore token (user-level OAuth, the authorization-code app we already have), and Procore shows the real author.
- No stored PM token and no service account for now.
- All writes go through `api/_procoreWrite.js`, so a Developer Managed Service Account could replace this later without other changes.
- Tokens stay in the server-side, encrypted, httpOnly cookie, as today.
- The limit: a person can only create what their own Procore permissions allow. For example, Observations need permission on the Observations tool, and the assignees must be people they're allowed to assign. Procore's 403 names who was refused.

**B. Who closes items:**
- Done in SiteSnap moves the item to "ready for review" / "ready to close".
- The PM (the Punch Item's final approver) closes it, with a one-tap Close in SiteSnap or in Procore.

**C. Procore's email on create:** sent to the assignee only.

**"Reported by":** always written in the description ("Reported by {name} via SiteSnap AI"). Also in the Punch Item's `reference` field and the Change Event's `external_data` when those come in.

Sources: `docs/PROCORE_API_NOTES.md`.
