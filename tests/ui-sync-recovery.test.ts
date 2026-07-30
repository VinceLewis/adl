// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import type { SyncRecoveryItem } from "../src/server/sync-client.js";
import {
  ADL_RESOLVE_RECOVERY_EVENT,
  RECOVERY_ACKNOWLEDGE_LABEL,
  RECOVERY_CHOICE_LABELS,
  type ResolveRecoveryDetail,
} from "../src/ui/authority-bridge.js";
import {
  AdlSyncRecoveryElement,
  defineAdlSyncRecovery,
} from "../src/ui/components/adl-sync-recovery.js";

describe("adl-sync-recovery", () => {
  beforeEach(() => {
    defineAdlSyncRecovery();
    document.body.innerHTML = "";
  });

  it("renders no chrome at all when there is nothing to recover", () => {
    const element = mountRecovery();
    element.items = [];

    expect(element.innerHTML).toBe("");
    expect(element.querySelector("[data-sync-recovery='true']")).toBeNull();
  });

  it("renders both model-permitted choices for a manual conflict", () => {
    const element = mountRecovery();
    element.items = [
      recoveryItem({
        queueId: "queue-manual",
        status: "manualResolution",
        strategy: "manual",
        code: "conflict.revisionMismatch",
        message: "The record changed on the server.",
        requiresUserChoice: true,
        choices: ["keepServer", "resubmitMine"],
      }),
    ];

    const buttons = choiceButtons(element);
    expect(buttons.map((button) => button.dataset.recoveryChoice)).toEqual([
      "keepServer",
      "resubmitMine",
    ]);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      RECOVERY_CHOICE_LABELS.keepServer,
      RECOVERY_CHOICE_LABELS.resubmitMine,
    ]);

    const region = requireElement<HTMLElement>(element, "[data-sync-recovery='true']");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(element.textContent).toContain("Update PurchaseOrder");
    expect(element.textContent).toContain("The record changed on the server.");
    expect(element.textContent).toContain("conflict.revisionMismatch");
    expect(element.querySelector("[data-recovery-strategy='manual']")).not.toBeNull();
  });

  it("offers only a terminal acknowledgement for a rejection, with its reason", () => {
    const element = mountRecovery();
    element.items = [
      recoveryItem({
        queueId: "queue-rejected",
        status: "rejected",
        code: "policy.writeDenied",
        message: "You may not change a submitted order.",
        requiresUserChoice: false,
        choices: ["keepServer"],
      }),
    ];

    const buttons = choiceButtons(element);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.dataset.recoveryChoice).toBe("keepServer");
    expect(buttons[0]?.textContent?.trim()).toBe(RECOVERY_ACKNOWLEDGE_LABEL);
    expect(buttons[0]?.textContent).not.toContain(RECOVERY_CHOICE_LABELS.keepServer);
    expect(element.textContent).toContain("policy.writeDenied");
    expect(element.textContent).toContain("You may not change a submitted order.");
  });

  it("dispatches the resolution choice and resolves nothing itself", () => {
    const element = mountRecovery();
    element.items = [
      recoveryItem({ queueId: "queue-a", choices: ["keepServer", "resubmitMine"] }),
      recoveryItem({ queueId: "queue-b", choices: ["keepServer", "resubmitMine"] }),
    ];

    const detected: ResolveRecoveryDetail[] = [];
    document.body.addEventListener(ADL_RESOLVE_RECOVERY_EVENT, (event) => {
      detected.push((event as CustomEvent<ResolveRecoveryDetail>).detail);
    });

    requireElement<HTMLButtonElement>(
      element,
      "[data-recovery-queue-id='queue-b'][data-recovery-choice='resubmitMine']",
    ).click();

    expect(detected).toEqual([{ queueId: "queue-b", choice: "resubmitMine" }]);
    // The component presents; it does not remove the item on its own.
    expect(choiceButtons(element)).toHaveLength(4);
  });

  it("disables every choice while a resolution is in flight", () => {
    const element = mountRecovery();
    element.items = [recoveryItem({ queueId: "queue-a", choices: ["keepServer", "resubmitMine"] })];

    expect(choiceButtons(element).every((button) => button.disabled)).toBe(false);

    element.busy = true;

    const busyButtons = choiceButtons(element);
    expect(busyButtons).toHaveLength(2);
    expect(busyButtons.every((button) => button.disabled)).toBe(true);

    const detected: ResolveRecoveryDetail[] = [];
    document.body.addEventListener(ADL_RESOLVE_RECOVERY_EVENT, (event) => {
      detected.push((event as CustomEvent<ResolveRecoveryDetail>).detail);
    });
    busyButtons[0]?.click();
    expect(detected).toEqual([]);
  });
});

function mountRecovery(): AdlSyncRecoveryElement {
  const element = document.createElement("adl-sync-recovery");
  document.body.append(element);
  if (!(element instanceof AdlSyncRecoveryElement)) {
    throw new Error("adl-sync-recovery did not upgrade to its custom element class.");
  }

  return element;
}

function recoveryItem(overrides: Partial<SyncRecoveryItem> = {}): SyncRecoveryItem {
  return {
    queueId: "queue-a",
    opId: "op-a",
    objectName: "PurchaseOrder",
    recordId: "po-1",
    operation: "update",
    status: "conflict",
    code: "conflict.revisionMismatch",
    message: "The record changed on the server.",
    recordedAt: "2026-07-30T09:00:00.000Z",
    requiresUserChoice: true,
    choices: ["keepServer", "resubmitMine"],
    ...overrides,
  };
}

function choiceButtons(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button[data-recovery-choice]")];
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}
