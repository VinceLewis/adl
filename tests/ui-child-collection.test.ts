// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationRuntime,
  compileAdl,
  validateApplicationModel,
  type ResolvedApplicationModel,
  type RuntimeContext,
  type StoredObjectRecord,
} from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type { StageChildOperationDetail } from "../src/ui/types.js";

/**
 * Everything here is driven from ADL source rather than a hand-built partial
 * model, because until this phase no ADL model could declare a child
 * collection at all. A fixture would prove the renderer works and prove nothing
 * about the language.
 */
const ORDER_ADL = `
APP OrderDesk
  START_VIEW OrderList
END.APP

ROLE Clerk

OBJECT Order
  KEY Code
  DISPLAY Code

  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT

  VIEW OrderList LIST
    FIELDS Code Notes
    SEARCH Code
    ACTIONS create read update
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
      OPERATIONS createChild linkExisting updateChild unlink remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
      PICKER ProductPicker
        SOURCE OBJECT OrderLine
        SELECTION multiple
        DISPLAY Sku
        SEARCH Sku
        SORT Sku ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Nothing to link.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

OBJECT OrderLine
  DISPLAY Sku

  FIELD Order TEXT LOOKUP Order DISPLAY Code
  FIELD Sku TEXT(60) REQUIRED
  FIELD Position NUMBER REQUIRED

  CONSTRAINT orderedOrderLines ORDERED PARENT Order POSITION Position REORDER shift COMPACT onDelete

  VIEW OrderLineList LIST
    FIELDS Sku Position
    SEARCH Sku
    SORT Position ASC
    ACTIONS create read update delete
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

POLICY OrderPolicy ON Order
  ALLOW * ROLE Clerk
END.POLICY

POLICY OrderLinePolicy ON OrderLine
  ALLOW * ROLE Clerk
END.POLICY
`;

/**
 * The same collection with a narrower `OPERATIONS` list, no `ORDER_FIELD` and
 * no `PICKER`. It exists to prove the browser offers what the model permits and
 * nothing else.
 */
const RESTRICTED_ORDER_ADL = ORDER_ADL.replace(
  `      OPERATIONS createChild linkExisting updateChild unlink remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
      PICKER ProductPicker
        SOURCE OBJECT OrderLine
        SELECTION multiple
        DISPLAY Sku
        SEARCH Sku
        SORT Sku ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Nothing to link.'
      END.PICKER
`,
  `      OPERATIONS createChild remove
      STAGED
      EMPTY_TEXT 'No lines yet.'
`,
);

/**
 * The same order form, except that a line is added by choosing a `Product`
 * rather than by re-parenting an existing `OrderLine`. `CANDIDATE_FIELD` names
 * the child field the chosen product's id lands in, which is what makes "add a
 * product to this order" expressible at all.
 */
const MINTING_ORDER_ADL = `
APP OrderDesk
  START_VIEW OrderList
END.APP

ROLE Clerk

OBJECT Order
  KEY Code
  DISPLAY Code

  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT

  VIEW OrderList LIST
    FIELDS Code Notes
    SEARCH Code
    ACTIONS create read update
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
      OPERATIONS createChild updateChild remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
      PICKER ProductPicker
        SOURCE OBJECT Product
        CANDIDATE_FIELD Product
        SELECTION multiple
        DISPLAY Name
        SEARCH Name
        SORT Name ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Every product is already on this order.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

OBJECT Product
  DISPLAY Name

  FIELD Name TEXT REQUIRED

  VIEW ProductList LIST
    FIELDS Name
    SEARCH Name
    ACTIONS create read update delete
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

OBJECT OrderLine
  FIELD Order TEXT LOOKUP Order DISPLAY Code
  FIELD Product TEXT REQUIRED LOOKUP Product DISPLAY Name
  FIELD Position NUMBER REQUIRED

  CONSTRAINT orderedOrderLines ORDERED PARENT Order POSITION Position REORDER shift COMPACT onDelete

  VIEW OrderLineList LIST
    FIELDS Product Position
    SORT Position ASC
    ACTIONS create read update delete
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

POLICY OrderPolicy ON Order
  ALLOW * ROLE Clerk
END.POLICY

POLICY ProductPolicy ON Product
  ALLOW * ROLE Clerk
END.POLICY

POLICY OrderLinePolicy ON OrderLine
  ALLOW * ROLE Clerk
END.POLICY
`;

/**
 * An order whose lines carry a `Product` lookup and a free-text `Note`, added
 * through the plain draft row rather than through a picker.
 *
 * It exists because inline row editing has to be proved on a collection with
 * more than one editable field and with a field that is not a text box. A single
 * text field cannot show that an untouched field stays out of the patch, and a
 * text field cannot show that a lookup is a chooser rather than a place to type
 * a record id — which is what child editors used to be.
 */
const INLINE_EDIT_ORDER_ADL = `
APP OrderDesk
  START_VIEW OrderList
END.APP

ROLE Clerk

OBJECT Order
  KEY Code
  DISPLAY Code

  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT

  VIEW OrderList LIST
    FIELDS Code Notes
    SEARCH Code
    ACTIONS create read update
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
      OPERATIONS createChild updateChild remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
    END.CHILD_COLLECTION
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

OBJECT Product
  DISPLAY Name

  FIELD Name TEXT REQUIRED

  VIEW ProductList LIST
    FIELDS Name
    SEARCH Name
    ACTIONS create read update delete
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

OBJECT OrderLine
  FIELD Order TEXT LOOKUP Order DISPLAY Code
  FIELD Product TEXT REQUIRED LOOKUP Product DISPLAY Name
  FIELD Note TEXT
  FIELD Position NUMBER REQUIRED

  CONSTRAINT orderedOrderLines ORDERED PARENT Order POSITION Position REORDER shift COMPACT onDelete

  VIEW OrderLineList LIST
    FIELDS Product Note Position
    SORT Position ASC
    ACTIONS create read update delete
  END.VIEW

  SYNC LOCAL_FIRST SCOPE All CONFLICT Manual
END.OBJECT

POLICY OrderPolicy ON Order
  ALLOW * ROLE Clerk
END.POLICY

POLICY ProductPolicy ON Product
  ALLOW * ROLE Clerk
END.POLICY

POLICY OrderLinePolicy ON OrderLine
  ALLOW * ROLE Clerk
END.POLICY
`;

const seedContext: RuntimeContext = {
  userId: "seed-clerk",
  roles: ["Clerk"],
  channel: "api",
  now: new Date("2026-07-31T08:00:00.000Z"),
};

const clerkContext: RuntimeContext = {
  userId: "clerk-1",
  roles: ["Clerk"],
  channel: "ui",
  now: new Date("2026-07-31T08:00:00.000Z"),
};

describe("ADL-declared child collections in the browser", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("compiles the declaration into the resolved edit-surface shape", () => {
    const { model } = compileOrderModel();
    const form = model.objects
      .find((object) => object.name === "Order")
      ?.views.find((view) => view.name === "OrderForm");
    const section = form?.editSections.find((candidate) => candidate.name === "Lines");

    expect(form?.editContainer).toBe("page");
    expect(form?.editSections.map((candidate) => candidate.name)).toEqual(["Details", "Lines"]);
    expect(section).toMatchObject({
      kind: "childCollection",
      heading: "Lines",
      childObject: "OrderLine",
      parentField: "Order",
      childView: "OrderLineList",
      operations: ["createChild", "linkExisting", "updateChild", "unlink", "remove", "reorder"],
      staged: true,
      orderField: "Position",
      emptyState: { text: "No lines yet." },
      picker: {
        name: "ProductPicker",
        sourceKind: "object",
        source: "OrderLine",
        selection: "multiple",
        displayFields: ["Sku"],
        searchFields: ["Sku"],
        excludeAlreadyLinked: true,
        emptyState: { text: "Nothing to link." },
      },
    });
  });

  it("renders the declared child rows, child-view fields and section actions", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const details = requireElement<HTMLElement>(app, "[data-edit-section='Details']");
    expect(details.querySelector("h3")?.textContent?.trim()).toBe("Order");
    expect(details.querySelector("adl-field-renderer[data-field-slot='Code']")).not.toBeNull();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(section.querySelector("h3")?.textContent?.trim()).toBe("Lines");

    // The child view names the fields, and the parent lookup is never one of
    // them: it is what the section is filtering on.
    expect(childRowValues(section)).toEqual([
      ["Amp", "1"],
      ["Cable", "2"],
      ["Mic", "3"],
    ]);
    expect(section.textContent).not.toContain("ORD-1");

    expect(sectionActionLabels(section)).toEqual(["Link", "Add"]);
    expect(rowActionLabels(section)[0]).toEqual(["Edit", "Unlink", "Remove"]);

    // The child draft fields come from the declared child view, and are rendered
    // by the platform's field renderer rather than as bare inputs — so a lookup
    // is a chooser here exactly as it is on the parent form. `Position` is absent
    // because it is the section's order field: a new child is appended, and
    // asking for a position beside that would be a second source of truth.
    expect(
      [
        ...section.querySelectorAll<HTMLElement>(
          "[data-child-draft-section] , [data-child-draft] adl-field-renderer",
        ),
      ]
        .filter((element) => element.tagName.toLowerCase() === "adl-field-renderer")
        .map((element) => element.dataset.childFieldSlot),
    ).toEqual(["Sku"]);
  });

  it("renders the declared empty text when a parent has no children", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-2");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(section.querySelector(".adl-child-rows")).toBeNull();
    expect(section.querySelector(".adl-empty")?.textContent?.trim()).toBe("No lines yet.");
  });

  it("opens the declared relationship picker and excludes already-linked candidates", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    openPicker(app);
    await flushUi();

    const picker = requireElement<HTMLElement>(app, ".adl-relationship-picker");
    expect(picker.querySelector("h3")?.textContent?.trim()).toBe("Product Picker");

    const candidates = [
      ...picker.querySelectorAll<HTMLInputElement>("input[data-picker-candidate]"),
    ];
    expect(candidates.map((input) => input.type)).toEqual(["checkbox"]);
    expect(
      [...picker.querySelectorAll(".adl-relationship-picker-row span")].map(labelText),
    ).toEqual(["Spare"]);
  });

  it("offers only the operations the model permits", async () => {
    const seeded = await seedOrders(RESTRICTED_ORDER_ADL);
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(sectionActionLabels(section)).toEqual(["Add"]);
    expect(rowActionLabels(section)[0]).toEqual(["Remove"]);
    expect(section.querySelectorAll("[data-child-reorder]")).toHaveLength(0);
    expect(section.querySelectorAll("[data-child-reorder-controls]")).toHaveLength(0);
  });

  it("renders reorder controls disabled at the ends of the collection", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(section.querySelectorAll("[data-child-reorder-controls]")).toHaveLength(3);
    expect(reorderDisabledMatrix(section)).toEqual([
      { up: true, down: false },
      { up: false, down: false },
      { up: false, down: true },
    ]);

    const rows = [...section.querySelectorAll<HTMLElement>(".adl-child-row")];
    expect(rows.map((row) => row.getAttribute("draggable"))).toEqual(["true", "true", "true"]);
    expect(rows.map((row) => row.dataset.childRowPosition)).toEqual(["1", "2", "3"]);
  });

  it("stages a reorder instead of writing the child record from the DOM handler", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    clickReorder(app, 0, "down");
    await flushUi();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRowValues(section).map((values) => values[0])).toEqual(["Cable", "Amp", "Mic"]);

    // Nothing has been written: the staged operation is still only intent.
    expect(await storedLinePositions(seeded)).toEqual([
      ["Amp", 1],
      ["Cable", 2],
      ["Mic", 3],
    ]);
  });

  it("applies a staged reorder through the runtime when the parent is saved", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    clickReorder(app, 2, "up");
    await flushUi();
    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    // Sorted by SKU: Mic took position 2 and shifted Cable down to 3.
    expect(await storedLinePositions(seeded)).toEqual([
      ["Amp", 1],
      ["Cable", 3],
      ["Mic", 2],
    ]);
  });

  it("collapses repeated reorders of one row into a single staged operation", async () => {
    const seeded = await seedOrders();
    const applyStaged = vi.spyOn(seeded.runtime, "applyStagedChildChanges");
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    clickReorder(app, 0, "down");
    await flushUi();
    clickReorder(app, 1, "down");
    await flushUi();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRowValues(section).map((values) => values[0])).toEqual(["Cable", "Mic", "Amp"]);

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    // A staged batch commits as one transaction whose writes are planned against
    // pre-transaction state, so two operations naming the same child would be
    // last-write-wins. Exactly one survives, and it carries the final position.
    const staged = applyStaged.mock.calls[0]?.[0].stagedChanges ?? [];
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ operation: "reorder", position: 3 });

    expect(await storedLinePositions(seeded)).toEqual([
      ["Amp", 3],
      ["Cable", 1],
      ["Mic", 2],
    ]);
  });

  it("stages the same reorder when a row is dragged onto another row", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const rows = [
      ...requireElement<HTMLElement>(
        app,
        "[data-child-section='Lines']",
      ).querySelectorAll<HTMLElement>(".adl-child-row"),
    ];
    rows[2]?.dispatchEvent(new Event("dragstart", { bubbles: true }));
    rows[0]?.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    rows[0]?.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    await flushUi();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRowValues(section).map((values) => values[0])).toEqual(["Mic", "Amp", "Cable"]);
    expect(await storedLinePositions(seeded)).toEqual([
      ["Amp", 1],
      ["Cable", 2],
      ["Mic", 3],
    ]);
  });

  it("stages a link from the picker without writing the child record", async () => {
    const seeded = await seedOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    openPicker(app);
    await flushUi();
    requireElement<HTMLInputElement>(app, "input[data-picker-candidate]").checked = true;
    requireElement<HTMLButtonElement>(app, "button[data-picker-action='add']").click();
    await flushUi();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRowValues(section).map((values) => values[0])).toEqual([
      "Amp",
      "Cable",
      "Mic",
      "Spare",
    ]);
    expect(await linkedSkus(seeded)).toEqual(["Amp", "Cable", "Mic"]);

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    expect(await linkedSkus(seeded)).toEqual(["Amp", "Cable", "Mic", "Spare"]);
  });

  /**
   * A minting picker is the way a child is added, so the header carries one
   * control and the bare draft row is gone. The draft row asked the person to
   * type the chosen record's id into a text box, which is the defect
   * `CANDIDATE_FIELD` exists to close.
   */
  it("offers a single Add control and no draft row when the picker mints children", async () => {
    const seeded = await seedCatalogue();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    // One control, and it is the one that opens the picker: a minting picker
    // labels it "Add" because the record the person chooses does not exist as a
    // child yet.
    expect(sectionActionLabels(section)).toEqual(["Add"]);
    const controls = [...section.querySelectorAll<HTMLButtonElement>("button[data-picker-open]")];
    expect(controls.map(labelText)).toEqual(["Add"]);
    expect(section.querySelector("[data-child-draft]")).toBeNull();
    expect(section.querySelectorAll("input[data-child-draft-field]")).toHaveLength(0);
  });

  it("stages createChild operations carrying the chosen candidate and writes nothing until save", async () => {
    const seeded = await seedCatalogue();
    const applyStaged = vi.spyOn(seeded.runtime, "applyStagedChildChanges");
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    openPicker(app);
    await flushUi();

    const picker = requireElement<HTMLElement>(app, ".adl-relationship-picker");
    // Amp is already on the order. Exclusion compares the product each existing
    // line *names*, so the line's own id never enters into it.
    expect(
      [...picker.querySelectorAll(".adl-relationship-picker-row span")].map(labelText),
    ).toEqual(["Cable", "Mic"]);

    for (const candidate of picker.querySelectorAll<HTMLInputElement>(
      "input[data-picker-candidate]",
    )) {
      candidate.checked = true;
    }
    requireElement<HTMLButtonElement>(app, "button[data-picker-action='add']").click();
    await flushUi();

    // Staged, not written: the order still holds only the line it was seeded
    // with.
    expect(await orderedProducts(seeded)).toEqual([["Amp", 1]]);

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    // Each ticked product produced a `createChild` carrying that product's id in
    // the declared candidate field — never a `childId`, which would have named
    // the product's record as though it were the line's.
    const staged = applyStaged.mock.calls[0]?.[0].stagedChanges ?? [];
    expect(
      staged.map((operation) => [operation.operation, operation.childObject, operation.values]),
    ).toEqual([
      ["createChild", "OrderLine", { Product: productId(seeded, "Cable") }],
      ["createChild", "OrderLine", { Product: productId(seeded, "Mic") }],
    ]);
    expect(staged.every((operation) => operation.childId === undefined)).toBe(true);

    // Nothing supplied a position, so the runtime appended each new line to the
    // end of the ordered collection in the order the products were chosen.
    expect(await orderedProducts(seeded)).toEqual([
      ["Amp", 1],
      ["Cable", 2],
      ["Mic", 3],
    ]);
  });
});

/**
 * Editing a child row in place.
 *
 * The row `Edit` control used to dispatch `updateChild` with no values at all,
 * which planned a patch of nothing: a control that looked enabled, wrote nothing
 * a person would recognise as an edit, and still burned a revision and a queue
 * entry. Every case here turns on the distinction that fix rests on — opening a
 * row is not staging, and saving one stages only what actually changed.
 */
describe("inline editing of a child row", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("opens the row without staging anything and offers Save and Cancel in place of Edit", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");
    const staged = captureStagedOperations(app);
    const before = await storedLines(seeded);

    openRowEditor(app, 0);
    await flushUi();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = childRow(section, 0);
    expect(row.classList.contains("adl-child-editor")).toBe(true);

    // Save and Cancel are the only moves while the row is open; Remove is not a
    // move *of* the editor and stays. Edit itself is gone, because re-opening an
    // open row is not a thing to offer.
    expect(rowActionLabels(section)[0]).toEqual(["Save", "Cancel", "Remove"]);
    expect(row.querySelectorAll("button[data-child-action='updateChild']")).toHaveLength(0);

    // The value cells are editors now, not read-only text. Direct children only:
    // a field renderer has spans of its own, for the required marker and the
    // policy badge.
    expect(row.querySelectorAll(".adl-child-row-values > span")).toHaveLength(0);
    expect(childEditorSlots(section, rowId(section, 0))).toEqual(["Product", "Note"]);

    // Opening an editor changes nothing about the record, so nothing is staged
    // and nothing is written. This is the whole of the defect being closed.
    expect(staged).toEqual([]);
    expect(await storedLines(seeded)).toEqual(before);
  });

  it("stages one updateChild carrying only the field that changed", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");
    const staged = captureStagedOperations(app);

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    const lineId = childRecordId(section, 0);
    openRowEditor(app, 0);
    await flushUi();

    setChildEditorValue(app, "Lines", row, "Note", "Fragile");
    clickRowEditControl(app, "Lines", row, "save");
    await flushUi();

    expect(staged.map((detail) => [detail.operation, detail.childId, detail.values])).toEqual([
      ["updateChild", lineId, { Note: "Fragile" }],
    ]);
    // `Product` was rendered, held a value and was never touched. A patch that
    // carried it would write the row back over itself, which is what a diffless
    // collector does.
    expect(Object.keys(staged[0]?.values ?? {})).toEqual(["Note"]);

    // Staged, not written: the line still reads as it was seeded.
    expect(await storedLines(seeded)).toEqual([
      ["Amp", "Boxed", 1],
      ["Cable", "Loose", 2],
    ]);

    // The row is closed, so the editor is not still sitting open over a change
    // that has already been taken.
    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRow(reread, 0).classList.contains("adl-child-editor")).toBe(false);
  });

  /**
   * DEFECT (failing on purpose — see the report for this task).
   *
   * A staged inline edit is invisible until the parent is saved. The row closes
   * and shows the value it had before, with nothing anywhere to say a change is
   * waiting, so a person who edits a row sees exactly what they saw when the
   * control did nothing at all — which is the failure mode this whole change
   * exists to remove.
   *
   * It is an omission in the runtime rather than in the browser:
   * `EditSurfaceRuntime.evaluateStagedChildRows`
   * (`src/runtime/edit-surface-runtime.ts:535-571`) only turns `createChild` and
   * `linkExisting` into rows, and `toPersistedChildRow` (line 516) copies
   * `record.values` untouched, so no staged `updateChild` is ever overlaid on the
   * row it names. Every other staged operation in this section *is* reflected
   * before the parent is saved: a staged create and a staged link render as rows,
   * a staged remove takes its row away, and `adl-form-view.orderedChildRows`
   * (`src/ui/components/adl-form-view.ts:914-936`) replays staged reorders into
   * the rendered order. Only `updateChild` is dropped.
   *
   * Not fixed here: this task owns tests only.
   */
  it("shows a staged inline edit on the row it changed", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    openRowEditor(app, 0);
    await flushUi();
    setChildEditorValue(app, "Lines", row, "Note", "Fragile");
    clickRowEditControl(app, "Lines", row, "save");
    await flushUi();

    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRowValues(reread)[0]).toEqual(["Amp", "Fragile", "1"]);
  });

  it("stages nothing when a row editor is saved without a change", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");
    const staged = captureStagedOperations(app);
    const before = await storedLines(seeded);

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    openRowEditor(app, 0);
    await flushUi();
    clickRowEditControl(app, "Lines", row, "save");
    await flushUi();

    expect(staged).toEqual([]);
    expect(await storedLines(seeded)).toEqual(before);

    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRow(reread, 0).classList.contains("adl-child-editor")).toBe(false);
    expect(rowActionLabels(reread)[0]).toEqual(["Edit", "Remove"]);
  });

  it("stages nothing when a row editor is cancelled", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");
    const staged = captureStagedOperations(app);
    const before = await storedLines(seeded);

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    openRowEditor(app, 0);
    await flushUi();
    setChildEditorValue(app, "Lines", row, "Note", "Discarded");
    clickRowEditControl(app, "Lines", row, "cancel");
    await flushUi();

    expect(staged).toEqual([]);
    expect(await storedLines(seeded)).toEqual(before);

    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    expect(childRow(reread, 0).classList.contains("adl-child-editor")).toBe(false);
    expect(childRowValues(reread)[0]).toEqual(["Amp", "Boxed", "1"]);
  });

  it("commits an inline edit inside the staged batch rather than as a separate write", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");
    // Cleared after the seed writes and after opening, so every queue assertion
    // below describes what saving the parent did.
    seeded.runtime.syncQueue.clear();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    const lineId = childRecordId(section, 0);
    openRowEditor(app, 0);
    await flushUi();
    setChildEditorValue(app, "Lines", row, "Note", "Fragile");
    clickRowEditControl(app, "Lines", row, "save");
    await flushUi();
    expect(seeded.runtime.syncQueue.getEntries()).toEqual([]);

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    expect(await storedLines(seeded)).toEqual([
      ["Amp", "Fragile", 1],
      ["Cable", "Loose", 2],
    ]);

    // One transaction, so one queue entry of kind `batch`. An inline edit that
    // wrote on its own would show up here as a second `update` entry.
    const entries = seeded.runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.operation).toBe("batch");
    expect(entries[0]?.operation.batch?.writes).toEqual([
      expect.objectContaining({
        operation: "update",
        objectName: "OrderLine",
        recordId: lineId,
        patch: { Note: "Fragile" },
      }),
    ]);
  });

  it("renders a child lookup as a chooser populated from the target object, in the row editor and the draft row", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const row = rowId(section, 0);
    openRowEditor(app, 0);
    // Options are loaded through the policy-enforcing `runtime.search` after the
    // first paint, so the chooser fills in on a later turn.
    await flushUi();
    await flushUi();

    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    const editor = childEditorField(reread, row, "Product");
    const editorChooser = requireElement<HTMLSelectElement>(editor, "select[data-field-input]");
    // Every product, by name — not a text box asking for `product-…`, which is
    // what a bare `<input type="text">` made a child lookup mean.
    expect(optionLabels(editorChooser)).toEqual(["Amp", "Cable", "Mic"]);
    expect(editorChooser.value).toBe(productId(seeded, "Amp"));

    const draft = childDraftField(reread, "Product");
    const draftChooser = requireElement<HTMLSelectElement>(draft, "select[data-field-input]");
    expect(optionLabels(draftChooser)).toEqual(["Amp", "Cable", "Mic"]);
    // Nothing is chosen yet on a new child, and the empty option is a prompt
    // rather than a product.
    expect(draftChooser.value).toBe("");

    // A plain text field beside it is still a text box: the change is that the
    // control follows the field, not that everything became a select.
    expect(
      requireElement<HTMLInputElement>(childDraftField(reread, "Note"), "input[data-field-input]")
        .type,
    ).toBe("text");
  });

  it("excludes the section's order field from the row editor and the draft row", async () => {
    const seeded = await seedInlineOrders();
    const app = await mountApp(seeded);
    await openOrder(app, "ORD-1");

    const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    // The order field is part of the child view and is shown on a closed row, so
    // its absence below is about editing rather than about the field being
    // unknown to the section.
    expect(childRowValues(section)[0]).toEqual(["Amp", "Boxed", "1"]);
    expect(childDraftSlots(section)).toEqual(["Product", "Note"]);

    const row = rowId(section, 0);
    openRowEditor(app, 0);
    await flushUi();

    const reread = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
    // A new child is appended and reordering has its own controls, so a typed
    // position would be a second source of truth for the same thing.
    expect(childEditorSlots(reread, row)).toEqual(["Product", "Note"]);
    expect(childDraftSlots(reread)).toEqual(["Product", "Note"]);
  });
});

interface SeededOrders {
  model: ResolvedApplicationModel;
  runtime: ApplicationRuntime;
}

function compileOrderModel(source = ORDER_ADL): { model: ResolvedApplicationModel } {
  const result = compileAdl(source);
  expect(result.diagnostics).toEqual([]);
  expect(validateApplicationModel(result.model)).toEqual([]);
  return { model: result.model };
}

async function seedOrders(source = ORDER_ADL): Promise<SeededOrders> {
  const { model } = compileOrderModel(source);
  const runtime = new ApplicationRuntime(model);

  const order = await runtime.create("Order", { Code: "ORD-1", Notes: "First" }, seedContext);
  await runtime.create("Order", { Code: "ORD-2", Notes: "Empty" }, seedContext);
  await runtime.create(
    "OrderLine",
    { Order: order.meta.guid, Sku: "Amp", Position: 1 },
    seedContext,
  );
  await runtime.create(
    "OrderLine",
    { Order: order.meta.guid, Sku: "Cable", Position: 2 },
    seedContext,
  );
  await runtime.create(
    "OrderLine",
    { Order: order.meta.guid, Sku: "Mic", Position: 3 },
    seedContext,
  );
  // Unlinked, so the picker has exactly one candidate that is not already
  // linked to ORD-1.
  await runtime.create("OrderLine", { Sku: "Spare", Position: 1 }, seedContext);

  return { model, runtime };
}

interface SeededCatalogue extends SeededOrders {
  products: Map<string, string>;
}

/** An order holding one line for `Amp`, in a catalogue of three products. */
async function seedCatalogue(): Promise<SeededCatalogue> {
  const { model } = compileOrderModel(MINTING_ORDER_ADL);
  const runtime = new ApplicationRuntime(model);

  const order = await runtime.create("Order", { Code: "ORD-1", Notes: "First" }, seedContext);
  const products = new Map<string, string>();
  for (const name of ["Amp", "Cable", "Mic"]) {
    const product = await runtime.create("Product", { Name: name }, seedContext);
    products.set(name, product.meta.guid);
  }
  await runtime.create(
    "OrderLine",
    { Order: order.meta.guid, Product: products.get("Amp") ?? "", Position: 1 },
    seedContext,
  );

  return { model, runtime, products };
}

function productId(seeded: SeededCatalogue, name: string): string {
  const id = seeded.products.get(name);
  if (id === undefined) {
    throw new Error(`No seeded product '${name}'.`);
  }
  return id;
}

/** The products this order's lines name, in position order. */
async function orderedProducts(seeded: SeededCatalogue): Promise<[string, number][]> {
  const names = new Map([...seeded.products].map(([name, id]) => [id, name]));
  const lines = await seeded.runtime.search(
    "OrderLine",
    { sort: [{ field: "Position", direction: "asc" }] },
    seedContext,
  );
  return lines.map((line): [string, number] => [
    names.get(String(line.values.Product)) ?? String(line.values.Product),
    Number(line.values.Position),
  ]);
}

/**
 * Clicks the section's one picker control.
 *
 * Exactly one, because the header used to carry a separate Link and Add pair
 * and a second control would mean the two entry points had come back apart.
 */
function openPicker(app: AdlAppElement, section = "Lines"): void {
  const controls = [
    ...app.querySelectorAll<HTMLButtonElement>(`button[data-picker-open='${section}']`),
  ];
  if (controls.length !== 1) {
    throw new Error(
      `Expected exactly one control opening the '${section}' picker, found ${controls.length}.`,
    );
  }

  controls[0]?.click();
}

async function mountApp(seeded: SeededOrders): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = seeded.model;
  app.runtime = seeded.runtime;
  app.context = clerkContext;
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

async function openOrder(app: AdlAppElement, code: string): Promise<void> {
  const row = [...app.querySelectorAll<HTMLTableRowElement>("tr[data-record-id]")].find(
    (candidate) => candidate.textContent?.includes(code),
  );
  if (row === undefined) {
    throw new Error(`No list row for order '${code}'. Rows: ${app.textContent ?? ""}`);
  }

  row.click();
  await flushUi();
  await flushUi();
}

function clickReorder(app: AdlAppElement, rowIndex: number, direction: "up" | "down"): void {
  const section = requireElement<HTMLElement>(app, "[data-child-section='Lines']");
  const row = [...section.querySelectorAll<HTMLElement>(".adl-child-row")][rowIndex];
  if (row === undefined) {
    throw new Error(`No child row at index ${rowIndex}.`);
  }

  const button = row.querySelector<HTMLButtonElement>(`button[data-child-reorder='${direction}']`);
  if (button === null) {
    throw new Error(`No '${direction}' reorder control on child row ${rowIndex}.`);
  }
  if (button.disabled) {
    throw new Error(`The '${direction}' reorder control on child row ${rowIndex} is disabled.`);
  }

  button.click();
}

function childRowValues(section: HTMLElement): string[][] {
  return [...section.querySelectorAll<HTMLElement>(".adl-child-row")].map((row) =>
    [...row.querySelectorAll(".adl-child-row-values span")].map(labelText),
  );
}

/**
 * Every control in the section header, however it is wired.
 *
 * The control that opens a picker carries `data-picker-open` rather than
 * `data-child-action`, so selecting only the latter would silently stop seeing
 * the picker control instead of reporting that it had gone.
 */
function sectionActionLabels(section: HTMLElement): string[] {
  return [...section.querySelectorAll<HTMLButtonElement>(".adl-child-section-actions button")].map(
    labelText,
  );
}

function rowActionLabels(section: HTMLElement): string[][] {
  return [...section.querySelectorAll<HTMLElement>(".adl-child-row")].map((row) =>
    [...row.querySelectorAll<HTMLButtonElement>(".adl-child-row-actions button")].map(labelText),
  );
}

function reorderDisabledMatrix(section: HTMLElement): { up: boolean; down: boolean }[] {
  return [...section.querySelectorAll<HTMLElement>(".adl-child-row")].map((row) => ({
    up: requireElement<HTMLButtonElement>(row, "button[data-child-reorder='up']").disabled,
    down: requireElement<HTMLButtonElement>(row, "button[data-child-reorder='down']").disabled,
  }));
}

async function storedLinePositions(seeded: SeededOrders): Promise<[string, number][]> {
  const lines = await seeded.runtime.search("OrderLine", {}, seedContext);
  return lines
    .filter((line) => typeof line.values.Order === "string")
    .map((line): [string, number] => [String(line.values.Sku), Number(line.values.Position)])
    .sort((left, right) => left[0].localeCompare(right[0], "en"));
}

async function linkedSkus(seeded: SeededOrders): Promise<string[]> {
  const order = await findOrder(seeded, "ORD-1");
  const lines = await seeded.runtime.search("OrderLine", {}, seedContext);
  return lines
    .filter((line) => line.values.Order === order.meta.guid)
    .map((line) => String(line.values.Sku))
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function findOrder(seeded: SeededOrders, code: string): Promise<StoredObjectRecord> {
  const orders = await seeded.runtime.search("Order", {}, seedContext);
  const order = orders.find((candidate) => candidate.values.Code === code);
  if (order === undefined) {
    throw new Error(`No order '${code}'.`);
  }
  return order;
}

/** An order holding two lines, in a catalogue of three products. */
async function seedInlineOrders(): Promise<SeededCatalogue> {
  const { model } = compileOrderModel(INLINE_EDIT_ORDER_ADL);
  const runtime = new ApplicationRuntime(model);

  const order = await runtime.create("Order", { Code: "ORD-1", Notes: "First" }, seedContext);
  const products = new Map<string, string>();
  for (const name of ["Amp", "Cable", "Mic"]) {
    const product = await runtime.create("Product", { Name: name }, seedContext);
    products.set(name, product.meta.guid);
  }
  for (const [index, [name, note]] of [
    ["Amp", "Boxed"],
    ["Cable", "Loose"],
  ].entries()) {
    await runtime.create(
      "OrderLine",
      {
        Order: order.meta.guid,
        Product: products.get(name ?? "") ?? "",
        Note: note ?? "",
        Position: index + 1,
      },
      seedContext,
    );
  }

  return { model, runtime, products };
}

/** Every line of the seeded order as `[product name, note, position]`. */
async function storedLines(seeded: SeededCatalogue): Promise<[string, string, number][]> {
  const names = new Map([...seeded.products].map(([name, id]) => [id, name]));
  const lines = await seeded.runtime.search(
    "OrderLine",
    { sort: [{ field: "Position", direction: "asc" }] },
    seedContext,
  );
  return lines.map((line): [string, string, number] => [
    names.get(String(line.values.Product)) ?? String(line.values.Product),
    String(line.values.Note ?? ""),
    Number(line.values.Position),
  ]);
}

/**
 * Records every child operation the form stages, in order.
 *
 * The staged list lives inside `adl-app`, so it is observed here through the
 * events that build it. That is the honest surface: a case asserting "nothing was
 * staged" has to see the absence of the dispatch, not merely the absence of a
 * write, because the write only happens when the parent is saved.
 */
function captureStagedOperations(app: AdlAppElement): StageChildOperationDetail[] {
  const staged: StageChildOperationDetail[] = [];
  app.addEventListener("adl-stage-child-operation", (event) => {
    staged.push((event as CustomEvent<StageChildOperationDetail>).detail);
  });
  return staged;
}

function childRow(section: HTMLElement, index: number): HTMLElement {
  const row = [...section.querySelectorAll<HTMLElement>(".adl-child-row")][index];
  if (row === undefined) {
    throw new Error(`No child row at index ${index}.`);
  }
  return row;
}

/** The child record a row names, which is what a staged operation must carry. */
function childRecordId(section: HTMLElement, index: number): string {
  const id = childRow(section, index).dataset.childId;
  if (id === undefined) {
    throw new Error(`Child row ${index} names no persisted record.`);
  }
  return id;
}

function rowId(section: HTMLElement, index: number): string {
  const id = childRow(section, index).dataset.childRow;
  if (id === undefined) {
    throw new Error(`Child row ${index} carries no row id.`);
  }
  return id;
}

/** Clicks a row's `Edit` control, which opens the row rather than staging. */
function openRowEditor(app: AdlAppElement, index: number, sectionName = "Lines"): void {
  const section = requireElement<HTMLElement>(app, `[data-child-section='${sectionName}']`);
  const button = requireElement<HTMLButtonElement>(
    childRow(section, index),
    "button[data-child-action='updateChild']",
  );
  if (button.disabled) {
    throw new Error(`The Edit control on child row ${index} is disabled.`);
  }
  button.click();
}

function clickRowEditControl(
  app: AdlAppElement,
  sectionName: string,
  row: string,
  kind: "save" | "cancel",
): void {
  requireElement<HTMLButtonElement>(
    app,
    `button[data-child-edit='${kind}'][data-child-section='${sectionName}'][data-child-action-row='${row}']`,
  ).click();
}

function childEditorField(section: HTMLElement, row: string, fieldName: string): HTMLElement {
  return requireElement<HTMLElement>(
    section,
    `adl-field-renderer[data-child-editor='${section.dataset.childSection ?? ""}'][data-child-editor-row='${row}'][data-child-field-slot='${fieldName}']`,
  );
}

function childDraftField(section: HTMLElement, fieldName: string): HTMLElement {
  return requireElement<HTMLElement>(
    section,
    `adl-field-renderer[data-child-draft-section='${section.dataset.childSection ?? ""}'][data-child-field-slot='${fieldName}']`,
  );
}

function childEditorSlots(section: HTMLElement, row: string): (string | undefined)[] {
  return [
    ...section.querySelectorAll<HTMLElement>(`adl-field-renderer[data-child-editor-row='${row}']`),
  ].map((renderer) => renderer.dataset.childFieldSlot);
}

function childDraftSlots(section: HTMLElement): (string | undefined)[] {
  return [
    ...section.querySelectorAll<HTMLElement>("adl-field-renderer[data-child-draft-section]"),
  ].map((renderer) => renderer.dataset.childFieldSlot);
}

/**
 * Types into one field of an open row editor.
 *
 * A child field is an `adl-field-renderer`, so the value goes on the control the
 * renderer reads back through `getValue()`. Focus is load-bearing rather than
 * decorative: the form decides whether an input belongs to the parent draft or to
 * a surface it owns by asking where focus is, and without it a parent draft
 * change would recreate the form and wipe what is being typed.
 */
function setChildEditorValue(
  app: AdlAppElement,
  sectionName: string,
  row: string,
  fieldName: string,
  value: string,
): void {
  const section = requireElement<HTMLElement>(app, `[data-child-section='${sectionName}']`);
  const input = requireElement<HTMLInputElement | HTMLSelectElement>(
    childEditorField(section, row, fieldName),
    "[data-field-input]",
  );
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].filter((option) => option.value !== "").map(labelText);
}

function labelText(element: Element): string {
  return element.textContent?.trim() ?? "";
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}
