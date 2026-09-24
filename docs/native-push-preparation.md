# Native iOS Push: preparation stage

## What is installed

- Pinned Capacitor Push Notifications 8.1.2, Swift Package integration and
  AppDelegate callbacks. No `aps-environment` entitlement or Push capability.
- Native settings save an account-scoped **local draft** of four options. No
  token, credentials or notification contents are stored in this draft.
- `nativePushPlatform.ts` adapts iOS permission, APNs registration events,
  registration errors, cancellation, 15-second timeout and listener cleanup.
- `createNativePushEnrollment` is an injectable registration workflow. It waits
  for backend persistence before reporting enabled; it handles opt-out and
  cancellation/cleanup when the account changes.
- `createNativePushActionHandler` validates recipient, installation ID, expiry
  and an allowlist of direct-chat/group/task destinations. It buffers one tap
  in memory while authentication restores and suppresses duplicate deliveries.
  The destination still enforces normal database access controls.

## Current production behavior

`pushSupport()` still returns `native-pending` on native platforms. The
registration workflow and action listener are **not started in production**.
No permission dialog, APNs registration, server upload or native push delivery
occurs. The Personal Team build remains usable. Web Push is unchanged.

This is not an APNs sender or an implemented server device registry. The
`NativePushBackend` interface is the explicit integration boundary; tests use
synthetic implementations, not a live registry. Do not mark native push active
or connect the controller until the following requirements are implemented.

## Activation work after Apple Developer membership

1. Configure the bundle `com.saluuog.nexus` with Push Notifications and a valid
   provisioning profile. Set sandbox versus production from the signed build,
   not from user input. Create APNs signing credentials and keep the private
   key, key ID and team ID only in server secrets.
2. Implement and test the authenticated device registry and `NativePushBackend`:
   derive account ownership from the verified session, never from request user
   IDs. Atomically bind each APNs token/environment/topic to its installation
   and account; prevent cross-account takeover using an installation credential.
   Bind/unbind must be idempotent. Enforce ownership on updates and deletes.
   Never expose stored APNs tokens through client reads. Apply RLS/grants and
   expiry/revocation policies before deploying. Do not reuse Web Push endpoint
   columns for APNs tokens.
3. Implement the APNs server transport and delivery queue, rechecking recipient
   access, unread state, enabled flags and notification preferences immediately
   before dispatch. Use generic title/body by default. Handle invalid tokens,
   retries, opt-outs and environment mismatch. Deduplicate delivery IDs.
4. Create an enrollment instance bound to one authenticated account and one
   installation. Backend methods must remain tied to that session while cleanup
   is pending. Await `disable()` (or `dispose()` for account changes) before
   completing logout, and await any in-flight enable operation before switching
   the backend to a new user. Cleanup errors must remain visible and retryable.
   Do not persist APNs tokens in browser storage. Renew registration after launch
   when previously enabled; persist rotation before declaring enabled.
5. On explicit activation, offer the saved draft and then obtain OS permission.
   Load actual enabled status from the registry. Replace the pending settings UI
   with the real native status; local drafts must never be mistaken for enabled.
6. Attach `listenForNativePushAction` before session restoration, pass data to
   the action handler, flush after the account is known, and remove the listener
   plus clear pending actions on logout/unmount. Wire navigation through the
   existing router. Native foreground alerts should use generic content by
   default; review presentation options before enabling.
7. Test on paid-team device builds: denied permission, token rotation, offline
   registration, logout/account switch, disabled previews, active/background/
   terminated app taps, expired or foreign payloads, removed chat membership,
   invalidated APNs tokens and TestFlight production delivery. Verify cold-start
   notification forwarding with the project's SceneDelegate lifecycle.

## Payload contract

Use `v: 1`, an opaque delivery `id`, account `recipient`, installation `device`,
`expires` as milliseconds since epoch and an internal `path`. Allowed paths:

- `/app/chats?conversation=<uuid>`
- `/app/groups?group=<uuid>`
- `/app/business?workspace=<uuid>&view=tasks&project=<uuid>&task=<uuid>`
  with optional `&comment=<uuid>`

No external URLs, arbitrary query parameters, access tokens or refresh tokens.
The in-memory handler must be cleared on explicit logout. APNs notification
content itself needs server-side privacy enforcement, not just tap validation.

## Validation

`node --test tests/native-push.test.mjs` covers the disabled gate, permission
refusal, registration/persistence order, backend failure, late token/bind during
logout, safe navigation, duplicate taps, session restoration and private defaults.
The native UI test verifies draft persistence without claiming active push.
`npm run build:ios` syncs packages; CI performs the unsigned iOS compile. Real
APNs delivery remains untested and unavailable until activation is complete.
