/**
 * Model content fingerprinting.
 *
 * `modelVersion` is what an author *declares*; `modelFingerprint` is what the
 * model *is*. Before Phase 51 only the declared value existed, it had no ADL
 * syntax behind it, and it was a platform constant — so editing model content
 * (`OFFLINE_GRACE 30 DAYS` to `7 DAYS`, say) left the version identical and the
 * startup compatibility guard silent, while the authority quietly began issuing
 * shorter sessions than every already-running device believed it had.
 *
 * The fingerprint closes that: it is a deterministic digest of the resolved
 * model's own content, so a content change is always visible even when the
 * author forgets to bump the declared version. The declared version still
 * selects migrations; the fingerprint only decides whether a declared version is
 * still telling the truth.
 *
 * Determinism is part of the cross-runtime contract, so both halves are
 * specified rather than incidental:
 *
 * 1. **Canonical form.** JSON with object keys sorted by UTF-16 code unit,
 *    array order preserved, `undefined`-valued keys omitted, and no whitespace.
 * 2. **Digest.** SHA-256 over the UTF-8 bytes of that text, lowercase hex,
 *    prefixed `sha256-`.
 *
 * SHA-256 is implemented here rather than taken from a platform API because the
 * only digest available in both a browser and Node without a dependency is
 * `crypto.subtle.digest`, which is asynchronous — and model resolution is
 * synchronous everywhere in this repository.
 */

import type { JsonValue } from "./resolved-model.js";

/**
 * Keys excluded from the canonical form because they are not model content.
 *
 * `modelVersion` is excluded deliberately, and it is the subtle one. The
 * fingerprint answers a single question — "is the content this version claims to
 * describe still the same?" — and it is only ever consulted when two versions
 * already compare equal, so including the version in its own digest adds
 * nothing. What it did add was a contradiction: `1.1` and `1.1.0` are the same
 * version, but re-spelling one changed the digest, so the guard refused with a
 * stale fingerprint and the only remedy it could name — declare a migration
 * between them — was itself a validation error, because they do not move
 * forward relative to each other. Excluding the version removes that dead end
 * while leaving the case that matters untouched: a content change at an
 * unchanged version is still refused.
 */
const NON_CONTENT_KEYS = new Set(["modelFingerprint", "modelVersion", "generatedAt"]);

export const MODEL_FINGERPRINT_ALGORITHM = "sha256";

/**
 * Canonical JSON text for a value: sorted object keys, preserved array order,
 * omitted `undefined` values, no insignificant whitespace.
 */
export function canonicalJson(value: unknown): string {
  return writeCanonical(value, new Set());
}

/**
 * The fingerprint of a resolved model's content. Accepts the model with or
 * without `modelFingerprint` present; the field is excluded from its own input
 * either way, as is `generatedAt`, which is a build stamp rather than semantics.
 *
 * This is a digest of whatever it is handed, not a claim that resolution is
 * idempotent — it is not. `resolveApplicationModel` takes a *partial* model, and
 * feeding a resolved one back re-appends each object's default-deny policy, so
 * the second result genuinely has different content and correctly fingerprints
 * differently. What is guaranteed is that resolving the same partial source
 * twice always agrees.
 */
export function computeModelFingerprint(model: unknown): string {
  return `${MODEL_FINGERPRINT_ALGORITHM}-${sha256Hex(canonicalJson(model))}`;
}

function writeCanonical(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("A resolved model may not contain a non-finite number.");
    }
    // `-0` and `0` are the same model content; JSON.stringify disagrees.
    return JSON.stringify(value === 0 ? 0 : value);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    guardCycle(value, seen);
    const text = `[${value.map((item) => writeCanonical(item === undefined ? null : item, seen)).join(",")}]`;
    seen.delete(value);
    return text;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    guardCycle(record, seen);
    const entries = Object.keys(record)
      .filter((key) => !NON_CONTENT_KEYS.has(key) && record[key] !== undefined)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${writeCanonical(record[key], seen)}`);
    seen.delete(record);
    return `{${entries.join(",")}}`;
  }

  // `undefined`, functions and symbols have no canonical form; a resolved model
  // is JSON by contract, so reaching here is a defect rather than an input.
  throw new TypeError(`A resolved model may not contain a ${typeof value} value.`);
}

function guardCycle(value: object, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new TypeError("A resolved model may not contain a cycle.");
  }
  seen.add(value);
}

/** Sorts by UTF-16 code unit, which `Array.prototype.sort` already does. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Narrowing helper for callers that hold `JsonValue` and want the same digest. */
export function fingerprintJson(value: JsonValue): string {
  return computeModelFingerprint(value);
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 of a string's UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  // Padding: one 0x80 byte, then zeroes to 56 mod 64, then a 64-bit big-endian
  // length. The length below 2^32 bits is enough for any resolved model.
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15] as number;
      const previous2 = schedule[index - 2] as number;
      const s0 = rotr(previous15, 7) ^ rotr(previous15, 18) ^ (previous15 >>> 3);
      const s1 = rotr(previous2, 17) ^ rotr(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] =
        ((schedule[index - 16] as number) + s0 + (schedule[index - 7] as number) + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    for (let index = 0; index < 64; index += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[index] as number) + (schedule[index] as number)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    const round = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index += 1) {
      hash[index] = ((hash[index] as number) + (round[index] as number)) >>> 0;
    }
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** UTF-8 encoding without depending on `TextEncoder` being present. */
function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
