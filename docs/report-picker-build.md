# Report picker, My items, permission-aware home: build notes

Spec: `sitesnap-report-picker-my-items-spec.md` (Ky, 2026-10-17). Branch `feature/report-picker-my-items`.

## Done: build steps 1 and 2

- **Home** (`src/messaging/ProjectHome.jsx`): 2 x 3 tiles: Report something | Message, My items (New) | Inspection,
  Daily log | Project photos. Every tile in a row with a status pill keeps an empty line of the same height until
  its count arrives, so nothing moves (e2e checks tile positions before and after).
- **Badges** (`src/messaging/homeBadges.js`): read when home shows, kept 60 s per project. Inspection = open
  inspections where I'm an inspector (the Inspections list's `mine` group). My items = placeholder (none shown)
  until step 3. Daily log keeps its own line.
- **New pill**: `NEW_RELEASED` + `NEW_DAYS` in `src/messaging/capabilities.js`.
- **Tool access** (`api/_capabilities.js`, `GET /api/procore/capabilities`, phone: `useCapabilities`, sessionStorage
  per project). Best source: `GET /rest/v1.0/settings/permissions?project_id=` (the caller's own permission list with
  `available_for_user`, `can_create`, `user_access_level`). Fallback: a one-row read per tool. 401/403 = denied,
  anything else = unknown (hides nothing). An all-unknown answer isn't cached.
- **Picker** (`src/messaging/ReportPicker.jsx`): rows from `pickerRows()`; only built types (`READY_TYPES` in
  MessagingApp, now `["issue"]`). Issue opens the existing Report an Issue flow unchanged. Rows with no usable path
  are left out; if none is left, a plain "Ask your project admin" line. Guest demo: every built row shows.
- **My items** tile: hidden only when Procore refuses both Observations and Punch List; opens a placeholder.

## Done: build step 3, My items (branch only)

- `GET /api/procore/my-items` (`api/procore/my-items.js`, plain functions in `api/_myItems.js`): Observations with
  `filters[assignee_id][]=me`, Punch Items with `filters[status]=open` (no assignee filter is documented), up to 5
  pages of 100 each; every row is also checked as "assigned to me" on our side, so an ignored filter never shows
  other people's items. Grouped Overdue (due before the project's today) / Open / Ready for review, due date first,
  closed left out. One tool refused = the other's items, no error; both refused = plain "Ask your project admin".
  `&type=&id=` = one item for the detail (description, image attachments, who assigned it).
- Badge: `{ open, overdue }` from the same answer (`myItemsStore.js`, 60 s), red only when overdue > 0.
- Phone: `MyItems.jsx` (list, detail, Mark fixed). **Mark fixed reuses the existing close-out**: the same Composer
  (photo, Tap to Talk, note) with the Done quick reply already picked, then the same Procore change as Done in a
  thread (Ready for review). Item with a SiteSnap thread: reply there, then `record-status` with the cid. No thread:
  a new thread that follows the record (`procore` link, nobody on To, whoever assigned it on CC, so no to-dos are
  made), then `record-status` by record id (new: `{ recordType, recordId, action: "done" }`, done only). After
  that, the list and badge read Procore again. Guest demo: everything up to Send, where Composer shows the note.
- Composer gained three optional props (`initialStatus`, `initialPicked`, `procoreLink`); everything else unchanged.
- Check page: `/api/procore/test-my-items` (sandbox only): filtered vs unfiltered counts, first-row field names,
  assignee / assignment shapes, attachment fields.

**Sandbox 2026-10-17 (`/api/procore/test-my-items` as Chloe Abara, a demo project):** the Observation
`filters[assignee_id][]` filter works (1 of 4 rows, hers); rows have `assignee {id, name, vendor}` and `assignees[]`,
`created_by`, `location`, `due_date`, `status: "initiated"`. Punch Items: `filters[status]=open` left out the closed
one (3 of 4); assignees are `assignees[].id` and `assignments[].login_information_id` (both handled);
`punch_item_manager` is there (shown as "Assigned by"). Full reads have `attachments` with `url` + `thumbnail_url`
on sandbox.procore.com, so the photo proxy can show them; the grid now loads the thumbnail. Chloe has no open Punch
Items, so a punch row on the list wasn't seen live. Mark fixed can't be tried until the branch is live (Procore
sign-in only works on the production URL).

## Sandbox results

**2026-10-17, Edward (admin), 4 projects (HP 373715, WG 373716, LV 373717, sandbox test 373212):**

- `settings/permissions?project_id=` answers 200 and lists **only the tools turned on for that project**. So a tool
  missing from a 200 answer is now treated as denied, with no probe. Confirmed names: `checklists`, `observations`,
  `punch_list`, `daily_log`, `images`, `directory`, `rfi`, `change_events`. Incidents is off on every project, so
  its name isn't known yet and it's still probed.
- `can_create` comes back only on some tools (observations, punch_list, rfi, change_events, submittal_log); the rest
  leave it out (null = not known).
- The three demo projects have **no RFIs and no Change Events** turned on (403 on the read, missing from the list).
  Only the sandbox test project has them. So in HP / WG / LV, Question for the PM and Extra work would use the
  Message fallback unless those tools are turned on there.
- The Daily Log probe answered 422: a UTC "today" was tomorrow on the project's clock. It now asks for the day before.
- RFIs, Change Events, Incidents read paths: 403 where off, 200 (RFIs, Change Events) where on. Confirmed.

**2026-10-17, Subcontractor-style person, sandbox test project 373212** (template levels: Observations, Punch
List, RFIs, Photos, Commitments, Change Orders, Submittals = Standard; Change Events, Daily Log, Inspections,
Directory = None; Home, Drawings, Specifications, Documents = Read Only):

- `can_create`: observations true, punch_list true, rfi **true** (a sub can create RFIs), change_events false,
  submittal_log false.
- The list and the reads agree everywhere except **Directory**: None in the list, but the project people read
  answers 200. Directory is now always decided by the read (`PROBE_ALWAYS`); nothing hides on it anyway.
- Picker for this person: Issue (record), Safety (Observation), Delay (Observation fallback, no Daily Log),
  Extra work (Message fallback, no Change Events), Question for the PM (draft RFI). Matches the spec's
  subcontractor row.

**Still to run (optional):** a Foreman / Superintendent and a Subcontractor - External person (levels below Admin, and whether
`can_create` turns false for them).

## Differences from the spec (for Ky)

- Existing tiles (Inspection, Daily log, Project photos) are never hidden by the probe: each already has its own
  plain no-access screen, and hiding them would break the 3 x 2 layout. Only My items (new) hides.
- Daily log subtitle is now the spec's "Crew, delays, deliveries, by voice" ("past logs" dropped from the tile).
- A read probe can't tell Read Only from Standard. Until the permission list is confirmed, a Read Only person sees
  rows Procore will refuse at Send (the send error path then explains).
