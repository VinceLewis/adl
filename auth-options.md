# Auth Options for a Local-First Giggle-Style ADL App

> Superseded for architecture decisions by
> `docs/architecture/target-architecture.md` and ADR 0007.
> This document remains useful background. The current target keeps a small
> TypeScript auth boundary, defers provider choice, and keeps ADL authorization
> separate from authentication.

## Goal

Build something that works locally and offline without copying GoTrue auth or requiring an email sender.

The near-term target is a local-database-only or local-first version of a Giggle-style band app. It should support offline app use after the user has signed in and after relevant band data has been cached locally.

Signup and invite acceptance can be online-only.

## Recommendation

Use a small ADL auth boundary rather than adopting GoTrue semantics.

The runtime already accepts identity through `RuntimeContext.userId`. ADL does not need auth to be a language construct. It needs a runtime service that can reliably provide:

- `userId`
- session state
- selected/local user profile
- cached membership data
- online-only signup and invite-claim workflows

The recommended shape is:

```text
AuthService
  -> signs users in
  -> caches local identity/session
  -> supplies RuntimeContext.userId
  -> requires online access for signup and invite claiming
  -> lets normal app reads/writes continue offline where sync policy allows
```

## Invite Flow Without Email

Do not send invite emails from the platform initially.

Use invite codes or invite links instead:

1. A band admin creates an invitation.
2. The app shows a code or copyable link.
3. The admin sends it manually by WhatsApp, SMS, Signal, iMessage, Slack, or any other channel.
4. The invited user opens the app and enters the code or follows the link.
5. The app must be online to claim the invite.
6. The server validates the token, updates the invitation, and creates the membership transaction.
7. The new membership is cached locally for offline use.

This avoids email infrastructure while keeping invite acceptance authoritative.

## Offline Behavior

Offline use should rely on a cached local session and cached local data.

Allowed offline:

- Opening the app after prior sign-in
- Reading cached bands, events, songs, set lists, and availability
- Creating or editing local-first records that policy allows
- Queueing syncable writes for later replay
- Switching between cached local identities in development/local-only mode

Online-only:

- New account signup
- First login on a new device
- Invite code claim
- Password reset or account recovery
- Server-side sync replay and conflict resolution

The browser remains untrusted. Offline checks are useful for UX and local-first behavior, but the server must re-check identity, membership, policy, validation, lifecycle, and conflict state when syncing.

## Option 1: Custom Lightweight Auth Service

This is the best fit for ADL right now.

The service can be deliberately small:

- Email/password or username/password
- Optional passkey support later
- Invite-code claim endpoint
- Session token or signed cookie when online
- Cached local session in IndexedDB
- Runtime adapter that produces `RuntimeContext.userId`

Pros:

- No GoTrue dependency or conceptual baggage
- Easy to model invite codes instead of email
- Fits ADL runtime boundaries cleanly
- Can support local-only development mode
- Can later become the server authority for sync

Cons:

- You own password storage, sessions, recovery, and security details
- Needs careful implementation before production use
- Passkeys add complexity if implemented directly

Use this if the priority is a practical ADL-native path.

## Option 2: Better Auth

Better Auth is a strong TypeScript-first candidate if you want an off-the-shelf auth library later.

It provides credential auth, sessions, plugins, passkeys, and multi-tenant/team-style features. It is framework-agnostic and fits a TypeScript server better than adopting GoTrue just because Supabase uses it.

Pros:

- Good TypeScript fit
- Built-in sessions and credential auth
- Passkey support is available through its ecosystem
- More complete than hand-rolling everything
- Could support teams/organizations-style concepts later

Cons:

- Still an online/server auth dependency
- Needs integration with ADL's runtime context and membership model
- Its team/tenant concepts should not replace ADL business contexts without a clear mapping

Use this if you want a real auth library but still want to avoid GoTrue.

Reference:

- [Better Auth docs](https://www.better-auth.com/docs)

## Option 3: Auth.js

Auth.js can work as an integration layer, especially if an app already uses a framework it supports.

Its Credentials provider can forward arbitrary credentials to an auth service. That means Auth.js is not necessarily the core identity store. It can sit in front of a custom auth backend.

Pros:

- Familiar ecosystem
- Good for web-framework session integration
- Credentials provider can bridge to a custom service

Cons:

- Less ideal as the core ADL auth system
- Credentials support is intentionally limited
- More framework-shaped than ADL needs at the runtime layer

Use this only if the chosen server framework already makes Auth.js convenient.

Reference:

- [Auth.js Credentials](https://authjs.dev/getting-started/authentication/credentials)

## Option 4: Supabase Auth

Supabase Auth can be practical, and email confirmation can be disabled for some flows.

However, it is GoTrue-based. If the aim is not to replicate GoTrue, Supabase Auth should be treated as a possible deployment integration, not the core ADL auth model.

Pros:

- Quick to get running
- Mature hosted auth service
- Works well with Supabase deployments

Cons:

- Pulls ADL toward GoTrue semantics
- Email/invite behavior is Supabase-shaped
- Offline/local-first behavior still needs ADL's own local session and sync handling

Use this only if deployment speed matters more than keeping auth ADL-native.

Reference:

- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)

## Passkeys

Passkeys are attractive for future login because they avoid passwords and email links.

They use public-key credentials through WebAuthn. The private key stays with the user's authenticator/device, and the server stores the public credential data.

Good future use:

- Add passkey after account signup
- Use passkey for returning login
- Keep invite claiming online
- Cache successful identity locally for offline app use

Caution:

- WebAuthn is origin-bound, so local development and production origins need thought
- First setup and new-device login are online workflows
- Recovery still needs a plan

References:

- [MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [MDN Passkeys](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys)

## Suggested ADL Runtime Shape

Add runtime auth as infrastructure, not as a business model primitive:

```ts
interface RuntimeAuthSession {
  userId: string;
  expiresAt?: string;
  onlineVerifiedAt?: string;
  offlineAllowed: boolean;
}

interface AuthService {
  getSession(): Promise<RuntimeAuthSession | null>;
  signIn(input: SignInInput): Promise<RuntimeAuthSession>;
  signOut(): Promise<void>;
  claimInvite(input: ClaimInviteInput): Promise<RuntimeAuthSession>;
}
```

The ADL runtime should continue to consume `RuntimeContext`:

```ts
const context: RuntimeContext = {
  userId: session.userId,
  roles: [],
  channel: "ui",
  online,
};
```

Context roles and memberships should still be resolved from ADL runtime data, not embedded directly into the auth token as the only source of truth.

## Local Development Mode

For local-only development, support a simple identity picker:

- Seed local users
- Pick "Casey" or "Riley"
- Store current local user id in browser storage
- Build `RuntimeContext.userId` from that selection

This is not production auth. It is a productive way to test local-first workflows without building server auth first.

## Production Direction

The production path should separate identity from business authorization:

- Auth proves who the user is.
- ADL context membership proves what bands they can access.
- ADL policy proves which operations they can perform.
- Sync replay re-checks all of the above on the server.

This keeps ADL aligned with its current architecture: model-first, runtime-enforced, and not tied to one provider.

## Practical Next Step

The next practical step is not choosing a full auth provider immediately.

Build a local auth adapter first:

1. Add a browser-local identity/session service.
2. Add a simple local user picker for the band reference app.
3. Make the app derive `RuntimeContext.userId` from that session.
4. Keep signup and invite claim as online-only placeholders.
5. Later replace the placeholder online endpoints with either a custom auth service or Better Auth.

This lets the local/offline Giggle-style app move forward now without locking ADL into GoTrue, email delivery, or a particular backend.
