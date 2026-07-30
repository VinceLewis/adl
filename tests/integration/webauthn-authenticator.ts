import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type { JsonValue } from "../../src/index.js";

/**
 * A software WebAuthn authenticator for the integration suite.
 *
 * It exists so the passkey ceremonies can be proven against the **real**
 * `@simplewebauthn/server` verifier rather than a stub: this file only ever
 * *produces* credentials, and every check — challenge, origin, relying party,
 * flags, counter, and the ECDSA signature itself — is performed by the real
 * library against a key it has never seen. Encoding helpers (`isoCBOR`,
 * `isoBase64URL`) are borrowed from that package because CBOR and base64url are
 * wire formats, not verification: using the library's encoder proves nothing on
 * its own, and re-implementing CBOR here would only add a second thing to get
 * wrong.
 *
 * The knobs below exist to drive the refusal cases the phase requires — a
 * forged signature, a wrong-origin assertion, and a stale signature counter —
 * each of which must be produced by a genuinely misbehaving authenticator, not
 * by tampering with the server.
 */

/** ES256. The only algorithm this authenticator implements. */
const COSE_ALG_ES256 = -7;
const COSE_KTY_EC2 = 2;
const COSE_CRV_P256 = 1;

/** WebAuthn authenticator data flags (https://www.w3.org/TR/webauthn-2/#flags). */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKUP_STATE = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

export interface SoftwareAuthenticatorOptions {
  rpId: string;
  origin: string;
  /**
   * Report the credential as a multi-device (backed up) passkey. BE and BS are
   * set together: the library refuses a single-device credential that claims to
   * be backed up, exactly as a real one would be refused.
   */
  backedUp?: boolean;
  /** Signature counter this authenticator starts from. */
  signCount?: number;
  /** Transports advertised at registration; round-tripped through storage. */
  transports?: readonly string[];
}

/** Per-ceremony deviations, each of which a correct authority must refuse. */
export interface CeremonyOverrides {
  /** Assert against a different origin than the one this authenticator binds to. */
  origin?: string;
  /**
   * Report this counter instead of advancing. A value at or below the stored
   * one is the cloned-authenticator signal.
   */
  signCount?: number;
  /**
   * Sign over tampered bytes. The DER structure stays well formed, so the
   * refusal comes from the signature check itself rather than from a parse
   * error — which is what a real forgery attempt looks like.
   */
  forgeSignature?: boolean;
}

/**
 * A single-credential software authenticator. Each test constructs its own, so
 * "this authenticator" and "this credential" are the same thing; registering
 * twice replaces the key, as re-enrolling a device would.
 */
export class SoftwareAuthenticator {
  private readonly options: SoftwareAuthenticatorOptions;
  private signCount: number;
  private keyPair: CryptoKeyPair | undefined;
  private credentialIdBytes: Uint8Array | undefined;
  private userHandleValue: string | undefined;

  constructor(options: SoftwareAuthenticatorOptions) {
    this.options = options;
    this.signCount = options.signCount ?? 0;
  }

  /** Base64url credential id, as the authority stores and addresses it. */
  get credentialId(): string {
    if (this.credentialIdBytes === undefined)
      throw new Error("This authenticator holds no credential yet.");
    return isoBase64URL.fromBuffer(this.credentialIdBytes);
  }

  /** The user handle the registration options named, echoed back on assertions. */
  get userHandle(): string | undefined {
    return this.userHandleValue;
  }

  /**
   * Answers `navigator.credentials.create()`: a fresh P-256 key pair, an
   * attested-credential-data `authData`, and a `none` attestation object.
   */
  async register(
    options: Record<string, unknown>,
    overrides: CeremonyOverrides = {},
  ): Promise<Record<string, JsonValue>> {
    const challenge = readChallenge(options);
    this.userHandleValue = readUserHandle(options);
    this.keyPair = (await globalThis.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      // The private key never leaves this object, so it need not be extractable;
      // WebCrypto always allows the public key to be exported.
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    this.credentialIdBytes = randomBytes(32);
    if (overrides.signCount !== undefined) this.signCount = overrides.signCount;

    const clientDataJSON = this.clientData("webauthn.create", challenge, overrides);
    const authData = concat(
      await sha256(new TextEncoder().encode(this.options.rpId)),
      Uint8Array.of(this.flags(FLAG_ATTESTED_CREDENTIAL_DATA)),
      bigEndianUint32(this.signCount),
      // AAGUID. All zeroes is the value a privacy-preserving authenticator
      // reports, and is what `attestationType: "none"` expects to see.
      new Uint8Array(16),
      bigEndianUint16(this.credentialIdBytes.byteLength),
      this.credentialIdBytes,
      await this.cosePublicKey(),
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, JsonEncodableCbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: [...(this.options.transports ?? ["internal", "hybrid"])],
      },
    };
  }

  /**
   * Answers `navigator.credentials.get()`: authenticator data with no attested
   * credential data, and an ECDSA-P256-SHA256 signature over
   * `authData || SHA-256(clientDataJSON)` in DER form. WebAuthn requires DER;
   * WebCrypto emits raw `r || s`, so the conversion is not optional.
   */
  async authenticate(
    options: Record<string, unknown>,
    overrides: CeremonyOverrides = {},
  ): Promise<Record<string, JsonValue>> {
    const keyPair = this.keyPair;
    if (keyPair === undefined || this.credentialIdBytes === undefined)
      throw new Error("This authenticator holds no credential yet.");
    const challenge = readChallenge(options);
    // An override reports a counter without advancing the authenticator's own,
    // so a stale value can be replayed the way a clone would replay it.
    const reportedCount = overrides.signCount ?? (this.signCount += 1);

    const clientDataJSON = this.clientData("webauthn.get", challenge, overrides);
    const authData = concat(
      await sha256(new TextEncoder().encode(this.options.rpId)),
      Uint8Array.of(this.flags(0)),
      bigEndianUint32(reportedCount),
    );
    const signedData = concat(authData, await sha256(clientDataJSON));
    const signature = await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      overrides.forgeSignature === true ? tamper(signedData) : signedData,
    );

    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(derEncodeEcdsaSignature(new Uint8Array(signature))),
        ...(this.userHandleValue === undefined ? {} : { userHandle: this.userHandleValue }),
      },
    };
  }

  private flags(extra: number): number {
    const backup = this.options.backedUp === true ? FLAG_BACKUP_ELIGIBLE | FLAG_BACKUP_STATE : 0;
    return FLAG_USER_PRESENT | FLAG_USER_VERIFIED | backup | extra;
  }

  private clientData(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    overrides: CeremonyOverrides,
  ): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({
        type,
        challenge,
        origin: overrides.origin ?? this.options.origin,
        crossOrigin: false,
      }),
    );
  }

  /** COSE_Key for the generated public key: `{1: 2, 3: -7, -1: 1, -2: x, -3: y}`. */
  private async cosePublicKey(): Promise<Uint8Array> {
    const keyPair = this.keyPair;
    if (keyPair === undefined) throw new Error("This authenticator holds no credential yet.");
    const jwk = await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    if (jwk.x === undefined || jwk.y === undefined)
      throw new Error("The exported public key carried no EC coordinates.");
    return isoCBOR.encode(
      new Map<number, JsonEncodableCbor>([
        [1, COSE_KTY_EC2],
        [3, COSE_ALG_ES256],
        [-1, COSE_CRV_P256],
        [-2, isoBase64URL.toBuffer(jwk.x)],
        [-3, isoBase64URL.toBuffer(jwk.y)],
      ]),
    );
  }
}

/**
 * The subset of the CBOR encoder's input type this file produces. Declaring it
 * locally keeps the encoder's own types out of the test surface while still
 * type-checking what is handed to it.
 */
type JsonEncodableCbor = string | number | Uint8Array | Map<string | number, JsonEncodableCbor>;

function readChallenge(options: Record<string, unknown>): string {
  const challenge = options.challenge;
  if (typeof challenge !== "string" || challenge.length === 0)
    throw new Error("The ceremony options carried no challenge.");
  return challenge;
}

function readUserHandle(options: Record<string, unknown>): string | undefined {
  const user = options.user;
  if (user === null || typeof user !== "object" || Array.isArray(user)) return undefined;
  const id = (user as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * DER-encode a raw `r || s` ECDSA signature. WebCrypto returns the raw form and
 * WebAuthn mandates the ASN.1 DER form, so the verifier's ASN.1 parse fails
 * outright without this step.
 */
function derEncodeEcdsaSignature(raw: Uint8Array): Uint8Array {
  const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32, 64)));
  // A P-256 signature body is at most 70 bytes, so the short-form length always
  // applies and no multi-byte length encoding is needed.
  return concat(Uint8Array.of(0x30, body.byteLength), body);
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.byteLength - 1 && bytes[start] === 0) start += 1;
  let value = bytes.slice(start);
  // DER integers are signed, so a leading high bit needs a zero pad to stay positive.
  if (((value[0] ?? 0) & 0x80) !== 0) value = concat(Uint8Array.of(0x00), value);
  return concat(Uint8Array.of(0x02, value.byteLength), value);
}

/** Flip one bit so the signature is over data that is not what was presented. */
function tamper(data: Uint8Array): Uint8Array {
  const copy = data.slice();
  const last = copy.byteLength - 1;
  copy[last] = (copy[last] ?? 0) ^ 0xff;
  return copy;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bigEndianUint16(value: number): Uint8Array {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

function bigEndianUint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
