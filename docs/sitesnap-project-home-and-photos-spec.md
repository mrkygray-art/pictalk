# SiteSnap: Project Home and Project Photos (Procore Photos integration)

Target repo: `sitesnap-procore` (Vercel). Place this file in `docs/`.

## Goal

After a user signs in and picks a Procore project, show a simple project home screen with three actions. Add a new **Project photos** flow that uses **Procore's own Photos tool** as the system of record. We do not build our own photo storage or gallery database. Procore holds the photos; SiteSnap captures, uploads, and browses them.

Design stance (unchanged): foremen never log into Procore. Everything they need happens inside SiteSnap. PMs review in Procore.

## Scope

In scope:
1. Project home screen with three actions.
2. Project photos flow: capture, upload to a Procore album, browse albums and photos.
3. Auto-filing photos from "Report an issue" and "Message" into the day's album.
4. Offline capture queue for photo uploads.

Out of scope for this spec (do not build now):
- Daily Log, Inspections, RFI drafting, Change Events.
- Changes to the existing Report an issue or Message logic beyond the auto-file hook in section 4.
- Visual redesign. Reuse the current iPhone-style skin, colors, and components.

## 1. Project home screen

Shown right after a project is selected. Header shows the project name and a back control to the project picker.

Three large tappable tiles, in this order:
- **Report an issue**: opens the existing AI-classified Observation / Punch Item flow (photo plus voice, confirmation card, push to Procore).
- **Message**: opens the existing project messaging flow (photo plus voice, people search and multi-select, tagged people alerted).
- **Project photos**: opens the new flow in section 2.

Layout: Report an issue and Message side by side, Project photos full width below. Tiles use an icon, a short title, and a one-line subtitle. Use existing design tokens. Keep every existing feature reachable; this screen only adds a routing step.

Acceptance:
- Selecting a project always lands here.
- Back returns to the project picker without losing sign-in state.
- All three tiles carry the selected `project_id` into the next screen.

## 2. Project photos flow

### 2.1 Landing view

Header: "Project photos", a back control, and a **Snap** button (camera).
Filter chips: **By day** (default), **By area**, **By trade**.
Below: a list of albums. Each row shows a thumbnail, album name, photo count, and last-updated date. Tapping a row opens that album.

Data source: read albums (Procore calls them image categories) and their photos from Procore's Photos API. Do not cache photos in our own database beyond short-lived client or server caching for speed.

Grouping behavior:
- **By day**: group photos by capture date. If Procore albums are not date-based, build this view by filtering images on created date, not by requiring a date album.
- **By area**: group by Procore album. This is the default Procore structure.
- **By trade**: show only if the photo record carries trade info we wrote (see 2.4). If not available, hide this chip for now rather than fake it.

### 2.2 Snap (capture and upload)

1. User taps Snap, camera opens directly.
2. After the photo, optional voice note (existing Deepgram flow). Skip allowed.
3. Album picker, defaulted to the day's album (see 2.3). User can change it with one tap.
4. Save uploads to Procore. Show a plain-language confirmation ("Saved to Level 2 East").

Image handling before upload:
- Convert HEIC to JPEG.
- Resize to a sensible max long edge (start with 2048 px) and compress, since Procore's help notes large uploads can time out. Make these values constants.
- Do not upload TIFF.

Upload call: Procore Create Image, `POST /rest/v1.0/images`, multipart/form-data, with `image[data]` (the file) and `image[image_category_id]` (the album). Confirm other required fields against the current API docs before coding. Procore also documents an `upload_uuid` approach; check which is recommended for our payload size and use that.

### 2.3 Albums

Albums in Procore are image categories. Default behavior:
- Use or create one album per day, named `Field photos YYYY-MM-DD` (local project date).
- If the app cannot create albums (see section 6, item 1), fall back to listing existing albums and letting the user pick; if no sensible album exists, show a clear message telling the user to ask a PM to create an album.

Privacy:
- Respect Procore's rule that photos uploaded to a private album become private. Do not write to private albums by default. Prefer public albums so photos remain visible in other Procore tools.

### 2.4 Captions and voice notes

- Put the AI summary or transcript of the voice note into the photo's description field if the API supports it (verify in section 6, item 3).
- Also add the capturing user's name and time in the description if it does not clutter it.
- Keep the original audio in SiteSnap storage, linked by Procore image ID. Procore's Photos tool is not assumed to store audio.
- If a trade was identified (from tagging or AI), append it in a consistent text pattern so a By trade view can parse it later. Do not invent structure Procore does not support.

### 2.5 Browsing

Album view: grid of thumbnails, newest first. Tap a photo for full view with its description, who captured it, time, and (if linked) a "linked to Observation / Punch item" badge. Load more on scroll.

Read-only in this version: no delete or edit of Procore photos from SiteSnap.

## 3. Linking photos to items

When a photo is also attached to an Observation or Punch Item created by "Report an issue":
- Store a mapping in our own database: `procore_image_id`, `procore_item_type`, `procore_item_id`, `project_id`.
- The album view uses this mapping to show a "linked" badge.

## 4. Auto-filing from Report an issue and Message

Add a setting, on by default: **Also save photos to the project's daily album.**
- When a photo is sent through Report an issue or Message, also upload it to the day's album and set the description from the transcript.
- Do not upload the same photo twice if it is retried. Track by a client-generated capture ID.
- Failure to file to the album must never block the issue or message from sending. Log it and retry in the background.

## 5. Offline capture queue

- Photo, audio, and metadata are saved locally first (IndexedDB).
- Queue shows a small status ("3 waiting to upload").
- Retry with backoff when the connection returns. Process in order. Never lose a capture on failure.
- Idempotency: each capture has a unique ID so retries do not create duplicates in Procore.
- Show failures in plain language with a Retry action.

## 6. Verify in the Procore sandbox before building (blocking questions)

Run small tests and report results back to Ky before finishing the feature. Record findings in `docs/procore-photos-findings.md`.

1. **Can the app create albums?** Check whether the API exposes create for image categories (the Photos tool). If yes, implement per-day album creation. If no, use the fallback in 2.3.
2. **Auth and permissions.** Photos upload requires Standard permission or higher on the project's Photos tool. Determine whether our requests run as the signed-in user or as the app. Test with a user who has lower Photos permission and confirm the error is handled with a clear message ("You don't have permission to add photos to this project").
3. **Description field.** Confirm the image record accepts a description/caption via API, its length limit, and whether it can be set at creation or only by update.
4. **Date and filter support.** Confirm how to list images by album and by created date, and the pagination method.
5. **Thumbnails.** Confirm which URL or field gives a thumbnail suitable for the grid, and whether those URLs need auth headers or expire.
6. **Rate limits.** Note any rate limits that affect bulk offline sync.

If any answer changes the design, stop and ask before improvising.

## 7. Non-goals and guardrails

- Do not duplicate photo storage in Firebase or Vercel beyond the offline queue and audio.
- Do not request Procore scopes beyond what Photos read/write and existing features need.
- Do not expose private albums or photos the signed-in user cannot already see in Procore.
- Keep plain-language copy for foremen. No Procore jargon on the field screens ("Save photo", "Album").

## 8. Acceptance criteria

- Selecting a project shows the three-tile home screen.
- Snap uploads a photo to the chosen or default Procore album, and the photo appears in Procore's Photos tool for that project.
- Photo description contains the transcript or summary when the API allows it.
- Project photos shows albums, counts, and photo grids pulled from Procore.
- Photos sent through Report an issue or Message also land in the daily album, without duplicates, and never block the original action.
- Offline captures upload once the connection returns, with no duplicates or lost items.
- Permission, private-album, and upload-timeout errors show friendly messages.
- `docs/procore-photos-findings.md` documents answers to section 6.
