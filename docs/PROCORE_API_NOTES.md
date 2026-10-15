# Procore API notes: voice + photo → Procore record

For `SPEC_voice-photo-to-procore-record.md`, Step 1. Checked 2026-10-14 against Procore's published API reference (the OpenAPI data behind developers.procore.com/reference: `developers.procore.com/api/v1/resource_groups` and its per-resource files).

**Desk check, then the sandbox:** see Sandbox results below. "Confirmed" means the reference says so. The sandbox test script that the spec's Step 1 calls for is waiting on decision A below.

## Sandbox results (2026-10-14, Ky ran `/api/procore/test-records` in "Sandbox Test Project")

Signed in as Edward Gray (Procore user 481274); his own Procore sign-in wrote everything (decision A).

| Check | Result |
|---|---|
| Upload a photo (JPEG) and a sound file (WAV) | Both worked: Procore gave an upload id for each |
| Create an Observation with only name, type, description, status and `upload_ids` | **Created**, id 370992. **Procore numbered it #1 itself.** Status `initiated`, 2 attachments |
| Create a Punch Item with only name, description, reference and `upload_ids` | **Created on the first try**, id 196869. **No manager or final approver needed through the API.** Procore numbered it #1 (`position`). Status Open, workflow `initiated`, 2 attachments |
| Observation types | **22** in this company, across Commissioning, Environmental (9), Quality (Corrective Action, Deficiency, Non-Conformance, Pre-Punch), Safety (6), Warranty (Service Call) and Work to Complete. The test used the first one, Commissioning; the classifier has to pick the right type (usually Quality: Deficiency, or Safety: Safety Hazard). |
| Observation statuses | initiated, ready_for_review, not_accepted, closed (labels Initiated, Ready For Review, Not Accepted, Closed) |
| Webhook events for the project | 96 resources, including **Observation Items**, **Observation Item Response Logs**, **Punch Items**, **Change Events**, Change Event Line Items, Potential Change Orders, Task Items, RFIs, Images. So status sync can use webhooks. |

**Seen in Procore (Ky's screenshots of Observation #1):**
- **Private was on.** The project's Observation settings make new items private, and that applies to API creates too. Real records must send `personal: false` (Observations) and `private: false` (Punch Items) so the project team sees them.
- **No due date.** A hand-made Observation got the project's 8-day default; the API one didn't. SiteSnap should send the foreman's date, or leave it blank unless a project setting says otherwise.
- **Nobody notified** (Notification Date blank), as expected. Decision C (email the assignee) is a separate call.
- **Created By shows Edward Gray:** the real author (decision A).

- **Attachments work end to end:** in the Observation's view, the photo opens and the WAV downloads and plays. In edit mode, attachments show only as name tags.
- **Line breaks:** the description is formatted text, so plain line breaks collapse into one line. Send it as HTML paragraphs (`<p>`).

**Answered by the sandbox:**
- Q2 (create plus photo and audio): yes, for Observations and Punch Items.
- Q3 (numbers): Procore assigns them for both.
- Q5 (webhooks): the events we need exist.

**Still to check:**
- that both items and their attachments show in Procore's own tools and in All Open Items (Ky to look);
- whether the sound plays inside Procore;
- who may close each item type;
- the send-email step to the assignee (decision C);
- Change Event creation (Phase 2).

## What the reference confirms

### Observations: `POST /rest/v1.0/observations/items`
- **Body:** `project_id` and `observation{...}`. Only `observation.name` and `observation.type_id` are required.
- **Defaults:** "`number`, `personal` and `due_date` default from the Project's Observations configuration when omitted." So Procore assigns the number.
- **Fields we'd fill:**
  - `description`
  - `priority`: Low / Medium / High / Urgent
  - `status`: initiated / ready_for_review / not_accepted / closed / draft
  - `trade_id`
  - `location_id`, or `mt_location` to create a location
  - `due_date`
  - `assignee_id` or `assignee_ids` (single or multi, per project setting)
  - `distribution_member_ids`
  - `upload_ids` (attachments)
  - `personal` (private)
- **Type:** `type_id` comes from `GET /rest/v1.0/projects/{project_id}/observation_types`. Each company configures its own Quality, Safety, Commissioning or Warranty types, so SiteSnap has to read them; it can't hard-code them.
- **Assignees:** "Every assignee must be a user the requesting user is permitted to assign … check `GET /rest/v1.0/observations/assignees` first or the request is rejected with a 403." The 403 names the rejected people (`ineligible_assignees`).
- **Not distributed on create:** Procore doesn't email anyone when the item is created. That needs `POST /observations/items/send_unsent` or `/{id}/send_email`, or later changes: "changing `status` … notifies the distribution list; changing the assignee set notifies the users added."
- **Close:** `PATCH /rest/v1.0/observations/items/{id}` with `status: closed`. The available statuses per project come from `GET /projects/{project_id}/observations/items/statuses`.
- **Replies:** response logs, which take a comment and uploads: `POST /observations/items/{item_id}/response_logs`.

### Punch Items: `POST /rest/v1.1/punch_items`
- **Body:** `project_id` and `punch_item{...}`. The API's only required field is `punch_item.name`.
- **Fields we'd fill:**
  - `description`, `due`
  - `priority`: low / medium / high
  - `status`: open / closed
  - `workflow_status`: draft, initiated, work_required, ready_for_review, ready_to_close, closed, and a few dispute states
  - `trade_id`, `location_id` / `mt_location`
  - `punch_item_manager_id`, `final_approver_id`, `punch_item_type_id`
  - `login_information_ids` (assignees)
  - `distribution_member_ids`
  - `schedule_impact` / `cost_impact`: yes_known, yes_unknown, no_impact, tbd, n_a
  - `schedule_impact_days`, `cost_impact_amount`
  - `reference` (free text)
  - `private`
  - `upload_ids`, or multipart `punch_item[images][]`
- **The web form's other required fields** (Number, Punch Item Manager, Final Approver) aren't required by the API body. The `run_configurable_validations` query flag may enforce the company's form rules. **Sandbox test needed.**
- **Number:** not an input field, so Procore assigns it. To be confirmed in the sandbox.
- **Who can be picked:**
  - managers: `GET /projects/{id}/available_punch_item_managers`
  - final approvers: `/punch_list/available_final_approvers`
  - assignees: `/punch_list_assignee_options`
- **Email:** sent explicitly with `send_unsent`, `send_all_unsent`, or `/{id}/send_email`.
- **Close:** `PATCH /rest/v1.1/punch_items/{id}` with `status: closed` or `workflow_status`. Procore's workflow normally has the final approver close it. **Who may close via the API needs a sandbox test.**

### Change Events (Phase 2): `POST /rest/v1.1/change_events?project_id=`
- **Required:**
  - `change_event.scope`: tbd / in_scope / out_of_scope
  - `change_event.status`: an object whose id "must identify a Change Event status that exists for the company". Unknown ids return 400, so the statuses are read first.
- **Number:** "If omitted on create, one is auto-assigned."
- **Also:** `title`, `description`, `change_reason`, `change_type`.
- **Link to an Observation:** `event_origin {origin_type: "observations", origin_id}` links it to its source record. An Observation that mentions extra work can therefore be promoted to a Change Event later, keeping the link.
- **Our own ids:** `external_data {origin_id, origin_data}` holds free-form external ids, a natural place for the SiteSnap capture id.
- Line items, labor and materials are a separate resource. Per the spec, we capture words only, never prices.

### Attachments (photos and the audio file)
- `POST /rest/v1.1/projects/{project_id}/uploads` returns a UUID plus a storage URL and fields.
- The server then posts the file to that URL as multipart, including all the returned fields unchanged.
- The record gets the UUID in `upload_ids`. Uploads are generic files, so the audio file can attach the same way as photos.
- The reference doesn't limit file types for this endpoint. A sandbox check is still needed that the audio shows and plays in Procore's attachments.

### Lookups the confirmation card needs (read-only)
- Trades: `GET /rest/v1.0/companies/{company_id}/trades`.
- Locations: `GET /rest/v1.0/projects/{project_id}/locations`.
- Directory: `GET /rest/v1.0/projects/{project_id}/users`, already used by the directory search.
- Observation types and assignees, and punch managers, approvers and assignees: as listed above.

### Webhooks
- Hooks: `POST /rest/v2.0/companies/{company_id}/projects/{project_id}/webhooks/hooks`, then triggers, as in `sitesnap-procore-findings.md`.
- The event names aren't published as a fixed list. They're discovered per project with `GET /rest/v1.0/webhooks/resources?project_id=`, or the v2.0 company/project equivalent. Needs a signed-in call in the sandbox.
- Polling every few minutes is the fallback, per the spec.

## Answers to the spec's open questions (as far as the docs go)

| # | Question | Answer |
|---|---|---|
| 1 | Create records without a Procore login for each foreman | Two options; see decision A. |
| 2 | All three record types plus photo and audio attachments via the API | Observations, Punch Items and Change Events all take `upload_ids`. The sandbox has to show each tool is turned on and that our app's permissions allow writing. |
| 3 | Record number | Observations and Change Events: auto-assigned when left out. Punch Items: not an input field, so auto; to be confirmed. |
| 4 | Statuses on create and close | Observation: initiated → closed (per-project list). Punch: open/closed plus the workflow statuses. Change Event: the company's own status ids. Who may close each one is a sandbox test. |
| 5 | Webhooks | Hooks per project. Event names are discovered with a signed-in call. |
| 6 | "Reported by" in a structured field | Not as the creator (the creator is whoever's token writes it). Punch Items have a free-text `reference` field. Change Events have `external_data`. Observations: description only. Plan: always put "Reported by [name] via SiteSnap AI" in the description, and also in `reference` / `external_data` where they exist. |
| 7 | Offline capture | Not in the MVP. The app already queues messages on the phone, and the same queue could hold a capture until there's signal. Procore's upload instructions expire, so the server would ask for them only when it sends. |

## Decisions needed before building (for Ky)

**A. Who writes to Procore, given foremen have no Procore login?** This conflicts with what's live now: since 2026-10-14, everyone signs in with Procore.
1. **A PM's stored Procore sign-in (sandbox prototype; decision 2 in `sitesnap-procore-findings.md`).** A PM connects once. The server keeps their token encrypted and writes every record with it. Every record shows that PM as the creator, so "Reported by" goes in the text. It works today with the user-level OAuth app we have. If that PM leaves the project or revokes access, the writes stop.
2. **A Developer Managed Service Account (DMSA, the client-credentials grant).** This is Procore's current answer for apps that write without a user. It needs a manifest change, a new app version, and a company admin installing it and picking projects. The records show a generic service-account user as creator. It's the right production answer, but more setup; see the findings doc.

   **Recommendation:** option 1 for the sandbox prototype, built behind one small "Procore writer" module so it can switch to option 2 later without other changes.
3. **The foreman's own SiteSnap sign-in.** With no Procore login, foremen need a SiteSnap sign-in to own their captures and get assigned items.
   - The earlier plan (Step 4) was Google or emailed-link sign-in, matched by email to the Procore project directory.
   - The live messaging app now uses Procore sign-in. Keeping it for PMs and adding Google/email-link sign-in for foremen means the database rules need one more way to recognize project members.

**B. Who closes items?** Procore's Punch List workflow has the final approver close an item. "Done" in SiteSnap could:
- move it to `ready_for_review` / `ready_to_close`, so the PM closes it in Procore (this matches how Procore expects it), or
- close it outright with the PM's token.

  **Recommendation:** the first, plus a one-tap Close for the PM in SiteSnap.

**C. Distribution:** Observations and Punch Items don't email anyone on create through the API. Should SiteSnap call the send-email step so Procore notifies the assignee? Recommended: yes, for the assignee only.

## What the Step 1 sandbox test needs

The spec's "done when" is a script that creates an Observation and a Punch Item with a photo in the sandbox, both showing in Procore. That takes a Procore sign-in with permission to create both. Two ways:
- **Ky signs in on the live site.** A temporary, signed-in-only server route creates one test Observation and one test Punch Item in `1234 - Sandbox Test Project`. Each is labeled "SiteSnap API test" and gets a small test photo, and the route reports the ids and links. This means a small push to production, with nothing visible in the app.
- **A local script** that Ky signs in through once. This needs a localhost redirect URI added to the Procore app in the developer portal, and the client secret on this machine.

## Step 2: the classifier (2026-10-14)

`functions/classifier.js` (rules and checks) and `functions/captures.js` (the `classifyCapture` callable, project members only) turn what the foreman said, plus the project's own lists, into a draft record for the confirmation card:
- **Model:** Claude (claude-opus-5-5, effort low, a strict JSON schema).
- **Kept only where it matches the project:** assignees must be a real directory person (a first name only if one person has it), and trades, locations and Observation types must be on the project's lists. A date must be real and not in the past ("Friday", "tomorrow", "Oct 20" and "the 20th" work; "before the pour" stays blank).
- **Everything else stays blank** and goes in `missing_fields`. Names that were said but match no one go in `unmatched_names`, so the foreman picks.
- **Low confidence (< 0.6)** becomes an Observation, and the card leads with the type switcher.
- **Change Events wait for Phase 2:** a Change Event or RFI is saved as an Observation for now, with "Possible cost or schedule impact: …" in the description and `suggested_record_type` kept.
- **Bad answers:** a bad or missing answer falls back to an Observation with the raw words. The original transcript is always kept untouched.

**Results with the real model** (`node scripts/classify-eval.cjs`, the spec's five sentences, the sandbox's 22 Observation types): **5 of 5 as the spec expects.**
- Paint touch-up: Punch Item, Painting, Level 2 stairwell.
- Fire caulking: Observation, Deficiency, high, electrical room.
- Duct conflict: Observation (suggested Change Event), impact "two guys half a day".
- Lisa's drywall: Punch Item for Lisa Hubbard, due 2026-10-16, Room 204.
- "Something's off back there": low confidence, mostly blank.

Rules tests: `tests/classifier.test.js`.

## Step 3: the confirmation card and create flow (2026-10-14)

**Off for everyone until tested:** Report an Issue shows only on a phone that opened the app once with `?beta=report` (`src/messaging/beta.js`; `?beta=off` hides it again).

The flow (`src/messaging/ReportFlow.jsx`):
1. **Capture:** Take Photo (up to 4) and Tap to Talk. The words come back and can be edited, or typed instead.
2. **Fill It In:** `classifyCapture` drafts the card, using the project's lists from `GET /api/procore/record-options` (Observation types, trades, locations) and the directory.
3. **The card:** Observation | Punch Item, title, what's going on, kind of observation (grouped, Quality and Safety first), who it's for (Change opens the directory search), priority, where, trade, due, and the photos. Anything not said stays blank.
4. **Send to Procore:** the phone shrinks the photos (1600 px JPEG) and posts them with the voice file to `POST /api/procore/records`. The server writes with the reporter's own Procore sign-in:
   - uploads, then the record (not private, HTML description, "Reported by …", the words as said);
   - if Procore won't let them assign someone, it's created unassigned and the screen says so;
   - Procore's email goes to the assignee only.
5. **Sent screen:** the type and number, Open in Procore, Open the Thread. The thread is created automatically: the capture is its first message, it's linked to the record (`procore {recordType, id, number, url}` on the conversation), and the assignees are tagged.

**Deploy needed before it works live:** the rules (threads with a Procore link may start with no one tagged) and the new `classifyCapture` function:
```
firebase deploy --only firestore:rules,functions:classifyCapture --project sitesnap-procore
```
**Done when** (spec): a real capture from the phone creates a correct record in Procore with photo, transcript and "Reported by".

Ky's sandbox test (2026-10-14): passed. The photo and the audio file open in Procore, "Reported by" is in the description, and Procore's Change History shows the reporter's own name.

## Step 4: thread, assignee, Done and close (2026-10-14)

The thread follows the record, using decision B: Done in SiteSnap means "ready for review"; the PM (or the item's final approver) closes it.

- **To-dos:** a record thread's first message gets one to-do per assignee: the record's title and its due date (`recordTasks` in `functions/messaging.js`, not the AI's guesses). Later messages are flagged as usual. The due date rides on the conversation's `procore.due` (rules allow it).
- **Done:** when an assignee taps Done (on the to-do or as a quick reply) and no one else still has a to-do, the record goes to Ready for review in Procore. That's `PATCH /rest/v1.1/punch_items/{id}` with `workflow_status: "ready_for_review"`, or `PATCH /rest/v1.0/observations/items/{id}` with `status: "ready_for_review"`. The thread stays open.
- **Everyone's done:** the thread asks "Everyone's done. Close it in Procore?"
- **Close / Reopen:** on a record thread these buttons change Procore first (punch `status: closed` / `open` + `work_required`; observation `closed` / `initiated`), with the person's own sign-in, and the thread follows only if Procore agrees. If Procore refuses, the person sees: "Procore says you can't close this one. The project manager (or the item's final approver) closes it." Nothing changes.
- **Closed in Procore:** opening the thread checks Procore (`GET /api/procore/record-status`). If the record was closed there, the thread closes too, with a "Closed by Procore" line. The status shows in the thread header ("Procore Punch Item #2 · Ready for review").
- Endpoint: `api/procore/record-status.js` (GET = check, POST `{action: done | close | reopen}`). It checks project membership, then writes the thread with firebase-admin (`procoreStatus`, `status`, and the Closed/Reopened line).

**Why not webhooks yet:** Procore's webhook only says "this record changed". Reading it needs someone's sign-in, and SiteSnap keeps none on the server. Checking when the thread opens covers it for now. Step 5 (the PM dashboard) needs a stored token or a service account, and that's when webhooks come in.

**Deploy needed before it works live** (the to-do trigger and the rules for the due date):
```
firebase deploy --only firestore:rules,functions:onConversationMessage --project sitesnap-procore
```
**Done when** (spec): closing in the app closes the Procore record, and closing in Procore closes the thread.

Tests: `tests/record-status.test.js` (mocked Procore), `tests/messaging-rules.test.js`, `e2e/e2e-report.js` (to-do, status, Close in Procore).

## Sandbox test people (2026-10-14)

`/api/procore/seed-directory` (sandbox only, hidden, like `test-records`) loads Ky's 4 test companies and 16 people (`api/_seedDirectory.js`) into a project with the signed-in admin's own token. Check What's There lists what the cleanup would touch; Run makes the ticked earlier test records inactive, then adds one company per call.
- Procore's API has no delete for company users or vendors, so "remove" = inactive. For people that's `POST /rest/v2.0/companies/{c}/people/bulk_deactivate {ids}` with **person** ids (`GET /rest/v1.0/companies/{c}/people` gives `user_id` and `contact.is_active`). `PATCH .../users/{id} {is_active: false}` answers 200 but leaves them active in the Directory (seen 2026-10-14). Vendors: `PATCH /rest/v1.0/vendors/{id} {is_active: false}`.
- Rate limit: about 25 calls per 10 seconds (spike limit) in the sandbox; the first run hit 429 after ~30 quick calls. The page now paces calls 500 ms apart, waits 10.5 s and retries once on a 429, and does one company or one person per request.
- Never touched: the signed-in person, `@procore.com` users, Architect TEST Company and its people. Re-running updates the same records (matched by email / company name) instead of making duplicates; an update can't include `email_address`.
- Vendor: Tags/Keywords go in `notes`, DBA in `trade_name`. User: `business_phone` + `business_phone_extension`, no permission template ("apply later"), `is_employee: false`.
- Project Role: `POST /rest/v1.0/project_roles {project_id, project_role: {role, user_id}}`. Only role names the project already has work: "Project Manager" 201, "General Contractor" 404 "Item not found" (2026-10-14). The page now uses the project's own role names (`GET /project_roles`): General Contractor falls back to Superintendent (or Foreman), Worker gets no role.
- Role names live in the company's roles list: `GET/POST /rest/v2.0/companies/{c}/roles` (`{project_role: {name, type, add_to_project_team, display_on_company_home}}`; GET answers `{data: [...]}`). The sandbox had only Project Manager; the page creates **Superintendent** (type copied from Project Manager) for the site leads, then assigns it with `POST /project_roles`.
- Two sets (2026-10-14). Set 1 = the first sheet as it ended up in Procore (Ironbridge 4, VoltLine 4, ClearFlow 3, Summit Framing & Drywall with no people; the first run stopped before Lena Kowalski and Summit's people). Set 2 = `sitesnap-seed-directory-expansion.md`: 5 trade companies, 21 people (5 PM, 5 GC, 11 Worker). Its Lena Kowalski (`lkowalski`) and Dominic Ruiz (`druiz`) reuse emails set 1 had planned but never created. Project Role: Project Manager for PMs only; the Superintendent step was dropped per the spec. **Verify** reads the directory back (company, exact email, tag, on the project, roles, duplicate emails, totals).
- Permission templates (Ky's permission_template_matching.md, 2026-10-14): `GET /rest/v1.0/projects/{p}/permission_templates` lists them (id, name, category); `PATCH /rest/v1.0/projects/{p}/permission_template_assignments {permission_template_assignments: {user_id, permission_template_id}}` sets one. Ironbridge (the GC) = Internal (PM: Project Manager - Internal; the rest: Foreman / Superintendent - Internal); every other company's people = Subcontractor - External. `permissionTemplateFor` in api/_seedDirectory.js; the page's Set Permission Templates button does both sets, and Verify checks them.
