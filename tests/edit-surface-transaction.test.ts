import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  AuthoritySyncClient,
  compileAdl,
  coveredQueueRecords,
  validateApplicationModel,
} from "../src/index.js";
import type {
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
  AuthorityTransport,
  ResolvedApplicationModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

/**
 * A staged batch of child changes is one transaction, or it is nothing.
 *
 * Before this phase `applyStagedChanges` looped over the staged operations and
 * called `create`/`update`/`delete` one at a time. Each of those is its own
 * `commitPlannedTransaction`, its own operation-log entry and its own queue
 * entry, so a batch of child changes could fail halfway and leave the parent's
 * children half-changed locally, and could land partially at the authority. That
 * is the failure Phase 57 closed for commands, and these cases are what keeps it
 * closed here.
 *
 * Every case states what regresses if the property stops holding, and every
 * refusal case asserts against storage *and* the sync queue rather than against
 * the thrown error alone: an exception says only that the caller was told, not
 * that nothing landed.
 *
 * The model is written in ADL source and compiled, so the syntax this phase adds
 * is exercised end to end rather than only through a hand-built partial model.
 */
const ORDER_DESK_ADL = `APP OrderDesk
  START_VIEW OrderList
END.APP

ROLE Admin
ROLE Clerk

OBJECT Order
  DISPLAY Code
  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT
  SYNC LOCAL_FIRST

  VIEW OrderList LIST
    FIELDS Code Notes
    ACTIONS create read update delete
  END.VIEW

  VIEW OrderForm FORM
    FIELDS Code Notes
    ACTIONS save delete
    EDIT_CONTAINER page
    EDIT_SECTION Details HEADING 'Order'
      FIELDS Code Notes
    END.EDIT_SECTION
    CHILD_COLLECTION Lines HEADING 'Lines'
      CHILD OrderLine PARENT_FIELD Order
      CHILD_VIEW OrderLineList
      OPERATIONS createChild linkExisting updateChild remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
      PICKER LinePicker
        SOURCE OBJECT OrderLine
        SELECTION multiple
        DISPLAY Sku
        SEARCH Sku
        SORT Sku ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Nothing to link.'
      END.PICKER
    END.CHILD_COLLECTION
    CHILD_COLLECTION Attachments HEADING 'Attachments'
      CHILD OrderAttachment PARENT_FIELD Order
      OPERATIONS createChild updateChild remove
      STAGED
      EMPTY_TEXT 'No attachments yet.'
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT

OBJECT OrderLine
  DISPLAY Sku
  CONSTRAINT uniqueSkuPerOrder UNIQUE SCOPE Order FIELDS Sku
  CONSTRAINT orderedLines ORDERED PARENT Order POSITION Position REORDER shift COMPACT onDelete
  FIELD Order TEXT REQUIRED LOOKUP Order DISPLAY Code
  FIELD Sku TEXT REQUIRED
  FIELD Position NUMBER REQUIRED MIN(1)
  SYNC LOCAL_FIRST

  VIEW OrderLineList LIST
    FIELDS Sku Position
    ACTIONS read update delete
  END.VIEW
END.OBJECT

OBJECT OrderAttachment
  DISPLAY Label
  FIELD Order TEXT REQUIRED LOOKUP Order DISPLAY Code
  FIELD Label TEXT REQUIRED
  SYNC ONLINE_REQUIRED

  VIEW OrderAttachmentList LIST
    FIELDS Label
    ACTIONS read update delete
  END.VIEW
END.OBJECT

POLICY OrderPolicy ON Order
  ALLOW ALL ROLE Admin
  ALLOW ALL ROLE Clerk
END.POLICY

POLICY OrderLinePolicy ON OrderLine
  ALLOW ALL ROLE Admin
  ALLOW CREATE ROLE Clerk
  ALLOW READ ROLE Clerk
  ALLOW SEARCH ROLE Clerk
  ALLOW UPDATE ROLE Clerk
END.POLICY

POLICY OrderAttachmentPolicy ON OrderAttachment
  ALLOW ALL ROLE Admin
  ALLOW ALL ROLE Clerk
END.POLICY
`;

const compiled = compileAdl(ORDER_DESK_ADL);
const orderDeskModel: ResolvedApplicationModel = compiled.model;

const adminContext: RuntimeContext = { userId: "admin", roles: ["Admin"], channel: "ui" };
const clerkContext: RuntimeContext = { userId: "clerk", roles: ["Clerk"], channel: "ui" };
const offlineAdminContext: RuntimeContext = { ...adminContext, online: false };

interface OrderFixture {
  runtime: ApplicationRuntime;
  orderId: string;
  lines: StoredObjectRecord[];
}

/**
 * An order with `skus.length` lines at positions 1..n, and an empty queue.
 *
 * The queue is cleared after setup so every queue assertion below describes what
 * the staged batch did, not what the setup writes did.
 */
async function orderWithLines(skus: string[]): Promise<OrderFixture> {
  const runtime = new ApplicationRuntime(orderDeskModel);
  const order = await runtime.create("Order", { Code: "A-1" }, adminContext);
  const lines: StoredObjectRecord[] = [];
  for (const [index, sku] of skus.entries()) {
    lines.push(
      await runtime.create(
        "OrderLine",
        { Order: order.meta.guid, Sku: sku, Position: index + 1 },
        adminContext,
      ),
    );
  }
  runtime.syncQueue.clear();
  return { runtime, orderId: order.meta.guid, lines };
}

function lineId(fixture: OrderFixture, index: number): string {
  const id = fixture.lines[index]?.meta.guid;
  if (id === undefined) throw new Error(`Expected fixture line ${index}.`);
  return id;
}

async function applyToLines(
  fixture: OrderFixture,
  stagedChanges: Parameters<ApplicationRuntime["applyStagedChildChanges"]>[0]["stagedChanges"],
  context: RuntimeContext = adminContext,
): Promise<Awaited<ReturnType<ApplicationRuntime["applyStagedChildChanges"]>>["applied"]> {
  const result = await fixture.runtime.applyStagedChildChanges({
    objectName: "Order",
    viewName: "OrderForm",
    parentRecordId: fixture.orderId,
    context,
    stagedChanges,
  });
  return result.applied;
}

async function skusAndPositions(fixture: OrderFixture): Promise<Array<[unknown, unknown]>> {
  const records = await fixture.runtime.search(
    "OrderLine",
    { sort: [{ field: "Position", direction: "asc" }] },
    adminContext,
  );
  return records.map((record) => [record.values.Sku, record.values.Position]);
}

/** A transport that refuses everything, so a whole-batch verdict can be produced. */
function refusingTransport(): AuthorityTransport {
  return {
    async bootstrap(): Promise<AuthorityBootstrapResponse> {
      return { records: [] };
    },
    async replay(
      _sessionToken: string | undefined,
      intent: AuthorityOperationIntent,
    ): Promise<AuthorityOutcome> {
      return {
        status: "rejected",
        operationId: intent.operationId,
        code: "ADL_POLICY_DENIED",
        message: "The authority refused this batch.",
      };
    },
  };
}

describe("the ADL-declared edit surface this fixture compiles from", () => {
  it("compiles and validates, so every case below runs against parsed syntax", () => {
    expect(compiled.diagnostics).toEqual([]);
    expect(validateApplicationModel(orderDeskModel)).toEqual([]);

    const view = orderDeskModel.objects
      .find((object) => object.name === "Order")
      ?.views.find((candidate) => candidate.name === "OrderForm");

    expect(view?.editContainer).toBe("page");
    expect(view?.editSections).toEqual([
      expect.objectContaining({ name: "Details", kind: "fields", fields: ["Code", "Notes"] }),
      expect.objectContaining({
        name: "Lines",
        kind: "childCollection",
        childObject: "OrderLine",
        parentField: "Order",
        childView: "OrderLineList",
        operations: ["createChild", "linkExisting", "updateChild", "remove", "reorder"],
        staged: true,
        orderField: "Position",
        picker: expect.objectContaining({
          name: "LinePicker",
          sourceKind: "object",
          source: "OrderLine",
          selection: "multiple",
          excludeAlreadyLinked: true,
        }),
      }),
      expect.objectContaining({ name: "Attachments", childObject: "OrderAttachment" }),
    ]);
  });
});

describe("a staged batch commits as one storage transaction", () => {
  /**
   * Regression guard: with per-operation commits the first child landed and the
   * second one's refusal left the parent holding a child the user never agreed
   * to save on its own — and one queue entry that would carry it to the
   * authority.
   */
  it("writes and queues nothing when one staged child fails validation", async () => {
    const fixture = await orderWithLines([]);

    await expect(
      applyToLines(fixture, [
        {
          id: "good",
          section: "Lines",
          operation: "createChild",
          childObject: "OrderLine",
          values: { Sku: "A", Position: 1 },
        },
        {
          // `Sku` is REQUIRED, so this one cannot be planned at all.
          id: "bad",
          section: "Lines",
          operation: "createChild",
          childObject: "OrderLine",
          values: { Position: 2 },
        },
      ]),
    ).rejects.toMatchObject({ code: "ADL_RUNTIME_VALIDATION_FAILED" });

    expect(await fixture.runtime.search("OrderLine", {}, adminContext)).toEqual([]);
    expect(fixture.runtime.syncQueue.getEntries()).toEqual([]);
  });

  /**
   * Regression guard: policy is enforced per write, and a batch must not become
   * a way to smuggle the writes that were allowed past the one that was not.
   * The clerk may create and update lines but never delete one.
   */
  it("writes and queues nothing when one staged child is denied by policy", async () => {
    const fixture = await orderWithLines(["A"]);

    await expect(
      applyToLines(
        fixture,
        [
          {
            id: "create",
            section: "Lines",
            operation: "createChild",
            childObject: "OrderLine",
            values: { Sku: "B", Position: 2 },
          },
          {
            id: "remove",
            section: "Lines",
            operation: "remove",
            childObject: "OrderLine",
            childId: lineId(fixture, 0),
          },
        ],
        clerkContext,
      ),
    ).rejects.toMatchObject({ code: "ADL_POLICY_DENIED" });

    // The permitted create did not land, and the denied delete did not either.
    expect(await skusAndPositions(fixture)).toEqual([["A", 1]]);
    expect(fixture.runtime.syncQueue.getEntries()).toEqual([]);
  });

  /**
   * The strongest of these cases, and the one that proves the *commit* is
   * atomic rather than just the planning.
   *
   * Object constraints are checked inside `commitPlannedTransaction`, after
   * every write has been planned — `planCreateForTransaction` never checks them.
   * So both creates below plan successfully and the refusal happens with the
   * whole transaction in hand. If the batch were committed write by write, the
   * first `Sku: "DUP"` line would already be persisted and queued by the time
   * the second one was refused.
   */
  it("writes and queues nothing when the commit's constraint check refuses one write", async () => {
    const fixture = await orderWithLines([]);
    const operationsBefore = fixture.runtime.operationLog.getOperations().length;

    const error: unknown = await applyToLines(fixture, [
      {
        id: "first",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        values: { Sku: "DUP", Position: 1 },
      },
      {
        id: "second",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        values: { Sku: "DUP", Position: 2 },
      },
    ]).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    // Both offending writes are named, because the constraint was evaluated
    // over the whole transaction rather than over one write at a time.
    expect(error).toMatchObject({ code: "ADL_RUNTIME_VALIDATION_FAILED" });
    expect(
      (error as { issues: Array<{ code: string }> }).issues.map((issue) => issue.code),
    ).toEqual(["ADL_RUNTIME_CONSTRAINT_UNIQUE", "ADL_RUNTIME_CONSTRAINT_UNIQUE"]);

    expect(await fixture.runtime.search("OrderLine", {}, adminContext)).toEqual([]);
    expect(fixture.runtime.syncQueue.getEntries()).toEqual([]);
    // Not even local history records a write, because none was made.
    expect(fixture.runtime.operationLog.getOperations()).toHaveLength(operationsBefore);
  });

  /**
   * Regression guard: the sync gate is per object, and a batch spans as many
   * objects as it has sections. An `onlineRequired` child offline must take the
   * `localFirst` child beside it down with it, or the transaction the user
   * submitted is not the transaction that landed.
   */
  it("writes and queues nothing when one child object's sync mode blocks the write", async () => {
    const fixture = await orderWithLines([]);

    await expect(
      fixture.runtime.applyStagedChildChanges({
        objectName: "Order",
        viewName: "OrderForm",
        parentRecordId: fixture.orderId,
        context: offlineAdminContext,
        stagedChanges: [
          {
            id: "line",
            section: "Lines",
            operation: "createChild",
            childObject: "OrderLine",
            values: { Sku: "A", Position: 1 },
          },
          {
            id: "attachment",
            section: "Attachments",
            operation: "createChild",
            childObject: "OrderAttachment",
            values: { Label: "Signed order" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "ADL_SYNC_POLICY_DENIED" });

    expect(await fixture.runtime.search("OrderLine", {}, adminContext)).toEqual([]);
    expect(await fixture.runtime.search("OrderAttachment", {}, adminContext)).toEqual([]);
    expect(fixture.runtime.syncQueue.getEntries()).toEqual([]);
  });
});

describe("a staged batch reaches the authority as one operation", () => {
  /**
   * Regression guard: one entry per child is exactly the shape that loses the
   * transaction across the sync boundary, because the authority may accept some
   * of them and refuse the rest. The entry must also name every record the batch
   * wrote, with the right `created` flag, or Phase 58's verdict lands on some of
   * them and not others — and only a created record may later be discarded.
   */
  it("queues exactly one batch entry naming every record it wrote", async () => {
    const fixture = await orderWithLines(["A", "B", "C"]);

    const applied = await applyToLines(fixture, [
      {
        id: "insert",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        // Takes the position the removal below frees, so no sibling has to move
        // and this batch's writes are exactly the three requested.
        values: { Sku: "D", Position: 3 },
      },
      {
        id: "edit",
        section: "Lines",
        operation: "updateChild",
        childObject: "OrderLine",
        childId: lineId(fixture, 1),
        values: { Sku: "B-revised" },
      },
      {
        id: "drop",
        section: "Lines",
        operation: "remove",
        childObject: "OrderLine",
        childId: lineId(fixture, 2),
      },
    ]);

    const entries = fixture.runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Expected one queued batch entry.");
    expect(entry.operation.operation).toBe("batch");
    // The entry is filed under a representative *child* record, so the label is
    // the only thing that tells a recovery surface which change this was. It
    // names the parent the user was editing, not the child row it happens to be
    // filed under.
    expect(entry.operation.batch?.label).toContain("Order");
    expect(entry.operation.batch?.label).not.toContain("OrderLine");
    expect(entry.operation.batch?.writes.map((write) => write.operation)).toEqual([
      "create",
      "update",
      "delete",
    ]);

    const created = await fixture.runtime.search("OrderLine", {}, adminContext);
    const insertedId = created.find((record) => record.values.Sku === "D")?.meta.guid;
    expect(insertedId).toBeDefined();

    // The caller still learns which record each staged operation produced,
    // positionally, even though nothing was committed one operation at a time.
    expect(applied).toEqual([
      {
        operationId: "insert",
        operation: "createChild",
        childObject: "OrderLine",
        recordId: insertedId,
      },
      {
        operationId: "edit",
        operation: "updateChild",
        childObject: "OrderLine",
        recordId: lineId(fixture, 1),
      },
      {
        operationId: "drop",
        operation: "remove",
        childObject: "OrderLine",
        recordId: lineId(fixture, 2),
      },
    ]);

    // Every record the batch wrote, and only a create is flagged as created:
    // the `created` flag is what later licenses a local discard, so an edited or
    // deleted record must never carry it.
    expect(coveredQueueRecords(entry.operation)).toEqual([
      { objectName: "OrderLine", recordId: insertedId, created: true },
      { objectName: "OrderLine", recordId: lineId(fixture, 1), created: false },
      { objectName: "OrderLine", recordId: lineId(fixture, 2), created: false },
    ]);
  });
});

describe("record sync state across a staged batch", () => {
  async function syncStatusOf(
    runtime: ApplicationRuntime,
    recordId: string,
  ): Promise<string | undefined> {
    const record = await runtime.objectStore.getRecordForSync("OrderLine", recordId);
    return record?.meta.syncStatus;
  }

  /**
   * Regression guard: a record written by a queued batch is waiting on the
   * authority exactly as a record written by an ordinary create is. Reporting it
   * as settled would be a lie about work the device is still holding, and
   * reporting it as `local` would be the pre-Phase-58 state where a queued
   * write and a write with no delivery path looked identical.
   */
  it("reports every record a staged batch wrote as pending while it is queued", async () => {
    const fixture = await orderWithLines(["A", "B"]);
    // Settle the setup writes so `pending` below can only have come from the
    // batch: the fixture clears the queue, and these rows would otherwise still
    // be carrying the state their own creates left.
    for (const line of fixture.lines) {
      await fixture.runtime.objectStore.setRecordSyncState("OrderLine", line.meta.guid, "synced");
    }

    await applyToLines(fixture, [
      {
        id: "insert",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        values: { Sku: "C", Position: 3 },
      },
      {
        id: "edit",
        section: "Lines",
        operation: "updateChild",
        childObject: "OrderLine",
        childId: lineId(fixture, 0),
        values: { Sku: "A-revised" },
      },
    ]);

    const entry = fixture.runtime.syncQueue.getEntries()[0];
    if (entry === undefined) throw new Error("Expected one queued batch entry.");
    for (const covered of coveredQueueRecords(entry.operation)) {
      expect(await syncStatusOf(fixture.runtime, covered.recordId)).toBe("pending");
    }
    // The record the batch did not touch is untouched by it.
    expect(await syncStatusOf(fixture.runtime, lineId(fixture, 1))).toBe("synced");
  });

  /**
   * Regression guard: the batch is answered as one operation, so its verdict is
   * equally true of every row it produced. Marking only the record the entry
   * happens to be filed under would leave the rest looking like ordinary unsent
   * work for ever — the residue Phase 58 exists to end — and would leave a
   * refused create with no discard licence.
   */
  it("marks every record a staged batch wrote as rejected when the authority refuses it", async () => {
    const fixture = await orderWithLines(["A", "B", "C"]);

    await applyToLines(fixture, [
      {
        id: "insert",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        values: { Sku: "D", Position: 3 },
      },
      {
        id: "edit",
        section: "Lines",
        operation: "updateChild",
        childObject: "OrderLine",
        childId: lineId(fixture, 1),
        values: { Sku: "B-revised" },
      },
      {
        id: "drop",
        section: "Lines",
        operation: "remove",
        childObject: "OrderLine",
        childId: lineId(fixture, 2),
      },
    ]);
    const entry = fixture.runtime.syncQueue.getEntries()[0];
    if (entry === undefined) throw new Error("Expected one queued batch entry.");
    const covered = coveredQueueRecords(entry.operation);
    expect(covered).toHaveLength(3);

    const outcomes = await new AuthoritySyncClient(fixture.runtime, refusingTransport()).reconcile(
      "session-token",
      adminContext,
    );
    // One operation, one verdict — not three.
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected"]);

    for (const record of covered) {
      expect(await syncStatusOf(fixture.runtime, record.recordId)).toBe("rejected");
    }

    // The created row is discardable because the refusal proves the authority
    // holds no copy of it; the edited row is not, because the authority still
    // holds the record whose update was refused. The removed row is a tombstone
    // and so is deliberately not offered as something to throw away.
    // `listRefusedRecords` is sorted by record id, so the pairing is asserted
    // rather than the order.
    const refused = await fixture.runtime.listRefusedRecords();
    expect(refused).toHaveLength(2);
    expect(new Map(refused.map((item) => [item.recordId, item.discardable]))).toEqual(
      new Map([
        [covered.find((record) => record.created)?.recordId, true],
        [lineId(fixture, 1), false],
      ]),
    );
    expect(refused.every((item) => item.objectName === "OrderLine")).toBe(true);
  });
});

describe("ordered children in a staged batch", () => {
  /**
   * A reorder and an insert in one batch must commit one coherent arrangement.
   *
   * Applied one at a time, moving C to position 1 shifts A and B down, and the
   * insert at position 2 then shifts them again — so A and B are each written
   * twice and the collection passes through an arrangement nobody asked for. In
   * one transaction `expandOrderedCollectionWrites` reserves *both* requested
   * positions before arranging anything, so each sibling moves exactly once, to
   * its final place.
   */
  it("commits a reorder and an insert as one coherent set of positions", async () => {
    const fixture = await orderWithLines(["A", "B", "C"]);
    const operationsBefore = fixture.runtime.operationLog.getOperations().length;

    await applyToLines(fixture, [
      {
        id: "move-c",
        section: "Lines",
        operation: "reorder",
        childObject: "OrderLine",
        childId: lineId(fixture, 2),
        position: 1,
      },
      {
        id: "insert-d",
        section: "Lines",
        operation: "createChild",
        childObject: "OrderLine",
        values: { Sku: "D", Position: 2 },
      },
    ]);

    // Both requested positions hold, the untouched siblings keep their relative
    // order behind them, and the collection is contiguous from 1 with no
    // duplicates. An intermediate arrangement would have put A or B at 2.
    expect(await skusAndPositions(fixture)).toEqual([
      ["C", 1],
      ["D", 2],
      ["A", 3],
      ["B", 4],
    ]);

    // Four records changed, and each was written exactly once. Two commits would
    // have logged A and B twice, which is the observable trace of the
    // intermediate arrangement this transaction never has.
    const written = fixture.runtime.operationLog
      .getOperations()
      .slice(operationsBefore)
      .filter((operation) => operation.operation !== "batch");
    expect(written).toHaveLength(4);
    expect(new Set(written.map((operation) => operation.recordId)).size).toBe(4);

    // And one queue entry for the whole rearrangement.
    const entries = fixture.runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.operation).toBe("batch");

    // Every row the rearrangement touched — the two the caller asked about and
    // the two the ordered constraint moved for it — is waiting on that one
    // entry, so all four report `pending`.
    const lines = await fixture.runtime.search("OrderLine", {}, adminContext);
    expect(lines.map((record) => record.meta.syncStatus)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });
});
