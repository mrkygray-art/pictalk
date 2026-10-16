# SiteSnap: Daily Log Examples page (build notes)

Built from Ky's spec `docs/daily-log-examples-spec.md`.

**Page:** https://sitesnap-procore.vercel.app/api/procore/daily-log-examples (sandbox only, not linked, `noindex`). Sign in with Procore first.

## How to use it

1. **Load Projects**: every project you can see in Procore (none hardcoded). All ticked; untick to skip.
2. **Find Foremen**: per project, reads the directory (Procore calls only; nothing changes). It shows:
   - the project's stage (from the demo staging plan, the project name, or Procore's stage; else "Guessed"). Change it if it's wrong: the text depends on it.
   - the last 5 working days in the project's own time zone.
   - foreman candidates: anyone whose job title says foreman / foreperson / lead / superintendent / super / supervisor. When no title matches, people whose permission template says Foreman / Superintendent or whose company name names a trade, marked **guess**. Each has a trade you can change. Remove with ×, add anyone from the directory with "Add someone…".
   - "No foreman found in this project's directory" when there's no one: pick someone or untick it. No one is ever invented.
   - "No Daily Log access on this project" (403) or "The Daily Log tool is turned off" (404): skipped.
3. **Generate Previews**: 3 cards per project, nothing sent. Each has the date, foreman, the entries, and a **Say it like a foreman** script. Per card: Regenerate (same person and date, new text), Edit, Remove. Per project: Regenerate all 3.
4. **Send this project's samples** or **Send All**: a confirm box says how many logs and entries, and where. The table shows each entry: created / skipped / failed, the Procore id, and Procore's exact words for a failure.
5. **Delete Samples I Created** (per project, or all): deletes only what's in the ledger.

## What the samples say

`api/_dailyLogExamples.js` holds a content bank for 12 trades (GC superintendent, site work, concrete, framing, drywall, painting, electrical, low voltage, plumbing, HVAC, fire protection, roofing) x 4 stages (site work, structure, rough-in, finishes). A trade working outside its main phase (drywall during site work) gets a small crew and early tasks only (takeoff, stocking), never finish work.

- Every sample: **Manpower** (the foreman's company, 4 to 12 workers, 6 to 10 hours; the comment says the work, the crew adding up to the head count, and the hours on site: "Electrical · Unit rough-in. 1 foreman, 4 journeymen, 1 apprentice. On site 6:30 AM to 2 PM.") and **Notes** (`Reported by: name, title, company.` + 3 to 5 sentences + `— [SiteSnap sample]`). Short notes are topped up with a safety / cleanup line ("Toolbox talk at 7 on silica dust, everyone signed.") and the plan for tomorrow, each used once per project.
- About 1 in 3: a **Delivery** (what, from a generic supplier like "Lumber yard", time, condition, "Signed by" the foreman).
- About 1 in 3: an **issue** (material short, inspector pushed, RFI, another trade in the way, weather). Most issues lose time, so about 1 in 4 samples has a **Delay** (the project's matching delay type, start and end, cause and what it held up).
- In a project, the 3 samples use different dates, different foremen when there are 2 or more (different trades first), and never the same sentence twice.
- No phone numbers, emails or real company names. People and companies come from the directory.

## Procore side

Same requests as the app's Daily log (`api/_dailyLog.js`): `POST /rest/v1.0/projects/{id}/manpower_logs | notes_logs | delivery_logs | delay_logs` with `Procore-Company-Id`, paced at about 2 calls a second; a 429 waits out Procore's 10-second window and tries once more. The company goes in `contact_id` (manpower) and `vendor_id` (delay); if Procore refuses it (400 / 422), the entry is sent once more without a company and the table says so. Entries are created **as you**: Procore has no "on behalf of", which is why the foreman is named in the Notes. Adding to a day that already has a log is fine (Procore keeps one log per day and adds entries to it).

Ledger: Firestore `procoreProjects/{companyId}_{projectId}/dailyLogSamples/{sampleId}_{section}` (server only, like the rest of `procoreProjects`): project, log type, Procore id, date, foreman, time. A resend skips anything already there; delete removes the Procore entry (404 = already gone) and then the row.

**Delay type:** Procore's `delay_type` takes the type's key (`weather`, `existing_conditions`), as in its own examples; sending the display name ("Weather") made delays with **No Delay Type**. `delayTypeKey` in `api/_dailyLog.js` sends the key, for this page and for the app's Daily log. If Procore still drops a type, the results table says "Procore didn't keep the delay type". Not yet confirmed in the sandbox.

**Completed days are locked:** once a day is Completed in Procore (Complete Day / Complete Only / Complete & Distribute), its entries can't be deleted or edited through the API, even by the admin who made them: DELETE and PATCH both answer 403 (sandbox, 2026-10-16). After Ky reopened the days in the Daily Log Calendar, all 12 samples deleted at once. Delete samples before completing a day. On a 403 the page also tries setting the entry back to pending before deleting again, and the error says to reopen the day.

**Add 2 foremen** (per project): adds Derek Lawson (Plumbing Foreman, ClearFlow Plumbing & Mechanical) and Maria Santos (Electrical Foreman, VoltLine Electric Inc.), `EXTRA_FOREMEN` in `api/_seedDirectory.js`, with the test-people page's own steps (company onto the project, person created or updated, added, Subcontractor - External template), then reloads the project's foremen. Safe to run again: a 409 "email already exists" (someone made moments ago, not yet in Procore's search) finds the person in the full company list and updates them. The test-people cleanup always keeps them.

**Clear old "SiteSnap test" entries** (per project): finds the entries the Daily Log check page left in the last 5 working days (text starting "SiteSnap test"), lists them in a confirm box, and deletes only those.

Code: `api/procore/daily-log-examples.js` (page + actions), `api/_dailyLogExamples.js` (bank, foremen, stage, samples), `tests/daily-log-examples.test.js`.

## Not in version 1 (spec section 11)

- **Photos**: left out. In the Daily Log check, photos sent with an entry weren't kept (`docs/closeout-dailylog-test-results.md`), so this waits on that answer.
- **Write with AI** toggle: not built. Vercel has no model key today (the AI runs in Firebase functions); the content bank covers the spec's rules. Can be added later.
- Weather, visitors, inspections, safety logs: not built.
- Stage from open items: the page guesses from the name and Procore's stage and says "Guessed"; you set it per project.
