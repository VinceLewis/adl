import type { AuthorityConfiguration } from "./authority-config.js";

export interface UpstreamIdentityVerifier {
  /**
   * Stable, non-secret identifier for the active verifier. It is disclosed in
   * the startup security log and on `/readyz` so a bypassed deployment is
   * visible from outside the process.
   */
  readonly name: string;
  /** Validate a provider proof against the configured issuer/audience; never log the proof. */
  verify(
    proof: string,
    expected: AuthorityConfiguration["upstreamIdentity"],
  ): Promise<{ subject: string } | null>;
}

/** Non-secret description of the active identity boundary. */
export interface AuthorityIdentityVerificationStatus {
  mode: AuthorityConfiguration["identityVerification"]["mode"];
  verifier: string;
  bypassed: boolean;
}

/**
 * Development-only verifier. No provider is contacted: the supplied account
 * proof is accepted as the identity subject. It is deliberately temporary and
 * is always disclosed by {@link describeIdentityVerification}; a real provider
 * decision is separate follow-up work.
 *
 * It still refuses a proof that could not be a usable subject, so the bypass
 * cannot introduce control characters or unbounded keys into identity storage.
 */
export class BypassIdentityVerifier implements UpstreamIdentityVerifier {
  readonly name = "bypass";
  async verify(proof: string): Promise<{ subject: string } | null> {
    const subject = proof.trim();
    if (subject.length === 0 || subject.length > 320) return null;
    // Control characters (notably NUL) are rejected: real PostgreSQL refuses
    // them in a text key, so they must never reach identity storage.
    if (/[\u0000-\u001f\u007f]/u.test(subject)) return null;
    return { subject };
  }
}

/**
 * Selected when verification is switched on but no provider implementation has
 * been supplied. Every proof is unverifiable, so no session is issued. This is
 * an honest failure rather than a silent downgrade to the bypass.
 */
export class UnconfiguredUpstreamIdentityVerifier implements UpstreamIdentityVerifier {
  readonly name = "upstream-unconfigured";
  async verify(): Promise<{ subject: string } | null> {
    return null;
  }
}

export interface UpstreamIdentityVerifierSelection {
  /** A real provider verifier, used only when the switch is on. */
  upstream?: UpstreamIdentityVerifier;
}

/**
 * The configuration switch. It defaults to the bypass, and turning it on never
 * falls back to the bypass: an absent provider rejects instead.
 */
export function selectUpstreamIdentityVerifier(
  configuration: AuthorityConfiguration,
  selection: UpstreamIdentityVerifierSelection = {},
): UpstreamIdentityVerifier {
  if (configuration.identityVerification.mode === "bypass") return new BypassIdentityVerifier();
  return selection.upstream ?? new UnconfiguredUpstreamIdentityVerifier();
}

export function describeIdentityVerification(
  configuration: AuthorityConfiguration,
  verifier: UpstreamIdentityVerifier,
): AuthorityIdentityVerificationStatus {
  const mode = configuration.identityVerification.mode;
  return { mode, verifier: verifier.name, bypassed: mode === "bypass" };
}
