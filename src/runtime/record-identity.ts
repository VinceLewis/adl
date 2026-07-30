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

function randomId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid !== undefined) {
    return randomUuid;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
