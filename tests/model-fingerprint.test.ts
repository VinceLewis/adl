import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MODEL_FINGERPRINT_ALGORITHM,
  canonicalJson,
  computeModelFingerprint,
  resolveApplicationModel,
  sha256Hex,
} from "../src/index.js";
import type { PartialApplicationModel } from "../src/index.js";

describe("canonicalJson", () => {
  it("sorts object keys by UTF-16 code unit rather than by locale or insertion order", () => {
    // Deliberately mixed case and non-ASCII: a locale-aware sort would put 'a'
    // before 'Z' and 'é' next to 'e', and a stable insertion-order walk would
    // emit them exactly as written. Code-unit order is the only one that gives
    // the sequence asserted below.
    const text = canonicalJson({ b: 1, a: 2, Z: 3, A: 4, é: 5, "": 6, "0": 7 });

    expect(text).toBe('{"":6,"0":7,"A":4,"Z":3,"a":2,"b":1,"é":5}');
  });

  it("sorts keys at every depth, not only at the top level", () => {
    expect(canonicalJson({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });

  it("preserves array order, which is content rather than presentation", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ steps: ["z", "a", "m"] })).toBe('{"steps":["z","a","m"]}');
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: [1, { b: null }], c: true })).toBe('{"a":[1,{"b":null}],"c":true}');
  });

  it("omits keys whose value is undefined", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson({ a: undefined })).toBe("{}");
    // An absent key and a key present with `undefined` are the same content.
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });

  it("writes -0 as 0, because they are the same model content", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson({ v: -0 })).toBe('{"v":0}');
    expect(canonicalJson({ v: -0 })).toBe(canonicalJson({ v: 0 }));
    expect(canonicalJson([-0, 0])).toBe("[0,0]");
  });

  it("keeps an array hole distinguishable as null rather than dropping it", () => {
    // Arrays are positional, so an omitted element would shift every later one.
    expect(canonicalJson([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("throws on a cycle", () => {
    const cyclic: Record<string, unknown> = { name: "model" };
    cyclic["self"] = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/u);
  });

  it("throws on a cycle reached through an array", () => {
    const items: unknown[] = [];
    items.push(items);

    expect(() => canonicalJson({ items })).toThrow(TypeError);
  });

  it("does not mistake a repeated value for a cycle", () => {
    const shared = { a: 1 };

    expect(canonicalJson({ left: shared, right: shared })).toBe('{"left":{"a":1},"right":{"a":1}}');
  });

  it("throws on a value with no JSON form", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
    expect(() => canonicalJson(() => undefined)).toThrow(TypeError);
    expect(() => canonicalJson({ token: Symbol("token") })).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
  });

  it("throws on a non-finite number", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ v: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson({ v: Number.NEGATIVE_INFINITY })).toThrow(/non-finite/u);
  });
});

describe("sha256Hex", () => {
  // Published FIPS 180-4 vectors, hard-coded so this file still proves something
  // if `node:crypto` itself were wrong or unavailable.
  const publishedVectors: Array<[string, string]> = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ];

  it.each(publishedVectors)("matches the published vector for %j", (text, expected) => {
    expect(sha256Hex(text)).toBe(expected);
  });

  it.each([
    ["the empty string", ""],
    ["abc", "abc"],
    ["a multi-byte UTF-8 string", "héllo wörld — 日本語 🎸"],
    ["a string that lands exactly on a block boundary", "a".repeat(64)],
    ["a string one byte short of the padding boundary", "b".repeat(55)],
    ["a string that forces a second padding block", "c".repeat(56)],
    ["a long multi-block string", "übung".repeat(500)],
  ])("agrees with node:crypto for %s", (_label, text) => {
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });

  it("hashes the UTF-8 bytes, so an astral character is four bytes rather than a surrogate pair", () => {
    // If the implementation hashed UTF-16 code units the surrogate pair would
    // hash differently from the code point's UTF-8 encoding.
    expect(sha256Hex("🎸")).toBe(createHash("sha256").update("🎸", "utf8").digest("hex"));
    expect(sha256Hex("\u{1f3b8}")).toBe(sha256Hex("🎸"));
  });

  it("returns lowercase hex of a fixed 64-character width", () => {
    expect(sha256Hex("model")).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("computeModelFingerprint", () => {
  it("is the algorithm name and the digest of the canonical form", () => {
    const content = { app: { name: "Fixture" }, modelVersion: "1.0.0" };

    expect(computeModelFingerprint(content)).toBe(
      `${MODEL_FINGERPRINT_ALGORITHM}-${sha256Hex(canonicalJson(content))}`,
    );
    expect(computeModelFingerprint(content)).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  it("excludes modelFingerprint and generatedAt from its own input", () => {
    const content = { app: { name: "Fixture" }, modelVersion: "1.0.0" };
    const stamped = {
      ...content,
      modelFingerprint: "sha256-0000000000000000000000000000000000000000000000000000000000000000",
      generatedAt: "2026-07-30T00:00:00.000Z",
    };

    expect(computeModelFingerprint(stamped)).toBe(computeModelFingerprint(content));
  });

  it("excludes them at any depth, so a nested build stamp cannot move the digest", () => {
    expect(computeModelFingerprint({ a: { generatedAt: "then", keep: 1 } })).toBe(
      computeModelFingerprint({ a: { keep: 1 } }),
    );
  });

  it("changes when any content changes", () => {
    const base = computeModelFingerprint({ app: { name: "Fixture" } });

    expect(computeModelFingerprint({ app: { name: "Fixture2" } })).not.toBe(base);
    expect(computeModelFingerprint({ app: { name: "Fixture", extra: 1 } })).not.toBe(base);
  });

  it("is independent of key insertion order", () => {
    expect(computeModelFingerprint({ a: 1, b: 2 })).toBe(computeModelFingerprint({ b: 2, a: 1 }));
  });
});

describe("resolved model fingerprints", () => {
  it("is stable across two resolutions of the same input", () => {
    const first = resolveApplicationModel(fingerprintPartialModel());
    const second = resolveApplicationModel(fingerprintPartialModel());

    expect(first.modelFingerprint).toMatch(/^sha256-[0-9a-f]{64}$/u);
    expect(second.modelFingerprint).toBe(first.modelFingerprint);
  });

  it("differs when offlineGraceDays alone changes", () => {
    // The Phase 50 case with teeth: the declared version is identical, so only
    // the fingerprint can tell an already-running device that the grace it
    // believes it has is no longer the grace the authority will honour.
    const thirtyDays = resolveApplicationModel(fingerprintPartialModel());
    const sevenDays = resolveApplicationModel({
      ...fingerprintPartialModel(),
      app: { ...fingerprintPartialModel().app, offlineGraceDays: 7 },
    });

    expect(sevenDays.modelVersion).toBe(thirtyDays.modelVersion);
    expect(sevenDays.app.offlineGraceDays).toBe(7);
    expect(sevenDays.modelFingerprint).not.toBe(thirtyDays.modelFingerprint);
  });

  it("differs when a declared migration changes, and matches when it does not", () => {
    const withoutMigration = resolveApplicationModel(fingerprintPartialModel());
    const withMigration = resolveApplicationModel({
      ...fingerprintPartialModel(),
      migrations: [
        {
          from: "1.0.0",
          to: "1.1.0",
          objects: [{ object: "Gig", steps: [{ kind: "dropField", field: "LegacyNote" }] }],
        },
      ],
    });

    expect(withMigration.modelFingerprint).not.toBe(withoutMigration.modelFingerprint);
  });

  it("re-fingerprints an already-resolved model to the same value", () => {
    // The resolved model carries its own fingerprint, so fingerprinting it again
    // would be circular if the field were part of its own input. It is not, so
    // the digest of a resolved model is the digest it already carries.
    const model = resolveApplicationModel(fingerprintPartialModel());

    expect(computeModelFingerprint(model)).toBe(model.modelFingerprint);
    expect(model).toHaveProperty("modelFingerprint");
  });

  it("is unmoved by a stale fingerprint already present on the input", () => {
    const model = resolveApplicationModel(fingerprintPartialModel());
    const tampered = {
      ...model,
      modelFingerprint: "sha256-0000000000000000000000000000000000000000000000000000000000000000",
    };

    expect(computeModelFingerprint(tampered)).toBe(model.modelFingerprint);
  });
});

function fingerprintPartialModel(): PartialApplicationModel {
  return {
    modelVersion: "1.1.0",
    app: { name: "FingerprintFixture", offlineGraceDays: 30 },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Gig",
        businessKey: "Title",
        displayField: "Title",
        fields: [
          { name: "Title", type: "text", required: true },
          { name: "VenueName", type: "text" },
        ],
      },
    ],
    policies: [
      {
        name: "GigPolicy",
        object: "Gig",
        rules: [
          {
            name: "allowAdmin",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  };
}
