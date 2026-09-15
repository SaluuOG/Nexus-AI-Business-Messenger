# Whole-chat scan backend

This function is intentionally disabled by default. Apply the accompanying
`chat_scan` migration, deploy `chat-scan` with JWT verification **enabled**, then
configure these server-only secrets once an owner has selected the provider/model:

- `OPENAI_API_KEY`: API project key; never put it in a `VITE_` variable.
- `NEXUS_AI_MODEL`: explicitly selected Responses-compatible model with structured outputs.
- `NEXUS_AI_ENABLED`: exactly `true` to activate paid provider requests.
- Optional `NEXUS_AI_ALLOWED_ORIGINS`: comma-separated frontend origins. Default:
  `https://saluuog.github.io,http://localhost:5173,http://127.0.0.1:5173`.

The function uses the Supabase-provided URL and public anon key (or
`SUPABASE_PUBLISHABLE_KEY`) plus each caller's JWT, never a service-role key. No
provider/model is selected automatically. `status` authenticates without loading
messages or contacting OpenAI. A disabled scan sends no conversation data.

`POST {action:"scan",kind:"direct"|"group",chatId:"uuid"}` reads all currently
accessible undeleted messages with timestamp/UUID keysets, including history older
than the chat UI's latest 200. It does not read attachment, image or audio bytes.
The coverage count includes all undeleted messages and explicitly counts excluded
attachments. Current group members have the same full-history access as the
existing messenger; losing membership blocks a scan and its result.

The operation validates a fingerprint on every page and again after generation.
Edits, deletions, new messages, source metadata changes or access revocation abort
the result. Chat data is untrusted prompt content, never instructions or tools.
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
after failure. No raw transcript, generated result or secret is logged or persisted
by Nexus; `scanId` identifies this ephemeral response only. OpenAI requests specify
`store:false`; provider-side retention is governed by the selected API account.

Official references checked during implementation:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/auth-legacy-jwt

Node transport/auth/provider fixture tests run as part of `npm test`. Database
acceptance is `tests/sql/chat-scan-rls.sql` and uses synthetic rollback-only records.
A real provider smoke test remains required after model/key configuration, using
synthetic chat content before owner acceptance with real chats.
