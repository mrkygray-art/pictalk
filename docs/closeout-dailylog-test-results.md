# Close-Out + Daily Log: sandbox check results

Check page: `/api/procore/test-dailylog` (Daily Log). Close-Out isn't built yet.

## Daily Log

### Run 1: Edward Gray (admin), 2026-10-16, project 373212
- Read today's Manpower / Delays / Deliveries / Notes (`?log_date=`): **200** each.
- Delay types: `GET /rest/v1.0/projects/{id}/daily_logs/delay_log_types` **200**, 7 types, shaped `{ id, display_name, english_or_display_name, translation_key, visible }` (no `name`). Fixed in `api/_dailyLog.js` `delayTypeName`.
- Created one of each (**201**); each was found when read back. Procore makes the day's `daily_log_header_id` by itself. Status came back `approved` (admin).
- Deliveries: `time_hour`, `time_minute`, `delivery_from`, `contents`, `comments` all kept.
- Delays: `start_time` / `end_time` "HH:MM" kept (answer: `start_time_hour`, `end_time: "8:00 AM"`, `duration: 1`), `comments` kept. **`delay_type` came back `""`**: how to send it is still open.
- **Photos as multipart `{log}[attachments][]` were not kept** (`attachments: []` on Delay and Note). Still open.
- Manpower company: not tested (Edward has no company on this project, so none was sent). Now the check uses the project's first company.
- Rate limit: 25 calls per 10 seconds.

### Run 2: Chloe Abara (Sentinel Low Voltage & Security, template Subcontractor - External), 2026-10-16
- Ran the first version of the page (before the variant tries were live).
- **Every Daily Log read and write: 403** "You do not have sufficient access to complete that action." Delay types 403.
- Her template here is **Subcontractor - External**, whose Daily Log level is **None** in this sandbox (seen in Procore's Directory, 2026-10-16). So this run is the **subcontractor foreman** case: no Daily Log by default. In the app she'd see "You don't have permission to use the Daily Log on this project." (B7), which is the intended behavior.

### Still to run
- Edward on the current page: which way the delay type and photos stick, and whether `contact_id` sets the manpower company.
- Chloe again with Daily Log at Standard (Ky taking her off the template, custom permissions) to see a sub foreman write.
- An internal foreman (Foreman / Superintendent - Internal); its Daily Log level isn't known yet.
