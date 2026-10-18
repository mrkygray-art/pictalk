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
| Project allowlist | A call naming a project outside `DEMO_PROJECT_IDS` (path `/projects/{id}`, `project_id` in the query or the JSON body) is refused (403 `loop_project`), reads too. A write that names no project is refused. The project picker (`listProjects`) shows only the demo projects. |
| Action allowlist | Reads pass. Writes allowed: create an Observation (+ its assignee email), change it (status), add a response, upload slot, Photos album + image. Anything else, deletes included, is refused (403 `loop_action`) before Procore sees it. |
| Kill switch | `FULL_LOOP_DEMO=false` (then redeploy) turns all of this off; the app is exactly as before. |
| Not affected | **The owner** (a Procore login in `DEMO_ADMIN_EMAILS`, i.e. Ky / Edward Gray): never limited, every project, every tool, the normal card (Ky, 2026-10-18: "Edward Gray should have full rights, I am the admin"). Checked with Procore's `/me` once per sign-in token, remembered 10 minutes per server. Guest demo sessions (their own read-only guard: everything works up to the send button, nothing reaches Procore), and the sandbox tool pages (`test-*`, demo staging / check / seed / authorize, seed directory, daily log examples), which have their own owner/admin guards. So demo mode now limits only other signed-in test accounts. |

While it's on, the app's other Procore tools (Punch Items, Daily log, Inspections, …) can't write: the spec keeps
them out of this phase.

**Tokens:** the signed-in person's tokens stay in the sealed httpOnly cookie (refreshed early, one refresh + retry
on a 401). `procoreSend(..., { retry429: true })` waits out a 429 (Procore's reset header, 2–12 s, twice); the loop's
endpoints will pass it. It's opt-in because demo staging and others handle a 429 themselves.

**Still to decide (Step 7, status sync):** Procore's webhook only says "this item changed", so the server must read
it back with someone's sign-in. Plan: keep the PM's sign-in sealed in server-only Firestore, as the guest demo does.

## Steps 4–5: classify, confirm, create (built, not merged)

The existing Report flow (`src/messaging/ReportFlow.jsx`, `functions/classifier.js`, `api/procore/records.js`)
already did most of it; what changed:

| Spec | Built |
|---|---|
| Strict JSON with `suggested_assignee`, `follow_up_question`, `missing_info`, `daily_log` | Added to the classifier's schema. `assignee_company` is kept only if it's a company on the project ("drywall sub" → Clean Line Drywall); `follow_up_question` only when confidence is under the threshold. The existing names stay (`record_type` `rfi` = the spec's `question`; `missing_fields` = `missing_info`, both returned). |
| Threshold 0.6, configurable | `CLASSIFY_CONFIDENCE_THRESHOLD` (Functions env), default 0.6. |
| Low confidence: ask the one question | A "One question" screen (speak or type the answer); the answer is added to the words and SiteSnap fills it in again. Asked once; Skip goes to the card with the first draft. |
| Phase 1 = Observations; another type: "Create as Observation" or "Save as note" | In demo mode the card has no type switch; another type the AI heard shows both buttons. Save as note = a SiteSnap thread to the people picked, nothing in Procore. Outside demo mode the card is as before (Observation / Punch Item). |
| Assignee: one match preselected, several 2–3 choices, none = must pick | `src/messaging/assigneeMatch.js`: a named person, else the company heard, else the trade (company or title). In demo mode Approve & Send needs an assignee. |
| Approve & Send / Edit / Discard | The card's buttons (all modes). Edit = back to the words; Discard asks first. Done screen: View in Procore. |
| Idempotent create, mapping row | `api/_captures.js`: the capture id is the key. A Firestore transaction takes a lock (`recordCaptures/{id}` `state: creating`); a repeat gets the first answer back (`repeat: true`), a second request while the first runs gets 409 `already_sending`, a refused create lets go of the lock, a lock older than 2 minutes can be taken again. The row: `siteSnapItemId, procoreProjectId, procoreObservationId, recordType, number, url, createdByActor, createdAt, demoTag`. |
| Photo to Procore Photos + linked | Already: attached to the Observation (`upload_ids`) and filed in the day's album, linked (`autoFilePhotos`). |
| Log every classification | `classifyCapture` adds each run to `procoreProjects/{key}/classifications/{captureId}.runs`; the create adds `proposed` (the card as first filled in), `final`, `edits` (fields changed) and `record`. Server only. Not for guest demo visitors. |
| `[SS-DEMO]` marker | Now also added while `FULL_LOOP_DEMO=true` (was only `DEMO_MODE`). |

Needs a Functions deploy for the new classifier fields and the run log: `classifyCapture`. Until then the app works
as before (no company match, no follow-up question).

Not done yet: EXIF GPS stripping when the phone can't shrink a photo (spec section 7 item 7; the phone's shrink
re-encodes, which drops it, but the fallback sends the original).

## Settings (Vercel, Production)

| Setting | |
|---|---|
| `FULL_LOOP_DEMO` | `true` turns demo mode on |
| `DEMO_PROJECT_IDS` | shared with demo staging and the guest demo |
| `DEMO_ACTOR_PM` | Ky's Procore login (the demo check compares it with the signed-in account) |
| `DEMO_ACTOR_ASSIGNEE` | Option B only |
| `CLASSIFY_CONFIDENCE_THRESHOLD` | Functions env (not Vercel), default 0.6 |

Tests: `tests/demo-check.test.js`, `tests/full-loop.test.js`, `tests/full-loop-records.test.js`,
`tests/classifier.test.js`; on the phone `e2e/e2e-full-loop.js` (emulators + `npx vite --port 5178`) and
`e2e/e2e-report.js`.
