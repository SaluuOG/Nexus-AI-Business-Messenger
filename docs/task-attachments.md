# Task and comment attachments

Introduced 22 September 2026. Open **Projekte → Aufgaben → Details & Zusammenarbeit**.
Files can be uploaded directly to a task; after sending a comment, its author can
choose **Datei zum Kommentar hinzufügen**. Images have an authenticated preview;
all supported formats have a download action. HEIC/HEIF previews depend on the
browser's image support; downloading remains available.

Supported extensions: JPG/JPEG, PNG, WebP, GIF, HEIC/HEIF, PDF, DOCX, XLSX, PPTX,
TXT, CSV and ZIP. Limits: 25 MiB per file, 100 attachments per task including comment
attachments, and 10 outstanding uploads per author. The UI validates the name,
size and declared MIME before reserving an upload. Server validation and the
private bucket independently restrict size and MIME.

## Permissions and storage

- Owner/admin/member: upload to tasks and to their own comments.
- Guest: view and download attachments in their current workspace.
- Members remove their own attachments; owners/admins moderate any attachment.
- No direct client writes to attachment metadata, no client overwrite/delete
  policy on binary objects, and no access across workspace boundaries.
- Metadata reads, uploads, finalization and downloads require a current workspace
  membership and a live authentication session. Canceling one's own unfinished
  upload remains possible after a role downgrade.

Migration `20260922095109_task_attachments.sql` adds scoped foreign keys, RLS,
explicit grants, invoker RPC wrappers with private implementations and Realtime.
The private `nexus-task-attachments` bucket is provisioned through the Storage API
by the internally authenticated cleanup worker. Existing chat storage is separate.

A stable upload intent reserves an immutable object path. Finalization checks
Storage's recorded size and MIME. A retry with the same intent recovers a lost
response without creating another attachment or overwriting bytes. Changed IDs,
authors, task/comment scope or descriptors cannot reuse an existing intent.

Downloads use the authenticated Storage endpoint with `cache: no-store`.
The app creates no public or signed sharing URLs. Image blobs are revoked on
closing the preview, unmount, context/access loss, hiding the tab or going offline.
A downloaded copy is outside application revocation; file-type checks do not
constitute antivirus scanning.

## Cleanup

Deleting metadata immediately removes application access and queues binary removal
through the Storage API. The same trigger covers comment, task, project and
workspace cascades. Abandoned reservations expire after one hour. The per-minute
`nexus-task-file-cleanup` cron wakes `task-file-cleanup` only when work is due.
A successful removal normally follows within a minute; transient failures retry
with backoff. IDs remain tombstoned to prevent reuse after deletion.

The Edge Function has platform JWT verification disabled because it accepts only
random, hashed, single-use internal wake tokens, valid for two minutes. Client
roles cannot mint or consume wakes, claim jobs or complete them. There are no
reusable service credentials in the HTTP wake queue. Service credentials stay in
the Edge runtime. Claims are leased and completion is fenced by the lease token.

## Verification

Only attachments and directly affected collaboration flows are selected by
`tests/run-changed.mjs`. Local typecheck/build and 15 unit assertions/tests pass.
The rolled-back SQL acceptance passes before and after migration, covering upload
reservation/replay, validation, role/workspace/session isolation, denied direct
writes, comment/task cascades, expiration, lease fencing and one-use wake tokens.
Storage API initialization returned HTTP 200 and the bucket is private with the
expected MIME allowlist and size limit. Security advisors introduced no findings;
the new uploader index is expected to be unused before regular traffic.

Browser and live release verification are recorded below after completion.
