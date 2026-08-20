import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdlProject } from "../src/compiler/compile-adl-project.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project-v2.js";
import { validateApplicationModel } from "../src/compiler/validate-model.js";

function readMultiSourceExample(name: string): string {
  return readFileSync(new URL(`../examples/multi-source/${name}`, import.meta.url), "utf8");
}

describe("compileAdlProjectV2", () => {
  it("merges several .adlj files: array concatenation and the view-only-object merge rule both work", () => {
    const result = compileAdlProjectV2({
      manifestSource: readMultiSourceExample("adlj-only-app.yaml"),
      sources: {
        "tasks-core.adlj": readMultiSourceExample("tasks-core.adlj"),
        "tasks-views.adlj": readMultiSourceExample("tasks-views.adlj"),
        "tasks-policy.adlj": readMultiSourceExample("tasks-policy.adlj"),
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);

    // "first fragment that declares APP wins": tasks-core.adlj is listed
    // first, so its app name wins over the other two files' app blocks.
    expect(result.model.app.name).toBe("TaskTrackerMultiSource");

    // Exactly one Task object: tasks-views.adlj's view-only Task declaration
    // merged onto tasks-core.adlj's full declaration rather than colliding.
    const taskObjects = result.model.objects.filter((object) => object.name === "Task");
    expect(taskObjects).toHaveLength(1);
    expect(taskObjects[0]?.fields.map((field) => field.name)).toEqual([
      "Title",
      "Priority",
      "Status",
    ]);
    expect(taskObjects[0]?.views.map((view) => view.name)).toEqual(["TaskList"]);

    // Array concatenation: the policy declared in the third file reaches the
    // merged model (alongside the resolver's own generated default-deny
    // policy for Task, unrelated to this merge).
    const taskPolicy = result.model.policies.find((policy) => policy.name === "TaskPolicy");
    expect(taskPolicy).toBeDefined();
    const rule = taskPolicy?.rules.find((r) => r.name === "allowTransition2");
    expect(rule).toMatchObject({ action: "transition", lifecycleAction: "close" });
  });

  it("compiles a mixed .adl + .adlj project into one valid resolved model", () => {
    const result = compileAdlProjectV2({
      manifestSource: readMultiSourceExample("mixed-app.yaml"),
      sources: {
        "domain.adl": readMultiSourceExample("domain.adl"),
        "extra.adlj": readMultiSourceExample("extra.adlj"),
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);

    // The .adl source (domain.adl) is listed first, so its APP declaration
    // wins over extra.adlj's.
    expect(result.model.app.name).toBe("TaskTrackerMixedSource");

    const taskObjects = result.model.objects.filter((object) => object.name === "Task");
    expect(taskObjects).toHaveLength(1);
    expect(taskObjects[0]?.fields.map((field) => field.name)).toEqual([
      "Title",
      "Priority",
      "Status",
    ]);
    // extra.adlj's view-only Task declaration merged onto domain.adl's object.
    expect(taskObjects[0]?.views.map((view) => view.name)).toEqual(["TaskList"]);

    expect(result.model.policies.find((policy) => policy.name === "TaskPolicy")).toBeDefined();
  });

  it("leaves compileAdlProject's existing behaviour on plain `.adl` text unchanged", () => {
    // The regression proof that `compileAdlProject` — the original,
    // `.adl`-only project compiler, kept as public API in `src/index.ts` and
    // no longer called by any runtime path — still parses a manifest and
    // compiles the `.adl` text it lists, unaffected by `compileAdlProjectV2`
    // existing in the same codebase.
    //
    // Until Phase 98 this ran over Giggle Band's kept `domain.adl`/`ui.adl`,
    // a two-source manifest. Those files are gone: they were a frozen
    // model-version-1.0.0 snapshot of an application that had reached 1.9.0,
    // and `.adl` text is the printed view of `.adlj`, not a surface anyone
    // hand-maintains. The `examples/` corpus has no `.adl` fragment without
    // its own `APP` block, so this is a one-source manifest and
    // `compileAdlProject`'s multi-`.adl` concatenation is no longer covered
    // anywhere. That reduction is recorded in
    // `docs/phases/phase-98-delete-kept-adl-snapshot.md`; multi-source
    // merging itself stays covered by the two `compileAdlProjectV2` cases
    // above, one of which merges an `.adl` source with an `.adlj` one.
    const manifestSource = [
      "name: Purchase Orders",
      "id: purchase-orders",
      "version: 0.1.0",
      "startView: PurchaseOrderList",
      "",
      "sources:",
      "  - purchase-order.adl",
      "",
    ].join("\n");
    const purchaseOrder = readFileSync(
      new URL("../examples/purchase-order.adl", import.meta.url),
      "utf8",
    );

    const result = compileAdlProject({
      manifestSource,
      sources: { "purchase-order.adl": purchaseOrder },
    });

    expect(result.manifest).toMatchObject({
      name: "Purchase Orders",
      id: "purchase-orders",
      sources: ["purchase-order.adl"],
    });
    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.app).toEqual({
      name: "PurchaseOrders",
      theme: "ProcurementTheme",
      startView: "PurchaseOrderList",
      offlineGraceDays: 30,
    });
  });
});
