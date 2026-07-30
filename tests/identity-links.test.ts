import { describe, expect, it } from "vitest";
import {
  InMemoryAuthorityIdentitySessionStore,
  OpaqueSessionAdapter,
  assertIdentityKeyPart,
} from "../src/index.js";
import type { AuthorityIdentity } from "../src/index.js";

/**
 * The Phase 49 identity keying. An identity carries no external identifier of
 * its own: every one lives in a `(provider, subject) -> userId` link, so
 * changing provider, adding a second method, or running two in parallel is
 * linking an identifier rather than re-keying the user id that memberships,
 * sessions and audit rows all reference.
 */

/** Nothing in production disables an identity yet, so the store is the seam. */
class DisablingIdentitySessionStore extends InMemoryAuthorityIdentitySessionStore {
  private readonly disabled = new Map<string, Date>();
  disable(userId: string, disabledAt: Date): void {
    this.disabled.set(userId, disabledAt);
  }
  override async findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null> {
    const identity = await super.findIdentityByUserId(userId);
    const disabledAt = this.disabled.get(userId);
    return identity === null || disabledAt === undefined ? identity : { ...identity, disabledAt };
  }
}

function createFixture() {
  const store = new DisablingIdentitySessionStore();
  let ids = 0;
  return {
    store,
    sessions: new OpaqueSessionAdapter(store, {
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      newId: () => `id-${(ids += 1)}`,
    }),
  };
}

/** Values real PostgreSQL refuses, or that must never reach an unbounded key. */
const NUL = String.fromCharCode(0);
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const DELETE = String.fromCharCode(0x7f);
const unusableKeyParts = [
  "",
  " ",
  "\t\n",
  "a".repeat(321),
  `alex${NUL}@example.test`,
  `alex${UNIT_SEPARATOR}@example.test`,
  `alex${DELETE}@example.test`,
  "alex\n@example.test",
];

describe("identity provisioning", () => {
  it("resolves the same identity for a repeated pair and mints one per new pair", async () => {
    const { sessions } = createFixture();
    const first = await sessions.provisionIdentity("passkey", "handle-1");
    expect(await sessions.provisionIdentity("passkey", "handle-1")).toEqual(first);
    const second = await sessions.provisionIdentity("passkey", "handle-2");
    expect(second.userId).not.toBe(first.userId);
  });

  it("treats the provider as part of the key", async () => {
    const { sessions } = createFixture();
    // The same subject string under two providers is two different people. If
    // the provider were not part of the key, switching provider would let one
    // caller land on another's memberships.
    const upstream = await sessions.provisionIdentity("upstream", "alex@example.test");
    const passkey = await sessions.provisionIdentity("passkey", "alex@example.test");
    expect(passkey.userId).not.toBe(upstream.userId);
    expect(await sessions.listIdentityLinks(upstream.userId)).toEqual([
      {
        provider: "upstream",
        subject: "alex@example.test",
        userId: upstream.userId,
        linkedAt: new Date("2026-07-30T12:00:00.000Z"),
      },
    ]);
  });

  it("refuses an identifier that could not be a usable identity key", async () => {
    const { sessions } = createFixture();
    for (const part of unusableKeyParts) {
      expect(() => assertIdentityKeyPart(part, "provider")).toThrow();
      expect(() => assertIdentityKeyPart(part, "subject")).toThrow();
      // The guard is on the adapter, not only on the helper, so no caller can
      // reach identity storage around it.
      await expect(sessions.provisionIdentity(part, "handle-1")).rejects.toThrow();
      await expect(sessions.provisionIdentity("passkey", part)).rejects.toThrow();
    }
    expect(() => assertIdentityKeyPart("a".repeat(320), "subject")).not.toThrow();
    expect(() => assertIdentityKeyPart("passkey", "provider")).not.toThrow();
  });
});

describe("identity links", () => {
  it("reaches one identity through either of its external identifiers", async () => {
    const { sessions, store } = createFixture();
    // The acceptance criterion: a member registered under one provider gains a
    // second identifier, and both resolve to the same user id. This is what
    // makes a provider or method change survivable without a data migration.
    const identity = await sessions.provisionIdentity("upstream", "sub-123");
    await sessions.linkIdentity(identity.userId, "passkey", "handle-1");

    expect(await store.findIdentityByLink("upstream", "sub-123")).toMatchObject({
      userId: identity.userId,
    });
    expect(await store.findIdentityByLink("passkey", "handle-1")).toMatchObject({
      userId: identity.userId,
    });
    expect(await sessions.provisionIdentity("passkey", "handle-1")).toMatchObject({
      userId: identity.userId,
    });
    expect(
      (await sessions.listIdentityLinks(identity.userId)).map((link) => [
        link.provider,
        link.subject,
      ]),
    ).toEqual([
      ["upstream", "sub-123"],
      ["passkey", "handle-1"],
    ]);
  });

  it("is idempotent for the same pair and refuses one held by another identity", async () => {
    const { sessions } = createFixture();
    const alex = await sessions.provisionIdentity("upstream", "sub-alex");
    const sam = await sessions.provisionIdentity("upstream", "sub-sam");
    await sessions.linkIdentity(alex.userId, "passkey", "handle-1");
    await sessions.linkIdentity(alex.userId, "passkey", "handle-1");
    expect(await sessions.listIdentityLinks(alex.userId)).toHaveLength(2);

    // Silently re-pointing an identifier would move a live identity's
    // memberships to whoever claimed it second, so it is refused instead.
    await expect(sessions.linkIdentity(sam.userId, "passkey", "handle-1")).rejects.toThrow(
      "another identity",
    );
    expect(await sessions.listIdentityLinks(sam.userId)).toHaveLength(1);
  });

  it("refuses to link an identifier to an unknown or disabled identity", async () => {
    const { sessions, store } = createFixture();
    await expect(sessions.linkIdentity("user-missing", "passkey", "handle-1")).rejects.toThrow(
      "unknown or disabled",
    );
    const identity = await sessions.provisionIdentity("upstream", "sub-123");
    store.disable(identity.userId, new Date("2026-07-30T13:00:00.000Z"));
    await expect(sessions.linkIdentity(identity.userId, "passkey", "handle-1")).rejects.toThrow(
      "unknown or disabled",
    );
    expect(await sessions.listIdentityLinks(identity.userId)).toHaveLength(1);
  });

  it("refuses an unusable identifier on the link path as well", async () => {
    const { sessions } = createFixture();
    const identity = await sessions.provisionIdentity("upstream", "sub-123");
    for (const part of unusableKeyParts) {
      await expect(sessions.linkIdentity(identity.userId, part, "handle-1")).rejects.toThrow();
      await expect(sessions.linkIdentity(identity.userId, "passkey", part)).rejects.toThrow();
    }
    expect(await sessions.listIdentityLinks(identity.userId)).toHaveLength(1);
  });
});
