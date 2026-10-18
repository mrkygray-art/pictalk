# Demo seed (sandbox demo data, second set)

From Ky's `procore-sandbox-demo-seed.md` (2026-10-18). A second, bigger demo set in Procore's sandbox that lives
**alongside** the demo staging set (`docs/DEMO_STAGING.md`), not instead of it.

**Page:** https://sitesnap-procore.vercel.app/admin/demo-seed (→ `/api/procore/demo-seed`; not linked anywhere, `noindex`).

## What it makes

| | |
|---|---|
| Projects | `[DEMO] Marina Heights Mixed-Use` (early), `[DEMO] Crestview Medical Office TI` (middle), `[DEMO] Dockside Warehouse Conversion` (closeout) |
| Companies | Tidewater Development (owner), Harborline Construction (GC), Beacon Electric & Low Voltage, Coastal Mechanical, Ridgeline Drywall & Finishes |
| People | 22 plus Ky (the signed-in admin = the demo PM), on the projects in the spec's matrix, with Procore's own permission templates |
| Records | 12 Observations, 14 Punch Items (statuses, assignees, reviewers, locations, trades, closing comments; OBS-04 has two assignees and a 3-comment thread) |
| Daily Log | 7 work days per project (manpower by company, delays, deliveries, a note with the weather and who kept the log) |
| Inspections | 3 company templates + 1 inspection each, with the spec's pre-seeded answers (Final walk left open for the live demo) |
| Photos | 12 drawn jobsite illustrations in Safety / Quality / Progress / Punch albums, also attached to their records |
| Messages | M1-M10 as 8 SiteSnap threads (M2 and M4 are replies), linked to their records; M8 tags the whole team except the owner |

Everything in Procore is tagged `[DEMO]` in its title.

## Differences from the spec

| Spec | Built |
|---|---|
| Node scripts with a stored token, `seed-map.json`, `seed-log.json` | A sandbox page (SiteSnap has no stored Procore token; everyone writes with their own sign-in). Each task is one request; the seed map is in server-only Firestore `sitesnapDemoSeed/state/tasks/{id}`; Copy for Claude is the log. |
| `--dry-run` | The task list shows what each task makes; Preview Reset lists what reset would remove. |
| `--reset` | Reset Seeded Data removes only what the seed map recorded (records only while still tagged `[DEMO]`). Setup (projects, companies, people, albums, templates) stays. |
| Names (Luis Herrera, Priya Nair, Carlos Mendez, Margaret Okafor, Daniel Whitfield, Aiko Tanaka, Gary Lindqvist, Tom Brennan, Marcus Webb, Jamal Reed, Tyler Boone, Eddie Park, Hector Ruiz, Beth Kowalski, Nina Castillo, Kevin Tran) | Renamed: they clashed with the test people or the demo staging people already in the sandbox, and SiteSnap finds people by name. The page lists spec → used. Pacific Rim Development → Tidewater Development, Summit Drywall → Ridgeline Drywall, Westgate → Crestview, Harbor Point → Dockside. |
| Project matrix | Mehta and Webb added to Crestview, Salazar and Reed to Dockside: the spec assigns them items there. |
| `mrkygray+<handle>@gmail.com` | `<DEMO_SEED_EMAIL local>+demo-<handle>@…` (falls back to the first of `DEMO_ADMIN_EMAILS`), so no personal address is in the public repo and the handles can't collide with the test people's. |
| Invites sent with the users | A separate "Send 22 Invites" button (each is a real email). |
| "Created by Denise Carter", logs "as Luis Herrera" | Procore records the signed-in admin as the creator; the description / note says who reported or kept it. |
| Weather log | The weather is written into the day's note (no weather log endpoint confirmed). |
| Message photos | Messages are text (the words as said); the photos are on the linked records and in the albums. |
| Visitor / safety logs (optional) | Not seeded. |
| Ky "ball in court" on OBS-04 | Ky is OBS-04's second assignee. |

## Setup (Ky)

1. `DEMO_MODE=true` is already set. Optional: `DEMO_SEED_EMAIL` in Vercel (else the first of `DEMO_ADMIN_EMAILS` is used).
2. Open the page, sign in with Procore (as Edward, an admin), press **Seed Everything**. It makes the projects first.
3. If it says tools are off: in each `[DEMO]` project, Admin → Active Tools, turn on Observations, Punch List,
   Inspections, Daily Log, Photos and Directory. Press **Seed Everything** again (it only runs what isn't done).
4. Anything red or amber: **Copy for Claude** and paste it.
5. Optional: **Send 22 Invites** to sign in as the foremen (they land in your inbox via plus-addresses).

Between demos: **Restore Starting Statuses** (e.g. OBS-04 back to Initiated, PI-12 back to Ready for Review). Records
made live during a demo aren't tagged and stay.

## Unconfirmed in the sandbox (each task's notes say what Procore answered)

Company trades (create), punch `workflow_status` / `punch_item_manager_id` / `final_approver_id` / `mt_location`,
"Urgent" priority, observation comments via `response_logs` without a status change, image delete, company inspection
templates (create, sections with `items_attributes`, item paths tried in turn), `create_from_company_template`,
`POST /rest/v1.0/checklist/lists`, the deprecated list sections fallback, inspection delete, and the user invite
call. Each step has a fallback or says plainly what to do by hand.

## Files

`api/_demoSeedData.js` (cast, projects, records, logs, inspections, messages, task list), `api/_demoSeedRun.js`
(tasks, undo, restore, invites, store), `api/procore/demo-seed.js` (guard, page), `scripts/build-seed-photos.mjs`
→ `api/_demoSeedPhotos.js` (`npm run build:seed-photos`; a real photo at `demo-assets/seed/<key>.jpg` wins),
`tests/demo-seed.test.js`.
