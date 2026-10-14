# SiteSnap AI: Procore API findings

For Steps 2, 6 and 8 and the open questions in `docs/sitesnap-changes.md`. Checked on 2026-10-13 against Procore's API reference (the OpenAPI documents behind developers.procore.com/reference) and the source of Procore's docs (github.com/procore/documentation). Every call below needs `Authorization: Bearer <token>` and the `Procore-Company-Id` header. Nothing here has been tried against the sandbox yet.

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

- Old-style service accounts stopped working on 2025-03-18.
- The current option is a **Developer Managed Service Account**: the `client_credentials` grant, added as a "Service Account Authentication" data connector with tool permissions set in the Permissions Builder.
- A customer admin installs the app and picks projects. Procore adds a service-account user to their Directory, which may need adding to projects.
- Writes show that generic user as the author. That's why the foreman's name goes in the item text.
- Our sandbox app currently uses **user-level** authentication. Tasks would be written as the signed-in PM unless we add a service account.

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
- What the sandbox sends back after sign-in. The callback handles both `?code=` and `#code=`. Look for "Procore callback: code arrived …" in the Vercel logs.
