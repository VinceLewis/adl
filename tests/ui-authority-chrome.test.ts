// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  resolveApplicationModel,
} from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type {
  AdlAuthorityBridge,
  AdlInviteState,
  AdlSessionState,
} from "../src/ui/authority-bridge.js";
import type { SyncRecoveryChoice, SyncRecoveryItem } from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

/**
 * The shell's half of Phase 47. Two rules matter most here: a browser with no
 * authority configured must show no session or recovery chrome at all (this is
 * the `npm run dev` and Playwright visual state), and every user action must
 * travel to the bridge rather than being decided in the component.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "AuthorityChromeFixture", startView: "GigList" },
  roles: [{ name: "Admin" }],
  shell: {
    controls: [{ name: "signOut", kind: "logout", label: "Sign out", placement: "topBar" }],
    topBar: { controls: ["signOut"] },
  },
  objects: [
    {
      name: "Gig",
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "GigList", kind: "list", fields: ["Title"] }],
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel);
const adminContext: RuntimeContext = { userId: "user-42", roles: ["Admin"], channel: "ui" };

function recoveryItem(overrides: Partial<SyncRecoveryItem> = {}): SyncRecoveryItem {
  return {
    queueId: "sync-op-1",
    opId: "op-1",
    objectName: "Gig",
    recordId: "gig-1",
    operation: "update",
    status: "manualResolution",
    code: "ADL_SYNC_MANUAL_RESOLUTION",
    message: "This record must be resolved by a person.",
    recordedAt: "2026-07-30T00:00:00.000Z",
    requiresUserChoice: true,
    choices: ["keepServer", "resubmitMine"],
    ...overrides,
  };
}

function signedOutState(): AdlSessionState {
  return {
    status: "signedOut",
    developmentMode: true,
    identityMode: "bypass",
    passkeySupported: true,
    busy: false,
  };
}

/** Records every call so the shell's dispatch can be asserted without a network. */
class FakeAuthorityBridge implements AdlAuthorityBridge {
  session: AdlSessionState = signedOutState();
  invite: AdlInviteState = { status: "idle" };
  recovery: SyncRecoveryItem[] = [];
  readonly calls: string[] = [];

  async signIn(accountProof: string): Promise<void> {
    this.calls.push(`signIn:${accountProof}`);
    this.session = { ...this.session, status: "signedIn", userId: "user-42" };
  }
  async registerPasskey(inviteToken?: string): Promise<void> {
    this.calls.push(`registerPasskey:${inviteToken ?? ""}`);
    this.session = { ...this.session, status: "signedIn", userId: "user-42" };
  }
  async signInWithPasskey(): Promise<void> {
    this.calls.push("signInWithPasskey");
    this.session = { ...this.session, status: "signedIn", userId: "user-42" };
  }
  async signOut(): Promise<void> {
    this.calls.push("signOut");
    this.session = { ...signedOutState(), identityMode: this.session.identityMode };
  }
  async claimInvite(inviteToken: string): Promise<void> {
    this.calls.push(`claimInvite:${inviteToken}`);
  }
  async resolveRecovery(queueId: string, choice: SyncRecoveryChoice): Promise<void> {
    this.calls.push(`resolveRecovery:${queueId}:${choice}`);
    this.recovery = this.recovery.filter((item) => item.queueId !== queueId);
  }
}

describe("browser authority chrome", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
  });

  it("renders no session, invite or recovery chrome when no authority is configured", async () => {
    const app = await mountApp();

    expect(app.querySelector("[data-authority-chrome]")).toBeNull();
    expect(app.querySelector("adl-session-panel")).toBeNull();
    expect(app.querySelector("adl-sync-recovery")).toBeNull();
    // A `logout` control with no session behind it stays visibly unavailable.
    const control = requireElement<HTMLButtonElement>(app, "[data-shell-control-kind='logout']");
    expect(control.disabled).toBe(true);
  });

  it("shows a sign-in surface labelled as development mode when the bypass is on", async () => {
    const bridge = new FakeAuthorityBridge();
    const app = await mountApp(bridge);

    const panel = requireElement<HTMLElement>(app, "adl-session-panel");
    expect(panel.querySelector("[data-session-sign-in-form]")).not.toBeNull();
    expect(panel.querySelector("[data-session-development-warning]")).not.toBeNull();
    // Signed out, there is no session for the shell's logout control to end.
    expect(
      requireElement<HTMLButtonElement>(app, "[data-shell-control-kind='logout']").disabled,
    ).toBe(true);
  });

  it("routes a sign-in through the bridge and then enables the shell sign-out control", async () => {
    const bridge = new FakeAuthorityBridge();
    const app = await mountApp(bridge);

    const input = requireElement<HTMLInputElement>(app, "[data-session-account-proof]");
    input.value = "development-subject-01";
    requireElement<HTMLFormElement>(app, "[data-session-sign-in-form]").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flushUi();

    expect(bridge.calls).toEqual(["signIn:development-subject-01"]);
    const control = requireElement<HTMLButtonElement>(app, "[data-shell-control-kind='logout']");
    expect(control.disabled).toBe(false);

    control.click();
    await flushUi();
    expect(bridge.calls).toEqual(["signIn:development-subject-01", "signOut"]);
  });

  it("refuses an invite claim while offline instead of queuing it", async () => {
    const bridge = new FakeAuthorityBridge();
    bridge.session = {
      status: "signedIn",
      userId: "user-42",
      developmentMode: false,
      identityMode: "bypass",
      passkeySupported: true,
      busy: false,
    };
    const app = await mountApp(bridge, { ...adminContext, online: false });

    const claim = requireElement<HTMLButtonElement>(app, "[data-session-claim-invite]");
    expect(claim.disabled).toBe(true);
    claim.click();
    await flushUi();

    expect(bridge.calls).toEqual([]);
  });

  it("claims an invitation through the bridge when online", async () => {
    const bridge = new FakeAuthorityBridge();
    bridge.session = {
      status: "signedIn",
      userId: "user-42",
      developmentMode: false,
      identityMode: "bypass",
      passkeySupported: true,
      busy: false,
    };
    const app = await mountApp(bridge, { ...adminContext, online: true });

    requireElement<HTMLInputElement>(app, "[data-session-invite-token]").value =
      "invite-token-that-is-long-enough-to-send";
    requireElement<HTMLFormElement>(app, "[data-session-invite-form]").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flushUi();

    expect(bridge.calls).toEqual(["claimInvite:invite-token-that-is-long-enough-to-send"]);
  });

  it("shows a manual conflict and resolves it through the bridge", async () => {
    const bridge = new FakeAuthorityBridge();
    bridge.session = {
      status: "signedIn",
      userId: "user-42",
      developmentMode: false,
      identityMode: "bypass",
      passkeySupported: true,
      busy: false,
    };
    bridge.recovery = [recoveryItem({ strategy: "manual" })];
    const app = await mountApp(bridge);

    const recovery = requireElement<HTMLElement>(app, "adl-sync-recovery");
    expect(recovery.textContent).toContain("This record must be resolved by a person.");
    // Only the recovery item's own fields are on screen; no record values leak.
    expect(recovery.textContent).not.toContain("Title");

    requireElement<HTMLButtonElement>(recovery, "[data-recovery-choice='resubmitMine']").click();
    await flushUi();

    expect(bridge.calls).toEqual(["resolveRecovery:sync-op-1:resubmitMine"]);
    // Resolved entries leave the surface once the bridge reports them gone.
    expect(requireElement<HTMLElement>(app, "adl-sync-recovery").innerHTML).toBe("");
  });

  it("offers a rejected write a dismissal only, never a resubmission", async () => {
    const bridge = new FakeAuthorityBridge();
    bridge.session = {
      status: "signedIn",
      userId: "user-42",
      developmentMode: false,
      identityMode: "bypass",
      passkeySupported: true,
      busy: false,
    };
    bridge.recovery = [
      recoveryItem({
        status: "rejected",
        code: "ADL_POLICY_DENIED",
        message: "The authority refused this write.",
        requiresUserChoice: false,
        choices: ["keepServer"],
      }),
    ];
    const app = await mountApp(bridge);

    const recovery = requireElement<HTMLElement>(app, "adl-sync-recovery");
    expect(recovery.textContent).toContain("ADL_POLICY_DENIED");
    expect(recovery.querySelector("[data-recovery-choice='resubmitMine']")).toBeNull();
    expect(recovery.querySelector("[data-recovery-choice='keepServer']")).not.toBeNull();
  });
});

async function mountApp(
  authority?: AdlAuthorityBridge,
  context: RuntimeContext = adminContext,
): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = model;
  app.runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
  app.context = context;
  if (authority !== undefined) {
    app.authority = authority;
  }
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected to find '${selector}'.`);
  }

  return element;
}
