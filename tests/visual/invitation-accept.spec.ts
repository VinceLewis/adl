import { expect, test } from "./support/evidence.js";
import { type Page } from "@playwright/test";
import { allowSignedOutStartup } from "./support/authority-allowances.js";
import { expectAbsentWithin } from "./support/expect-absence.js";
import { readAllPersistedRecords } from "./support/persisted-upgrade.js";
import {
  INVITATION_APP_ORIGIN,
  INVITATION_AUTHORITY_PORT,
  INVITEE_ACCOUNT_PROOF,
  startInvitationAuthority,
  type InvitationAuthorityHarness,
} from "./invitation-authority.js";

/**
 * An invited person, against a real authority, in a real browser.
 *
 * Phase 107's inventory run found that Phase 105's defect was not reachable from
 * this suite at all — no spec drove Jointly Care against an authority, so no
 * request was made and the gates had nothing to look at. This project is the
 * answer to that, and the answer turned out to be worth having: driving it
 * produced two facts that no hermetic test and no DOM assertion had shown.
 *
 * What the unit suite proves (`tests/ui-invitee-accept.test.ts`) is that a real
 * `<adl-app>` render of the unmodified Jointly Care model now lets an invitee
 * click `Accept` and commits both records **locally**. What this spec measures is
 * that the same person, on a device talking to a real server, does not get that
 * far — and exactly where they stop.
 */

let authority: InvitationAuthorityHarness;

test.beforeAll(async () => {
  authority = await startInvitationAuthority();
});
test.afterAll(async () => {
  await authority?.close();
});

/**
 * The invitation reaches the device. The circle does not, and that is what stops
 * the screen working.
 *
 * `AuthorityService.bootstrap` selects candidates by **read policy**, and no
 * policy in Jointly Care lets a pending invitee read the `Circle` record itself
 * — `allowCircleMemberReadCircle` wants a role they have not got, and no
 * vocabulary expresses "may read because a grant admits me here"
 * (`MyPendingCircleInvites`'s own comment in `domain.adlj` says so).
 *
 * `RuntimeContextService.mergeGrantedContexts` then reads the context's own root
 * record before it will report the instance as available, and returns nothing
 * when it is absent. So the grant resolves against a record that never arrived,
 * `listAvailableContexts` is empty, and the `CONTEXT ALL` view falls to the
 * shell's context-level empty state before it ever reaches its list.
 */
test("delivers the invitation to a member of nothing, and no circle to open it in", async ({
  page,
  evidence,
}, testInfo) => {
  allowSignedOutStartup(evidence);
  await signIn(page);

  // The positive half: the bootstrap really ran and really carried the
  // invitation. Without this, everything below would be satisfied by a device
  // that received nothing at all.
  const persisted = await readAllPersistedRecords(page, "adl-jointly-care-example");
  const byObject = persisted.map((entry) => entry.object);
  expect(byObject).toEqual(["CircleInvite"]);
  expect((persisted[0]?.record as { values: Record<string, unknown> }).values).toMatchObject({
    Invitee: authority.inviteeUserId,
    InviteeEmail: authority.inviteeEmail,
    Status: "pending",
  });

  // The negative half, and the cause: the circle the invitation is *to* is not
  // here, so the grant has no instance to make available.
  expect(byObject).not.toContain("Circle");
  expect(byObject).not.toContain("CircleMember");
  expect(
    await page.evaluate(async () => {
      const app = document.querySelector("adl-app") as unknown as {
        runtime: { listAvailableContexts(name: string, c: unknown): Promise<unknown[]> };
        context: unknown;
      };
      return app.runtime.listAvailableContexts("Circle", app.context);
    }),
  ).toEqual([]);

  await navigateTo(page, "MyPendingInvites");
  const shell = page.locator("main.adl-shell");
  await expect(shell).toContainText("No Circle contexts are available for this view.");
  await expectAbsentWithin({
    within: shell,
    present: page.locator("[data-empty-state='true']"),
    absent: page.locator("button[data-presentation-action='true']"),
    because:
      "the invitee's circle never reached this device, so the grant makes no context available and the invite list is never reached — there is no row to accept",
  });
  await expect(shell).not.toContainText(authority.inviteeEmail);

  await page.screenshot({
    path: testInfo.outputPath("invitee-no-context.png"),
    fullPage: true,
  });
  // The surface on its own as well as the page. A full-page shot of an
  // authority-configured demo is dominated by session and administration
  // chrome, and what a reviewer needs to see here is the one region this test
  // is about.
  await page
    .locator("[data-empty-state='true']")
    .screenshot({ path: testInfo.outputPath("invitee-empty-state.png") });
});

/**
 * And the intent that screen would send is refused by the server anyway.
 *
 * This is the assertion a DOM check cannot reach. `operation-log.ts` records the
 * context an operation was made under; a `CONTEXT ALL` screen holds no selection,
 * so `toIntent` (`src/server/sync-client.ts`) sends `selectedContexts: {}`, and
 * `AuthorityService.resolveContext` deliberately keeps a narrow resolution for a
 * replay — it iterates the intent's own selection and nothing else. The result
 * is a write the browser reports as done and the server never performed.
 *
 * Driven through `page.request`, which shares the page context's cookie jar, so
 * this reaches the server as the **same principal** the app is signed in as
 * rather than as a fresh anonymous caller.
 */
test("refuses the accept a cross-context screen would send, and writes nothing", async ({
  page,
  evidence,
}) => {
  allowSignedOutStartup(evidence);
  await signIn(page);

  expect(await authority.readInviteStatus()).toBe("pending");

  const csrf = await page.evaluate(
    () =>
      document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("__Host-adl_csrf="))
        ?.slice("__Host-adl_csrf=".length) ?? "",
  );
  expect(
    csrf,
    "no CSRF cookie, so the request below would be refused for the wrong reason",
  ).not.toBe("");

  const replay = async (selectedContexts: Record<string, string>) =>
    page.request.post(`http://localhost:${INVITATION_AUTHORITY_PORT}/v1/sync/replay`, {
      headers: {
        "content-type": "application/json",
        "x-adl-csrf-token": csrf,
        origin: INVITATION_APP_ORIGIN,
        "x-forwarded-proto": "https",
      },
      data: {
        operationId: `accept-${Math.random().toString(36).slice(2)}`,
        kind: "command",
        commandName: "AcceptCircleInvite",
        input: { Invite: authority.inviteRecordId },
        recordIds: [
          {
            step: "createMembership",
            objectName: "CircleMember",
            recordId: "circlemember-from-browser",
          },
        ],
        selectedContexts,
      },
    });

  // Exactly what a `CONTEXT ALL` screen queues: no selection.
  const refused = await replay({});
  // Answered `200 OK` with a rejected outcome in the body, which is why this
  // defect is invisible to every HTTP-shaped check: the transport succeeded and
  // the write did not. The message is asserted, not just the code — a rejection
  // for some unrelated reason (a bad CSRF token is `403`, an expired session
  // `401`) must not pass as the one under test.
  expect(refused.status()).toBe(200);
  expect(await refused.json()).toMatchObject({
    status: "rejected",
    code: "ADL_POLICY_DENIED",
    message: "Policy denied update on object 'CircleInvite' outside its runtime context scope.",
  });

  /*
   * `expectAuthorityDenied` is deliberately **not** used here, and that is a
   * finding rather than an omission.
   *
   * Measured: the authority's security log records nothing for this refusal. A
   * replay whose *outcome* is `rejected` is logged as `http_request` /
   * `allowed` / `200`, because the log's `denied` events cover transport-level
   * rejections (`authority_request_rejected` — unauthenticated, bad origin, rate
   * limited) and not a policy verdict inside an accepted request. So the one
   * helper built for exactly this shape cannot see the shape, and the strongest
   * available statement of the server's verdict is the two below: the outcome it
   * returned, and the records it did not write.
   */

  // Nothing moved. A rejection response with a committed write is the failure
  // mode worth the extra assertion.
  expect(await authority.readInviteStatus()).toBe("pending");
  expect(await authority.inviteeIsMember()).toBe(false);

  // The control that makes this a statement about the missing selection rather
  // than about the caller: the identical intent, from the identical browser
  // session, naming the circle, is accepted and does write both records.
  const accepted = await replay({ Circle: authority.circleId });
  expect(await accepted.json()).toMatchObject({ status: "accepted" });
  expect(await authority.readInviteStatus()).toBe("accepted");
  expect(await authority.inviteeIsMember()).toBe(true);
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/?demo=jointly-care");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut", { timeout: 20_000 });
  await panel.locator("[data-session-account-proof='true']").fill(INVITEE_ACCOUNT_PROOF);
  await panel.locator("[data-session-sign-in='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
}

async function navigateTo(page: Page, navItem: string): Promise<void> {
  const menuButton = page.locator("button[data-shell-menu='true']");
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const item = page.locator(`button[data-nav-item='${navItem}']`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator(".adl-nav-drawer")).not.toHaveClass(/active/);
}
