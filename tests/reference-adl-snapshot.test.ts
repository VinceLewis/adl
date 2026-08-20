import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdlProject } from "../src/compiler/compile-adl-project.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project-v2.js";
import { printPartialApplicationModelAsAdl } from "../src/compiler/print-adl.js";

/**
 * `src/reference/giggle-band/domain.adl` and `ui.adl` are not a generated view
 * of `domain.adlj`/`ui.adlj`. They are a frozen snapshot of the Giggle Band
 * application as it stood at model version 1.0.0, kept on disk for two reasons
 * that have nothing to do with being current:
 *
 * 1. `docs/spec/language.md` and a dozen `docs/phases/*.md` documents cite
 *    exact line numbers into them, so every line above the trailing
 *    "SUPERSEDED AS COMPILED SOURCE" note must keep its number forever.
 * 2. They are this repository's richest real `.adl` *text* corpus, and two
 *    tests (`tests/compile-adlj.test.ts`'s printer round-trip and
 *    `tests/compile-adl-project-v2.test.ts`'s `compileAdlProject` regression
 *    proof) parse them as their proof material.
 *
 * The snapshot cannot be regenerated from the `.adlj` source: the real
 * application now declares three constructs that have no ADL text syntax at
 * all (`conflictOverlay`, `projectedFields`, `summary`), so no `.adl` text
 * exists that says what `domain.adlj`/`ui.adlj` say. See
 * `docs/phases/phase-94-adl-adlj-divergence.md`.
 *
 * The tests below therefore do not require the two sides to agree. They pin
 * *how* they disagree, so that a future change to either side either leaves
 * the recorded divergence exactly as it is or fails loudly and forces the
 * author to record what they changed. Before Phase 94 this class of drift was
 * invisible: a `.adlj` edit silently invalidated the snapshot and every
 * citation into it, which is how a phase document came to cite `ui.adl:13-19`
 * for a `themeSwitch` placement the running application had already moved.
 */

const readReference = (relativePath: string): string =>
  readFileSync(new URL(`../src/reference/${relativePath}`, import.meta.url), "utf8");

const TRAILING_NOTE_MARKER = "# FROZEN SNAPSHOT, NOT A VIEW OF";

/** The snapshot's declaration region: everything above the trailing note. */
function frozenRegion(source: string): string {
  const index = source.indexOf(TRAILING_NOTE_MARKER);
  expect(index).toBeGreaterThan(0);
  return source.slice(0, index);
}

const sha256 = (value: string): string =>
  `sha256-${createHash("sha256").update(value, "utf8").digest("hex")}`;

const manifestSource = (first: string, second: string): string =>
  [
    "name: Giggle Band ADL Example",
    "id: giggle-band",
    "version: 0.1.0",
    "startView: HomeDashboard",
    "",
    "sources:",
    `  - ${first}`,
    `  - ${second}`,
    "",
  ].join("\n");

/**
 * Arrays of named entities are re-keyed by name before diffing. Without this,
 * inserting one object shifts every later index and buries the real difference
 * under a hundred positional ones.
 */
function keyByName(value: unknown): unknown {
  if (Array.isArray(value)) {
    const allNamed =
      value.length > 0 &&
      value.every(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).name === "string",
      );
    if (allNamed) {
      const keyed: Record<string, unknown> = {};
      for (const entry of value) {
        keyed[String((entry as Record<string, unknown>).name)] = keyByName(entry);
      }
      return keyed;
    }
    return value.map(keyByName);
  }
  if (value !== null && typeof value === "object") {
    const mapped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      mapped[key] = keyByName(entry);
    }
    return mapped;
  }
  return value;
}

/**
 * Reports the shallowest differing path, never descending into a difference,
 * with a digest over both sides' values at that path. The digest is what makes
 * this a value pin and not merely a shape pin: editing what an
 * already-divergent path *says* on either side changes the digest and fails
 * the test, exactly like introducing a new divergent path does.
 */
function divergentPaths(left: unknown, right: unknown, path: string, out: string[]): void {
  const record = (): void => {
    const digest = sha256(
      `${JSON.stringify(left) ?? "undefined"}\u0000${JSON.stringify(right) ?? "undefined"}`,
    );
    out.push(`${path} = ${digest.slice(7, 19)}`);
  };
  if (Object.is(left, right)) return;
  const kindOf = (value: unknown): string =>
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  if (leftKind !== rightKind || leftKind === "array") {
    if (JSON.stringify(left) !== JSON.stringify(right)) record();
    return;
  }
  if (leftKind === "object") {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])].sort();
    // A key present on only one side reaches `record()` through the type
    // mismatch against `undefined`, so it needs no separate branch.
    for (const key of keys) {
      divergentPaths(leftObject[key], rightObject[key], `${path}.${key}`, out);
    }
    return;
  }
  record();
}

function compileSnapshot() {
  return compileAdlProject({
    manifestSource: manifestSource("domain.adl", "ui.adl"),
    sources: {
      "domain.adl": readReference("giggle-band/domain.adl"),
      "ui.adl": readReference("giggle-band/ui.adl"),
    },
  });
}

function compileRealSource() {
  return compileAdlProjectV2({
    manifestSource: manifestSource("domain.adlj", "ui.adlj"),
    sources: {
      "domain.adlj": readReference("giggle-band/domain.adlj"),
      "ui.adlj": readReference("giggle-band/ui.adlj"),
    },
  });
}

describe("Giggle Band's kept `.adl` snapshot", () => {
  it("keeps every declaration line above the trailing note byte-for-byte frozen", () => {
    expect(sha256(frozenRegion(readReference("giggle-band/domain.adl")))).toBe(
      "sha256-69498996264f968a7162760b5ba7f57bfcd236a0703ab283e9c4946505e1fb56",
    );
    expect(sha256(frozenRegion(readReference("giggle-band/ui.adl")))).toBe(
      "sha256-b6e26a4a3b7e1d653556cafe3117f4e153ba8d692872617e533f317ded9f79d4",
    );
  });

  it("diverges from the real `.adlj` source in exactly the recorded ways", () => {
    const snapshot = compileSnapshot();
    const real = compileRealSource();
    expect(snapshot.diagnostics).toEqual([]);
    expect(real.diagnostics).toEqual([]);

    const paths: string[] = [];
    divergentPaths(keyByName(snapshot.model), keyByName(real.model), "model", paths);
    expect(paths.sort()).toEqual([
      // The snapshot is model version 1.0.0; the real source is 1.9.0 and
      // carries the nine MIGRATION blocks that got it there.
      "model.migrations = 56979bcfde39",
      "model.modelFingerprint = 0807f00f7338",
      "model.modelVersion = 15abb0a1ba8c",
      // Phase 92: the availability board's roster section was renamed from the
      // over-claiming `Who is free` to `Availability`, and its legend dropped.
      "model.objects.Availability.views.BandMemberAvailabilityBoard.presentation.legends = e719e4ae09d8",
      "model.objects.Availability.views.BandMemberAvailabilityBoard.presentation.sections.TeamAvailability.heading = 002d93d7a734",
      // `Event.SetList`, a single set-list lookup, became the ordered
      // many-to-many `EventSetList` (migrations 1.3.0 and 1.4.0), and `Event`
      // gained an explicit `CreatedBy`.
      "model.objects.Event.fields.CreatedBy = 0d70d6f2cb63",
      "model.objects.Event.fields.SetList = 552207688cc0",
      "model.objects.Event.views.BandEventCalendar.presentation.sections.DuplicateGig.lists.PreviousGigs.actions.duplicateGig.input.SetList = b3783f2d2a17",
      // No ADL text syntax: a calendar conflict overlay (Phase 86).
      "model.objects.Event.views.BandEventCalendar.presentation.sections.PlanningCalendar.calendars.MonthPlanner.conflictOverlay = 26a54df7ec97",
      // The gig form's single `Fields` section became `Details` plus a
      // `SetLists` child collection.
      "model.objects.Event.views.BandEventForm.editSections.Details = 1d4c89d379e1",
      "model.objects.Event.views.BandEventForm.editSections.Fields = 1c2915aaef11",
      "model.objects.Event.views.BandEventForm.editSections.SetLists = b8a74ac90498",
      "model.objects.Event.views.BandEventForm.fields = 8dbe88c7996f",
      // The home schedule row dropped its redundant leading ICON fragment.
      "model.objects.Event.views.HomeDashboard.presentation.sections.Schedule.lists.UpcomingEvents.row.fragments = 6d63a8504ce8",
      "model.objects.EventSetList = 5b9f1566ca6f",
      // No ADL text syntax: child-collection projected fields and summary
      // (Phase 87).
      "model.objects.SetList.views.SetListForm.editSections.Songs.projectedFields = e61bfc1847d8",
      "model.objects.SetList.views.SetListForm.editSections.Songs.summary = e2fed7a56f5a",
      // A song may not appear twice in one set list.
      "model.objects.SetListItem.constraints.uniqueSongInSetList = 98422821caf7",
      "model.policies.EventSetListDefaultDeny = 9862dce5ff0b",
      "model.policies.EventSetListPolicy = 90bd3322be33",
      "model.policies.EventSetListSystemAdminPolicy = 1697effe2583",
      // `UserPolicy` moved from `ROLE BandMember` to `AUTHENTICATED`: a
      // context-scoped role condition never resolves against `User`.
      "model.policies.UserPolicy.rules.allowAuthenticatedReadUsers = 13aaecada41a",
      "model.policies.UserPolicy.rules.allowAuthenticatedSearchUsers = fa1b69b957fc",
      "model.policies.UserPolicy.rules.allowBandMemberReadUsers = edafaf7557df",
      "model.policies.UserPolicy.rules.allowBandMemberSearchUsers = 4e6faf877cd8",
      // The read model feeding the calendar's conflict overlay.
      "model.readModels.EventAvailabilityConflicts = e0883aa806a9",
      // Shell chrome: `themeSwitch` moved from the top bar into the nav
      // drawer, the redundant `Set list editor` nav item was removed, and the
      // availability board's nav label became `Band Availability`.
      "model.shell.controls.themeSwitch.placement = 85c7eaebaa16",
      "model.shell.nav.items.BandMemberAvailabilityBoard.label = 2dffbd6d2273",
      "model.shell.nav.items.SetListForm = eead2c625d0d",
      "model.shell.navDrawer.controls = c7e9063a2238",
      "model.shell.topBar.controls = 47d9fa8ad882",
      // `EventSetList` brought its own SYNC declaration.
      "model.sync = b8f63e6f582b",
    ]);
  });

  it("cannot be regenerated: the real source uses constructs with no ADL text syntax", () => {
    const real = compileRealSource();
    expect(() => printPartialApplicationModelAsAdl(real.partialModel)).toThrow(/conflictOverlay/);
  });
});
