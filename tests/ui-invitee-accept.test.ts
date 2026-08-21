// @vitest-environment happy-dom

/**
 * The shell's cross-context (`CONTEXT ALL`) runtime context, and the invitee
 * affordance that depends on it (Phase 105).
 *
 * Two runtime paths answer the same question — "which context instances can
 * this caller reach, now that the selection has been dropped?" —
 * `ReadModelService.resolveExecutionContext` and the browser shell's
 * `resolveActiveViewContext`. The read path resolved roles *and* grants; the
 * shell resolved roles only. So a `CONTEXT ALL` screen rendered a row reached
 * through a `CONTEXT_GRANT` and then refused every command run against it,
 * which is exactly what Jointly Care's shipped `Accept` button did.
 *
 * These cases are the backfill the fix was owed: the `mode === "all"` branch
 * had no direct test in either direction before this file, and no browser test
 * clicked an invite action in either reference application.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PolicyDeniedError } from "../src/index.js";
import type { RuntimeContext, StoredObjectRecord } from "../src/index.js";
import {
  bandReferenceSystemContext,
  contextForBand,
  createBandReferenceRuntime,
  seedBandReferenceRuntime,
} from "../src/reference/band-app.js";
import {
  contextForCircle,
  createJointlyReferenceRuntime,
  jointlyReferenceSystemContext,
  seedJointlyReferenceRuntime,
} from "../src/reference/jointly-app.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";

describe("shell CONTEXT ALL runtime context (Pair A)", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  /**
   * A+ `expectContextAllViewContextCarriesGrants`.
   *
   * Observed on the context the shell actually hands the runtime, captured off
   * a real `runtime.search` call made by a real `<adl-app>` render — not on a
   * private field. `BandDirectory` is `CONTEXT ALL Band` and predates this
   * phase, so this pins the shell branch itself rather than the view Part 2
   * adds.
   */
  it("expectContextAllViewContextCarriesGrants", async () => {
    const seeded = await seedGiggleBandWithPendingInvitation();
    const capture = captureSearchContexts(seeded.runtime);

    const app = await mountApp(seeded.model, seeded.runtime, seeded.inviteeContext);
    await navigateTo(app, "BandDirectory");

    const bandSearch = capture.calls.find((call) => call.objectName === "Band");
    expect(bandSearch).toBeDefined();
    expect(bandSearch?.context.contextGrants).toEqual([
      {
        context: "Band",
        contextId: seeded.secondBand.meta.guid,
        grant: "pendingBandInvitation",
        grantRecordId: seeded.pendingInvitation.meta.guid,
      },
    ]);

    // And the grant is *effective*, not merely present: the invitation is
    // scoped to the very band the invitee has not joined, so a read that comes
    // back at all is a read that cleared the object-scope gate through this
    // grant and then matched `allowInviteeReadOwnInvitation`.
    const invitation = await seeded.runtime.read(
      "BandInvitation",
      seeded.pendingInvitation.meta.guid,
      requireContext(bandSearch?.context),
    );
    expect(invitation?.values.Status).toBe("Pending");
    expect(invitation?.values.Band).toBe(seeded.secondBand.meta.guid);
  });

  /**
   * A− `expectContextAllViewContextCarriesNoRoles`.
   *
   * The half that keeps A+ from meaning "grant everything". A grant widens the
   * object-scope gate and confers no role, so the shell's `CONTEXT ALL` context
   * must still fail a `ROLE BandAdmin`-gated command.
   *
   * Deliberately silent about *which* layer refuses it. Before the fix that is
   * the object-scope gate (`BandInvitationContextScope`); after it, the policy
   * engine's default deny. Pinning the layer here would make this half red
   * under the "remove the grant resolution" mutation, where it must stay green
   * — the fact it exists to hold is that a grant confers no role, and removing
   * grants entirely does not confer one either. A+ is where the grant being
   * *effective* is asserted.
   */
  it("expectContextAllViewContextCarriesNoRoles", async () => {
    const seeded = await seedGiggleBandWithPendingInvitation();
    const capture = captureSearchContexts(seeded.runtime);

    const app = await mountApp(seeded.model, seeded.runtime, seeded.inviteeContext);
    await navigateTo(app, "BandDirectory");

    const shellContext = capture.calls.find((call) => call.objectName === "Band")?.context;
    expect(shellContext?.contextRoles).toEqual([]);

    const refusal = await expectPolicyDenied(
      seeded.runtime.executeCommand(
        "RevokeBandInvitation",
        { Invitation: seeded.pendingInvitation.meta.guid },
        requireContext(shellContext),
      ),
    );
    expect(refusal.message).toContain("Policy denied update on object 'BandInvitation'");
    expect(refusal.decision.effect).toBe("deny");
    expect(refusal.decision.reasons.every((reason) => reason.effect === "deny")).toBe(true);
    expect(refusal.decision.reasons.length).toBeGreaterThan(0);

    // Nothing was written: a refusal that committed would be the failure mode
    // this half exists to catch.
    const unchanged = await seeded.runtime.read(
      "BandInvitation",
      seeded.pendingInvitation.meta.guid,
      contextForBand(bandReferenceSystemContext, seeded.secondBand.meta.guid),
    );
    expect(unchanged?.values.Status).toBe("Pending");
  });
});

describe("Jointly Care's invitee Accept button, from the browser (Pair B)", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  /**
   * B+ `expectInviteeAcceptCommitsFromTheBrowser`.
   *
   * The **unmodified** Jointly Care model. Part 1's proof is that this passes
   * with no `.adlj` edit at all — that is what distinguishes a platform fix
   * from a Giggle-Band-shaped workaround.
   *
   * The state is read back through a `SystemAdmin` context rather than out of
   * the success banner, because a banner is a claim about a write and not the
   * write.
   */
  it("expectInviteeAcceptCommitsFromTheBrowser", async () => {
    const seeded = await seedJointlyReferenceRuntime(await createJointlyReferenceRuntime());
    const app = await mountApp(seeded.model, seeded.runtime, seeded.inviteeContext);
    await navigateTo(app, "MyPendingInvites");

    expect(app.textContent).toContain("alex@example.com");
    presentationAction(app, "accept").click();
    await settleUi(app);

    expect(app.textContent).toContain("Accept invite completed.");

    const circleSystemContext = contextForCircle(
      jointlyReferenceSystemContext,
      seeded.firstCircle.meta.guid,
    );
    const invite = await seeded.runtime.read(
      "CircleInvite",
      seeded.pendingInvite.meta.guid,
      circleSystemContext,
    );
    expect(invite?.values.Status).toBe("accepted");
    expect(invite?.values.RespondedAt).toEqual(expect.any(String));

    const members = await seeded.runtime.search("CircleMember", {}, circleSystemContext);
    expect(
      members.some(
        (member) =>
          member.values.User === seeded.invitee.meta.guid &&
          member.values.Circle === seeded.firstCircle.meta.guid,
      ),
    ).toBe(true);
  });

  /**
   * B− `expectNonInviteeSeesNoAcceptOnSomeoneElsesInvite`.
   *
   * Two non-invitees, because they are stopped by two different mechanisms and
   * only one of them is the row action's own `WHEN`:
   *
   * - the circle **owner** may read every invite their circle sent, so the row
   *   renders for them — and carries no `Accept`/`Decline`, because
   *   `WHEN Invitee == RUNTIME.userId` is false;
   * - the **co-carer** is a plain `CircleMember`, so row-level read shaping
   *   drops the row entirely before any action is evaluated.
   *
   * Both are asserted against a present anchor (the section heading, and for
   * the owner the row's own text), never against an empty screen: an assertion
   * that "Accept" is absent passes just as well when the whole view failed to
   * render.
   */
  it("expectNonInviteeSeesNoAcceptOnSomeoneElsesInvite", async () => {
    const seeded = await seedJointlyReferenceRuntime(await createJointlyReferenceRuntime());

    const ownerApp = await mountApp(seeded.model, seeded.runtime, seeded.carerContext);
    await navigateTo(ownerApp, "MyPendingInvites");
    expect(ownerApp.textContent).toContain("Your pending invites");
    expect(ownerApp.textContent).toContain("alex@example.com");
    expect(ownerApp.textContent).not.toContain("Accept");
    expect(ownerApp.textContent).not.toContain("Decline");
    expect(presentationActions(ownerApp)).toEqual([]);

    document.body.innerHTML = "";

    const coCarerApp = await mountApp(seeded.model, seeded.runtime, seeded.coCarerContext);
    await navigateTo(coCarerApp, "MyPendingInvites");
    expect(coCarerApp.textContent).toContain("Your pending invites");
    expect(coCarerApp.textContent).toContain("No pending invites");
    expect(coCarerApp.textContent).not.toContain("alex@example.com");
    expect(presentationActions(coCarerApp)).toEqual([]);

    // And the command itself, from the owner's own fully-selected context, so
    // the refusal is the step guard rather than the object-scope gate.
    const refusal = await expectPolicyDenied(
      seeded.runtime.executeCommand(
        "AcceptCircleInvite",
        { Invite: seeded.pendingInvite.meta.guid },
        seeded.firstCircleContext,
      ),
    );
    expect(refusal.message).toBe("Command 'AcceptCircleInvite' step 'acceptInvite' was denied.");
    expect(refusal.decision.reasons).toEqual([
      {
        policyName: "Command:AcceptCircleInvite",
        ruleName: "acceptInvitePrecondition",
        effect: "deny",
        message: "Command 'AcceptCircleInvite' step 'acceptInvite' precondition failed.",
      },
    ]);

    const invite = await seeded.runtime.read(
      "CircleInvite",
      seeded.pendingInvite.meta.guid,
      contextForCircle(jointlyReferenceSystemContext, seeded.firstCircle.meta.guid),
    );
    expect(invite?.values.Status).toBe("pending");
    expect(invite?.values.RespondedAt).toBeUndefined();
  });
});

interface GiggleBandInviteeSeed {
  model: Awaited<ReturnType<typeof seedBandReferenceRuntime>>["model"];
  runtime: Awaited<ReturnType<typeof seedBandReferenceRuntime>>["runtime"];
  secondBand: StoredObjectRecord;
  pendingInvitation: StoredObjectRecord;
  inviteeContext: RuntimeContext;
}

/**
 * Riley, invited to The Betas and a member of nothing.
 *
 * The seed already gives Riley an *Accepted* invitation to The Alphas, which is
 * why only The Betas is reachable: `pendingBandInvitation` carries
 * `WHEN Status == 'Pending'`.
 */
async function seedGiggleBandWithPendingInvitation(): Promise<GiggleBandInviteeSeed> {
  const seeded = await seedBandReferenceRuntime(await createBandReferenceRuntime());
  const pendingInvitation = await seeded.runtime.create(
    "BandInvitation",
    {
      Band: seeded.secondBand.meta.guid,
      Inviter: seeded.musician.meta.guid,
      Invitee: seeded.guest.meta.guid,
      InviteeEmail: "riley@example.com",
      SentAt: "2026-07-07",
    },
    contextForBand(bandReferenceSystemContext, seeded.secondBand.meta.guid),
  );

  return {
    model: seeded.model,
    runtime: seeded.runtime,
    secondBand: seeded.secondBand,
    pendingInvitation,
    inviteeContext: {
      userId: seeded.guest.meta.guid,
      roles: [],
      channel: "api",
      ...(bandReferenceSystemContext.now === undefined
        ? {}
        : { now: bandReferenceSystemContext.now }),
    },
  };
}

interface CapturedSearch {
  objectName: string;
  context: RuntimeContext;
}

/**
 * Records the context the shell passes to `runtime.search`.
 *
 * That argument *is* `resolveActiveViewContext`'s output for a list view, so
 * this observes the branch under test through the runtime call it produces,
 * rather than reaching into a protected field.
 */
function captureSearchContexts(runtime: GiggleBandInviteeSeed["runtime"]): {
  calls: CapturedSearch[];
} {
  const calls: CapturedSearch[] = [];
  const original = runtime.search.bind(runtime);
  runtime.search = (async (
    objectName: string,
    query: Parameters<typeof original>[1],
    context: RuntimeContext,
  ) => {
    calls.push({ objectName, context: structuredClone(context) });
    return original(objectName, query, context);
  }) as typeof runtime.search;

  return { calls };
}

async function mountApp(
  model: GiggleBandInviteeSeed["model"],
  runtime: GiggleBandInviteeSeed["runtime"],
  context: RuntimeContext,
): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = model;
  app.runtime = runtime;
  app.context = { ...context, channel: "ui" };
  document.body.append(app);
  await app.whenReady();
  await settleUi(app);
  return app;
}

async function navigateTo(app: AdlAppElement, viewName: string): Promise<void> {
  requireElement<HTMLButtonElement>(app, "button[data-shell-menu='true']").click();
  requireElement<HTMLButtonElement>(app, `button[data-view-nav='${viewName}']`).click();
  await settleUi(app);
}

async function settleUi(app: AdlAppElement): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(app.isConnected).toBe(true);
}

function presentationActions(app: AdlAppElement): string[] {
  return [
    ...app.querySelectorAll<HTMLButtonElement>("button[data-presentation-action='true']"),
  ].map((button) => button.dataset.actionName ?? "");
}

function presentationAction(app: AdlAppElement, actionName: string): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(
    app,
    `button[data-presentation-action='true'][data-action-name='${actionName}']`,
  );
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}

function requireContext(context: RuntimeContext | undefined): RuntimeContext {
  if (context === undefined) {
    throw new Error("The shell never resolved a runtime context for the view.");
  }

  return context;
}

/**
 * Asserts a refusal happened *and* hands back its named reason.
 *
 * `rejects.toBeInstanceOf` alone would let a denial for entirely the wrong
 * reason pass, which in this codebase is the common case rather than the
 * exotic one — the scope gate and the policy engine both raise
 * `PolicyDeniedError`.
 */
async function expectPolicyDenied(work: Promise<unknown>): Promise<PolicyDeniedError> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyDeniedError);
    return error as PolicyDeniedError;
  }

  throw new Error("Expected a PolicyDeniedError, but the operation was permitted.");
}
