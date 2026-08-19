// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { ApplicationRuntime, resolveApplicationModel } from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";
import { AdlListViewElement } from "../src/ui/components/adl-list-view.js";
import { defineAdlComponents } from "../src/ui/components/register.js";

defineAdlComponents();

const viewerContext: RuntimeContext = {
  userId: "viewer-1",
  roles: ["Viewer"],
  channel: "ui",
  now: new Date("2026-08-19T09:00:00.000Z"),
};

const partialModel = {
  app: { name: "LookupTargetFieldDemo" },
  roles: [{ name: "Viewer" }],
  objects: [
    {
      name: "Song",
      businessKey: "Isrc",
      displayField: "Title",
      fields: [
        { name: "Isrc", type: "text", required: true },
        { name: "Title", type: "text", required: true },
      ],
      views: [
        {
          name: "SongList",
          kind: "list",
          fields: ["Isrc", "Title"],
          actions: ["create", "read", "update"],
        },
      ],
    },
    {
      name: "SetListItem",
      businessKey: "Position",
      displayField: "Position",
      fields: [
        { name: "Position", type: "number", required: true },
        {
          name: "Song",
          type: "text",
          lookup: { targetObject: "Song", targetField: "Isrc", displayField: "Title" },
        },
      ],
      views: [
        {
          name: "SetListItemList",
          kind: "list",
          fields: ["Position", "Song"],
          actions: ["create", "read", "update"],
        },
      ],
    },
  ],
  policies: [
    {
      name: "SongPolicy",
      object: "Song",
      rules: [
        { name: "allowViewerAll", effect: "allow", principal: { match: "everyone" }, action: "*" },
      ],
    },
    {
      name: "SetListItemPolicy",
      object: "SetListItem",
      rules: [
        { name: "allowViewerAll", effect: "allow", principal: { match: "everyone" }, action: "*" },
      ],
    },
  ],
} satisfies PartialApplicationModel;

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function labelText(element: Element): string {
  return element.textContent?.trim() ?? "";
}

/**
 * `AdlListViewElement.loadLookupLabel` used to resolve every `LOOKUP` field's
 * stored value by identity read (`runtime.read(targetObject, storedValue,
 * ...)`), which only ever matches an identity `LOOKUP`. A `LOOKUP ...
 * TARGET_FIELD` field stores a natural key instead (here, the song's
 * `Isrc`), so that identity read always came back empty and the cell fell
 * back to showing the raw stored `Isrc` value. Phase 75 fixed
 * `loadLookupLabel` (via the shared `resolveLookupTargetRecord` helper) to
 * do an exact-match search on the declared `TARGET_FIELD` instead. See
 * [[browser-ui-runtime]].
 */
describe("adl-list-view TARGET_FIELD lookup label", () => {
  it("resolves the target's display field through a TARGET_FIELD lookup instead of showing the raw stored value", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel));

    await runtime.create("Song", { Isrc: "US-S1Z-99-00001", Title: "Neon Skyline" }, viewerContext);
    await runtime.create("SetListItem", { Position: 1, Song: "US-S1Z-99-00001" }, viewerContext);

    const model = resolveApplicationModel(partialModel);
    const object = model.objects.find((candidate) => candidate.name === "SetListItem");
    const view = object?.views.find((candidate) => candidate.name === "SetListItemList");
    if (object === undefined || view === undefined) {
      throw new Error("Fixture is missing SetListItem/SetListItemList.");
    }

    const list = document.createElement("adl-list-view") as AdlListViewElement;
    document.body.append(list);
    list.runtime = runtime;
    list.object = object;
    list.view = view;
    list.context = viewerContext;
    list.records = await runtime.search("SetListItem", undefined, viewerContext);
    await flushUi();
    await flushUi();

    const row = list.querySelector<HTMLTableRowElement>("tr[data-record-id]");
    if (row === null) {
      throw new Error("No SetListItem row rendered.");
    }
    const cells = [...row.querySelectorAll("td:not(.adl-list-sync-cell)")].map(labelText);

    expect(cells).toEqual(["1", "Neon Skyline"]);
    expect(cells).not.toContain("US-S1Z-99-00001");

    list.remove();
  });
});
