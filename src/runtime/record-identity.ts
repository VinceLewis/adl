/**
 * Record identity: how an id is minted and what makes one usable as a storage
 * key.
 *
 * A record id crosses a trust boundary. An offline create names its own record
 * so the accepted record comes back under the id the client already holds, which
 * means the authority receives an id from an untrusted caller. The id is an
 * identifier and never an authorisation: naming a record grants nothing, and the
 * caller may not assert revision, actor, timestamps, accepted state or scope.
 *
 * The shape rules exist because a text key that PostgreSQL refuses is a real
 * failure rather than a curiosity — the Phase 44 NUL-byte `audit_id` defect. They
 * are deliberately the same rules `BypassIdentityVerifier` applies to an identity
 * subject, for the same reason.
 */

/** Matches the identity-subject bound: a text key must stay bounded and indexable. */
export const MAX_RECORD_ID_LENGTH = 320;

/**
 * True when a value could be a record id. Unlike an identity subject this is
 * never trimmed first: the accepted record has to come back under the exact id
 * the caller already holds locally, so a surrounding-whitespace id is refused
 * rather than silently rewritten into a different id.
 */
export function isValidRecordId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_RECORD_ID_LENGTH) return false;
  if (value !== value.trim()) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    // Control characters are rejected: real PostgreSQL refuses NUL in a text key,
    // and NUL is also the separator inside bootstrap cursor keys.
    if (codePoint < 0x20 || codePoint === 0x7f) return false;
  }
  return true;
}

/**
 * Mints an id for a new record. Every minted id satisfies {@link isValidRecordId}
 * — `tests/record-identity.test.ts` asserts that, because a client proposing its
 * own minted id to the authority depends on it.
 */
export function createRecordGuid(objectName: string): string {
  return `${objectName.toLowerCase()}-${randomId()}`;
}

/**
 * Mints the revision for a new version of a record.
 *
 * A revision names one version of one record, and the optimistic-concurrency
 * check the whole sync loop rests on is a plain equality comparison against it
 * (`AuthorityService.apply` for a single intent, `applyBatch` for a batch). That
 * makes reissuing a revision a silent lost update rather than a curiosity: a
 * stale write whose `baseRevision` happens to name a *different* version wearing
 * the same name passes the check and overwrites edits it never saw, with no
 * conflict, no `manualResolution` and nothing left to detect it afterwards.
 *
 * Until Phase 61 the value came from a counter held on `ObjectStore` and seeded
 * at 1 in every constructor, so a record updated to `rev-4` through one runtime
 * came back as `rev-1` through the next runtime over the same persisted state —
 * revisions went *backwards* on an ordinary process restart, on the authority
 * and in every browser session alike.
 *
 * The rule here has two parts, and both are load-bearing:
 *
 * - a **sequence** derived from the record's own prior revision, so a record's
 *   revisions never move backwards and the value stays legible in an audit trail
 *   or an operation-log entry; and
 * - a **random token**, so the value is unique by construction rather than
 *   unique within one process. This is what survives a restart, and it is why
 *   two runtimes over one backend — or a device and the authority, minting
 *   offline with no round trip and no database sequence — cannot collide.
 *
 * The sequence is derived, never trusted: a revision whose shape this does not
 * recognise (a fixture literal, a value some other runtime minted) starts a new
 * sequence rather than failing, and the random token keeps that safe.
 *
 * Consumers must still treat a revision as **opaque** and compare it only for
 * equality — `docs/spec/runtime-semantics.md` states that as a contract
 * obligation. The structure exists for the minting side, not the reading side.
 */
export function createRecordRevision(previous?: string): string {
  return `rev-${recordRevisionSequence(previous) + 1}-${randomId()}`;
}

/**
 * Reads the sequence out of a revision this module minted, returning 0 for any
 * value it does not recognise — including a revision minted before Phase 61
 * carried a sequence at all, which is `rev-<n>` and is read here so an existing
 * record's next revision still counts up from where it stood.
 *
 * Exported for the minting side and for tests that assert a record's revisions
 * advance. It is not a licence for a consumer to order revisions: only the
 * runtime that mints a record's next revision may read the previous one.
 */
export function recordRevisionSequence(previous: string | undefined): number {
  if (typeof previous !== "string") return 0;
  const matched = /^rev-(\d+)(?:-|$)/.exec(previous);
  if (matched === null) return 0;
  const sequence = Number(matched[1]);
  // A sequence that cannot be counted past is not a usable starting point; the
  // random token still keeps the minted value unique.
  return Number.isSafeInteger(sequence) && sequence < Number.MAX_SAFE_INTEGER ? sequence : 0;
}

function randomId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid !== undefined) {
    return randomUuid;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
