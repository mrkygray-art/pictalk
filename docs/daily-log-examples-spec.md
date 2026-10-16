# SiteSnap AI — Daily Log Examples Page (Spec for Claude Code)

Put this file in the repo's `docs/` folder. Build it as a new admin/test page, the same style as the existing pages for adding companies, users, etc.

---

## 1. Goal

Create **3 realistic sample Daily Logs for every project** in the Procore sandbox, each written as if a **real foreman from that project's directory** filed it.

The owner (Ky) is not a foreman, so the data must **not be random filler**. Every sample has to read like something a real foreman would report, fit the trade of the person writing it, and match the stage of the project.

These samples serve two purposes:

1. Fill the Procore sandbox with believable Daily Log data so the PM dashboard and demos look real.
2. Give Ky a **"read it aloud" script** for each sample, so he can test SiteSnap's voice-driven Daily Log by speaking like a foreman.

---

## 2. Scope

**Projects:** every project the signed-in user can see in the sandbox company, including the test/demo ones. At minimum:

- SiteSnap AI · Test people
- SiteSnap AI · Procore API test
- SiteSnap AI · Permissions check
- SiteSnap AI · Demo staging
- SiteSnap AI · Photos check
- SiteSnap AI · Daily Log check
- Plus any other sandbox project returned by the API (for example Procore's default sandbox test project)

Do not hardcode names. Load the list from Procore and show it on the page.

**Volume:** 3 samples × number of projects (currently about 18+).

---

## 3. The page

Add a new page, **"Daily Log Examples"**, next to the existing add-companies / add-users pages. Same header, same buttons, same look.

### Step 1 — Load projects
- Button: **Load projects**. Calls Procore and lists every project with its name and ID.
- Each project row has a checkbox (all checked by default).

### Step 2 — Find the foremen (per project)
For each project, pull that project's directory users and build a **foreman candidate list**:

1. Match when `job_title` contains any of: `foreman`, `foreperson`, `forman`, `lead`, `superintendent`, `super`, `crew lead`, `general foreman`.
2. If nothing matches, also look at the company/trade name and the permission template for hints, but mark those as **"guess"**.
3. Show the candidates in a dropdown per project with name, title, company, and trade. **Ky can add or remove people** before generating.
4. If a project has **no foreman candidates**, show a clear warning: "No foreman found in this project's directory." Offer two choices: pick anyone from the directory manually, or skip the project. **Do not invent a person.**

### Step 3 — Preview samples
- Button: **Generate previews**. Nothing is sent to Procore yet.
- For each project, show 3 sample cards. Each card shows:
  - Date, foreman name, company, trade
  - The structured log entries (see section 5)
  - **"Say it like a foreman" script** (a short spoken version Ky can read aloud)
- Per card: **Regenerate**, **Edit**, **Remove**.
- Per project: **Regenerate all 3**.
- Randomization: each project's 3 samples must come from **different foremen when the project has 2 or more candidates**, and from different trades where possible. No two samples in a project should have the same date or the same text.

### Step 4 — Push to Procore
- Button per project: **Send this project's samples**. Button at top: **Send all**.
- Default is **preview only**. Sending requires a confirm dialog that states how many logs will be created and in which projects.
- Show a result table: project, sample #, log type, status (created / skipped / failed), Procore ID, and the exact error message for any failure.

### Step 5 — Cleanup
- Every record the page creates is saved in a local ledger (project ID, log type, Procore ID, timestamp).
- Button: **Delete samples I created** (per project and all). It deletes only what is in the ledger.
- Sample text should also carry a small marker (see section 6) so samples are easy to spot in Procore.

---

## 4. Dates

- Use the **last 5 working days** (skip weekends). Each sample in a project gets a different date.
- Never use a future date.
- If a Daily Log already exists for that date, add to it. Do not fail.

---

## 5. What each sample contains

Each sample is **one day's log** for one foreman. Use a realistic mix. Not every sample needs every type, but **every sample must have Manpower and Notes**.

| Log type | Required? | What it holds |
|---|---|---|
| Manpower | Yes | Company/trade, number of workers, hours, short work description |
| Notes | Yes | 2–5 sentences of what happened, in foreman language |
| Delivery | About 1 in 3 | What arrived, from whom, condition, who signed |
| Delay | About 1 in 4 | Cause, hours lost, what was affected |
| Photos | Optional | Attach a photo through Procore's own Photos tool if one is available |

Optional extras only if the endpoint is enabled on the project: Weather, Visitors, Inspections, Safety.

**Content rules (this is the important part):**
- Write in plain jobsite language. Short, specific, a little rough. No marketing tone.
- **Match the foreman's trade.** A drywall foreman talks about board, mud, and Level 4 finish. An electrician talks about rough-in, pulling wire, and panel gear. A concrete foreman talks about pours, pump trucks, and cylinders.
- **Match the project stage.** Do not report finish paint on a project that is still in site work. Use the project's stage or name if available; otherwise infer a stage from open items in the sandbox data and say so.
- Use real quantities and times (crew size of 4–12, 6–10 hours, "poured 40 yards", "set 22 frames").
- Include the occasional real-world issue: material short, inspector pushed, waiting on RFI, another trade in the way, weather. About 1 in 3 samples should include one.
- No made-up phone numbers, emails, or real company names. Use the directory's real names.
- Do not repeat sentences across samples.

### Example content bank (seed for the generator, expand it)

**Drywall**
- Hung 3rd floor corridor, 38 sheets 5/8 Type X. Taped and first coat on units 301–304. Short 12 sheets of 1/2", on order for tomorrow AM.

**Electrical**
- Pulled home runs for panel LP-2. Terminated 14 circuits in the east wing. Waiting on inspector for rough-in sign-off, scheduled 10 AM.

**Concrete**
- Poured slab section B, about 40 yards. Pump on site 6:30. Finished and cured by 2 PM. Cylinders taken, 4 total.

**Framing**
- Stood second-floor walls on grid lines C–F. Lost 2 hours waiting on the crane. Sheathing starts tomorrow if wind stays down.

**Plumbing**
- Roughed in underslab drains at restrooms. Pressure test passed at 5 PSI hold. Inspector requested to see the cleanout locations.

**Roofing**
- Tore off the north slope, dried in by 3 PM. Rain expected tomorrow. Tarped the exposed area and tied it down.

**Site work / Excavation**
- Trenched 220 ft for storm line. Hit unmarked conduit at 4 ft, stopped work, flagged it, and called the PM.

**Fire protection / Low voltage / HVAC**
- Add similar short entries. Keep them trade-specific.

---

## 6. Sample marker (for cleanup and honesty)

Add a small tag at the end of the Notes text, for example:

`— [SiteSnap sample]`

This lets Ky spot sample entries in Procore without them looking fake in the dashboard. Keep the tag the same everywhere.

---

## 7. Who "wrote" it

The Procore API will create these logs as **the OAuth user (Ky)**, not as the foreman. To keep the foreman visible:

- Put the author in the log text: `Reported by: [Name], [Title], [Company]`.
- If the endpoint accepts a user or vendor field (for example on Manpower), set it to the foreman and their company.
- Show this limitation in a small note on the page so nobody is surprised.

---

## 8. Procore API notes

Claude Code must **confirm every endpoint, field name, and payload shape against the current Procore API docs** before coding. Do not rely on this list as final.

Likely endpoints (all under `/rest/v1.0/projects/{project_id}/`):

- Manpower logs: `manpower_logs`
- Notes logs: `notes_logs`
- Delivery logs: `delivery_logs`
- Delay logs: `delay_logs`
- Directory: project users (`users`) and vendors (`vendors`)
- Projects list: `/rest/v1.0/projects?company_id={company_id}`

Rules:
- Send the `Procore-Company-Id` header on every call.
- Reuse the existing OAuth token handling and the existing sandbox base URL.
- Throttle calls (small delay between requests) and retry on 429 with backoff.
- **Handle 403 cleanly.** Some projects (for example "Permissions check") may deny access or have the Daily Log tool turned off. Show "No Daily Log access on this project" for that project and keep going with the others.
- If the Daily Log tool is disabled on a project, say so. Do not try to enable it.

---

## 9. AI generation (optional, behind a toggle)

Default: build samples from the content bank with randomized combinations.

Toggle: **Write with AI**. When on, send the foreman's name, title, trade, company, and the project name/stage to the model and ask for a short, rough, jobsite-style log in the shape above. Keep the same content rules. Always show the result in the preview before anything is sent.

---

## 10. Acceptance checklist

- [ ] New "Daily Log Examples" page matches the existing admin pages
- [ ] Projects load from Procore, none hardcoded
- [ ] Foremen are detected per project from the directory and are editable
- [ ] Projects with no foreman show a warning and are never filled with invented people
- [ ] 3 samples per selected project, different dates, different foremen when possible
- [ ] Every sample has Manpower and Notes, with trade- and stage-appropriate text
- [ ] Each sample has a "say it like a foreman" script
- [ ] Preview first, confirm before sending
- [ ] 403 and disabled-tool cases are handled per project
- [ ] Ledger of created records and a working **Delete samples I created**
- [ ] Sample marker present on every Notes entry

---

## 11. Open items to confirm with Ky

1. **Foreman titles:** if the directory job titles do not say "foreman", Ky will pick the foremen by hand in Step 2. Is that fine?
2. **Photos:** attach sample photos from Procore's Photos tool now, or leave photos out of the first version?
3. **AI toggle:** include it in version 1, or add it later?
