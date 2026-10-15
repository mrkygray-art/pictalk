# Demo staging (demo data seed + reset)

From Ky's `sitesnap-demo-seed-and-reset.md` (2026-10-15). Three demo projects in Procore's sandbox, filled with
15 scenarios that show SiteSnap's loop (speak + photo, real Procore record, the right people tagged, follow-up),
with a reset so it can be run again.

**Page:** https://sitesnap-procore.vercel.app/api/procore/demo-staging (not linked anywhere, `noindex`).

## Differences from the spec

The spec was written for a Next.js/TypeScript app with server-side Procore credentials. SiteSnap is plain JS on
Vercel functions and writes to Procore with each person's own sign-in (decision A), so:

| Spec | Built |
|---|---|
| `scripts/seed-demo.ts`, `scripts/reset-demo.ts` (CLI) | No CLI: there are no stored Procore credentials to run them with. Seed = the page's import buttons; reset = Preview Reset (the dry run) and Reset Demo. |
| `seed-manifest.json` | The scenario rows in Firestore (`sitesnapDemo/state/scenarios/{ID}`, server only) are the manifest: scenario → Procore id, steps done. A serverless function can't keep a file. |
| `/demo-staging` route, "admin role" | `/api/procore/demo-staging` (same family as the other sandbox pages). SiteSnap has no admin role, so "admin" = a Procore admin: only admins can read a company permission template's details. |
| `--dry-run`, `--yes` | Preview Reset changes nothing; Reset Demo asks once (the spec's wording). |
| `/demo-assets/<ID>.jpg` read at run time | Read at build time by `npm run build:demo-photos` into `api/_demoPhotos.js` (placeholders for the rest). Files in `public/` would be precached onto every phone. |
| 16 scenarios; LV = 3 open, 3 closed | The scenario list has 15 (HP 4, WG 5, LV 6) and LV is 4 open (1 overdue), 2 closed. The page follows the scenario list. |
| "Closed 5 days ago" | Procore can't backdate a close: records close today. SiteSnap's thread is backdated to match the story. |
| Closing comment | Observations: a response that closes it (`response_logs`). Punch Items: a comment, then closed. |
| "PM dashboard" | Not built yet (Phase 2 was paused). The page shows the Open / Overdue / Closed shape per project instead. |
| "Mr. Alan Reese" | Alan Reese: Procore has no honorific field. |

## Setup (Ky)

1. With only `DEMO_MODE=true` set (Config, Production) and redeployed, open the page and press **Create Demo Projects in Procore** (or pick existing ones), then copy the value it shows.
   Vercel → sitesnap-procore → Settings → Environment Variables (Production):
   - `DEMO_MODE` = `true`
   - `DEMO_PROJECT_IDS` = `HP:<id>,WG:<id>,LV:<id>` (the project id is the number in the Procore address,
     `…/<id>/project/…`; with only `DEMO_MODE` set, the page lists your projects and builds this line for you)
   - optional: `IMPORT_BATCH_SIZE` (default 3, max 6), `IMPORT_DELAY_MS` (default 500)
   Then redeploy (env changes only apply to a new deployment).
2. Open the page, sign in with Procore if asked.
3. Setup and reset → **Add Demo People to HP**, then WG, then LV (companies, people, permission templates,
   Dana gets the Project Manager role).
4. **Run Delete Check** once (the spec's spike): it says whether Procore lets us delete Observations and Punch
   Items and what can be edited after closing. Screenshot it for Claude.
5. **Import Next Batch** until everything is green. Anything red or amber: tick **Show only not imported**,
   screenshot, or press **Copy for Claude**.

## How it stays safe

- Every request: Procore sandbox only, `DEMO_MODE=true` (else 404, page and data), signed in, Procore admin.
- Only the three allowlisted projects; reset touches a record only if it's in one of them **and** its title
  starts with `[SS-DEMO]` (a manifest record that lost its tag is listed as left alone).
- Live captures in the demo projects are tagged `[SS-DEMO]` automatically (`api/procore/records.js`), so reset
  finds them too.
- Import: one scenario at a time, paced; a 429 stops the batch and marks the rest "429 rate limited, retry later".
  Steps per scenario: create, photo, assignee, close (closed ones), SiteSnap thread. A half-done one is **Partial**
  and a retry resumes from the missing step; a record deleted in Procore since is made again.
- Reset: delete; if Procore refuses, close + rename `[SS-DEMO][ARCHIVED] …`. Clears the SiteSnap threads for
  those records (messages and read marks) and puts the rows back to Not imported.
- The test-people page's cleanup never offers the demo people or companies.

## Files

`api/_demoScenarios.js` (projects, people, scenarios, rules), `api/_demoImport.js` (import, reset, delete check,
store), `api/procore/demo-staging.js` (guards, page), `api/_seedSteps.js` (paced directory steps shared with the
test-people page), `api/_demoPhotos.js` (generated), `scripts/build-demo-photos.mjs`, `demo-assets/`,
`tests/demo-staging.test.js`.

## Live demo items (not seeded)

Captured on stage with the app (each lands tagged `[SS-DEMO]`):
- HP: "Rebar at the south footing is missing the corner bars." (Observation; tag Luis Herrera and Tom Becker)
- WG: "Cable tray is hanging lower than the lights, blocking the forklift lane." (Observation; tag Alicia Nguyen and Marcus Ortega)
- LV: "Fire extinguisher cabinet in Hallway A is missing its extinguisher." (Punch Item; assign Priya Raman)
