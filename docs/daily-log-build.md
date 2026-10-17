# SiteSnap: Daily log by voice (build notes)

Built from Ky's spec `closeout-and-daily-log-spec.md`, **Feature B only** (Close-Out, Feature A, is not built yet). Ky approved the flow from a clickable sample on 2026-10-16.

## What the foreman does

Project home → **Daily log** tile (its line says *Not sent today*, *Draft in progress*, or *Sent today · N entries*) → date chip (Today by default, the project's own date; Yesterday or another past day) → **Tap to Talk** as many times as they like (the words add up and can be typed or fixed) → optional photos → **Organize My Log** → four cards (Manpower, Delays, Deliveries, Notes), each entry editable, deletable, with "You said …" and **Check this** tags that have one-tap answers → **Send N entries to Procore** → one row per entry with ✓ / Retry.

- Send asks first when a Check this is still open, and when manpower for the same company is already logged that day (B6). Never auto-merges.
- Photos go with Notes unless tapped and given to an entry. With no note, a "Site photos" note is made for them.
- The draft (words, cards, photos) lives on the phone (localStorage + IndexedDB) until every entry is in. Partly sent drafts remember which entries went (`sent`), and the server remembers each entry id, so a retry never makes a second copy.
- No Daily Log access (a 403 on the day's manpower) → a plain message, no capture screen (B7).
- Procore busy (429) → "Procore is busy, trying again in a moment", retried by itself up to 3 times.

## Code

| Piece | File |
|---|---|
| Home tile | `src/messaging/ProjectHome.jsx`, `MessagingApp.jsx` (`dailyStatusFor`) |
| Screens | `src/messaging/DailyLogFlow.jsx` |
| Phone store (options, draft, send one entry) | `src/messaging/dailyLogStore.js` |
| AI organizer (callable, needs deploy) | `functions/dailyLog.js` `organizeDailyLog` |
| Prompt, schema, validation, fallback | `functions/dailyLogParser.js` |
| Procore paths, fields, plain-word errors | `api/_dailyLog.js` (the one place to change a field name) |
| Options + one entry | `api/procore/daily-log.js` (GET / POST) |
| Sandbox check page | `api/procore/test-dailylog.js` → `/api/procore/test-dailylog` |
| Tests | `tests/daily-log-parser.test.js`, `tests/daily-log.test.js`, `e2e/e2e-dailylog.js` |

The organizer keeps only companies, delay types and locations from the project's real lists; anything else becomes a Check this. Times must be real `HH:MM`; AM/PM guesses are always flagged. If the model fails twice, the whole update becomes one Note ("I couldn't organize this. It's saved as a note.").

## Procore fields: best known, confirm with the check page

| Section | Request |
|---|---|
| Manpower | `POST /rest/v1.0/projects/{id}/manpower_logs` `{ manpower_log: { date, num_workers, num_hours, contact_id, location_id, notes } }`. The company is **`contact_id`**: a report from another Procore integration (Sept 2026) says `vendor_id` is ignored and leaves the company blank. |
| Delays | `…/delay_logs` `{ delay_log: { date, delay_type, start_time, end_time, vendor_id, location_id, comments } }` + photos as `delay_log[attachments][]` |
| Deliveries | `…/delivery_logs` `{ delivery_log: { date, time_hour, time_minute, delivery_from, contents, comments } }` |
| Notes | `…/notes_logs` `{ notes_log: { date, comment, location_id } }` + photos as `notes_log[attachments][]` |
| Lists | `GET …/{section}?log_date=YYYY-MM-DD` |
| Delay types | first of `…/daily_logs/delay_log_types`, `…/projects/{id}/delay_log_types`, `…/companies/{id}/delay_log_types` that answers with a list |
| Companies | `GET /rest/v1.0/projects/{id}/vendors`; the foreman's own company = their project user's `vendor` |

## Past logs (2026-10-16)

Ky asked for: view past logs; edit or delete only your own entries while the day is open (Procore locks a Completed day); never change approval status; easy to find.

- Where: a **New log | Past logs** switch under the title (capture and review screens), "See it in Past logs" after a send, and "· past logs" on the home tile.
- Days list (Ky, 2026-10-16): only days with entries, newest first, 30 days per read, Show older logs, the list scrolls in its own box (58dvh), Go to a day above it (opens only a complete date). The open day lives in DailyLogFlow, so the Past logs tab inside a day goes back to the list. A day: everyone's entries by section, who made each, Approved / Waiting on approval, photo count.
- Own entries only: Edit (the review card in a sheet, Save to Procore) and Delete (asks first). The server re-reads the entry and checks `created_by` before PATCH / DELETE.
- Locked day: Procore answers 403 (seen with the Daily Log Examples cleanup); the app shows "This day is locked in Procore" and hides Edit / Delete. SiteSnap never PATCHes a status to get around it.
- Still to confirm in the sandbox: that `start_date` / `end_date` filter the list endpoints (one day uses `log_date`, already confirmed), that PATCH with nulls clears a field, and the shape of `start_time` / `delay_type` in a read-back.

Procore's field-level reference doesn't load outside a browser, so these are not yet confirmed against a live answer. **The check page shows exactly what Procore kept for each field** ("company BLANK" etc.); fix any mismatch in `api/_dailyLog.js` only.

## To go live (Ky)

1. Turn on the **Daily Log** tool in the sandbox projects (Project Tools).
2. Deploy the organizer: `firebase deploy --only functions:organizeDailyLog` (until then Organize falls back to one Note).
3. Open `/api/procore/test-dailylog` signed in as Edward, then Chloe (Foreman / Superintendent - Internal), then a Subcontractor - External foreman; send Claude the page each time. Results go in `docs/closeout-dailylog-test-results.md`.
4. Try it on a phone: Daily log tile → talk → Organize → Send, then check Procore's Daily Log for that day.

Not built (out of scope v1): weather, visitors, inspections, equipment and the other sections; editing or deleting sent entries; approvals.
