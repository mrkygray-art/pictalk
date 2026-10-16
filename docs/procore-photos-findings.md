# Procore Photos: findings (spec section 6)

Spec: `docs/sitesnap-project-home-and-photos-spec.md`. Check page: `/api/procore/test-photos` (sandbox only; `api/procore/test-photos.js`).

Status 2026-10-15: **sandbox runs done as Edward Gray (admin) and Chloe Abara (no permission template on the project).** Still open: the thumbnail re-run (with and without a sign-in), the created-date filter by project day, and whether a person with Standard (not Admin) on Photos can create albums. Ky turned on the Photos tool in every sandbox project. The "Reference says" column comes from Procore's API reference as mirrored by a third party, because Procore's own pages didn't load.

| # | Question | Reference says | Sandbox |
|---|---|---|---|
| 1 | Can the app create albums? | Yes: `POST /rest/v1.0/image_categories?project_id=` with `{ image_category: { name, private } }`. `private` defaults to false. Also List, Show and Update (PATCH). | Edward (admin): **201**, public album made. Chloe: **403** "You do not have sufficient access to complete that action." Whether Standard can is still open. |
| 2 | Whose permission? | SiteSnap already calls Procore with the signed-in person's own token (`api/_procoreWrite.js`), so Procore checks that person's Photos level. Under Standard should get a 403. | Confirmed: it runs as the signed-in person. Edward: photo 201, uploader shows as Edward Gray. Chloe: photo **403** too, and SiteSnap's message is shown. So **every foreman needs Standard on Photos** in Procore. |
| 3 | Description | `image.description` can be sent on Create Image and changed later. The reference gives no length limit. | Confirmed: set at creation and kept exactly; a 3,000-character update was accepted and all 3,000 came back. The limit is above anything we'd write. |
| 4 | Listing and paging | `GET /rest/v1.0/images?project_id=` with `image_category_id`, `page`, `per_page`, `sort` (`-created_at`, `taken_at`, …), and `filters[created_at]`, `filters[log_date]`, `filters[trade_ids][]`, `filters[location_id][]`, `filters[uploader_id][]`, `filters[query]`. | Confirmed: `image_category_id` works; paging is `page` + `per_page` with a `Total` header (no `Link` header). `filters[log_date]=YYYY-MM-DD` found the photo (`log_date` isn't echoed in the answer). `filters[created_at]` with a bare date is a **UTC** day and missed an 8:36 pm Pacific photo; the re-run tests the project day with its offset. |
| 5 | Thumbnails | Every image has `thumbnail_url` and `url`. | Create and List answers have `thumbnail_url` and `url`; Show Image has only `url`. Links look like `sandbox.procore.com/fas/api/v5/files/...?companyId=&projectId=&sig=` (album `cover_photo` too). `url` without a sign-in: **401**, so phones can't load them directly and SiteSnap's server would fetch them with the person's token. The re-run tests `thumbnail_url` with and without the token. |
| 6 | Rate limits | Procore's documented 3,600 calls an hour per token, plus the spike limit we already hit (~25 calls per 10 s; see `PROCORE_API_NOTES.md`). | Confirmed in every run: `X-Rate-Limit-Limit: 25` per short window. Offline sync must pace uploads (each photo = 3 calls: upload slot, storage, Create Image). |

## Sandbox notes

- Each project starts with one public album, **Unclassified** (Procore's default).
- The album list returns `cover_photo` (a link, not `album_cover_id`), plus `count`, `created_at`, `updated_at`, `links` and `position`, which covers the spec's album row (thumbnail, name, count, last updated).
- The sandbox company has no trades and the project has no locations yet, so trade and location tagging is untested.
- Demo-project people like Chloe have no permission template, so they can't use Photos at all until one is set.

## Findings that may change the design (Ky to decide)

1. **Upload method.** The reference marks multipart `image[data]` as deprecated and recommends `upload_uuid` with `image_name`. SiteSnap already uses that upload path for Observation and Punch Item attachments (`uploadFile`). Plan: use `upload_uuid`, not `image[data]` as the spec suggested.
2. **Trades are a real field.** Create Image takes `trade_ids` and List Images filters on `filters[trade_ids][]`, so a By trade view can use Procore's own trades rather than parsing a text pattern in the description (spec 2.4). This needs the company's trades list (`/companies/{id}/trades`) and a way to pick or guess the trade.
3. **Locations are a real field.** Create Image takes `location_id`, and listing filters on `filters[location_id][]` (with sublocations). By area could use the project's Locations (the same ones the Where box already suggests) instead of albums or alongside them.
4. **By day without date albums.** `log_date` and `filters[log_date]` make a By day view possible from any album, so a `Field photos YYYY-MM-DD` album each day is optional, not required.
5. **Photos go through SiteSnap's server.** Procore's photo links need a Procore sign-in (401 without one), and foremen's phones don't have one. So the grid and full view load photos through a small SiteSnap endpoint that fetches them with the person's own token. That keeps "don't show what they can't see in Procore", and every thumbnail becomes a server fetch (whether those count against the rate limit is unknown), so thumbnails should be cached on the phone.
6. **Album creation may be admin-only.** If Standard can't create albums, the daily album has to come from a PM (or an admin's stored token), or we drop it and file by log date into one public album.
