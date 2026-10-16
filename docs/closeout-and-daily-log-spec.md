# SiteSnap: Close-Out + Daily Log (Build Spec)

> Saved from Ky's spec (2026-10-16). Feature B (Daily Log) is built: see `docs/daily-log-build.md` for what was built, the corrections found (manpower company is `contact_id`, not `vendor_id`) and how to confirm the rest. Feature A (Close-Out) is not built yet.

**Audience:** Claude Code. Put this file in the repo's `docs/` folder and build from it.
**App:** SiteSnap AI (`sitesnap-procore.vercel.app`), installed in the Procore sandbox project "1234 - Sandbox Test Project".
**Build on the existing app.** Match the current stack, auth, capture components, and styling. Do not restyle anything and do not rewrite working features.

---

## 0. Context and rules that apply to both features

### Product stance (do not violate)
- A foreman should never have to open Procore. Everything happens in SiteSnap. The PM sees the result in Procore's own dashboard.
- Every action is one capture: photo(s) and/or voice, then a **review card**, then **Send**. Nothing is written to Procore until the user taps Send.
- Easy enough for a non-technical user. Big buttons, plain words, one thing per screen.
- Voice capture must run **outside Procore's embedded frame** (the microphone does not work inside the iframe). Reuse whatever the app already does for this.

### Reuse what already exists
- Project picker and project home screen (Report an issue, Message, Project photos). Add two new tiles/entries described below.
- Photo capture, voice recording, transcription (Deepgram), and the review-before-send pattern already used for Observations and Punch Items.
- Procore's recommended upload method already used for Observations. Use the same one for any attachment in this spec.
- Per-user Procore sign-in. Every API call runs as the signed-in person, so Procore enforces their permissions.

### Procore API ground rules
- Every call needs the `Procore-Company-Id` header.
- Read the rate-limit headers on responses (limit, remaining, reset). On 429, back off until reset; never hammer.
- **Verify every endpoint path, field name, and allowed value against the live developer reference and a real sandbox call before relying on it.** Where this spec says "verify", the shape below is the best known version but was not confirmed against a live response.
- Map errors to plain language:
  - 401: ask the user to sign in again.
  - 403: "You don't have permission to do this on this project." Use the specific wording pattern already used for photos ("You don't have permission to add photos to this project.").
  - 404: "That item is no longer available."
  - 422: show Procore's validation message in plain words and let the user fix it.
  - 429: "Procore is busy, trying again in a moment" with automatic retry.
- If a send fails, keep the draft (photos, transcript, edits) so the user can retry. Never lose a capture.

### Permissions reality (important)
Permissions are set by Procore project permission templates (company-level Permissions tool). Known from testing:
- Internal foreman template ("Foreman / Superintendent - Internal") has Standard on Photos.
- "Subcontractor - External" has Photos at Read Only, so subcontractor foremen get a 403 until the company raises it to Standard.
- Daily Log and the response/close-out actions may also be limited for subcontractors.

So: **never assume a user can use a feature.** Probe and degrade gracefully (see "Capability check" in each feature).

---

# FEATURE A: Close-Out on Observations and Punch Items

## A1. Goal
Close the loop on items SiteSnap already creates. The foreman opens an item, takes an "after" photo, says "fixed, ready for review," and SiteSnap attaches the photo, adds the comment, and moves the item to **Ready for Review** in Procore. The PM accepts or sends it back inside Procore. If sent back, the foreman sees that in SiteSnap.

## A2. Scope
**In scope (v1)**
- List open Observations and Punch Items for the selected project.
- Item detail screen.
- Close-out capture (photo + voice) producing a response with after photo(s) and a comment, with status set to Ready for Review.
- Show the current status, and show "Sent back" (with the PM's note if available) when an item comes back as not accepted.

**Out of scope (v1)**
- SiteSnap never sets an item to **Closed**. Only the PM/manager closes. (If the API allows a foreman to do it, still do not.)
- Creating new items (already exists).
- Editing item fields (title, due date, assignee).
- Change Events, RFIs.

## A3. User flow
1. Project home shows a new tile: **Close out** (with a count badge of items needing action).
2. **Open items list** for the project. Two tabs: **Mine** (assigned to me or to my company) and **All open**. Search box (title, number, location). Each row: type icon (Observation / Punch), number, title, location, due date, status chip.
3. Tap an item to open **Item detail**: original photo(s), description, location, assignee, status, activity/responses.
4. Tap **Close out** (big button).
5. **Capture screen**: take one or more "after" photos (camera or library) and tap to talk. Transcript appears editable. Default suggested comment if user says nothing: none (leave empty and allow send with photo only).
6. **Review card**: after photo thumbnails, the comment (editable), the status SiteSnap will set (**Ready for Review**), and a **Send** button.
7. On success: green confirmation, item chip updates to Ready for Review. On failure: friendly message, draft kept, Retry button.

## A4. Voice interpretation (keep simple)
Run the transcript through the AI to decide intent. Three outcomes:
- **Fixed / done / ready for review / complete** (or clear synonyms): set status to Ready for Review.
- **Anything else** (for example "can't finish, waiting on parts", "need an answer", a question): do **not** change the status. Post it as a comment only, and tell the user clearly: "Added your note. The item is still open." Offer a button **Mark ready for review anyway**.
- **Unclear**: show the transcript and ask the user to tap **Ready for review** or **Just add a note**.

Never infer "fixed" from silence or from a photo alone. Status changes need an explicit voice or tap.

## A5. Procore API behavior

### Observations
- Statuses (verified against docs): `initiated`, `ready_for_review`, `not_accepted`, `closed`.
- Preferred write: create a **response log** on the item so the comment and after photos are recorded with the status change.
  - `POST /rest/v1.0/observations/items/{id}/response_logs`
  - Body includes `project_id`, `status: "ready_for_review"`, `response_log.comment`, and attachments (either multipart file attachments or `response_log.prostore_file_ids` using Procore's recommended upload). Use the same upload method the app already uses for Observations.
- Fallback if response logs are not permitted: `PATCH /rest/v1.0/observations/items/{id}` with `observation.status`. Note this alone does not attach photos, so attach them by the recommended upload method if possible.
- Read the current state: `GET /rest/v1.0/observations/items/{id}` and `GET /rest/v1.0/observations/items/{id}/response_logs?project_id=...` (use the logs to show the PM's "not accepted" comment).
- Always pass `project_id` where the endpoint requires it.

### Punch Items
- Items are listed with filters (status, assignee_response, and others). Use the project-scoped list that the app already uses, or `GET /rest/v1.1/punch_items` with `project_id` and filters (verify).
- A punch item has one or more **assignments** (one per assignee). The foreman responds on **their own assignment**:
  - `PATCH /rest/v1.0/projects/{project_id}/punch_item_assignments/{id}`
  - Body: `punch_item_assignment` with `status`, `comment`, and attachments. The documentation example uses `status: "ready_for_review"` with a comment.
  - **Verify:** list responses show assignment states like `resolved` / `unresolved`, so confirm in the sandbox which exact value moves the item to what the Punch List screen labels "Ready for Review," and map it in one constants file.
- To respond, the signed-in user (or their company) must be an assignee. Find the assignment belonging to the current user. If none exists, show: "This item isn't assigned to you, so you can't mark it ready for review," and offer **Add a note** only if the API allows a comment.
- The punch item manager accepts the response in Procore. SiteSnap shows the result by reading assignment fields such as `responded_at`, `manager_accepted_at`, and `approved`, and the item's activities (`GET /rest/v1.0/punch_items/{id}/activities?project_id=...`) for the manager's comment.

## A6. Capability check
Before showing the **Close out** button on an item, determine whether the user can respond:
- Observations: user can see the item and the project allows response logs for their template. If a probe is not possible, show the button and handle the 403 on send with the friendly message.
- Punch: user has an assignment on the item.
- If not allowed, hide the button and show a one-line reason ("You can view this item, but you can't update it.").

## A7. Statuses shown in SiteSnap (plain words)
| Procore | SiteSnap chip |
|---|---|
| Observation `initiated` / Punch open | Open |
| `ready_for_review` / Punch response awaiting review | Waiting on PM |
| `not_accepted` / manager rejected | Sent back (red) |
| `closed` | Closed |

## A8. Data and storage
- Keep a local **draft** per item (photos, transcript, comment, intent). Cleared on successful send.
- After a successful send, refetch the item from Procore rather than trusting local state.
- Do not store Procore tokens in new places. Reuse the existing session approach.

## A9. Test plan (add to the existing test/check page)
Add a **Close-out checks** group to the existing Procore check page, run as the signed-in user, with plain pass/fail lines like the existing ones:
1. List open Observations (200).
2. List open Punch Items (200).
3. Create a clearly labeled test Observation response with an after photo, status Ready for Review (200/201). Sandbox only.
4. Respond to a test Punch Item assignment with ready-for-review (200). Sandbox only.
5. Read back the item status after each write.
6. Confirm "Closed" is never sent by SiteSnap code (code-level assertion or unit test).

Run as each persona and record results:
- **Chloe** (template: Foreman / Superintendent - Internal): expected to pass if she is an assignee.
- **Edward**: expected to pass.
- **A subcontractor foreman user** (template: Subcontractor - External): record which steps return 403 and confirm the friendly message appears.

## A10. Done when
- Foreman can complete close-out in under 30 seconds with: open item, photo, speak, Send.
- The after photo and comment appear on the item in Procore, and status shows Ready for Review.
- PM sees it in Procore's own dashboard without any SiteSnap step.
- Rejected items show as "Sent back" in SiteSnap with the PM's note.
- 403, 429, and offline failures keep the draft and show friendly messages.

---

# FEATURE B: Daily Log by Voice

## B1. Goal
A foreman speaks one natural update, for example:
> "Six guys on site, drywall delayed waiting on materials, forklift delivery at 10."

SiteSnap transcribes it, the AI splits it into structured Daily Log entries (**Manpower, Delays, Deliveries, Notes**), the foreman reviews and fixes them, and SiteSnap writes them into Procore's Daily Log with photos attached.

## B2. Scope
**In scope (v1)**
- New **Daily log** entry on the project home screen.
- Voice (one or more recordings) plus optional photos.
- AI parsing into the four sections, a review screen with editable cards, and a Send that creates the Procore log entries.
- Date defaults to today (project's local date), changeable.

**Out of scope (v1)**
- Weather, visitors, inspections, safety, accidents, equipment, and other Daily Log sections. Anything that does not fit the four goes into **Notes**.
- Editing or deleting previously submitted logs.
- Approvals workflow (read the status back; do not manage it).

## B3. User flow
1. Project home: new tile **Daily log**.
2. **Capture screen**: date chip at top (Today), big **Tap to talk** button, **Add photos** button. User can record several times; transcript accumulates and is editable. Button: **Organize my log**.
3. **Review screen** (the key screen). Four collapsible cards, each with its entries, all editable, each with delete and "add entry":
   - **Manpower**: company, number of workers, hours, trade (if the API supports it), location.
   - **Delays**: reason/type, start time, end time (or duration), company, comment.
   - **Deliveries**: what was delivered, time, from/vendor, comment.
   - **Notes**: free text.
   Items the AI is unsure about are marked with an amber "Check this" tag and a short reason ("Did you mean 10 AM or 10 PM?").
4. **Photos** are shown as thumbnails; the user taps a photo to attach it to a specific entry (default: attach to Notes, or to the entry it was taken for if the user chose one). Unattached photos can be sent with Notes.
5. **Send to Procore** button. Results screen lists each entry with a check or a red x and a Retry for failed ones.

## B4. AI parsing contract
The model receives the transcript, the log date, the project's time zone, the foreman's company, a list of project companies/vendors (from the Directory, name + id), and the project's delay types. It must return **strict JSON only**, no prose.

```json
{
  "manpower": [
    { "company": "string|null", "worker_count": 6, "hours": null, "trade": null, "location": null, "source_phrase": "six guys on site" }
  ],
  "delays": [
    { "delay_type": "string|null", "start_time": null, "end_time": null, "duration_hours": null, "company": null, "comment": "Drywall delayed waiting on materials", "source_phrase": "drywall delayed waiting on materials" }
  ],
  "deliveries": [
    { "description": "Forklift", "time": "10:00", "vendor": null, "comment": null, "source_phrase": "forklift delivery at 10" }
  ],
  "notes": [],
  "needs_confirmation": [
    { "path": "deliveries[0].time", "reason": "AM or PM not stated" }
  ]
}
```

Rules for the prompt:
- **Never invent facts.** If something is not said, use `null`. Do not guess hours, companies, or delay causes.
- Include `source_phrase` for every entry so the review screen can show where it came from.
- Spoken numbers become numbers ("six" becomes 6).
- Times become 24-hour `HH:MM`. If AM/PM is ambiguous, put the best guess in the field and add a `needs_confirmation` item. Construction day context (7 AM to 6 PM) can be used to suggest, but must be flagged.
- Anything that does not fit Manpower, Delays, or Deliveries goes to Notes verbatim-ish.
- If the foreman's company is the obvious subject ("six guys on site"), set `company` to null and let the app fill the foreman's own company by default; do not fabricate a company name.
- Company names the user mentions must be matched against the provided project companies. If no confident match, set `company` to null and add `needs_confirmation`.
- `delay_type` must be chosen from the provided project delay types. If none fits, null and flag.
- Validate the JSON with a schema before showing it. On invalid output, retry once, then fall back to putting the whole transcript in a single Notes entry with a message "I couldn't organize this. It's saved as a note."

## B5. Procore API behavior
All logs are created per project and tied to a **daily log header** for the date (verify how headers are created or looked up).

Known endpoints (verify paths and payloads in the developer reference and sandbox):
- **Manpower:** `POST /rest/v1.0/projects/{project_id}/manpower_logs`. Expected fields include date/time, number of workers, number of hours, company/vendor id, location id, comments (verify names).
- **Delays:** `POST /rest/v1.0/projects/{project_id}/delay_logs`. Payload object `delay_log` with fields confirmed in docs: `daily_log_header_id`, `delay_type`, `location_id`, `daily_log_segment_id`, `start_time` (`HH:MM`), `end_time` (`HH:MM`), `vendor_id`, and a comments field; supports `attachments[]` via multipart/form-data. Response includes `duration` (1 to 24 hours) and `status` (pending or approved).
- **Delivery:** `POST /rest/v1.0/projects/{project_id}/delivery_logs` (verify).
- **Notes:** `POST /rest/v1.0/projects/{project_id}/notes_logs` (verify). Supports attachments and locations.
- **Delay types are configurable per project.** Fetch the project's visible delay log types (`/rest/v1.0/projects/{project_id}/daily_logs/delay_log_types`, verify) and give the AI that list. Do not create new delay types.
- **Lists/filters:** daily log list endpoints take `log_date`, `start_date`, `end_date`. If none are given, only today's logs are returned. Use this to read back what was submitted.
- Where the endpoint accepts multipart attachments (delay, notes, others), send photos with the entry. Where it does not, use Procore's recommended upload and reference the file, same as the Observation approach. Verify per endpoint.
- Write entries sequentially (or small parallel batches) respecting rate limits, and track success per entry. A failure on one entry must not block the others.

## B6. Defaults and mapping
- **Company:** default to the foreman's own company from the Procore Directory for Manpower and Delays. Show it on the card so they can change it from the project's company list.
- **Location:** optional. Use the project's locations (same list the existing "Where" box uses) only if the user names one that matches. Otherwise leave blank.
- **Date and time zone:** use the project's time zone, not the device's.
- **Status:** do not set pending/approved. Procore controls it per project settings. Read it back and show "Waiting on approval" if pending.
- **Duplicates:** before Send, fetch today's logs for the user's company. If entries already exist, show "You already logged X today. Add anyway?" Never auto-merge in v1.

## B7. Capability check
Daily Log access varies by permission template.
- On opening **Daily log** for a project, do a lightweight read (list today's logs). If 403, show: "You don't have permission to use the Daily Log on this project," and hide the capture screen.
- If reads work but a create returns 403 on one section, mark that section's entries as failed with the permission message and let the rest go through.

## B8. Data and storage
- Save the in-progress capture (audio transcript, photos, parsed JSON, edits) as a **draft** so the foreman can leave and resume the same day.
- Keep the raw transcript with the sent log record in SiteSnap (if the app already stores sent items) for traceability.
- Do not log full transcripts to server logs.

## B9. Test plan (add to the existing test/check page)
Add a **Daily Log checks** group:
1. Read today's logs (200).
2. Fetch project delay types (200).
3. Create a test Manpower entry (sandbox only, labeled "SiteSnap test"), then verify read-back.
4. Create a test Delay entry with a photo attachment.
5. Create a test Delivery entry.
6. Create a test Notes entry with a photo.
7. Rate-limit headers displayed (as already done).
8. Clean up test entries (delete) if the API and permission allow; otherwise label them clearly.

AI parsing test cases (unit tests against the parser, no Procore calls):
| Input | Expected |
|---|---|
| "Six guys on site, drywall delayed waiting on materials, forklift delivery at 10." | Manpower 6; Delay with drywall/materials comment; Delivery "forklift" at 10:00 flagged for AM/PM; Notes empty |
| "Just a quiet day, nothing to report." | Notes only |
| "Eight framers and three electricians, rain stopped us 1 to 3." | Two manpower entries; one weather-type delay 13:00 to 15:00 (if the type exists, else flagged) |
| "Concrete truck from ABC Ready Mix at 7:30." | Delivery with vendor matched or flagged |
| Gibberish or empty | Friendly "I didn't catch that" with a re-record prompt |

Run as Chloe, Edward, and a subcontractor foreman and record which steps pass or 403.

## B10. Done when
- A foreman can say one sentence, review four sorted cards, tap Send, and see the entries in Procore's Daily Log for the right date and project.
- Nothing is invented. Anything uncertain is flagged on the review screen.
- Photos appear on the entries in Procore.
- Partial failures are shown per entry and retryable.
- No access means a clear message, not a broken screen.

---

# Open questions (defaults chosen; change only if you disagree)

1. **Who sees "Mine"?** Default: items where the user or their company is an assignee. "All open" shows everything the user can see.
2. **Require an after photo for close-out?** Default: yes, one photo minimum, with a **Skip photo** link that requires typing or saying a reason.
3. **Can SiteSnap ever set Closed?** Default: no, never.
4. **Also file close-out photos into Procore's Photos album?** Default: not in v1. Attach to the response only. (Photos permission may be missing for some users.)
5. **Daily log photos:** attach to a chosen entry, default to Notes.
6. **Daily log vendor default:** the foreman's own company.

## Suggested build order
1. Constants file for Procore status values plus a small `procoreError` mapper (shared).
2. Feature A: lists, item detail, close-out for Observations, then Punch Items, then the check-page group.
3. Feature B: capability check, AI parser plus schema validation and unit tests, review screen, writers per section, check-page group.
4. Run all check groups as Chloe, Edward, and a subcontractor foreman, and save the results as `docs/closeout-dailylog-test-results.md`.
