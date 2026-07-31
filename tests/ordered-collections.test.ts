import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  PolicyDeniedError,
  RuntimeValidationError,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  ObjectStorageBackend,
  ObjectStorageSearchRequest,
  ObjectStorageTransactionWrite,
  OrderedCollectionCompaction,
  OrderedCollectionReorder,
  PartialApplicationModel,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

const fixedNow = new Date("2026-07-31T09:00:00.000Z");

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

const editorContext: RuntimeContext = {
  userId: "editor-1",
  roles: ["Editor"],
  channel: "api",
  now: fixedNow,
};

interface OrderedModelOptions {
  reorder?: OrderedCollectionReorder;
  compaction?: OrderedCollectionCompaction;
}

function createOrderedPartialModel(options: OrderedModelOptions = {}): PartialApplicationModel {
  return {
    app: { name: "OrderedCollectionDemo" },
    roles: [{ name: "Admin" }, { name: "Editor" }],
    objects: [
      {
        name: "SetList",
        businessKey: "Name",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "SetListItem",
        businessKey: "Title",
        displayField: "Title",
        fields: [
          {
            name: "SetList",
            type: "text",
            required: true,
            lookup: { targetObject: "SetList", displayField: "Name" },
          },
          { name: "Title", type: "text", required: true },
          { name: "Position", type: "number", required: true },
        ],
        constraints: [
          {
            name: "orderedSetListItems",
            kind: "ordered",
            parentField: "SetList",
            positionField: "Position",
            minPosition: 1,
            ...(options.reorder === undefined ? {} : { reorder: options.reorder }),
            ...(options.compaction === undefined ? {} : { compaction: options.compaction }),
          },
        ],
      },
    ],
    policies: [
      {
        name: "SetListPolicy",
        object: "SetList",
        rules: [
          {
            name: "allowAdminSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowEditorSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "*",
          },
        ],
      },
      {
        name: "SetListItemPolicy",
        object: "SetListItem",
        rules: [
          {
            name: "allowAdminSetListItems",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowEditorSetListItems",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "*",
          },
          {
            // The locked encore is the sibling an editor may not move, so a
            // reorder that would displace it must fail the whole transaction.
            name: "denyEditorLockedSetListItemUpdates",
            effect: "deny",
            principal: { match: "specific", roles: ["Editor"] },
            action: "update",
            condition: {
              kind: "binary",
              operator: "==",
              left: { kind: "field", field: "Title" },
              right: { kind: "literal", value: "Locked" },
            },
          },
        ],
      },
    ],
  };
}

class RecordingStorageBackend implements ObjectStorageBackend {
  readonly supportsTransactions = true;
  readonly transactions: ObjectStorageTransactionWrite[][] = [];
  singleWrites = 0;

  private readonly delegate = new InMemoryObjectStorageBackend();

  create(objectName: string, record: StoredObjectRecord): Promise<void> {
    this.singleWrites += 1;
    return this.delegate.create(objectName, record);
  }

  read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    return this.delegate.read(objectName, id);
  }

  update(objectName: string, record: StoredObjectRecord): Promise<void> {
    this.singleWrites += 1;
    return this.delegate.update(objectName, record);
  }

  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    this.singleWrites += 1;
    return this.delegate.delete(objectName, tombstone);
  }

  commitTransaction(writes: ObjectStorageTransactionWrite[]): Promise<void> {
    this.transactions.push(writes.map((write) => ({ ...write })));
    return this.delegate.commitTransaction(writes);
  }

  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    return this.delegate.search(request);
  }

  listRecords(): Promise<PersistedObjectRecord[]> {
    return this.delegate.listRecords();
  }

  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.delegate.readApplicationMetadata();
  }

  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    return this.delegate.writeApplicationMetadata(metadata);
  }
}

interface SeededOrderedRuntime {
  runtime: ApplicationRuntime;
  setListId: string;
  otherSetListId: string;
  items: Record<string, StoredObjectRecord>;
}

async function seedOrderedRuntime(
  options: OrderedModelOptions & { storage?: ObjectStorageBackend; titles?: string[] } = {},
): Promise<SeededOrderedRuntime> {
  const runtime = new ApplicationRuntime(
    resolveApplicationModel(createOrderedPartialModel(options)),
    options.storage === undefined ? {} : { storage: options.storage },
  );
  const setList = await runtime.create("SetList", { Name: "Main" }, adminContext);
  const otherSetList = await runtime.create("SetList", { Name: "Other" }, adminContext);

  const titles = options.titles ?? ["Alpha", "Bravo", "Charlie", "Delta"];
  const items: Record<string, StoredObjectRecord> = {};
  for (const [index, title] of titles.entries()) {
    items[title] = await runtime.create(
      "SetListItem",
      { SetList: setList.meta.guid, Title: title, Position: index + 1 },
      adminContext,
    );
  }

  // A second collection under a different parent proves the shift is scoped.
  items.Other = await runtime.create(
    "SetListItem",
    { SetList: otherSetList.meta.guid, Title: "Other One", Position: 1 },
    adminContext,
  );

  return {
    runtime,
    setListId: setList.meta.guid,
    otherSetListId: otherSetList.meta.guid,
    items,
  };
}

async function readOrder(
  runtime: ApplicationRuntime,
  setListId: string,
  context: RuntimeContext = adminContext,
): Promise<Array<[string, number]>> {
  const records = await runtime.search("SetListItem", {}, context);
  return records
    .filter((record) => record.values.SetList === setListId)
    .map((record): [string, number] => [
      String(record.values.Title),
      record.values.Position as number,
    ])
    .sort((left, right) => left[1] - right[1]);
}

describe("ordered collection reorder", () => {
  it("shifts siblings down when an item moves up the list", async () => {
    const seeded = await seedOrderedRuntime({ reorder: "shift" });

    const moved = await seeded.runtime.update(
      "SetListItem",
      seeded.items.Charlie?.meta.guid ?? "",
      { Position: 1 },
      adminContext,
    );

    expect(moved.values.Position).toBe(1);
    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Charlie", 1],
      ["Alpha", 2],
      ["Bravo", 3],
      ["Delta", 4],
    ]);
    // A different parent is a different collection and must not move.
    expect(await readOrder(seeded.runtime, seeded.otherSetListId)).toEqual([["Other One", 1]]);
  });

  it("shifts siblings up when an item moves down the list", async () => {
    const seeded = await seedOrderedRuntime({ reorder: "shift" });

    const moved = await seeded.runtime.update(
      "SetListItem",
      seeded.items.Alpha?.meta.guid ?? "",
      { Position: 3 },
      adminContext,
    );

    expect(moved.values.Position).toBe(3);
    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Bravo", 1],
      ["Charlie", 2],
      ["Alpha", 3],
      ["Delta", 4],
    ]);
  });

  it("makes room for a create that lands on an occupied position", async () => {
    const seeded = await seedOrderedRuntime({ reorder: "shift" });

    const created = await seeded.runtime.create(
      "SetListItem",
      { SetList: seeded.setListId, Title: "Encore", Position: 2 },
      adminContext,
    );

    expect(created.values.Position).toBe(2);
    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Encore", 2],
      ["Bravo", 3],
      ["Charlie", 4],
      ["Delta", 5],
    ]);
  });

  it("lets an existing gap absorb the shift instead of pushing it along", async () => {
    const runtime = new ApplicationRuntime(
      resolveApplicationModel(createOrderedPartialModel({ reorder: "shift" })),
    );
    const setList = await runtime.create("SetList", { Name: "Gappy" }, adminContext);
    for (const [title, position] of [
      ["Alpha", 1],
      ["Bravo", 2],
      ["Charlie", 4],
      ["Delta", 5],
    ] as const) {
      await runtime.create(
        "SetListItem",
        { SetList: setList.meta.guid, Title: title, Position: position },
        adminContext,
      );
    }

    await runtime.create(
      "SetListItem",
      { SetList: setList.meta.guid, Title: "Encore", Position: 2 },
      adminContext,
    );

    // Only Bravo moves: it lands in the free position 3, so Charlie and Delta
    // stay where they are and the collection comes out contiguous.
    expect(await readOrder(runtime, setList.meta.guid)).toEqual([
      ["Alpha", 1],
      ["Encore", 2],
      ["Bravo", 3],
      ["Charlie", 4],
      ["Delta", 5],
    ]);
  });

  it("commits a reorder as one storage transaction", async () => {
    const storage = new RecordingStorageBackend();
    const seeded = await seedOrderedRuntime({ reorder: "shift", storage });
    const singleWritesBefore = storage.singleWrites;

    await seeded.runtime.update(
      "SetListItem",
      seeded.items.Delta?.meta.guid ?? "",
      { Position: 1 },
      adminContext,
    );

    expect(storage.singleWrites).toBe(singleWritesBefore);
    expect(storage.transactions).toHaveLength(1);
    expect(storage.transactions[0]).toHaveLength(4);
    expect(storage.transactions[0]?.every((write) => write.operation === "update")).toBe(true);
  });

  it("converges when the same reorder is replayed", async () => {
    const seeded = await seedOrderedRuntime({ reorder: "shift" });
    const charlieId = seeded.items.Charlie?.meta.guid ?? "";

    await seeded.runtime.update("SetListItem", charlieId, { Position: 1 }, adminContext);
    const afterFirst = await readOrder(seeded.runtime, seeded.setListId);
    const operationsAfterFirst = seeded.runtime.operationLog.getOperations().length;

    await seeded.runtime.update("SetListItem", charlieId, { Position: 1 }, adminContext);

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual(afterFirst);
    // Only the replayed update itself is written: an item already on its
    // requested position displaces nothing.
    expect(seeded.runtime.operationLog.getOperations()).toHaveLength(operationsAfterFirst + 1);
  });

  it("still refuses a duplicate position under the strict default", async () => {
    const seeded = await seedOrderedRuntime();

    await expect(
      seeded.runtime.create(
        "SetListItem",
        { SetList: seeded.setListId, Title: "Encore", Position: 2 },
        adminContext,
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_CONSTRAINT_ORDERED_DUPLICATE" })],
    });

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Bravo", 2],
      ["Charlie", 3],
      ["Delta", 4],
    ]);
  });

  it("refuses a shift reorder that violates the minimum position", async () => {
    const seeded = await seedOrderedRuntime({ reorder: "shift" });

    await expect(
      seeded.runtime.update(
        "SetListItem",
        seeded.items.Charlie?.meta.guid ?? "",
        { Position: 0 },
        adminContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
    await expect(
      seeded.runtime.update(
        "SetListItem",
        seeded.items.Charlie?.meta.guid ?? "",
        { Position: 0 },
        adminContext,
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_CONSTRAINT_ORDERED_POSITION" })],
    });

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Bravo", 2],
      ["Charlie", 3],
      ["Delta", 4],
    ]);
  });

  it("fails the whole reorder when policy denies a generated sibling update", async () => {
    const seeded = await seedOrderedRuntime({
      reorder: "shift",
      titles: ["Locked", "Bravo", "Charlie"],
    });
    const operationsBefore = seeded.runtime.operationLog.getOperations().length;
    const auditBefore = seeded.runtime.auditService.getEvents().length;

    await expect(
      seeded.runtime.update(
        "SetListItem",
        seeded.items.Charlie?.meta.guid ?? "",
        { Position: 1 },
        editorContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Locked", 1],
      ["Bravo", 2],
      ["Charlie", 3],
    ]);
    expect(seeded.runtime.operationLog.getOperations()).toHaveLength(operationsBefore);
    expect(seeded.runtime.auditService.getEvents()).toHaveLength(auditBefore);
  });
});

describe("ordered collection compaction", () => {
  it("closes the gap left by a delete when compaction is onDelete", async () => {
    const seeded = await seedOrderedRuntime({ compaction: "onDelete" });

    await seeded.runtime.delete("SetListItem", seeded.items.Bravo?.meta.guid ?? "", adminContext);

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Charlie", 2],
      ["Delta", 3],
    ]);
    expect(await readOrder(seeded.runtime, seeded.otherSetListId)).toEqual([["Other One", 1]]);
  });

  it("leaves the gap when compaction is none", async () => {
    const seeded = await seedOrderedRuntime();

    await seeded.runtime.delete("SetListItem", seeded.items.Bravo?.meta.guid ?? "", adminContext);

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Charlie", 3],
      ["Delta", 4],
    ]);
  });

  it("keeps a delete a single storage write when there is nothing to compact", async () => {
    const storage = new RecordingStorageBackend();
    const seeded = await seedOrderedRuntime({ compaction: "onDelete", storage });
    const singleWritesBefore = storage.singleWrites;

    await seeded.runtime.delete("SetListItem", seeded.items.Delta?.meta.guid ?? "", adminContext);

    expect(storage.singleWrites).toBe(singleWritesBefore + 1);
    expect(storage.transactions).toHaveLength(0);
  });

  it("records audit and operation-log entries for the delete and every compacted sibling", async () => {
    const storage = new RecordingStorageBackend();
    const seeded = await seedOrderedRuntime({ compaction: "onDelete", storage });
    seeded.runtime.auditService.clear();
    seeded.runtime.operationLog.clear();
    const bravo = seeded.items.Bravo;
    const charlie = seeded.items.Charlie;
    const delta = seeded.items.Delta;

    const deleted = await seeded.runtime.delete(
      "SetListItem",
      bravo?.meta.guid ?? "",
      adminContext,
    );

    expect(deleted.meta.guid).toBe(bravo?.meta.guid);
    expect(deleted.meta.deletedAt).toBe(fixedNow.toISOString());

    const audit = seeded.runtime.auditService.getEvents();
    expect(audit.map((event) => [event.operation, event.recordId])).toEqual([
      ["delete", bravo?.meta.guid],
      ["update", charlie?.meta.guid],
      ["update", delta?.meta.guid],
    ]);
    expect(audit[0]).toMatchObject({
      object: "SetListItem",
      actorId: adminContext.userId,
      before: { Title: "Bravo", Position: 2 },
      after: { Title: "Bravo", Position: 2 },
    });
    expect(audit[1]).toMatchObject({
      before: { Title: "Charlie", Position: 3 },
      after: { Title: "Charlie", Position: 2 },
    });

    const operations = seeded.runtime.operationLog.getOperations();
    expect(operations.map((operation) => operation.operation)).toEqual([
      "delete",
      "update",
      "update",
    ]);
    expect(operations[0]).toMatchObject({
      object: "SetListItem",
      recordId: bravo?.meta.guid,
      baseRevision: bravo?.meta.revision,
      status: "pending",
      createdBy: adminContext.userId,
    });
    expect(operations[0]?.patch).toBeUndefined();
    // The compacting writes replay as ordinary update intents carrying only the
    // position they settled on, so no new sync operation kind is needed.
    expect(operations[1]).toMatchObject({
      recordId: charlie?.meta.guid,
      baseRevision: charlie?.meta.revision,
      patch: { Position: 2 },
    });
    expect(operations[2]).toMatchObject({
      recordId: delta?.meta.guid,
      patch: { Position: 3 },
    });
    expect(
      seeded.runtime.syncQueue
        .getEntries()
        .slice(-3)
        .map((entry) => [entry.operation.operation, entry.operation.recordId]),
    ).toEqual([
      ["delete", bravo?.meta.guid],
      ["update", charlie?.meta.guid],
      ["update", delta?.meta.guid],
    ]);

    // One transaction, one storage commit: the delete and the renumbering are
    // never separately observable.
    expect(storage.transactions).toHaveLength(1);
    expect(storage.transactions[0]?.map((write) => write.operation)).toEqual([
      "delete",
      "update",
      "update",
    ]);
  });

  it("keeps compaction inside the caller's authority", async () => {
    const seeded = await seedOrderedRuntime({
      compaction: "onDelete",
      titles: ["Alpha", "Locked", "Charlie"],
    });

    await expect(
      seeded.runtime.delete("SetListItem", seeded.items.Alpha?.meta.guid ?? "", editorContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    expect(await readOrder(seeded.runtime, seeded.setListId)).toEqual([
      ["Alpha", 1],
      ["Locked", 2],
      ["Charlie", 3],
    ]);
  });
});
