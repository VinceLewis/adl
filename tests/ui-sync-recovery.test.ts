// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import type { SyncDeliveryItem, SyncRecoveryItem } from "../src/server/sync-client.js";
import {
  ADL_RESOLVE_RECOVERY_EVENT,
  ADL_RETRY_DELIVERY_EVENT,
  DELIVERY_RETRY_LABEL,
  RECOVERY_ACKNOWLEDGE_LABEL,
  RECOVERY_CHOICE_LABELS,
  type ResolveRecoveryDetail,
  type RetryDeliveryDetail,
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

  it("presents a rejected command as one change named after the command", () => {
    const element = mountRecovery();
    element.items = [
      recoveryItem({
        queueId: "queue-command",
        // The entry is filed under the representative record whose sync mode
        // decided delivery. It is not what the user did, and must not be shown
        // as though it were.
        objectName: "BandMember",
        recordId: "member-1",
        operation: "command",
        commandName: "CreateBand",
        commandLabel: "Create Band",
        recordCount: 3,
        status: "rejected",
        code: "ADL_POLICY_DENIED",
        message: "The authority refused this command.",
        requiresUserChoice: false,
        choices: ["keepServer"],
      }),
    ];

    const articles = recoveryArticles(element);
    expect(articles).toHaveLength(1);
    const article = articles[0] as HTMLElement;
    expect(article.dataset.recoveryCommand).toBe("CreateBand");
    expect(article.dataset.recoveryRecordCount).toBe("3");

    const title = requireElement<HTMLElement>(article, ".adl-sync-recovery-title");
    expect(title.textContent?.trim()).toBe("Create Band — one command covering 3 records");
    // Three records, one verdict, one thing to dismiss.
    expect(element.textContent).not.toContain("BandMember");
    expect(element.textContent).not.toContain("Update");

    const buttons = choiceButtons(element);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.dataset.recoveryChoice).toBe("keepServer");
    expect(buttons[0]?.textContent?.trim()).toBe(RECOVERY_ACKNOWLEDGE_LABEL);
  });

  it("offers a conflicted command both choices and names it from its command name", () => {
    const element = mountRecovery();
    element.items = [
      recoveryItem({
        queueId: "queue-command-conflict",
        objectName: "Setlist",
        recordId: "setlist-1",
        operation: "command",
        // No declared label, and a single record: the fallback is the command's
        // own name title-cased, with no coverage clause to overstate its reach.
        commandName: "importSetlist",
        recordCount: 1,
        status: "manualResolution",
        strategy: "manual",
        code: "conflict.revisionMismatch",
        message: "The records changed on the server.",
        requiresUserChoice: true,
        choices: ["keepServer", "resubmitMine"],
      }),
    ];

    const article = recoveryArticles(element)[0] as HTMLElement;
    expect(article.dataset.recoveryCommand).toBe("importSetlist");
    expect(
      requireElement<HTMLElement>(article, ".adl-sync-recovery-title").textContent?.trim(),
    ).toBe("Import Setlist");

    const buttons = choiceButtons(element);
    expect(buttons.map((button) => button.dataset.recoveryChoice)).toEqual([
      "keepServer",
      "resubmitMine",
    ]);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      RECOVERY_CHOICE_LABELS.keepServer,
      RECOVERY_CHOICE_LABELS.resubmitMine,
    ]);
  });

  it("offers an undelivered command the same single retry as any other write", () => {
    const element = mountRecovery();
    element.undelivered = [
      deliveryItem({
        queueId: "queue-command-undelivered",
        objectName: "BandMember",
        recordId: "member-1",
        operation: "command",
        commandName: "CreateBand",
        commandLabel: "Create Band",
        recordCount: 3,
        message: "AuthorityTransportError: The authority is unreachable.",
      }),
    ];

    const article = requireElement<HTMLElement>(element, "[data-delivery-item]");
    expect(article.dataset.recoveryCommand).toBe("CreateBand");
    expect(article.dataset.recoveryRecordCount).toBe("3");
    expect(
      requireElement<HTMLElement>(article, ".adl-sync-recovery-title").textContent?.trim(),
    ).toBe("Create Band — one command covering 3 records");
    // Pending delivery is not a verdict, for a command as for anything else.
    expect(article.querySelector("[data-recovery-choice]")).toBeNull();

    const detected: RetryDeliveryDetail[] = [];
    document.body.addEventListener(ADL_RETRY_DELIVERY_EVENT, (event) => {
      detected.push((event as CustomEvent<RetryDeliveryDetail>).detail);
    });

    const retry = requireElement<HTMLButtonElement>(article, "[data-delivery-retry]");
    expect(retry.textContent?.trim()).toBe(DELIVERY_RETRY_LABEL);
    retry.click();

    expect(detected).toEqual([{ queueId: "queue-command-undelivered" }]);
  });

  it("leaves a write that did not originate in a command exactly as it was", () => {
    const element = mountRecovery();
    element.items = [recoveryItem({ queueId: "queue-a" })];
    element.undelivered = [deliveryItem({ queueId: "queue-d", operation: "create" })];

    const item = requireElement<HTMLElement>(element, "[data-recovery-queue-id='queue-a']");
    expect(requireElement<HTMLElement>(item, ".adl-sync-recovery-title").textContent?.trim()).toBe(
      "Update PurchaseOrder",
    );
    const delivery = requireElement<HTMLElement>(element, "[data-delivery-item]");
    expect(
      requireElement<HTMLElement>(delivery, ".adl-sync-recovery-title").textContent?.trim(),
    ).toBe("Create PurchaseOrder");

    // No command marking on a per-record entry: the attribute is what tells a
    // reader, a test and the visual suite that one article covers many records.
    expect(item.dataset.recoveryCommand).toBeUndefined();
    expect(item.dataset.recoveryRecordCount).toBeUndefined();
    expect(delivery.dataset.recoveryCommand).toBeUndefined();
    expect(delivery.dataset.recoveryRecordCount).toBeUndefined();
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

function deliveryItem(overrides: Partial<SyncDeliveryItem> = {}): SyncDeliveryItem {
  return {
    queueId: "queue-d",
    opId: "op-d",
    objectName: "PurchaseOrder",
    recordId: "po-1",
    operation: "create",
    message: "AuthorityTransportError: The authority is unreachable.",
    attemptedAt: "2026-07-31T09:00:00.000Z",
    ...overrides,
  };
}

function recoveryArticles(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("article.adl-sync-recovery-item")];
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
