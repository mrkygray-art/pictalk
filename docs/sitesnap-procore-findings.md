# SiteSnap AI: Procore API findings

For Steps 2, 6 and 8 and the open questions in `docs/sitesnap-changes.md`. Checked on 2026-10-13 against Procore's API reference (the OpenAPI documents behind developers.procore.com/reference) and the source of Procore's docs (github.com/procore/documentation). Every call below needs `Authorization: Bearer <token>` and the `Procore-Company-Id` header. Nothing here has been tried against the sandbox yet.

## Decisions (2026-10-13)

1. **Task, not Observation: approved.** The identity that writes Tasks needs **Admin on the Tasks tool**, so it can close them. Closing must be tested in the sandbox.
2. **Who writes, for the sandbox prototype only:**
   - A PM connects Procore once. Their token is stored on the server, encrypted and revocable, and never sent to the browser.
   - The foreman's name goes in the Task text.
   - Every Procore write goes through one small module, so it can switch to a Developer Managed Service Account later (see "Moving to a service account" below; not built).
3. **Step 1:** not merged until the preview is reviewed.
4. **Firebase:** Ky creates the new SiteSnap project and sends its ID. Don't touch `pictalk-6cbff`, and store no tokens (step 2's PM token included) until the new project exists.
5. **`?code=` or `#`: answered (2026-10-14).**
   - The sandbox sends the code **in the query** (`?code=`). All three sandbox sign-ins in the production logs say "Procore callback: code arrived in the query" (03:22 and 03:27 UTC, deployment `dpl_5JJeBvYxsh5anm1FYkAaL1NuBwB3`), and none say `#`.
   - The `#` handling stays as a fallback. It may matter for Procore's iframe-helper popup flow later.
6. **Webhooks (Step 8, not yet):**
   - Treat each delivery as a ping only.
   - Verify our own secret header.
   - Re-fetch the item from Procore before acting.

## Recommendation: Task (Task Items), not Observation

| | Task Items (`/rest/v1.0/task_items`) | Observations (`/rest/v1.0/observations/items`) |
|---|---|---|
| Create | `POST /rest/v1.0/task_items?project_id=`, body `task_item{title, description, due_date, status, assigned_id or assignee_ids[], distribution_member_ids[]}` | `POST /rest/v1.0/observations/items`, body `project_id` + `observation{name, type_id (required), description, due_date, priority, assignee_id or assignee_ids}` |
| Statuses | `initiated`, `in_progress`, `ready_for_review`, `closed`, `void` | `initiated`, `ready_for_review`, `not_accepted`, `closed` (+ `draft` with workflows) |
| Photo | Upload first (`POST /rest/v1.1/projects/{id}/uploads`), then `upload_ids[]`; or multipart `task_item[attachments][]` | `upload_ids[]` (multipart attachments on create are deprecated) |
| Replies | Task Item Comments: create, list (`filters[task_item_id]`), update, delete | Response Logs: create and list only |
| Close | `PATCH /task_items/{id}` with `status: closed` | `PATCH /observations/items/{id}` with `status: closed` |

**Why Task:**
- Its statuses map cleanly onto Open, Waiting and Resolved.
- It needs no company-configured category. Observations require a `type_id` from Quality, Safety, Commissioning or Warranty types.
- Its comments have full create, read, update and delete, so mirroring replies both ways is straightforward.

**When to choose Observations instead:** only for a customer who already tracks field issues as Quality or Safety observations.

**Watch out:** a Standard-level assignee can't close or void a Task from a comment. Closing from SiteSnap may need an Admin-level user in the Tasks tool (not confirmed).

Mapping: Open = `initiated`, Waiting = `in_progress` or `ready_for_review`, Resolved = `closed`.

## Directory (Step 2)

`GET /rest/v1.0/projects/{project_id}/users` returns **active** users only.

- **Job title:** `job_title`
- **Company:** `vendor.name`
- **Role:** `permission_template.name` (project) or `company_permission_template.name`

Users without Directory read permission get the compact view: name and `vendor{id, name}` only, with no title or template.

Other people endpoints:
- Inactive users: `GET /projects/{id}/users/inactive`.
- Every membership, including inactive: `GET /projects/{id}/project_memberships`. It returns only IDs.
- Who can be assigned: `GET /projects/{id}/assignable_users`. It also returns `job_title` and `vendor`.

Invited or not:
- There's no filter for it.
- `welcome_email_sent_at` and `last_login_at` come back as fields.
- A company user only appears once added to the project.

**Diagnostic:** `GET /api/procore/directory?companyId=4291776&projectId=373235&shape=1`, after Connect Procore, returns each field name and how many people have it filled in, with no values. It shows why the list has dashes.

## Webhooks (Step 8)

- **Create a hook:** `POST /rest/v2.0/companies/{company_id}/projects/{project_id}/webhooks/hooks` with `{payload_version: "v4.0", namespace, destination_url (https), destination_headers.Authorization}`.
- **Add triggers:** `POST …/hooks/{hook_id}/triggers` with `{resource_name, event_type}`.
- **Discover valid names:** `GET …/webhooks/resources?payload_version=`.
- **Payload (v4.0):** `{id, timestamp, reason, company_id, project_id, user_id, resource_type, resource_id}`. It only notifies, so the item has to be fetched with a GET.
- **No signature is documented.** Procore sends back the `Authorization` header we set on the hook, and we must check it.
- **Delivery:** 5-second timeout, retries with backoff, dropped after 12 hours. Dedupe by `id`.
- **Permission:** the app's data connector needs the "Webhooks API" permission at Standard.
- **Not confirmed:** the exact `resource_name` values for Task Items, Task Item Comments, Observations and Response Logs. They're only listed by the signed-in `/webhooks/resources` call.

## Service accounts (open question 2)

### The March 2025 change

Source: Procore's announcements page (`announcements/overview.md` in github.com/procore/documentation, section "January 2025 — Sunset of Traditional Service Accounts"; permalink `/overview`). Its timeline:
- Traditional Service Accounts were deprecated on December 9, 2021.
- Creating new ones stopped on January 21, 2025.
- Existing ones stopped working on **March 18, 2025**.
- Data connection apps had to move to Developer Managed Service Accounts (DMSA). Apps that didn't migrate stopped working, and non-compliant Marketplace apps were removed.
- Procore's migration guide: support.procore.com/products/online/user-guide/company-level/admin/tutorials/migrating-to-dmsa.

### Moving to a service account (DMSA): what that version needs (not built)

- **Manifest change.** In the Developer Portal's Configuration Builder, add a **Service Account Authentication** data connector component. Then use the **Permissions Builder** to list the company- and project-level tool permissions the app needs; for SiteSnap that's Tasks at Admin, so it can close items.
  - Source: developers.procore.com/documentation/building-data-connection-apps (`building_applications/building_data_connection_apps.md`, "Service Account Authentication").
  - Permission levels: Procore's User Permissions Matrix, support.procore.com/references/user-permissions-matrix-web.
- **New app version.**
  - Click Create Version or Save Version; it's saved as "Ready for Testing".
  - Test it in the sandbox, then promote it to Production with release notes.
  - For a custom (non-Marketplace) app, Procore notifies installed companies automatically, and admins see "Update Available" in App Management.
  - For a Marketplace app, the update must be approved before notifications go out.
  - Source: developers.procore.com/documentation/building-apps-promote-manifest (`building_applications/building_apps_promote_manifest.md`).
- **Customer admin install.**
  - A company admin installs the app (Marketplace or custom install), or updates it to the new version, and picks the **permitted projects**. These can be changed later.
  - Procore creates the service-account user in the **Company Directory** automatically. The customer may need to add it to each project and give it a permission template.
  - The app only reaches data in permitted projects.
  - Sources: developers.procore.com/documentation/developer-managed-service-accounts (`plan_your_app/developer_managed_service_accounts.md`); developers.procore.com/documentation/building-apps-install-arch (`platform_concepts/building_apps_install_arch.md`, "Service account (client credentials / DMSA)").
- **Token.**
  - `POST {PROCORE_LOGIN_URL}/oauth/token` with `grant_type=client_credentials`; the token lasts 5400 seconds.
  - One `client_id` / `client_secret` works for every company that installs the app.
  - Source: developers.procore.com/documentation/oauth-client-credentials (`oauth/oauth_client_credentials.md`).
- **Author.** Writes act as "a generic service account user" (the table on building-data-connection-apps), so the foreman's (and PM's) name must go in the Task text.
- **Code change when we switch:** only the write module's token source changes, from the stored PM token to a client-credentials token. The module is planned for Step 6 and isn't built yet.

### Summary

- Old-style service accounts stopped working on 2025-03-18.
- The current option is a **Developer Managed Service Account**: the `client_credentials` grant, added as a "Service Account Authentication" data connector with tool permissions set in the Permissions Builder.
- A customer admin installs the app and picks projects. Procore adds a service-account user to their Directory, which may need adding to projects.
- Writes show that generic user as the author. That's why the foreman's name goes in the item text.
- Our sandbox app uses **user-level** authentication. For the prototype, Tasks are written with the stored token of a PM who connected once (decision 2), not as the foreman.

## Permissions and 403s

- The tool permissions an app needs are set in the Configuration Builder's Permissions Builder, and each saved change is a new app version.
- User-level apps act with the signed-in user's own permissions.
- A 403 can mean a missing permission, the tool being turned off, or the app not being installed. "App is not connected to this company" means not installed.

## Conversations tool

No public API. None of Procore's 649 API resource groups mention it, so don't build on it.

## Not confirmed

- Minimum permission levels to create or close a Task or Observation.
- Webhook resource names, and whether comments fire events.
- Whether `PATCH task_items/{id}` accepts JSON (the reference lists multipart).
- That Admin on the Tasks tool is needed to close a Task (decision 1). This needs a sandbox test.
