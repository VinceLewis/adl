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

    // The child draft inputs come from the declared child view too.
    expect(
      [...section.querySelectorAll<HTMLInputElement>("input[data-child-draft-field]")].map(
        (input) => input.dataset.childDraftField,
      ),
    ).toEqual(["Sku", "Position"]);
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
