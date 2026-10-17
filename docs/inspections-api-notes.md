# SiteSnap AI: Procore Inspections API notes

Discovery for `sitesnap-inspections-spec.md`, section 2. Branch `feature/inspections`.

**Status (2026-10-16): desk check done; sandbox read check run by Edward (admin) on Westgate, all reads confirmed (below). Write check not run yet.** Procore's own developer reference does not load outside a browser, so everything here is from Procore's support pages and a third-party mirror of Procore's API reference (withone.ai, updated 2026-02-25). Treat field names as best known until `/api/procore/test-inspections` has run against the sandbox. Every Procore path and field name is in one file, `api/_inspections.js`, so a mismatch is a one-line fix.

**Verdict: the API looks able to run an inspection end to end** (read, answer each item, set a section N/A, attach a photo, create an Observation linked to the failed item, close). The section 8 fallback (answers kept only in SiteSnap plus a PDF) is not needed unless the sandbox check shows that writing answers is refused.

## 1. Inspections vs Checklists

These are one tool. Procore renamed "Checklists" to "Inspections" in the web app, but the API still calls them **checklists**: an inspection is a `checklist/list`, a template is a `checklist/list_template`, a question is a `checklist/item`. There is no second "Inspections" API to choose between. Westgate Distribution Center's `[Procore] Site Safety Inspection #1` and `#2` are checklist lists.

## 2. Endpoints

All need the `Procore-Company-Id` header. SiteSnap calls them with the signed-in person's own token (`api/_procoreWrite.js`), like every other write.

| Need | Request | Notes |
|---|---|---|
| List a project's inspections | `GET /rest/v1.0/projects/{project_id}/checklist/lists` | Paged (`page`, `per_page`, `Total` / `Link` headers). Filters: `filters[inspector_id][]`, `filters[responsible_contractor_id][]`, `filters[status]`, `filters[location_id][]`, `filters[trade_id]`, `filters[query]`, `filters[due_at]`. Sort: `number`, `name`, `inspection_date`, `created_at`, `updated_at`, `location`. |
| One inspection with sections and items | `GET /rest/v1.0/checklist/lists/{id}?project_id={project_id}` | `project_id` is a query param here (easy to miss). Returns `sections[].items[]`, each item with `item_response`, `response_set`, `type`, `observations[]`, `attachments[]`, `comments[]`. |
| Items with filters (lighter) | `GET /rest/v1.0/projects/{project_id}/checklist/list_items?filters[list_id][]=` | `filters[item_response_status]` = `conforming`, `non_conforming`, `neutral`, `not_applicable`, `null`. Sort `position_by_section`. Used to re-read one item before saving (`filters[id][]`). |
| Answer an item | `POST /rest/v1.0/projects/{project_id}/checklist/items/{item_id}/item_response` | Body `{ item_response: { status } }` for Pass / Fail / N/A items (`conforming`, `non_conforming`, `not_applicable`), `{ response_option_id }` for multiple choice, `{ text_value }`, `{ number_value }`, `{ date_value: "YYYY-MM-DD" }` for open-ended items. Send only the field for the item's type. 201 returns `{ item_id, status, responded_at, responder, item_type, payload }`. |
| Answer (older way, fallback) | `PATCH /rest/v1.0/checklist/lists/{list_id}/items/{id}` | Body `{ project_id, section_id, item: { status: "yes" \| "no" \| "n/a" \| "none", response_id } }`. Used only if `item_response` answers 404. |
| Photo on an item | Same PATCH as multipart: `project_id`, `section_id`, `item[status]` and files under `attachments[]` | Shows under the item's Attachments. The photo also goes to the Photos tool through SiteSnap's existing photo queue (`autoFilePhotos`). |
| Note on an item | `POST /rest/v1.0/checklist/lists/{list_id}/comments` `{ project_id, item_id, comment: { body } }` | The first guess (`/projects/{p}/inspections/{item}/comments`) answered 404 in the sandbox. If Procore refuses it, the note stays in SiteSnap (summary shows "note not in Procore") and goes into the Observation description on a Fail. |
| Section N/A | `PATCH /rest/v1.0/checklist/lists/{list_id}/sections/{id}/toggle_not_applicable` `{ project_id }` | It's a toggle: SiteSnap reads the section's `not_applicable` first and only toggles when it differs. Fallback: deprecated `PATCH …/sections/{id}` `{ project_id, section: { name, position, not_applicable } }`. |
| Failed item → Observation | `POST /rest/v1.0/observations/items` with top-level `inspection_item_failed: 1` and `observation.checklist_item_id` | Same body as Report an issue (`observationBody` in `api/_records.js`) plus those two fields. Procore links the Observation to the item (origin = inspection) **and marks the item failed itself**. The Observation shows in the item's `observations[]` and its activity. |
| Close | `PATCH /rest/v1.1/projects/{project_id}/checklist/lists/{id}/close` | Idempotent. Only the close, no other fields. A 403 here = the role can't close inspections: SiteSnap says "Saved. Your project manager will review it." |
| Observations made from items | `GET /rest/v1.0/projects/{project_id}/checklist/list_item_observations` | For the summary links if `observations[]` is missing on the item. |

## 3. Fields SiteSnap uses

**Inspection (list):** `id`, `name`, `number`, `status` (`Open`, `In Review`, `Closed`), `location { name }`, `due_at`, `inspection_date`, `description` (can be a long legal disclaimer, so it goes behind "Details"), `inspectors[] { id, name }`, `responsible_contractor { id, name }`, `trade { id, name }`, `point_of_contact`, `list_template_name`, counts `item_count`, `conforming_item_count`, `deficient_item_count`, `not_applicable_item_count` (the show call says `na_item_count`), `neutral_item_count`, `inspected_item_count` (show: `not_inspected_item_count`), `observations_count`, `default_response_phrasing { conforming_response, deficient_response }`.

- **"Assigned to me"** = my Procore user id is in `inspectors[]`. The spec calls them assignees; the API calls them inspectors.
- **"My company's work"** = `responsible_contractor.id` equals the vendor id of my company (my project user's `vendor.id`, same as Daily log).
- **Inspection number** = `number` (shown as "#1"). The name in the sandbox already has no number, so SiteSnap shows `name #number`.

**Section:** `id`, `name`, `position`, `not_applicable` (expected; confirm), `items[]`.

**Item:** `id`, `name` (the question), `details`, `position`, `section_id`, `status` (`yes`, `no`, `n/a`, `none`: the old 3-way state), `item_response { status, payload, responded_at, responder { id, name } }`, `response_set { responses[] { id, name, corresponding_status } }`, `type { category, name }`, `observations[]`, `attachments[]`, `comments[]`.

## 4. Pass / Fail / N/A / Neutral

| SiteSnap | Procore web | API `item_response.status` | Old `item.status` |
|---|---|---|---|
| Pass | Conforming | `conforming` | `yes` |
| Fail | Deficient | `non_conforming` | `no` |
| N/A | N/A | `not_applicable` | `n/a` |
| (not shown) | Neutral | `neutral` | `none` with an answer |
| Not answered | — | `null` | `none` |

- **Neutral** is the status of an answer that is neither conforming nor deficient: in a multiple-choice response set, each option maps to a `corresponding_status`, and an option can map to neutral (for example "Observed" or "Info only"). Open-ended answers (text, number, date) count as neutral too. It is not a 4th button on Pass / Fail / N/A items.
- **Templates can define other options.** Each item has a `response_set`. When it's a custom set (not the default Pass / Fail / N/A), SiteSnap shows that set's option names as the buttons, and an option whose status is deficient opens the Failed item screen like Fail does.
- **Custom wording:** an inspection can rename Conforming / Deficient (`default_response_phrasing`, for example "At Risk"). SiteSnap keeps Pass / Fail on the buttons (the spec's words) and shows Procore's wording under them when it differs.

## 5. Scopes and permissions

Procore has no per-tool OAuth scopes: an app's token can do whatever the signed-in person's permission template allows, and SiteSnap's app already reads and writes Observations, Photos and the Daily Log with it. Nothing new to request in the Developer Portal. What matters is the person's **Inspections** permission level:

- Read Only: can see inspections (list and run screens load), can't answer.
- Standard: can answer items on inspections where they're an inspector (Procore support pages). Expected for foremen.
- Admin: can answer any, close, and set sections N/A.

A 401/403 on the list read → "Your Procore role can't see Inspections on this project. Ask your project manager for access." A 403 on an answer → plain message on the item, answer kept on the phone, not retried. **The sandbox check needs to confirm the Standard level with a foreman (Chloe) and a sub foreman (Derek).**

## 6. Gotchas

- `GET checklist/lists/{id}` takes `project_id` as a query param; the project list call has it in the path.
- The two calls name the counts differently (`na_item_count` vs `not_applicable_item_count`). SiteSnap counts from the items itself and doesn't trust either.
- Item text repeats (the sample's 2.1 and 2.5 are identical). Item numbers are worked out by SiteSnap from section order and item order ("2.3" = section 2, item 3), which is what Procore's web app shows.
- `filters[status]` is documented as an integer although the status comes back as a string. SiteSnap filters on the phone instead.
- Procore's spike limit is about 25 calls per 10 seconds. One inspection read is one call (sections and items come back together), so the run screen never pages.
- `item_response` on Pass / Fail / N/A items: the docs' example sends every field at once, but the text says to send only the one for the item's type. SiteSnap sends only one.
- `number_value` is documented as an integer but the example uses 7.54: the check page tries a decimal.
- Multiple inspectors: `item_response.responder` says who answered. Before saving, SiteSnap re-reads the item and, if someone else answered since the screen loaded, answers 409 with their name ("Already answered by Dana Whitfield"); the foreman keeps theirs or overwrites.

## Sandbox results (Edward, admin, Westgate, 2026-10-16, read only)

- List: both inspections; `number`, `inspectors[]` (3 on #1, Edward only on #2), `inspected_item_count`, `item_count` 87, `not_applicable_item_count` all there. Responsible contractor, location, due date blank on both (not set in Procore yet). Also present: `identifier` ("1"), `respondable_item_count`, `amber_item_count`, `inspection_date`.
- Show: 17 sections, 87 items. Items are `type: { category: "multiple_choice", name: "default" }` with `response_set: null`: SiteSnap reads them as Pass / Fail / N/A (correct). Unanswered items: `status "none"`, `responded_with "No Response"`, `item_response null`. Section 1 is "Housekeeping and Sanitation" (6 items); 2.1 and 2.5 have the same text.
- **Sections have no `not_applicable` field.** Since Procore's N/A call is a toggle, SiteSnap remembers what it set (`procoreProjects/{key}/inspectionSections/{listId}_{sectionId}`) and only toggles when that differs. A section set N/A in Procore's web app won't show as N/A in SiteSnap until we find where Procore keeps it (the write check now prints the section and its items after the toggle).
- `list_items` works (total 87). Rate limit 25, as before.

## Write check (Edward, admin, #2, 2026-10-16)

- **Answer: works.** `POST …/checklist/items/{id}/item_response` `{ item_response: { status: "not_applicable" } }` → 201 with `status`, `responder`, `item_type`.
- **An answer can't be cleared** through the API: `{ status: null }` → 422 "Invalid params for default item response". SiteSnap never needs to.
- **Section N/A: works** via `toggle_not_applicable`; the answer has `not_applicable` true / false. Turning it on answers **every item in the section `not_applicable`** (Procore's N/A count +5); turning it off **clears every item** in it (even ones answered before). So a section whose items are all N/A is shown as N/A (that also catches sections set N/A in Procore's web app), and Undo N/A asks first.
- **Notes: the guessed path was wrong** (`/projects/{p}/inspections/{item}/comments` → 404 "Item not found"). Now `POST /rest/v1.0/checklist/lists/{listId}/comments` `{ project_id, item_id, comment: { body } }` (not yet run).
- Still to run: item photo, the new note path, Observation from a Fail, close.

## 7. To confirm in the sandbox (`/api/procore/test-inspections`)

Run as Edward (admin), then Chloe (Foreman / Superintendent - Internal), then Derek (Subcontractor - External). The page reads only, unless you tick "Also try writing" (then it answers ONE item and puts it back, toggles one section N/A and back, and adds a note):

1. The list call returns #1 and #2 with `inspectors`, `responsible_contractor`, `number`, and the counts.
2. The show call returns 17 sections and 87 items, `section.not_applicable`, and the item `type.category` / `response_set` values for a Pass / Fail / N/A item.
3. `item_response` POST works and Procore's Conforming count goes up (and back).
4. Section toggle works.
5. Note: which comments path answers.
6. Who gets a 403 for each step.

Not run by the check (needs a real Fail): Observation with `inspection_item_failed`. Run one from the app on #2 and check the item's Observation count in Procore.

## 8. Sandbox test data (spec section 3)

Templates are created in Procore's web app (Company → Inspections → Templates), not by SiteSnap (scope rule: SiteSnap never creates or edits templates). Ky to do in the sandbox:

- Three templates: Pre-pour (about 12 Pass / Fail / N/A items), Camera install (about 8), Safety walk (about 10); one inspection of each on Westgate Distribution Center, inspector Edward Gray.
- `[Procore] Site Safety Inspection #2`: add a sub and a contact in the project Directory, then set it as the Responsible Contractor.
- For the "Already answered" test: answer one item on #1 in Procore as Dana Whitfield (or Marcus Ortega), then answer it in SiteSnap as Edward.

## Sources

- [Procore support: Project Inspections](https://support.procore.com/products/online/user-guide/project-level/inspections)
- withone.ai mirror of Procore's reference: [List Checklists in a Project](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZErurt8g%3A%3AEzZkt5YeSpuxv3Gm-q09Sg), [Show a Checklist](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZFQfCf8g%3A%3AvEbFiwK1QPywV6JM5NF0_Q), [List Checklist Items](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZBadcsfg%3A%3ApmKbsU5kSTmJmHXoHiMTPA), [Create Item Response](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZBNud7XA%3A%3AjWdoqTrTQIiS3RUCcSvqOA), [Update Checklist Item](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZBYbPbZA%3A%3ASoGnmqqETdG-x8eCYPQD4Q), [Section Not Applicable](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZDmDvCYg%3A%3AnO7CpSN7SYimuIGIaF3A6w), [Create Observation Item](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZJ_22HgA%3A%3A79AQZuDnRGOtVRBcpDEYLQ), [Close a Checklist](https://www.withone.ai/knowledge/procore/conn_mod_def%3A%3AGLdZEC4xSDg%3A%3AHqtpEnvkRGyqFeH2mweFPg)
