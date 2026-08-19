import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdlProject } from "../src/compiler/compile-adl-project.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project.js";
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

  it("leaves compileAdlProject's existing behaviour on the Giggle Band reference app unchanged", () => {
    const manifestSource = readFileSync(
      new URL("../src/reference/giggle-band/app.yaml", import.meta.url),
      "utf8",
    );
    const domain = readFileSync(
      new URL("../src/reference/giggle-band/domain.adl", import.meta.url),
      "utf8",
    );
    const ui = readFileSync(
      new URL("../src/reference/giggle-band/ui.adl", import.meta.url),
      "utf8",
    );

    const result = compileAdlProject({
      manifestSource,
      sources: { "domain.adl": domain, "ui.adl": ui },
    });

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.app).toEqual({
      name: "Giggle Band ADL Example",
      theme: "CorporateLight",
      startView: "HomeDashboard",
      offlineGraceDays: 30,
    });
  });
});
