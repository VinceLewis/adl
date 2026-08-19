import { describe, expect, it } from "vitest";
import { mergePartialApplicationModelFragments } from "../src/compiler/merge-partial-model.js";
import { validateApplicationModel } from "../src/compiler/validate-model.js";
import { resolveApplicationModel } from "../src/compiler/resolve-model.js";
import type {
  PartialApplicationModelFragment,
  PartialObjectModel,
} from "../src/model/resolved-model.js";

describe("mergePartialApplicationModelFragments", () => {
  it("throws when no fragment declares APP", () => {
    const fragments: PartialApplicationModelFragment[] = [
      { objects: [{ name: "Widget" }] },
      { objects: [] },
    ];

    expect(() => mergePartialApplicationModelFragments(fragments)).toThrowError(
      /at least one source must declare APP/,
    );
  });

  it("app: the first fragment (in array order) that declares one wins", () => {
    const fragments: PartialApplicationModelFragment[] = [
      { objects: [] },
      { app: { name: "First" }, objects: [] },
      { app: { name: "Second" }, objects: [] },
    ];

    const merged = mergePartialApplicationModelFragments(fragments);
    expect(merged.app).toEqual({ name: "First" });
  });

  it("modelVersion: the first fragment that declares one wins; undefined if none do", () => {
    const withVersions = mergePartialApplicationModelFragments([
      { app: { name: "App" }, modelVersion: "1", objects: [] },
      { modelVersion: "2", objects: [] },
    ]);
    expect(withVersions.modelVersion).toBe("1");

    const withoutVersions = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [] },
      { objects: [] },
    ]);
    expect(withoutVersions.modelVersion).toBeUndefined();
  });

  it("shell: the last fragment (in array order) that declares one wins", () => {
    const firstShell = { nav: { items: [{ view: "First" }] } };
    const secondShell = { nav: { items: [{ view: "Second" }] } };

    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, shell: firstShell, objects: [] },
      { objects: [] },
      { shell: secondShell, objects: [] },
    ]);

    expect(merged.shell).toEqual(secondShell);
  });

  it("shell stays undefined when no fragment declares one", () => {
    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [] },
      { objects: [] },
    ]);

    expect(merged.shell).toBeUndefined();
  });

  it("concatenates array fields across fragments in order, preserving each fragment's own internal order", () => {
    const merged = mergePartialApplicationModelFragments([
      {
        app: { name: "App" },
        objects: [],
        roles: [{ name: "First" }, { name: "Second" }],
        policies: [{ name: "PolicyA", object: "Widget", rules: [] }],
      },
      {
        objects: [],
        roles: [{ name: "Third" }],
        policies: [
          { name: "PolicyB", object: "Widget", rules: [] },
          { name: "PolicyC", object: "Widget", rules: [] },
        ],
      },
    ]);

    expect(merged.roles?.map((role) => role.name)).toEqual(["First", "Second", "Third"]);
    expect(merged.policies?.map((policy) => policy.name)).toEqual([
      "PolicyA",
      "PolicyB",
      "PolicyC",
    ]);
  });

  it("merges a later view-only object declaration into the earlier full declaration of the same name", () => {
    const fullTask: PartialObjectModel = {
      name: "Task",
      businessKey: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "TaskDetail", kind: "detail" }],
    };
    const viewOnlyTask: PartialObjectModel = {
      name: "Task",
      views: [{ name: "TaskList", kind: "list" }],
    };

    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [fullTask] },
      { objects: [viewOnlyTask] },
    ]);

    expect(merged.objects).toHaveLength(1);
    expect(merged.objects[0]).toMatchObject({
      name: "Task",
      businessKey: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
    });
    expect(merged.objects[0]?.views?.map((view) => view.name)).toEqual(["TaskDetail", "TaskList"]);
  });

  it("creates a views array on the earlier entry when it had none, for a view-only merge", () => {
    const fullTask: PartialObjectModel = {
      name: "Task",
      fields: [{ name: "Title", type: "text", required: true }],
    };
    const viewOnlyTask: PartialObjectModel = {
      name: "Task",
      views: [{ name: "TaskList", kind: "list" }],
    };

    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [fullTask] },
      { objects: [viewOnlyTask] },
    ]);

    expect(merged.objects).toHaveLength(1);
    expect(merged.objects[0]?.views?.map((view) => view.name)).toEqual(["TaskList"]);
  });

  it("does NOT merge or drop a same-named object collision that is not view-only, leaving both entries for validation to refuse", () => {
    const firstTask: PartialObjectModel = {
      name: "Task",
      fields: [{ name: "Title", type: "text", required: true }],
    };
    const secondTask: PartialObjectModel = {
      name: "Task",
      fields: [{ name: "Description", type: "text", required: false }],
    };

    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [firstTask] },
      { objects: [secondTask] },
    ]);

    expect(merged.objects).toHaveLength(2);
    expect(merged.objects).toEqual([firstTask, secondTask]);

    // Confirm this is refused downstream by validation, not silently accepted.
    const model = resolveApplicationModel(merged);
    const diagnostics = validateApplicationModel(model);
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ADL_OBJECT_DUPLICATE" })]),
    );
  });

  it("does not merge a same-named object that declares fields but no other content, even alongside views", () => {
    // A collision where the later entry is NOT view-only (it also declares
    // fields) must not be merged even though it also carries views.
    const firstTask: PartialObjectModel = {
      name: "Task",
      fields: [{ name: "Title", type: "text", required: true }],
    };
    const secondTask: PartialObjectModel = {
      name: "Task",
      fields: [{ name: "Extra", type: "text", required: false }],
      views: [{ name: "TaskList", kind: "list" }],
    };

    const merged = mergePartialApplicationModelFragments([
      { app: { name: "App" }, objects: [firstTask] },
      { objects: [secondTask] },
    ]);

    expect(merged.objects).toHaveLength(2);
  });
});
