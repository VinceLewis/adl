// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ADL_CLAIM_INVITE_EVENT,
  ADL_SIGN_IN_EVENT,
  ADL_SIGN_OUT_EVENT,
  AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH,
  AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH,
  type AdlInviteState,
  type AdlSessionState,
  type ClaimInviteDetail,
  type SignInDetail,
} from "../src/ui/authority-bridge.js";
import {
  AdlSessionPanelElement,
  defineAdlSessionPanel,
} from "../src/ui/components/adl-session-panel.js";

const ACCOUNT_PROOF = "development-account-proof-0001";
const INVITE_TOKEN = "invite-token-0123456789abcdef0123456789abcdef";

const signedOut: AdlSessionState = {
  status: "signedOut",
  developmentMode: false,
  identityMode: "bypass",
  passkeySupported: true,
  busy: false,
};

const signedIn: AdlSessionState = {
  status: "signedIn",
  userId: "user-9f3c",
  developmentMode: false,
  identityMode: "bypass",
  passkeySupported: true,
  busy: false,
};

describe("adl-session-panel", () => {
  beforeEach(() => {
    defineAdlSessionPanel();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  });

  it("renders the sign-in form when signed out", () => {
    const panel = mountPanel({ session: signedOut });

    expect(panel.querySelector("[data-session-sign-in-form='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-account-proof='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-sign-in='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-sign-out='true']")).toBeNull();
    expect(panel.querySelector("[data-session-invite-form='true']")).toBeNull();
    expect(panel.dataset.sessionStatus).toBe("signedOut");
  });

  it("renders the identity, sign-out and invite form when signed in", () => {
    const panel = mountPanel({ session: signedIn });

    const identity = requireElement<HTMLElement>(panel, "[data-session-identity='true']");
    expect(identity.textContent).toContain("Signed in as");
    expect(identity.textContent).toContain("user-9f3c");
    expect(panel.querySelector("[data-session-sign-out='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-invite-form='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-invite-token='true']")).not.toBeNull();
    expect(panel.querySelector("[data-session-sign-in-form='true']")).toBeNull();
  });

  it("renders a local-data note and no sign-in form when the authority is unavailable", () => {
    const panel = mountPanel({
      session: {
        status: "unavailable",
        developmentMode: false,
        identityMode: "bypass",
        passkeySupported: true,
        busy: false,
      },
    });

    const note = requireElement<HTMLElement>(panel, "[data-session-unavailable='true']");
    expect(note.textContent).toContain("could not be reached");
    expect(note.textContent).toContain("local data");
    expect(panel.querySelector("[data-session-sign-in-form='true']")).toBeNull();
    expect(panel.querySelector("[data-session-invite-form='true']")).toBeNull();
  });

  it("warns that a development sign-in is not a verified identity in both states", () => {
    const signedOutPanel = mountPanel({ session: { ...signedOut, developmentMode: true } });
    const signedOutWarning = requireElement<HTMLElement>(
      signedOutPanel,
      "[data-session-development-warning='true']",
    );
    expect(signedOutWarning.textContent).toContain("Development");
    expect(signedOutWarning.textContent).toContain("unverified account proof");
    expect(signedOutWarning.textContent).toContain("not a verified identity");

    const signedInPanel = mountPanel({ session: { ...signedIn, developmentMode: true } });
    const signedInWarning = requireElement<HTMLElement>(
      signedInPanel,
      "[data-session-development-warning='true']",
    );
    expect(signedInWarning.textContent).toContain("unverified account proof");
    expect(signedInWarning.textContent).toContain("not a verified identity");
  });

  it("renders no development warning when the authority verifies identity", () => {
    const signedOutPanel = mountPanel({ session: signedOut });
    const signedInPanel = mountPanel({ session: signedIn });

    expect(signedOutPanel.querySelector("[data-session-development-warning='true']")).toBeNull();
    expect(signedInPanel.querySelector("[data-session-development-warning='true']")).toBeNull();
    expect(signedOutPanel.textContent).not.toContain("Development mode");
    expect(signedInPanel.textContent).not.toContain("Development mode");
  });

  it("dispatches the typed account proof on sign-in and keeps it out of the DOM", () => {
    const panel = mountPanel({ session: signedOut });
    const events = captureEvents<SignInDetail>(ADL_SIGN_IN_EVENT);

    typeInto(panel, "[data-session-account-proof='true']", ACCOUNT_PROOF);
    requireElement<HTMLButtonElement>(panel, "[data-session-sign-in='true']").click();

    expect(events).toHaveLength(1);
    expect(events[0]?.detail.accountProof).toBe(ACCOUNT_PROOF);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);

    // The proof lives only in the live input value, which is cleared on submit.
    expect(panel.outerHTML).not.toContain(ACCOUNT_PROOF);
    expect(
      requireElement<HTMLInputElement>(panel, "[data-session-account-proof='true']").value,
    ).toBe("");
    expect(globalThis.localStorage.length).toBe(0);
    expect(globalThis.sessionStorage.length).toBe(0);
    expect(globalThis.location.search).toBe("");
  });

  it("dispatches nothing when the account proof is empty and hints instead", () => {
    const panel = mountPanel({ session: signedOut });
    const events = captureEvents<SignInDetail>(ADL_SIGN_IN_EVENT);

    requireElement<HTMLButtonElement>(panel, "[data-session-sign-in='true']").click();

    expect(events).toHaveLength(0);
    const hint = requireElement<HTMLElement>(panel, "[data-session-proof-hint='true']");
    expect(hint.hidden).toBe(false);
  });

  it("hints without enforcing when the account proof is shorter than the authority minimum", () => {
    const panel = mountPanel({ session: signedOut });
    const events = captureEvents<SignInDetail>(ADL_SIGN_IN_EVENT);
    const short = "x".repeat(AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH - 1);

    typeInto(panel, "[data-session-account-proof='true']", short);
    const hint = requireElement<HTMLElement>(panel, "[data-session-proof-hint='true']");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain(String(AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH));

    // The hint is advisory: the server stays authoritative, so the attempt is
    // still dispatched.
    requireElement<HTMLButtonElement>(panel, "[data-session-sign-in='true']").click();
    expect(events).toHaveLength(1);
    expect(events[0]?.detail.accountProof).toBe(short);

    typeInto(panel, "[data-session-account-proof='true']", ACCOUNT_PROOF);
    expect(requireElement<HTMLElement>(panel, "[data-session-proof-hint='true']").hidden).toBe(
      true,
    );
  });

  it("dispatches a bare sign-out event", () => {
    const panel = mountPanel({ session: signedIn });
    const events = captureEvents(ADL_SIGN_OUT_EVENT);

    requireElement<HTMLButtonElement>(panel, "[data-session-sign-out='true']").click();

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toBeNull();
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
  });

  it("dispatches the typed invitation token when online", () => {
    const panel = mountPanel({ session: signedIn, online: true });
    const events = captureEvents<ClaimInviteDetail>(ADL_CLAIM_INVITE_EVENT);

    typeInto(panel, "[data-session-invite-token='true']", INVITE_TOKEN);
    requireElement<HTMLButtonElement>(panel, "[data-session-claim-invite='true']").click();

    expect(events).toHaveLength(1);
    expect(events[0]?.detail.inviteToken).toBe(INVITE_TOKEN);
    expect(events[0]?.composed).toBe(true);
    expect(panel.outerHTML).not.toContain(INVITE_TOKEN);
  });

  it("hints when the invitation token is shorter than the authority minimum", () => {
    const panel = mountPanel({ session: signedIn });

    typeInto(
      panel,
      "[data-session-invite-token='true']",
      "y".repeat(AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH - 1),
    );

    const hint = requireElement<HTMLElement>(panel, "[data-session-invite-hint='true']");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain(String(AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH));
  });

  it("refuses an offline claim instead of queueing it", () => {
    const panel = mountPanel({ session: signedIn, online: false });
    const events = captureEvents<ClaimInviteDetail>(ADL_CLAIM_INVITE_EVENT);

    const claim = requireElement<HTMLButtonElement>(panel, "[data-session-claim-invite='true']");
    const token = requireElement<HTMLInputElement>(panel, "[data-session-invite-token='true']");
    expect(claim.disabled).toBe(true);
    expect(token.disabled).toBe(true);

    const note = requireElement<HTMLElement>(panel, "[data-session-offline-note='true']");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("needs a connection");
    expect(note.textContent).toContain("cannot be queued");

    token.value = INVITE_TOKEN;
    claim.click();
    // Even a forced submission of the form must not dispatch a claim offline.
    requireElement<HTMLFormElement>(panel, "[data-session-invite-form='true']").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    expect(events).toHaveLength(0);
  });

  it("re-enables the claim control when the connection returns, keeping the typed token", () => {
    const panel = mountPanel({ session: signedIn, online: false });
    const events = captureEvents<ClaimInviteDetail>(ADL_CLAIM_INVITE_EVENT);

    const token = requireElement<HTMLInputElement>(panel, "[data-session-invite-token='true']");
    token.value = INVITE_TOKEN;
    panel.online = true;

    expect(requireElement<HTMLElement>(panel, "[data-session-offline-note='true']").hidden).toBe(
      true,
    );
    expect(
      requireElement<HTMLInputElement>(panel, "[data-session-invite-token='true']").value,
    ).toBe(INVITE_TOKEN);

    requireElement<HTMLButtonElement>(panel, "[data-session-claim-invite='true']").click();
    expect(events).toHaveLength(1);
    expect(events[0]?.detail.inviteToken).toBe(INVITE_TOKEN);
  });

  it("renders each invite outcome and disables the control while claiming", () => {
    const claiming = mountPanel({ session: signedIn, invite: { status: "claiming" } });
    expect(
      requireElement<HTMLButtonElement>(claiming, "[data-session-claim-invite='true']").disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLElement>(claiming, "[data-invite-status='claiming']").textContent,
    ).toContain("Claiming");

    const accepted = mountPanel({ session: signedIn, invite: { status: "accepted" } });
    expect(
      requireElement<HTMLElement>(accepted, "[data-invite-status='accepted']").textContent,
    ).toContain("accepted");

    const rejected = mountPanel({
      session: signedIn,
      invite: { status: "rejected", message: "That invitation has already been used." },
    });
    expect(
      requireElement<HTMLElement>(rejected, "[data-invite-status='rejected']").textContent,
    ).toContain("That invitation has already been used.");

    const offline = mountPanel({
      session: signedIn,
      online: false,
      invite: { status: "offline", message: "The claim was refused: no connection." },
    });
    expect(
      requireElement<HTMLElement>(offline, "[data-invite-status='offline']").textContent,
    ).toContain("The claim was refused: no connection.");
  });

  it("disables every control while the session is busy", () => {
    const busySignedOut = mountPanel({ session: { ...signedOut, busy: true } });
    expect(
      requireElement<HTMLInputElement>(busySignedOut, "[data-session-account-proof='true']")
        .disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLButtonElement>(busySignedOut, "[data-session-sign-in='true']").disabled,
    ).toBe(true);

    const busySignedIn = mountPanel({ session: { ...signedIn, busy: true } });
    expect(
      requireElement<HTMLButtonElement>(busySignedIn, "[data-session-sign-out='true']").disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLButtonElement>(busySignedIn, "[data-session-claim-invite='true']")
        .disabled,
    ).toBe(true);
    expect(
      requireElement<HTMLInputElement>(busySignedIn, "[data-session-invite-token='true']").disabled,
    ).toBe(true);

    const signOutEvents = captureEvents(ADL_SIGN_OUT_EVENT);
    requireElement<HTMLButtonElement>(busySignedIn, "[data-session-sign-out='true']").click();
    expect(signOutEvents).toHaveLength(0);
  });

  it("renders a credential-free error line", () => {
    const panel = mountPanel({
      session: { ...signedOut, error: "The authority rejected that account proof." },
    });

    const error = requireElement<HTMLElement>(panel, "[data-session-error='true']");
    expect(error.textContent).toContain("The authority rejected that account proof.");
    expect(error.getAttribute("role")).toBe("alert");
  });

  it("escapes server-derived text rather than rendering it as markup", () => {
    const panel = mountPanel({
      session: {
        status: "signedIn",
        userId: "<img src=x onerror=alert(1)>",
        developmentMode: false,
        identityMode: "bypass",
        passkeySupported: true,
        busy: false,
        error: "<script>alert(2)</script>",
      },
      invite: { status: "rejected", message: "<b>bad</b>" },
    });

    expect(panel.querySelector("img")).toBeNull();
    expect(panel.querySelector("script")).toBeNull();
    expect(panel.querySelector("[data-invite-status='rejected'] b")).toBeNull();
    expect(panel.innerHTML).toContain("&lt;script&gt;");
  });
});

interface PanelOptions {
  session: AdlSessionState;
  invite?: AdlInviteState;
  online?: boolean;
}

function mountPanel(options: PanelOptions): AdlSessionPanelElement {
  const panel = document.createElement("adl-session-panel");
  if (!(panel instanceof AdlSessionPanelElement)) {
    throw new Error("adl-session-panel is not registered.");
  }

  document.body.append(panel);
  panel.online = options.online ?? true;
  panel.invite = options.invite ?? { status: "idle" };
  panel.session = options.session;
  return panel;
}

function typeInto(root: ParentNode, selector: string, value: string): void {
  const input = requireElement<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
