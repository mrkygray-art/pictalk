# Full-loop demo (Ky's account is the PM)

From Ky's `SITESNAP_FULL_LOOP_DEMO_SPEC.md` v4 (2026-10-18). The loop, live in Procore's sandbox in each demo
project: speak + photo → AI proposes an Observation → confirm → created in Procore with the photo and a trade
assignee → close-out ("fixed, ready for review" + after photo) → the PM closes it. Built on branch
`feature/full-loop-demo`; only the Step 0 check page is on `sitesnap` so far.

## Decisions (2026-10-18)

- **Option A (PM only).** Ky's own Procore sign-in does every step; the Observation is assigned to the trade's
  Directory contact, and the demo performs the assignee's close-out with the PM account. Option B (a second
  Foreman/Sub user) can be added later.
- **Its own flag, `FULL_LOOP_DEMO`.** `DEMO_ENABLED` already means the public view-only guest demo (`/demo`,
  `docs/guest-demo.md`); the two never affect each other.
- **Demo marker:** `[SS-DEMO]` at the start of the title (already added in demo projects by `api/procore/records.js`,
  and what Reset uses).
- **Projects:** the existing `DEMO_PROJECT_IDS` (HP 373715, WG 373716, LV 373717).

## Step 0: demo check (done)

`/admin/demo-check` (`api/procore/demo-check.js`, rules in `api/_demoCheck.js`): read only, owner only
(`DEMO_ADMIN_EMAILS`), sandbox only. Ky's run on 2026-10-18 passed everything in all three projects: Edward Gray
active, statuses initiated / ready_for_review / not_accepted / closed, on the Observations assignee list, Drywall
(Carlos Mendez), Electrical (Alicia Nguyen), Plumbing (Ray Castillo), Roofing / Envelope (Owen Fletcher, Skyline
Roofing & Waterproofing, added to the demo people that day), Observation webhooks offered. Two expected PARTIALs:
`DEMO_ACTOR_PM` not set, and no project permission template (Ky is a company admin, who has every tool).

## Step 3: demo mode (built, not merged)

`api/_fullLoop.js`. While `FULL_LOOP_DEMO=true`, every Procore call made with a signed-in person's token
(`procoreGet` in `api/_procore.js`, `procoreSend` in `api/_procoreWrite.js`) goes through `guardFullLoop()`:

| Guard | What it does |
|---|---|
| Project allowlist | A call naming a project outside `DEMO_PROJECT_IDS` (path `/projects/{id}`, `project_id` in the query or the JSON body) is refused (403 `demo_project`), reads too. A write that names no project is refused. The project picker (`listProjects`) shows only the demo projects. |
| Action allowlist | Reads pass. Writes allowed: create an Observation (+ its assignee email), change it (status), add a response, upload slot, Photos album + image. Anything else, deletes included, is refused (403 `demo_action`) before Procore sees it. |
| Kill switch | `FULL_LOOP_DEMO=false` (then redeploy) turns all of this off; the app is exactly as before. |
| Not affected | Guest demo sessions (their own read-only guard), and the sandbox tool pages (`test-*`, demo staging / check / seed / authorize, seed directory, daily log examples), which have their own owner/admin guards. |

While it's on, the app's other Procore tools (Punch Items, Daily log, Inspections, …) can't write: the spec keeps
them out of this phase.

**Tokens:** the signed-in person's tokens stay in the sealed httpOnly cookie (refreshed early, one refresh + retry
on a 401). `procoreSend(..., { retry429: true })` waits out a 429 (Procore's reset header, 2–12 s, twice); the loop's
endpoints will pass it. It's opt-in because demo staging and others handle a 429 themselves.

**Still to decide (Step 7, status sync):** Procore's webhook only says "this item changed", so the server must read
it back with someone's sign-in. Plan: keep the PM's sign-in sealed in server-only Firestore, as the guest demo does.

## Settings (Vercel, Production)

| Setting | |
|---|---|
| `FULL_LOOP_DEMO` | `true` turns demo mode on |
| `DEMO_PROJECT_IDS` | shared with demo staging and the guest demo |
| `DEMO_ACTOR_PM` | Ky's Procore login (the demo check compares it with the signed-in account) |
| `DEMO_ACTOR_ASSIGNEE` | Option B only |

Tests: `tests/demo-check.test.js`, `tests/full-loop.test.js`.
