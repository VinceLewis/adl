// @vitest-environment happy-dom

/**
 * Phase 87: a `CHILD_COLLECTION` edit section's projected fields and
 * summary. See `docs/phases/phase-87-child-collection-projected-fields-and-summary.md`
 * and `learnings/implementation/edit-surface-language.md`.
 *
 * A dedicated fixture (Playlist/Track/Album) rather than the Giggle Band
 * reference app: it needs a policy-denied read on the *projected-field
 * target* specifically (a role that can read `Track` but not a particular
 * `Album`), which Giggle Band's real policies do not have a reason to model.
 */

import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  PartialApplicationModel,
  PartialEditChildCollectionSummaryModel,
  ResolvedApplicationModel,
  RuntimeContext,
} from "../src/index.js";
import type {
  RuntimeEditChildCollectionSection,
  RuntimeEditSurface,
} from "../src/runtime/edit-surface-runtime.js";

const adminContext: RuntimeContext = {
  userId: "admin",
  roles: ["Admin"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const viewerContext: RuntimeContext = {
  userId: "viewer",
  roles: ["Viewer"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

describe("child collection projected fields (Phase 87)", () => {
  it("resolves a row's value from a related object reached through a lookup field", async () => {
    const runtime = new ApplicationRuntime(createTracksModel(sumSummary()));
    const playlist = await runtime.create("Playlist", { Title: "Road Trip" }, adminContext);
    const albumA = await runtime.create(
      "Album",
      { Title: "First Light", LengthSeconds: 200 },
      adminContext,
    );
    await runtime.create(
      "Track",
      { Playlist: playlist.meta.guid, Album: albumA.meta.guid, Position: 1 },
      adminContext,
    );

    const surface = await runtime.evaluateEditSurface("Playlist", "PlaylistForm", adminContext, {
      mode: "edit",
      recordId: playlist.meta.guid,
    });
    const section = requireChildSection(surface);

    expect(section.projectedFields).toEqual(["LengthSeconds"]);
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0]?.values.LengthSeconds).toBe(200);
  });

  it("degrades to null with no fetch when the row's own lookup value is absent", async () => {
    const runtime = new ApplicationRuntime(createTracksModel(sumSummary()));
    const playlist = await runtime.create("Playlist", { Title: "Untitled Mix" }, adminContext);
    // `Album` is not required on `Track`, unlike `SetListItem.Song` -- exactly
    // to exercise this case: a row with no related record to project from.
    await runtime.create("Track", { Playlist: playlist.meta.guid, Position: 1 }, adminContext);

    const surface = await runtime.evaluateEditSurface("Playlist", "PlaylistForm", adminContext, {
      mode: "edit",
      recordId: playlist.meta.guid,
    });
    const section = requireChildSection(surface);

    expect(section.rows[0]?.values.LengthSeconds).toBeNull();
    expect(surface.diagnostics).toEqual([]);
  });

  it("degrades to null with a diagnostic when the related record is policy-denied, and excludes it from the summary", async () => {
    const runtime = new ApplicationRuntime(createTracksModel(sumSummary()));
    const playlist = await runtime.create("Playlist", { Title: "Members Only" }, adminContext);
    const publicAlbum = await runtime.create(
      "Album",
      { Title: "Public Record", LengthSeconds: 100, Visibility: "Public" },
      adminContext,
    );
    const privateAlbum = await runtime.create(
      "Album",
      { Title: "Private Session", LengthSeconds: 300, Visibility: "Private" },
      adminContext,
    );
    await runtime.create(
      "Track",
      { Playlist: playlist.meta.guid, Album: publicAlbum.meta.guid, Position: 1 },
      adminContext,
    );
    await runtime.create(
      "Track",
      { Playlist: playlist.meta.guid, Album: privateAlbum.meta.guid, Position: 2 },
      adminContext,
    );

    const surface = await runtime.evaluateEditSurface("Playlist", "PlaylistForm", viewerContext, {
      mode: "edit",
      recordId: playlist.meta.guid,
    });
    const section = requireChildSection(surface);

    const values = section.rows.map((row) => row.values.LengthSeconds).sort();
    expect(values).toEqual([100, null]);
    expect(surface.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "ADL_EDIT_CHILD_PROJECTED_FIELD_DENIED",
        section: "Tracks",
      }),
    );
    // The denied row's null value is skipped, not treated as 0 -- only the
    // readable album's length is summed.
    expect(section.summary?.text).toBe("1:40");
  });
});

describe("child collection summary (Phase 87)", () => {
  it("sums a numeric field, skipping rows with no value", async () => {
    const section = await evaluateWithTracks(sumSummary(), [200, null, 100]);
    expect(section.summary).toEqual({ label: "Total", text: "5:00", placement: "footer" });
  });

  it("averages a numeric field", async () => {
    const surface = await evaluateWithTracks(
      {
        field: "LengthSeconds",
        aggregate: "avg",
        label: "Average",
        format: { kind: "number" },
        placement: "footer",
      },
      [100, 200, 300],
    );
    expect(surface.summary).toEqual({ label: "Average", text: "200", placement: "footer" });
  });

  it("takes the min of a numeric field", async () => {
    const surface = await evaluateWithTracks(
      { field: "LengthSeconds", aggregate: "min", format: { kind: "number" }, placement: "header" },
      [300, 100, 200],
    );
    expect(surface.summary).toEqual({ text: "100", placement: "header" });
  });

  it("takes the max of a numeric field", async () => {
    const surface = await evaluateWithTracks(
      { field: "LengthSeconds", aggregate: "max", format: { kind: "number" }, placement: "footer" },
      [300, 100, 200],
    );
    expect(surface.summary).toEqual({ text: "300", placement: "footer" });
  });

  it("counts every row when count has no field", async () => {
    const surface = await evaluateWithTracks(
      { aggregate: "count", label: "Rows", format: { kind: "number" }, placement: "footer" },
      [null, null, 100],
    );
    expect(surface.summary).toEqual({ label: "Rows", text: "3", placement: "footer" });
  });

  it("counts only rows with a non-null value when count names a field", async () => {
    const surface = await evaluateWithTracks(
      {
        field: "LengthSeconds",
        aggregate: "count",
        label: "With length",
        format: { kind: "number" },
        placement: "footer",
      },
      [null, 100, 200],
    );
    expect(surface.summary).toEqual({ label: "With length", text: "2", placement: "footer" });
  });

  it("computes over an empty collection as zero, not a crash", async () => {
    const surface = await evaluateWithTracks(sumSummary(), []);
    expect(surface.summary).toEqual({ label: "Total", text: "0:00", placement: "footer" });
  });

  it("includes a staged, not-yet-saved row in a live total", async () => {
    const runtime = new ApplicationRuntime(createTracksModel(sumSummary()));
    const playlist = await runtime.create("Playlist", { Title: "Live Set" }, adminContext);
    const album = await runtime.create(
      "Album",
      { Title: "Opener", LengthSeconds: 180 },
      adminContext,
    );
    await runtime.create(
      "Track",
      { Playlist: playlist.meta.guid, Album: album.meta.guid, Position: 1 },
      adminContext,
    );
    const staged = [
      {
        id: "staged-1",
        section: "Tracks",
        operation: "createChild" as const,
        childObject: "Track",
        values: { Album: album.meta.guid, Position: 2 },
      },
    ];

    const before = await runtime.evaluateEditSurface("Playlist", "PlaylistForm", adminContext, {
      mode: "edit",
      recordId: playlist.meta.guid,
    });
    expect(requireChildSection(before).summary?.text).toBe("3:00");

    const withStagedAdd = await runtime.evaluateEditSurface(
      "Playlist",
      "PlaylistForm",
      adminContext,
      { mode: "edit", recordId: playlist.meta.guid, stagedChanges: staged },
    );
    // 180 (persisted) + 180 (staged) = 360s = 6:00, live and before Save.
    expect(requireChildSection(withStagedAdd).summary?.text).toBe("6:00");

    // Un-staging (the same "remove" a not-yet-saved row's own control sends)
    // takes the total back down immediately too.
    const withStagedRemoved = await runtime.evaluateEditSurface(
      "Playlist",
      "PlaylistForm",
      adminContext,
      { mode: "edit", recordId: playlist.meta.guid, stagedChanges: [] },
    );
    expect(requireChildSection(withStagedRemoved).summary?.text).toBe("3:00");
  });
});

describe("duration format (Phase 87)", () => {
  it("formats seconds as m:ss, matching giggle-new's own real display", async () => {
    const surface = await evaluateWithTracks(sumSummary(), [2840]);
    // 2840s = 47 * 60 + 20 = 47:20.
    expect(surface.summary?.text).toBe("47:20");
  });

  it("zero-pads seconds under ten", async () => {
    const surface = await evaluateWithTracks(sumSummary(), [65]);
    expect(surface.summary?.text).toBe("1:05");
  });
});

function sumSummary(): PartialEditChildCollectionSummaryModel {
  return {
    field: "LengthSeconds",
    aggregate: "sum",
    label: "Total",
    format: { kind: "duration", pattern: "m:ss" },
    placement: "footer",
  };
}

/**
 * Seeds one playlist with one track per `lengths` entry -- `null` creates a
 * track with no `Album` set, so its projected field (and the aggregate) skip
 * it -- and returns the evaluated child collection section directly.
 */
async function evaluateWithTracks(
  summary: PartialEditChildCollectionSummaryModel,
  lengths: Array<number | null>,
) {
  const runtime = new ApplicationRuntime(createTracksModel(summary));
  const playlist = await runtime.create("Playlist", { Title: "Fixture" }, adminContext);

  let position = 1;
  for (const length of lengths) {
    const albumId =
      length === null
        ? undefined
        : (
            await runtime.create(
              "Album",
              { Title: `Track ${position}`, LengthSeconds: length },
              adminContext,
            )
          ).meta.guid;
    await runtime.create(
      "Track",
      {
        Playlist: playlist.meta.guid,
        Position: position,
        ...(albumId === undefined ? {} : { Album: albumId }),
      },
      adminContext,
    );
    position += 1;
  }

  const surface = await runtime.evaluateEditSurface("Playlist", "PlaylistForm", adminContext, {
    mode: "edit",
    recordId: playlist.meta.guid,
  });
  return requireChildSection(surface);
}

function requireChildSection(surface: RuntimeEditSurface): RuntimeEditChildCollectionSection {
  const section = surface.sections.find(
    (candidate): candidate is RuntimeEditChildCollectionSection =>
      candidate.kind === "childCollection",
  );
  if (section === undefined) {
    throw new Error("Expected the child collection section to be evaluated.");
  }
  return section;
}

function createTracksModel(
  summary: PartialEditChildCollectionSummaryModel,
): ResolvedApplicationModel {
  const model = resolveApplicationModel(createTracksPartialModel(summary));
  expect(validateApplicationModel(model)).toEqual([]);
  return model;
}

function createTracksPartialModel(
  summary: PartialEditChildCollectionSummaryModel,
): PartialApplicationModel {
  return {
    app: { name: "TracksDemo", startView: "PlaylistList" },
    roles: [{ name: "Admin" }, { name: "Viewer" }],
    objects: [
      {
        name: "Playlist",
        displayField: "Title",
        fields: [{ name: "Title", type: "text", required: true }],
        views: [
          {
            name: "PlaylistList",
            kind: "list",
            fields: ["Title"],
            actions: ["create", "read", "update", "delete"],
            editContainer: "modal",
          },
          {
            name: "PlaylistForm",
            kind: "form",
            fields: ["Title"],
            actions: ["save", "delete"],
            editSections: [
              { name: "Details", kind: "fields", fields: ["Title"] },
              {
                name: "Tracks",
                kind: "childCollection",
                heading: "Tracks",
                childObject: "Track",
                parentField: "Playlist",
                operations: ["createChild", "remove"],
                staged: true,
                emptyState: { text: "No tracks yet." },
                projectedFields: [
                  { name: "LengthSeconds", through: "Album", field: "LengthSeconds" },
                ],
                summary,
              },
            ],
          },
        ],
      },
      {
        name: "Track",
        fields: [
          {
            name: "Playlist",
            type: "text",
            required: true,
            lookup: { targetObject: "Playlist", displayField: "Title" },
          },
          {
            name: "Album",
            type: "text",
            lookup: { targetObject: "Album", displayField: "Title" },
          },
          { name: "Position", type: "number", defaultValue: 1 },
        ],
      },
      {
        name: "Album",
        displayField: "Title",
        fields: [
          { name: "Title", type: "text", required: true },
          { name: "LengthSeconds", type: "number", required: true },
          { name: "Visibility", type: "text", defaultValue: "Public" },
        ],
      },
    ],
    policies: [
      {
        name: "PlaylistPolicy",
        object: "Playlist",
        rules: [
          { name: "allowEveryone", effect: "allow", principal: { match: "everyone" }, action: "*" },
        ],
      },
      {
        name: "TrackPolicy",
        object: "Track",
        rules: [
          { name: "allowEveryone", effect: "allow", principal: { match: "everyone" }, action: "*" },
        ],
      },
      {
        name: "AlbumPolicy",
        object: "Album",
        rules: [
          {
            name: "allowAdminAll",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowViewerReadPublic",
            effect: "allow",
            principal: { match: "specific", roles: ["Viewer"] },
            action: "read",
            condition: {
              kind: "binary",
              operator: "==",
              left: { kind: "field", field: "Visibility" },
              right: { kind: "literal", value: "Public" },
            },
          },
          {
            name: "allowViewerSearchAlbums",
            effect: "allow",
            principal: { match: "specific", roles: ["Viewer"] },
            action: "search",
          },
        ],
      },
    ],
  };
}
