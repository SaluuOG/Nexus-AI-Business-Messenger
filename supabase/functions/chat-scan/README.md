# Whole-chat scan backend

This function is intentionally disabled by default. Apply the accompanying
`chat_scan` and `chat_scan_workflow` migrations, deploy `chat-scan` with JWT verification **enabled**, then
configure these server-only secrets once an owner has selected the provider/model:

- `OPENAI_API_KEY`: API project key; never put it in a `VITE_` variable.
- `NEXUS_AI_MODEL`: explicitly selected Responses-compatible model with structured outputs.
- `NEXUS_AI_ENABLED`: exactly `true` to activate paid provider requests.
- Optional `NEXUS_AI_ALLOWED_ORIGINS`: comma-separated frontend origins. Default:
  `https://saluuog.github.io,http://localhost:5173,http://127.0.0.1:5173`.

The function uses the Supabase-provided URL and public anon key (or
`SUPABASE_PUBLISHABLE_KEY`) plus each caller's JWT, never a service-role key. No
provider/model is selected automatically. `status` authenticates and checks live
chat access and the personal workflow state without returning messages or
contacting OpenAI. It returns `{available, providerLabel, workflow}`. A disabled
scan sends no conversation data to the provider; existing current results can
still be viewed.

The workflow is personal to each signed-in account. `open` and `updated` chats
can be scanned; `processed` means a successful current result exists; `done`
means the account explicitly finished the chat and must reopen it first. New
messages, edits, deletions and relevant source changes make an existing scan
outdated, but never reopen a finished chat. Reopening an unchanged finished chat
with a current saved result restores `processed` without another model request.

`POST {action:"scan",kind:"direct"|"group",chatId:"uuid"}` reads all currently
accessible undeleted messages with timestamp/UUID keysets, including history older
than the chat UI's latest 200. It does not read attachment, image or audio bytes.
The coverage count includes all undeleted messages and explicitly counts excluded
attachments. Current group members have the same full-history access as the
existing messenger; losing membership blocks a scan and its result.

Before checking provider configuration or claiming quota, the function calls
`get_my_chat_scan_state`. Finished chats return `chat_done`. Processed chats read
`get_my_chat_scan_result` and return the saved response with `cached:true`,
without loading history, claiming quota or contacting OpenAI. A concurrent
change that invalidates that result returns `status_changed`, never old data or
an automatic paid rescan. Freshly completed responses include `cached:false`.

The operation validates a fingerprint on every page and again after generation.
Edits, deletions, new messages, source metadata changes or access revocation abort
the result. After reserving the lease it rechecks the personal workflow revision
before starting provider work. Only validated complete output is passed to
`complete_my_chat_scan`, which atomically checks the caller's live lease, personal
revision, current full-history snapshot and access before saving the result and
marking the chat processed. Finishing/reopening during an in-flight scan rejects
that old completion. Failures, cancellation and expired leases do not mark a
chat processed, and persistence failures are surfaced instead of reporting a
successful result. Chat data is untrusted prompt content, never instructions or tools.
Model findings carry validated original message IDs; displayed excerpts and sender
labels come from database input, not from generated fields. Findings are proposals;
the function never sends messages or creates/changes tasks.

Hard bounds: 5,000 messages, 300,000 serialized input characters, 8 chunks of at
most 40,000 characters, up to 3 concurrent provider calls, at most 9 provider calls
per scan (8 extraction plus 1 merge), 40 seconds per provider call, 120 seconds for
the operation plus at most 3 seconds for lease cleanup. No automatic provider
retries. Limits abort explicitly; partial output is never marked complete.
Database quota: one active 130-second lease per account, 6 attempts/hour and
20/day, using rolling windows. Attempts that reach the provider retain quota even
after failure. No chat content, result or secret is logged. Nexus stores the latest
successful analysis and its cited source excerpts in private account-scoped
database storage, together with the workflow status and last scan time. It does
not copy the entire transcript into another store. Source mutations invalidate
and clear affected cached results; reads always recheck live chat access.
`scanId` identifies the saved successful scan. OpenAI requests specify `store:false`;
provider-side retention is governed by the selected API account.

Official references checked during implementation:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/auth-legacy-jwt

Node transport/auth/provider fixture tests run as part of `npm test`. Database
acceptance is `tests/sql/chat-scan-rls.sql` plus the workflow SQL acceptance suite
and uses synthetic rollback-only records. Backend tests cover cache reuse without
provider configuration, full old-and-new history after changes, finished chats,
concurrent status changes, expired leases, cancellation and failed persistence.
A real provider smoke test remains required after model/key configuration, using
synthetic chat content before owner acceptance with real chats.
