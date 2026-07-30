/**
 * The browser half of a WebAuthn ceremony.
 *
 * It does exactly two things: hand the authority's options to the platform
 * authenticator, and encode what comes back as JSON. It makes no decision and
 * asserts nothing — the assertion is evidence the authority verifies against a
 * public key and a challenge it issued, never a claim this code can make on its
 * own. Nothing here is persisted: the options, the challenge and the response
 * exist only for the duration of the call.
 */
export interface WebAuthnBrowserClient {
  /** False when the platform has no WebAuthn support, so the surface can say so. */
  available(): boolean;
  /** Runs a registration ceremony and returns the response as JSON. */
  create(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Runs an authentication ceremony and returns the assertion as JSON. */
  get(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The user dismissed or cancelled the platform prompt; not a failure to report as an error. */
export class WebAuthnCancelledError extends Error {
  constructor() {
    super("The passkey prompt was dismissed.");
    this.name = "WebAuthnCancelledError";
  }
}

export class BrowserWebAuthnClient implements WebAuthnBrowserClient {
  available(): boolean {
    return typeof globalThis.PublicKeyCredential === "function";
  }

  async create(options: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publicKey = parseCreationOptions(
      options,
    ) as unknown as PublicKeyCredentialCreationOptions;
    return encodeRegistrationResponse(await ceremony(() => this.container().create({ publicKey })));
  }

  async get(options: Record<string, unknown>): Promise<Record<string, unknown>> {
    const publicKey = parseRequestOptions(options) as unknown as PublicKeyCredentialRequestOptions;
    return encodeAuthenticationResponse(await ceremony(() => this.container().get({ publicKey })));
  }

  private container(): CredentialsContainer {
    const container = globalThis.navigator?.credentials;
    if (container === undefined) throw new Error("This browser has no WebAuthn support.");
    return container;
  }
}

async function ceremony(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (error) {
    // A dismissed prompt and a refused ceremony are both NotAllowedError; the
    // surface treats them the same and simply lets the person try again.
    if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError"))
      throw new WebAuthnCancelledError();
    throw error;
  }
  if (credential === null) throw new WebAuthnCancelledError();
  return credential as PublicKeyCredential;
}

/* -------------------------------------------------------------------------- */
/* JSON <-> binary conversion                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `PublicKeyCredential.parseCreationOptionsFromJSON` is used when the browser
 * has it, and the field-by-field conversion below is the fallback. Both produce
 * the same structure; the fallback exists because the parse helpers are newer
 * than the ceremony itself and a browser without them still works.
 */
export function parseCreationOptions(options: Record<string, unknown>): Record<string, unknown> {
  const parse = (
    globalThis.PublicKeyCredential as unknown as {
      parseCreationOptionsFromJSON?: (json: unknown) => Record<string, unknown>;
    }
  )?.parseCreationOptionsFromJSON;
  if (typeof parse === "function") return parse(options);
  const user = asRecord(options.user);
  return {
    ...options,
    challenge: base64UrlToBuffer(asString(options.challenge)),
    ...(user === undefined ? {} : { user: { ...user, id: base64UrlToBuffer(asString(user.id)) } }),
    ...(Array.isArray(options.excludeCredentials)
      ? { excludeCredentials: options.excludeCredentials.map(withBufferId) }
      : {}),
  };
}

export function parseRequestOptions(options: Record<string, unknown>): Record<string, unknown> {
  const parse = (
    globalThis.PublicKeyCredential as unknown as {
      parseRequestOptionsFromJSON?: (json: unknown) => Record<string, unknown>;
    }
  )?.parseRequestOptionsFromJSON;
  if (typeof parse === "function") return parse(options);
  return {
    ...options,
    challenge: base64UrlToBuffer(asString(options.challenge)),
    ...(Array.isArray(options.allowCredentials)
      ? { allowCredentials: options.allowCredentials.map(withBufferId) }
      : {}),
  };
}

export function encodeRegistrationResponse(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const json = toJson(credential);
  if (json !== undefined) return json;
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      ...(typeof response.getTransports === "function"
        ? { transports: response.getTransports() }
        : {}),
    },
  };
}

export function encodeAuthenticationResponse(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const json = toJson(credential);
  if (json !== undefined) return json;
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      ...(response.userHandle === null
        ? {}
        : { userHandle: bufferToBase64Url(response.userHandle) }),
    },
  };
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function toJson(credential: PublicKeyCredential): Record<string, unknown> | undefined {
  const asJson = (credential as unknown as { toJSON?: () => Record<string, unknown> }).toJSON;
  return typeof asJson === "function" ? asJson.call(credential) : undefined;
}

function withBufferId(entry: unknown): unknown {
  const record = asRecord(entry);
  return record === undefined ? entry : { ...record, id: base64UrlToBuffer(asString(record.id)) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("The authority returned malformed WebAuthn options.");
  return value;
}
