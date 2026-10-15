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
