// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ADL_PASSKEY_SIGN_IN_EVENT,
  ADL_REGISTER_PASSKEY_EVENT,
  PASSKEY_IDENTITY_MODE,
  type AdlSessionState,
  type RegisterPasskeyDetail,
} from "../src/ui/authority-bridge.js";
import {
  AdlSessionPanelElement,
  defineAdlSessionPanel,
} from "../src/ui/components/adl-session-panel.js";
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  parseCreationOptions,
  parseRequestOptions,
} from "../src/ui/webauthn-client.js";

/**
 * The passkey half of the sign-in surface, proven at the DOM level.
 *
 * The rules under test are the ones a later edit could plausibly break: a
 * passkey deployment must never render an account-proof field (that would be a
 * second, weaker way in beside the ceremony), the invitation token must be
 * treated as the credential it is, and a browser that cannot do WebAuthn must
 * say so rather than offering a control that cannot work.
 *
 * The full ceremony — real challenge, real signature, real refusals — is proven
 * against a real authority over real PostgreSQL in `tests/integration/`, and in
 * the Playwright passkey project against a real Chromium authenticator. The
 * visual smoke suite screenshots the reference app with no authority
 * configured, so it deliberately covers none of this.
 */

const INVITE_TOKEN = "invite-token-0123456789abcdef0123456789abcdef";

const passkeySignedOut: AdlSessionState = {
  status: "signedOut",
  developmentMode: false,
  identityMode: PASSKEY_IDENTITY_MODE,
  passkeySupported: true,
  selfServiceRegistration: false,
  busy: false,
  /** No prior authentication here, so there is no grace to be inside. */
  grace: { status: "noIdentity", offlineGraceDays: 30 },
};

const passkeySignedIn: AdlSessionState = {
  ...passkeySignedOut,
  status: "signedIn",
  userId: "user-9f3c",
};

describe("adl-session-panel passkey surface", () => {
  beforeEach(() => {
    defineAdlSessionPanel();
    document.body.innerHTML = "";
  });

  it("offers a ceremony instead of a credential field when the authority verifies passkeys", () => {
    const panel = mountPanel(passkeySignedOut);

    expect(panel.querySelector("[data-session-passkey-sign-in='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-passkey-form='true']")).not.toBeNull();
    // The load-bearing assertion: no account proof anywhere on a passkey
    // deployment, because a typed credential would be a second way in.
    expect(panel.querySelector("[data-session-account-proof='true']")).toBeNull();
    expect(panel.querySelector("[data-session-sign-in-form='true']")).toBeNull();
  });

  it("keeps the account-proof surface for a deployment that is not verifying passkeys", () => {
    const panel = mountPanel({ ...passkeySignedOut, identityMode: "bypass" });

    expect(panel.querySelector("[data-session-account-proof='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-passkey-sign-in='true']")).toBeNull();
  });

  it("dispatches a sign-in intent without any detail the browser could have chosen", () => {
    const events = captureEvents(ADL_PASSKEY_SIGN_IN_EVENT);
    const panel = mountPanel(passkeySignedOut);

    requireElement<HTMLButtonElement>(panel, "[data-session-passkey-sign-in='true']").click();

    expect(events).toHaveLength(1);
    // Nothing identifies the person here: the authenticator names the
    // credential and the authority resolves the identity.
    expect(events[0]?.detail ?? null).toBeNull();
  });

  it("carries the invitation token once and clears it from the input", () => {
    const events = captureEvents<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT);
    const panel = mountPanel(passkeySignedOut);
    const input = requireElement<HTMLInputElement>(panel, "[data-session-passkey-invite='true']");
    input.value = INVITE_TOKEN;

    requireElement<HTMLFormElement>(panel, "[data-session-passkey-form='true']").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.detail?.inviteToken).toBe(INVITE_TOKEN);
    // The token is a credential: it must not outlive the attempt, and it must
    // never appear in markup, an attribute, or a field of the element.
    expect(input.value).toBe("");
    expect(panel.innerHTML).not.toContain(INVITE_TOKEN);
    expect(panel.outerHTML).not.toContain(INVITE_TOKEN);
  });

  it("refuses to dispatch a registration with an empty token and says why", () => {
    const events = captureEvents<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT);
    const panel = mountPanel(passkeySignedOut);

    requireElement<HTMLFormElement>(panel, "[data-session-passkey-form='true']").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(events).toHaveLength(0);
    const hint = requireElement<HTMLElement>(panel, "[data-session-passkey-hint='true']");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("lets a signed-in person add a device with no invitation, because the session authorises it", () => {
    const events = captureEvents<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT);
    const panel = mountPanel(passkeySignedIn);

    requireElement<HTMLButtonElement>(panel, "[data-session-add-passkey='true']").click();

    expect(events).toHaveLength(1);
    expect(events[0]?.detail?.inviteToken).toBeUndefined();
  });

  it("states that a browser without WebAuthn cannot sign in, and disables the controls", () => {
    const panel = mountPanel({ ...passkeySignedOut, passkeySupported: false });

    expect(panel.querySelector("[data-session-passkey-unsupported='true']")).not.toBeNull();
    expect(
      requireElement<HTMLButtonElement>(panel, "[data-session-passkey-sign-in='true']").disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLButtonElement>(panel, "[data-session-register-passkey='true']").disabled,
    ).toBe(true);
  });

  it("disables every ceremony control while one is in flight", () => {
    const panel = mountPanel({ ...passkeySignedOut, busy: true });

    expect(
      requireElement<HTMLButtonElement>(panel, "[data-session-passkey-sign-in='true']").disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLButtonElement>(panel, "[data-session-register-passkey='true']").disabled,
    ).toBe(true);
  });

  it("offers a create-an-account route only where the authority permits self-service", () => {
    const permitted = mountPanel({ ...passkeySignedOut, selfServiceRegistration: true });
    expect(permitted.querySelector("[data-session-self-register='true']")).not.toBeNull();
    // The invitation route stays exactly where it was: joining somebody else's
    // group and recovering a lost device are different intents and are not
    // replaced by this.
    expect(permitted.querySelector("[data-session-passkey-form='true']")).not.toBeNull();
    expect(permitted.querySelector("[data-session-passkey-invite='true']")).not.toBeNull();

    const refused = mountPanel(passkeySignedOut);
    expect(refused.querySelector("[data-session-self-register='true']")).toBeNull();
    expect(refused.querySelector("[data-session-passkey-sign-in='true']")).not.toBeNull();
    expect(refused.querySelector("[data-session-passkey-form='true']")).not.toBeNull();
  });

  it("dispatches a self-registration with no invite token key at all", () => {
    const events = captureEvents<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT);
    const panel = mountPanel({ ...passkeySignedOut, selfServiceRegistration: true });

    requireElement<HTMLButtonElement>(panel, "[data-session-self-register='true']").click();

    expect(events).toHaveLength(1);
    // Not merely `undefined`: the detail must carry no `inviteToken` key, so
    // nothing downstream can serialise one as `null`.
    expect(events[0]?.detail).toEqual({});
    expect(Object.keys(events[0]?.detail ?? {})).toEqual([]);
  });

  it("disables the create-an-account control on the same terms as sign-in", () => {
    for (const session of [
      { ...passkeySignedOut, selfServiceRegistration: true, busy: true },
      { ...passkeySignedOut, selfServiceRegistration: true, passkeySupported: false },
    ]) {
      const panel = mountPanel(session);
      expect(
        requireElement<HTMLButtonElement>(panel, "[data-session-self-register='true']").disabled,
      ).toBe(true);
    }
  });

  /*
   * The single most likely defect in this surface. `sessionEquals` is a pure
   * short circuit ahead of `render()`, and the readiness probe answers after
   * the panel has already rendered once from the fail-closed default. Omit the
   * field from that comparison and the control never appears at all, with
   * nothing thrown and nothing logged.
   */
  it("re-renders when a session differs only in whether self-service is permitted", () => {
    const panel = mountPanel(passkeySignedOut);
    expect(panel.querySelector("[data-session-self-register='true']")).toBeNull();

    panel.session = { ...passkeySignedOut, selfServiceRegistration: true };

    expect(panel.querySelector("[data-session-self-register='true']")).not.toBeNull();
  });

  it("explains where an invitation token comes from, in both states", () => {
    for (const selfServiceRegistration of [true, false]) {
      const panel = mountPanel({ ...passkeySignedOut, selfServiceRegistration });
      // The old copy named no source for a token at all, which left the only
      // way in undocumented on the surface that exists to explain it.
      expect(panel.textContent).toContain("Someone already using this app can send you");
      expect(panel.textContent).toContain("Join with an invitation");
    }
  });

  it("shows the confirmation a completed ceremony produced", () => {
    const panel = mountPanel({
      ...passkeySignedIn,
      notice: "This device is registered and your existing access was restored.",
    });

    const notice = requireElement<HTMLElement>(panel, "[data-session-notice='true']");
    expect(notice.textContent).toContain("existing access was restored");
  });
});

describe("browser WebAuthn encoding", () => {
  it("round-trips base64url without padding or URL-unsafe characters", () => {
    const bytes = new Uint8Array([0, 1, 62, 63, 250, 255, 128, 7]);
    const encoded = bufferToBase64Url(bytes.buffer);

    expect(encoded).not.toMatch(/[+/=]/u);
    expect(new Uint8Array(base64UrlToBuffer(encoded))).toEqual(bytes);
  });

  it("converts the authority's options into the binary fields the platform expects", () => {
    // happy-dom has no `PublicKeyCredential`, so this exercises the fallback
    // path — which is exactly the path a browser without the newer JSON parse
    // helpers takes, and it must produce the same structure.
    const parsed = parseCreationOptions({
      challenge: "AQID",
      rp: { id: "app.test", name: "App" },
      user: { id: "BAUG", name: "member", displayName: "member" },
      excludeCredentials: [{ id: "BwgJ", type: "public-key" }],
    });

    expect(new Uint8Array(parsed.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    const user = parsed.user as { id: ArrayBuffer };
    expect(new Uint8Array(user.id)).toEqual(new Uint8Array([4, 5, 6]));
    const excluded = parsed.excludeCredentials as { id: ArrayBuffer }[];
    expect(new Uint8Array(excluded[0]!.id)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("converts assertion options the same way", () => {
    const parsed = parseRequestOptions({
      challenge: "AQID",
      allowCredentials: [{ id: "BwgJ", type: "public-key" }],
    });

    expect(new Uint8Array(parsed.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    const allowed = parsed.allowCredentials as { id: ArrayBuffer }[];
    expect(new Uint8Array(allowed[0]!.id)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("refuses malformed options rather than sending nonsense to the authenticator", () => {
    expect(() => parseCreationOptions({ challenge: 42 })).toThrow();
  });
});

function mountPanel(session: AdlSessionState): AdlSessionPanelElement {
  const panel = document.createElement("adl-session-panel") as AdlSessionPanelElement;
  document.body.append(panel);
  panel.online = true;
  panel.session = session;
  return panel;
}

function captureEvents<TDetail = null>(eventName: string): CustomEvent<TDetail>[] {
  const events: CustomEvent<TDetail>[] = [];
  document.addEventListener(eventName, (event) => {
    events.push(event as CustomEvent<TDetail>);
  });
  return events;
}

function requireElement<TElement extends Element>(root: ParentNode, selector: string): TElement {
  const element = root.querySelector<TElement>(selector);
  if (element === null) {
    throw new Error(`Expected to find '${selector}'.`);
  }

  return element;
}
