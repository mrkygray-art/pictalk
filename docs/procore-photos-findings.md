# Procore Photos: findings (spec section 6)

Spec: `docs/sitesnap-project-home-and-photos-spec.md`. Check page: `/api/procore/test-photos` (sandbox only; `api/procore/test-photos.js`).

Status 2026-10-15: **desk check done, sandbox run pending.** Ky has turned on the Photos tool in every sandbox project. The "Reference says" column comes from Procore's API reference as mirrored by a third party, because Procore's own pages didn't load for this check. The sandbox run decides.

| # | Question | Reference says | Sandbox |
|---|---|---|---|
| 1 | Can the app create albums? | Yes: `POST /rest/v1.0/image_categories?project_id=` with `{ image_category: { name, private } }`. `private` defaults to false. Also List, Show and Update (PATCH). | pending |
| 2 | Whose permission? | SiteSnap already calls Procore with the signed-in person's own token (`api/_procoreWrite.js`), so Procore checks that person's Photos level. Under Standard should get a 403. | pending (admin run + a test person below Standard) |
| 3 | Description | `image.description` can be sent on Create Image and changed later. The reference gives no length limit. | pending (the check sends 3,000 characters by update and reads back what's kept) |
| 4 | Listing and paging | `GET /rest/v1.0/images?project_id=` with `image_category_id`, `page`, `per_page`, `sort` (`-created_at`, `taken_at`, …), and `filters[created_at]`, `filters[log_date]`, `filters[trade_ids][]`, `filters[location_id][]`, `filters[uploader_id][]`, `filters[query]`. | pending (the check reads the Total / Per-Page / Link headers) |
| 5 | Thumbnails | Every image has `thumbnail_url` and `url`. | pending (whether they open without a sign-in and whether they expire) |
| 6 | Rate limits | Procore's documented 3,600 calls an hour per token, plus the spike limit we already hit (~25 calls per 10 s; see `PROCORE_API_NOTES.md`). | pending (the check records the X-Rate-Limit headers) |

## Findings that may change the design (Ky to decide)

1. **Upload method.** The reference marks multipart `image[data]` as deprecated and recommends `upload_uuid` with `image_name`. SiteSnap already uses that upload path for Observation and Punch Item attachments (`uploadFile`). Plan: use `upload_uuid`, not `image[data]` as the spec suggested.
2. **Trades are a real field.** Create Image takes `trade_ids` and List Images filters on `filters[trade_ids][]`, so a By trade view can use Procore's own trades rather than parsing a text pattern in the description (spec 2.4). This needs the company's trades list (`/companies/{id}/trades`) and a way to pick or guess the trade.
3. **Locations are a real field.** Create Image takes `location_id`, and listing filters on `filters[location_id][]` (with sublocations). By area could use the project's Locations (the same ones the Where box already suggests) instead of albums or alongside them.
4. **By day without date albums.** `log_date` and `filters[log_date]` / `filters[created_at]` make a By day view possible from any album, so a `Field photos YYYY-MM-DD` album each day is optional, not required.
