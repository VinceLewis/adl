// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ADL_EXPORT_REPORT_EVENT,
  ADL_LOAD_ADMINISTRATION_EVENT,
  ADL_LOAD_MORE_ADMINISTRATION_EVENT,
  ADL_LOAD_MORE_REPORT_EVENT,
  ADL_REVOKE_MEMBER_SESSIONS_EVENT,
  ADL_RUN_REPORT_EVENT,
  type AdlAdministrationState,
  type LoadMoreAdministrationDetail,
  type RevokeMemberSessionsDetail,
  type RunReportDetail,
} from "../src/ui/authority-bridge.js";
import {
  AdlAccessReviewElement,
  defineAdlAccessReview,
} from "../src/ui/components/adl-access-review.js";
import {
  AdlAuditReviewElement,
  defineAdlAuditReview,
} from "../src/ui/components/adl-audit-review.js";
import {
  AdlReportRunnerElement,
  defineAdlReportRunner,
} from "../src/ui/components/adl-report-runner.js";

/** Markup in a server message must arrive as text, never as an injected node. */
const INJECTION = "<img src=x onerror=alert(1)>Report refused";

describe("adl-report-runner", () => {
  beforeEach(() => {
    defineAdlReportRunner();
    document.body.innerHTML = "";
  });

  it("reflects the report status and offers the declared read models", () => {
    const element = mountReportRunner();
    element.reports = ["OpenOrders", "MemberRoster"];
    element.state = administrationState({ status: "loaded", reportStatus: "idle" });

    expect(element.getAttribute("data-report-status")).toBe("idle");
    expect(
      requireElement<HTMLElement>(element, "[data-report-status]").getAttribute(
        "data-report-status",
      ),
    ).toBe("idle");

    const select = requireElement<HTMLSelectElement>(element, "[data-report-select='true']");
    expect([...select.options].map((option) => option.value)).toEqual([
      "OpenOrders",
      "MemberRoster",
    ]);
    expect(element.querySelector("[data-report-run='true']")).not.toBeNull();
    expect(element.querySelector("[data-report-export='true']")).not.toBeNull();
  });

  it("renders an explanation and no controls when no report is declared", () => {
    const element = mountReportRunner();
    element.reports = [];
    element.state = administrationState({ status: "loaded" });

    expect(element.querySelector("[data-report-empty='true']")).not.toBeNull();
    expect(element.querySelector("[data-report-select='true']")).toBeNull();
    expect(element.querySelector("[data-report-run='true']")).toBeNull();
    expect(element.querySelector("[data-report-export='true']")).toBeNull();
  });

  it("dispatches run and export with the selected read-model name", () => {
    const element = mountReportRunner();
    element.reports = ["OpenOrders", "MemberRoster"];
    element.state = administrationState({ status: "loaded" });

    const run: RunReportDetail[] = [];
    const exported: RunReportDetail[] = [];
    document.body.addEventListener(ADL_RUN_REPORT_EVENT, (event) => {
      run.push((event as CustomEvent<RunReportDetail>).detail);
    });
    document.body.addEventListener(ADL_EXPORT_REPORT_EVENT, (event) => {
      exported.push((event as CustomEvent<RunReportDetail>).detail);
    });

    requireElement<HTMLSelectElement>(element, "[data-report-select='true']").value =
      "MemberRoster";
    requireElement<HTMLButtonElement>(element, "[data-report-run='true']").click();
    requireElement<HTMLButtonElement>(element, "[data-report-export='true']").click();

    expect(run).toEqual([{ readModelName: "MemberRoster" }]);
    expect(exported).toEqual([{ readModelName: "MemberRoster" }]);
  });

  it("renders the report rows and offers more only when the server sent a cursor", () => {
    const element = mountReportRunner();
    element.reports = ["OpenOrders"];
    element.state = administrationState({
      status: "loaded",
      reportStatus: "ready",
      reportName: "OpenOrders",
      report: {
        readModelName: "OpenOrders",
        fields: ["reference", "total"],
        rows: [{ reference: "PO-1", total: 12 }],
        truncated: false,
      },
    });

    const headers = [...element.querySelectorAll("[data-report-table='true'] th")].map((header) =>
      header.textContent?.trim(),
    );
    expect(headers).toEqual(["reference", "total"]);
    expect(element.textContent).toContain("PO-1");
    expect(element.querySelector("[data-report-more='true']")).toBeNull();
    expect(element.querySelector("[data-report-truncated='true']")).toBeNull();

    element.state = administrationState({
      status: "loaded",
      reportStatus: "ready",
      reportName: "OpenOrders",
      report: {
        readModelName: "OpenOrders",
        fields: ["reference"],
        rows: [{ reference: "PO-1" }],
        nextCursor: "cursor-2",
        truncated: true,
      },
    });

    expect(element.querySelector("[data-report-truncated='true']")).not.toBeNull();

    let more = 0;
    document.body.addEventListener(ADL_LOAD_MORE_REPORT_EVENT, () => {
      more += 1;
    });
    requireElement<HTMLButtonElement>(element, "[data-report-more='true']").click();
    expect(more).toBe(1);
  });

  it("disables its controls while a report is running and dispatches nothing", () => {
    const element = mountReportRunner();
    element.reports = ["OpenOrders"];
    element.state = administrationState({ status: "loaded", reportStatus: "running" });

    const run: RunReportDetail[] = [];
    document.body.addEventListener(ADL_RUN_REPORT_EVENT, (event) => {
      run.push((event as CustomEvent<RunReportDetail>).detail);
    });

    const button = requireElement<HTMLButtonElement>(element, "[data-report-run='true']");
    expect(button.disabled).toBe(true);
    button.click();
    expect(run).toEqual([]);

    element.state = administrationState({ status: "loaded", reportStatus: "ready" });
    element.busy = true;
    expect(requireElement<HTMLButtonElement>(element, "[data-report-run='true']").disabled).toBe(
      true,
    );
  });

  it("escapes a server message rather than injecting it, and alerts only on error", () => {
    const element = mountReportRunner();
    element.reports = ["OpenOrders"];
    element.state = administrationState({
      status: "error",
      reportStatus: "error",
      message: INJECTION,
    });

    const message = requireElement<HTMLElement>(element, "[data-report-message='true']");
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toContain(INJECTION);
    expect(element.querySelector("img")).toBeNull();

    element.state = administrationState({
      status: "loaded",
      reportStatus: "ready",
      message: "Exported report.csv.",
    });
    expect(
      requireElement<HTMLElement>(element, "[data-report-message='true']").getAttribute("role"),
    ).toBe("status");
  });
});

describe("adl-audit-review", () => {
  beforeEach(() => {
    defineAdlAuditReview();
    document.body.innerHTML = "";
  });

  it("explains that no context is selected, and still offers a way to load one", () => {
    const element = mountAuditReview();
    const events: string[] = [];
    element.addEventListener(ADL_LOAD_ADMINISTRATION_EVENT, () => events.push("load"));
    element.state = administrationState({ status: "unavailable" });

    expect(element.getAttribute("data-administration-status")).toBe("unavailable");
    expect(element.querySelector("[data-administration-unavailable='true']")).not.toBeNull();
    // No review lists, because there is no context to review.
    expect(element.querySelectorAll("[data-audit-list]")).toHaveLength(0);
    // A missing context is never reported as a permission failure.
    expect(element.textContent).not.toContain("permitted");

    /*
     * The refresh survives this state deliberately. Someone lands here, chooses
     * a context in the top bar, and has to be able to load it — removing the
     * only control that can leave the state made it a dead end.
     */
    element
      .querySelector<HTMLButtonElement>("[data-administration-refresh='true']")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    expect(events).toEqual(["load"]);
  });

  it("renders each audit entry from its own keys and refreshes on request", () => {
    const element = mountAuditReview();
    element.state = administrationState({
      status: "loaded",
      accessAudit: {
        entries: [{ accessAuditId: "aa-1", kind: "membershipGranted", role: "manager" }],
      },
      runtimeAudit: {
        entries: [{ auditId: "ra-1", object: "PurchaseOrder", operation: "update" }],
      },
    });

    expect(element.getAttribute("data-administration-status")).toBe("loaded");
    expect(element.textContent).toContain("accessAuditId");
    expect(element.textContent).toContain("aa-1");
    expect(element.textContent).toContain("PurchaseOrder");

    let refreshes = 0;
    document.body.addEventListener(ADL_LOAD_ADMINISTRATION_EVENT, () => {
      refreshes += 1;
    });
    requireElement<HTMLButtonElement>(element, "[data-administration-refresh='true']").click();
    expect(refreshes).toBe(1);
  });

  it("shows an empty audit list exactly as it shows a refused one", () => {
    const element = mountAuditReview();
    element.state = administrationState({ status: "loaded" });

    expect(element.querySelector("[data-audit-empty='accessAudit']")).not.toBeNull();
    expect(element.querySelector("[data-audit-empty='runtimeAudit']")).not.toBeNull();
    expect(element.textContent).not.toContain("permitted");
    expect(element.textContent).not.toContain("denied");
  });

  it("offers more only for the list the server gave a cursor for", () => {
    const element = mountAuditReview();
    element.state = administrationState({
      status: "loaded",
      accessAudit: { entries: [{ accessAuditId: "aa-1" }] },
      runtimeAudit: { entries: [{ auditId: "ra-1" }], nextCursor: "cursor-runtime" },
    });

    expect(element.querySelector("[data-audit-more='accessAudit']")).toBeNull();

    const detected: LoadMoreAdministrationDetail[] = [];
    document.body.addEventListener(ADL_LOAD_MORE_ADMINISTRATION_EVENT, (event) => {
      detected.push((event as CustomEvent<LoadMoreAdministrationDetail>).detail);
    });
    requireElement<HTMLButtonElement>(element, "[data-audit-more='runtimeAudit']").click();

    expect(detected).toEqual([{ list: "runtimeAudit" }]);
  });

  it("escapes an administration message rather than injecting it", () => {
    const element = mountAuditReview();
    element.state = administrationState({ status: "error", message: INJECTION });

    const message = requireElement<HTMLElement>(element, "[data-administration-message='true']");
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toContain(INJECTION);
    expect(element.querySelector("img")).toBeNull();
  });
});

describe("adl-access-review", () => {
  beforeEach(() => {
    defineAdlAccessReview();
    document.body.innerHTML = "";
  });

  it("renders only an explanation and no controls when no context is selected", () => {
    const element = mountAccessReview();
    element.state = administrationState({ status: "unavailable" });

    expect(element.getAttribute("data-access-review-status")).toBe("unavailable");
    expect(element.querySelector("[data-access-review-unavailable='true']")).not.toBeNull();
    expect(element.querySelectorAll("button")).toHaveLength(0);
    expect(element.textContent).not.toContain("permitted");
  });

  it("offers revocation only for an active membership with a readable user id", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      memberships: {
        entries: [
          { membershipRecordId: "m-1", userId: "user-1", role: "manager", status: "active" },
          { membershipRecordId: "m-2", role: "member", status: "active" },
          { membershipRecordId: "m-3", userId: "user-3", role: "member", status: "revoked" },
        ],
      },
    });

    expect(element.getAttribute("data-access-review-status")).toBe("loaded");
    const revokes = [...element.querySelectorAll<HTMLButtonElement>("[data-revoke-member]")];
    expect(revokes.map((button) => button.dataset.revokeMember)).toEqual(["user-1"]);

    const detected: RevokeMemberSessionsDetail[] = [];
    document.body.addEventListener(ADL_REVOKE_MEMBER_SESSIONS_EVENT, (event) => {
      detected.push((event as CustomEvent<RevokeMemberSessionsDetail>).detail);
    });
    revokes[0]?.click();
    expect(detected).toEqual([{ userId: "user-1" }]);
  });

  it("pages memberships and invitations only when the server sent a cursor", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      memberships: { entries: [{ userId: "user-1", status: "active" }], nextCursor: "cursor-m" },
      invites: { entries: [{ inviteId: "inv-1", role: "member", status: "active" }] },
    });

    expect(element.querySelector("[data-access-more='invites']")).toBeNull();

    const detected: LoadMoreAdministrationDetail[] = [];
    document.body.addEventListener(ADL_LOAD_MORE_ADMINISTRATION_EVENT, (event) => {
      detected.push((event as CustomEvent<LoadMoreAdministrationDetail>).detail);
    });
    requireElement<HTMLButtonElement>(element, "[data-access-more='memberships']").click();

    expect(detected).toEqual([{ list: "memberships" }]);
    expect(element.textContent).toContain("inv-1");
  });

  it("renders recovery status as labelled text", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      recovery: { ready: true, recoveryRequired: false, lastRestoreAt: "2026-07-30T09:00:00.000Z" },
    });

    const recovery = requireElement<HTMLElement>(element, "[data-access-recovery='true']");
    expect(recovery.textContent).toContain("Healthy");
    expect(recovery.textContent).toContain("2026-07-30T09:00:00.000Z");
    expect(recovery.querySelectorAll("button")).toHaveLength(0);
  });

  it("renders retention read-only, with no control that could trigger a run", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      retention: {
        scheduled: true,
        intervalMinutes: 60,
        legalHold: false,
        minimumRetentionDays: 30,
        sessionRetentionDays: 45,
        challengeRetentionDays: 1,
        lastRun: {
          runId: "run-1",
          startedAt: "2026-07-30T09:00:00.000Z",
          finishedAt: "2026-07-30T09:00:05.000Z",
          outcome: "completed",
          dryRun: false,
          held: false,
          effectiveCutoff: "2026-06-30T00:00:00.000Z",
          prunedRuntimeAudit: 4,
          prunedOutcomes: 2,
          prunedSessions: 1,
          prunedChallenges: 0,
          prunedTotal: 7,
        },
      },
    });

    const retention = requireElement<HTMLElement>(element, "[data-access-retention='true']");
    expect(retention.textContent).toContain("60");
    expect(retention.textContent).toContain("30");
    expect(retention.textContent).toContain("completed");
    expect(retention.textContent).toContain("2026-06-30T00:00:00.000Z");
    // Retention is application-wide; this context-scoped surface must not run it.
    expect(retention.querySelectorAll("button")).toHaveLength(0);
    expect(element.querySelectorAll("[data-retention-run]")).toHaveLength(0);
  });

  it("says retention status is unavailable when the deployment reports none", () => {
    const element = mountAccessReview();
    element.state = administrationState({ status: "loaded", retention: null });

    const retention = requireElement<HTMLElement>(element, "[data-access-retention='true']");
    expect(retention.textContent).toContain("unavailable for this deployment");
    expect(retention.querySelectorAll("button")).toHaveLength(0);
  });

  it("escapes a membership user id rather than injecting it", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      memberships: { entries: [{ userId: INJECTION, role: "member", status: "active" }] },
    });

    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain(INJECTION);
    const revoke = requireElement<HTMLButtonElement>(element, "[data-revoke-member]");
    expect(revoke.dataset.revokeMember).toBe(INJECTION);
  });

  it("disables every control while an administration action is in flight", () => {
    const element = mountAccessReview();
    element.state = administrationState({
      status: "loaded",
      memberships: { entries: [{ userId: "user-1", status: "active" }], nextCursor: "cursor-m" },
    });
    element.busy = true;

    const buttons = [...element.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);

    const detected: RevokeMemberSessionsDetail[] = [];
    document.body.addEventListener(ADL_REVOKE_MEMBER_SESSIONS_EVENT, (event) => {
      detected.push((event as CustomEvent<RevokeMemberSessionsDetail>).detail);
    });
    requireElement<HTMLButtonElement>(element, "[data-revoke-member]").click();
    expect(detected).toEqual([]);
  });
});

function administrationState(
  overrides: Partial<AdlAdministrationState> = {},
): AdlAdministrationState {
  return {
    status: "loaded",
    accessAudit: { entries: [] },
    runtimeAudit: { entries: [] },
    memberships: { entries: [] },
    invites: { entries: [] },
    ...overrides,
  };
}

function mountReportRunner(): AdlReportRunnerElement {
  const element = document.createElement("adl-report-runner");
  document.body.append(element);
  if (!(element instanceof AdlReportRunnerElement)) {
    throw new Error("adl-report-runner did not upgrade to its custom element class.");
  }

  return element;
}

function mountAuditReview(): AdlAuditReviewElement {
  const element = document.createElement("adl-audit-review");
  document.body.append(element);
  if (!(element instanceof AdlAuditReviewElement)) {
    throw new Error("adl-audit-review did not upgrade to its custom element class.");
  }

  return element;
}

function mountAccessReview(): AdlAccessReviewElement {
  const element = document.createElement("adl-access-review");
  document.body.append(element);
  if (!(element instanceof AdlAccessReviewElement)) {
    throw new Error("adl-access-review did not upgrade to its custom element class.");
  }

  return element;
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}
