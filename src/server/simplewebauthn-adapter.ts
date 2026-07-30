import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { JsonValue } from "../model/resolved-model.js";
import type {
  WebAuthnAuthenticationCheck,
  WebAuthnAuthenticationOptionsRequest,
  WebAuthnAuthenticationVerification,
  WebAuthnLibrary,
  WebAuthnRegistrationCheck,
  WebAuthnRegistrationOptionsRequest,
  WebAuthnRegistrationVerification,
} from "./webauthn-identity.js";

/**
 * The only module in the repository that imports `@simplewebauthn/server`.
 *
 * It is deliberately not re-exported from `src/index.ts`: the browser bundle
 * imports that barrel, and this package is a Node dependency. Everything else
 * — the ceremony service, its stores, the HTTP edge — depends on the structural
 * {@link WebAuthnLibrary} interface instead, which is the same discipline `pg`
 * already follows. Composition happens in the authority entrypoint and in tests.
 *
 * Origin and relying-party binding are passed through explicitly on every call:
 * nothing here is inferred from the incoming request, so a credential
 * registered against one relying party id cannot be used against another.
 */
export class SimpleWebAuthnLibrary implements WebAuthnLibrary {
  async createRegistrationOptions(
    request: WebAuthnRegistrationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }> {
    const options = await generateRegistrationOptions({
      rpName: request.relyingParty.relyingPartyName,
      rpID: request.relyingParty.relyingPartyId,
      userID: isoBase64URL.toBuffer(request.userHandle),
      userName: request.userName,
      userDisplayName: request.userDisplayName,
      // No attestation is requested: this authority verifies a signature over
      // its own challenge and has no use for an attestation statement, which
      // would only add privacy-sensitive device data it must then not store.
      attestationType: "none",
      excludeCredentials: request.excludeCredentialIds.map((id) => ({ id })),
      authenticatorSelection: {
        // Discoverable, so authentication needs no user name and the
        // authenticator names the credential itself.
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    return { challenge: options.challenge, options: asJson(options) };
  }

  async verifyRegistration(
    check: WebAuthnRegistrationCheck,
  ): Promise<WebAuthnRegistrationVerification> {
    let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      result = await verifyRegistrationResponse({
        response: check.response as never,
        expectedChallenge: check.expectedChallenge,
        expectedOrigin: [...check.relyingParty.origins],
        expectedRPID: check.relyingParty.relyingPartyId,
        requireUserVerification: false,
      });
    } catch {
      // A malformed, wrong-origin, wrong-RP or unverifiable response is a
      // refusal, not an error to propagate: the library's message can quote
      // response material.
      return { verified: false };
    }
    const info = result.registrationInfo;
    if (!result.verified || info === undefined) return { verified: false };
    return {
      verified: true,
      credentialId: info.credential.id,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      ...(info.credential.transports === undefined
        ? {}
        : { transports: info.credential.transports }),
      backedUp: info.credentialBackedUp,
    };
  }

  async createAuthenticationOptions(
    request: WebAuthnAuthenticationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }> {
    const options = await generateAuthenticationOptions({
      rpID: request.relyingParty.relyingPartyId,
      userVerification: "preferred",
      ...(request.allowCredentialIds === undefined
        ? {}
        : { allowCredentials: request.allowCredentialIds.map((id) => ({ id })) }),
    });
    return { challenge: options.challenge, options: asJson(options) };
  }

  async verifyAuthentication(
    check: WebAuthnAuthenticationCheck,
  ): Promise<WebAuthnAuthenticationVerification> {
    let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      result = await verifyAuthenticationResponse({
        response: check.response as never,
        expectedChallenge: check.expectedChallenge,
        expectedOrigin: [...check.relyingParty.origins],
        expectedRPID: check.relyingParty.relyingPartyId,
        requireUserVerification: false,
        credential: {
          id: check.credential.id,
          publicKey: isoBase64URL.toBuffer(check.credential.publicKey),
          counter: check.credential.counter,
          ...(check.credential.transports === undefined
            ? {}
            : { transports: [...check.credential.transports] as never }),
        },
      });
    } catch {
      return { verified: false };
    }
    return result.verified
      ? { verified: true, newCounter: result.authenticationInfo.newCounter }
      : { verified: false };
  }
}

/** The library returns plain option objects; this states that for the JSON boundary. */
function asJson(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
