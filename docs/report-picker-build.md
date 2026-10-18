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

## Not verified in the sandbox yet (needs `/api/procore/test-capabilities`, sandbox only)

| Call | Source | Status |
|---|---|---|
| `GET /rest/v1.0/settings/permissions?project_id=` | third-party copy of Procore's reference | unconfirmed; tool names in it are guesses (`MANIFEST_NAMES`) |
| `GET /rest/v1.0/projects/{p}/rfis?per_page=1` | third-party copy | unconfirmed |
| `GET /rest/v1.0/change_events?project_id=&per_page=1` | third-party copy | unconfirmed (v1.1 is the create path in PROCORE_API_NOTES) |
| `GET /rest/v1.0/projects/{p}/incidents?per_page=1` | third-party copy | unconfirmed |
| Observations, Punch List, Daily Log (manpower_logs), Inspections, Directory, Photos | earlier sandbox checks | confirmed |

The check page shows both sources side by side plus what SiteSnap decides. Run it as Edward (admin), a Foreman /
Superintendent, and a Subcontractor - External person.

## Differences from the spec (for Ky)

- Existing tiles (Inspection, Daily log, Project photos) are never hidden by the probe: each already has its own
  plain no-access screen, and hiding them would break the 3 x 2 layout. Only My items (new) hides.
- Daily log subtitle is now the spec's "Crew, delays, deliveries, by voice" ("past logs" dropped from the tile).
- A read probe can't tell Read Only from Standard. Until the permission list is confirmed, a Read Only person sees
  rows Procore will refuse at Send (the send error path then explains).
