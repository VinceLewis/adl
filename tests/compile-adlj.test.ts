import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlProjectV2 } from "../src/compiler/compile-adl-project-v2.js";
import {
  AdljParseError,
  compileAdlj,
  adljSourceToPartialApplicationModel,
} from "../src/compiler/compile-adlj.js";
import { printPartialApplicationModelAsAdl } from "../src/compiler/print-adl.js";
import { MODEL_VALIDATION_CODES } from "../src/compiler/validate-model.js";
import { parseExpressionSource } from "../src/parser/parser.js";
import type { AdljSourceDocument } from "../src/model/adlj-source.js";

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

function readReference(name: string): string {
  return readFileSync(new URL(`../src/reference/${name}`, import.meta.url), "utf8");
}

describe("parseExpressionSource", () => {
  it("parses a simple infix expression", () => {
    expect(parseExpressionSource("EndDate >= StartDate")).toMatchObject({
      kind: "binary",
      operator: ">=",
    });
  });

  it("fails on trailing content after a complete expression", () => {
    expect(() => parseExpressionSource("EndDate >= StartDate extra")).toThrowError();
  });
});

describe("compileAdlj", () => {
  it("produces a ResolvedApplicationModel deep-equal to compileAdl's result on the equivalent .adl source", () => {
    const adlResult = compileAdl(readExample("task-tracker.adl"));
    expect(adlResult.diagnostics).toEqual([]);

    const adljResult = compileAdlj(readExample("task-tracker.adlj"));
    expect(adljResult.diagnostics).toEqual([]);

    expect(adljResult.model).toEqual(adlResult.model);
  });

  it("refuses source that is not valid JSON", () => {
    expect(() => compileAdlj("{ not json")).toThrowError(AdljParseError);
    try {
      compileAdlj("{ not json");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdljParseError);
      expect((error as AdljParseError).diagnostic).toMatchObject({
        severity: "error",
        code: MODEL_VALIDATION_CODES.ADLJ_JSON_INVALID,
      });
    }
  });

  it("refuses a document that does not match the generated schema, naming the violating path", () => {
    const invalid = JSON.stringify({ app: { name: "Bad" }, objects: [{ notAField: true }] });

    try {
      compileAdlj(invalid);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdljParseError);
      const diagnostic = (error as AdljParseError).diagnostic;
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic.code).toBe(MODEL_VALIDATION_CODES.ADLJ_SCHEMA_INVALID);
      expect(diagnostic.path).toBeDefined();
    }
  });

  it("compiles and round-trips the opt-in mode for generated navigation", () => {
    const source = JSON.stringify({
      app: { name: "GeneratedNavigation", startView: "ItemList" },
      shell: { nav: { mode: "includeUnlistedViews" } },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "ItemList", kind: "list", fields: ["Name"] }],
        },
      ],
    });

    const compiled = compileAdlj(source);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.model.shell.nav).toMatchObject({
      mode: "includeUnlistedViews",
      items: [expect.objectContaining({ view: "ItemList" })],
    });

    const printed = printPartialApplicationModelAsAdl(compiled.partialModel);
    expect(printed).toContain("NAV_MODE INCLUDE_UNLISTED_VIEWS");
    expect(compileAdl(printed).model.shell.nav).toEqual(compiled.model.shell.nav);
  });

  /*
   * A round-trip that does not depend on which reference app the printer can
   * currently handle: a small document carrying `registration`, printed and
   * re-parsed, resolves to the same value in both spellings.
   */
  it.each([
    ["selfService", "REGISTRATION SELF_SERVICE"],
    ["inviteOnly", "REGISTRATION INVITE_ONLY"],
  ])("round-trips app registration %s through printed .adl text", (registration, expected) => {
    const source = JSON.stringify({
      app: { name: "RegistrationRoundTrip", startView: "ItemList", registration },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "ItemList", kind: "list", fields: ["Name"] }],
        },
      ],
    });

    const compiled = compileAdlj(source);
    // This fixture declares no context and no create grant, so a `selfService`
    // document legitimately carries the unreachability warning; nothing else.
    expect(compiled.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(compiled.diagnostics.map((entry) => entry.code)).toEqual(
      registration === "selfService"
        ? [MODEL_VALIDATION_CODES.APP_SELF_SERVICE_REGISTRATION_UNREACHABLE]
        : [],
    );
    expect(compiled.model.app.registration).toBe(registration);

    const printed = printPartialApplicationModelAsAdl(compiled.partialModel);
    expect(printed).toContain(expected);
    expect(compileAdl(printed).model.app.registration).toBe(registration);
  });

  it("round-trips a SELF policy principal: .adlj JSON, printed .adl text, and .adl source all resolve identically", () => {
    // Acceptance criterion 6 of Phase 103. The three encodings of one rule —
    // `{"match": "self"}`, the printed `SELF` keyword, and hand-written `.adl`
    // text — must land on the same resolved model.
    const source = JSON.stringify({
      app: { name: "SelfPrincipalRoundTrip", startView: "PersonList" },
      // Declared explicitly because `compileAdl` always supplies both arrays
      // and `compileAdlj` only supplies what the document names — a
      // pre-existing asymmetry (see
      // `learnings/implementation/adlj-json-authoring-surface.md`) that has
      // nothing to do with the principal under test.
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Person",
          displayField: "Name",
          fields: [
            { name: "Name", type: "text" },
            { name: "Email", type: "text" },
          ],
          views: [{ name: "PersonList", kind: "list", fields: ["Name"] }],
        },
      ],
      policies: [
        {
          name: "PersonSelfPolicy",
          object: "Person",
          rules: [
            {
              name: "allowPersonReadSelf",
              effect: "allow",
              principal: { match: "self" },
              action: "read",
            },
            {
              name: "allowPersonNameToAnyone",
              effect: "allow",
              principal: { match: "authenticated" },
              action: "read",
              fields: ["Name"],
            },
          ],
        },
      ],
    });

    const compiled = compileAdlj(source);
    expect(compiled.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(compiled.partialModel);
    expect(printed).toContain("RULE allowPersonReadSelf ALLOW READ SELF");
    // The negative half: `SELF` must not print as `OWNER`, and must not drag an
    // OWNER clause along beside it.
    expect(printed).not.toContain("OWNER");

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(compiled.model);

    const rule = reparsed.model.policies
      .find((policy) => policy.name === "PersonSelfPolicy")
      ?.rules.find((entry) => entry.name === "allowPersonReadSelf");
    expect(rule?.principal).toEqual({
      match: "self",
      roles: [],
      groupRoles: [],
      users: [],
      owner: false,
    });
  });

  it("rejects an unknown policy principal match against the generated schema", () => {
    // The negative half of the schema widening: `self` is now a member and
    // near-misses still are not.
    const source = JSON.stringify({
      app: { name: "BadPrincipal", startView: "PersonList" },
      objects: [
        {
          name: "Person",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "PersonList", kind: "list", fields: ["Name"] }],
        },
      ],
      policies: [
        {
          name: "PersonPolicy",
          object: "Person",
          rules: [
            {
              name: "allowPersonReadMyself",
              effect: "allow",
              principal: { match: "myself" },
              action: "read",
            },
          ],
        },
      ],
    });

    expect(() => compileAdlj(source)).toThrow(/principal\/match/);
  });

  it("omits app registration from printed .adl text when the document declares none", () => {
    const source = JSON.stringify({
      app: { name: "NoRegistration", startView: "ItemList" },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "ItemList", kind: "list", fields: ["Name"] }],
        },
      ],
    });

    const compiled = compileAdlj(source);
    expect(compiled.model.app).not.toHaveProperty("registration");
    expect(printPartialApplicationModelAsAdl(compiled.partialModel)).not.toContain("REGISTRATION");
  });

  it("rejects an unknown .adlj app registration value against the generated schema", () => {
    const source = JSON.stringify({
      app: { name: "BadRegistration", registration: "open" },
      objects: [{ name: "Item" }],
    });

    try {
      compileAdlj(source);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdljParseError);
      expect((error as AdljParseError).diagnostic.code).toBe(
        MODEL_VALIDATION_CODES.ADLJ_SCHEMA_INVALID,
      );
    }
  });

  /*
   * Phase 100 closed nine `.adlj`-only constructs; Phase 99 must not open a
   * tenth. The onboarding control has real `.adl` text syntax and a printer
   * branch, and this is what proves the two agree.
   */
  it("round-trips a COMMAND_ACTION shell control through printed .adl text", () => {
    const source = JSON.stringify({
      app: { name: "Onboarding", startView: "GroupList" },
      shell: {
        controls: [
          {
            name: "createFirstGroup",
            kind: "commandAction",
            label: "Create a group",
            command: "MakeGroup",
            placement: "emptyState",
            visibility: { kind: "contextUnavailable", context: "Group" },
          },
        ],
      },
      contexts: [{ name: "Group", object: "Group", selection: { mode: "optional" } }],
      objects: [
        {
          name: "Group",
          fields: [{ name: "Name", type: "text", required: true }],
          views: [{ name: "GroupList", kind: "list", fields: ["Name"] }],
        },
      ],
      commands: [
        {
          name: "MakeGroup",
          inputs: [{ name: "Name", type: "text", required: true }],
          steps: [
            {
              name: "makeGroup",
              action: "create",
              object: "Group",
              values: { Name: { kind: "input", name: "Name" } },
              establishesContext: "Group",
            },
          ],
        },
      ],
    });

    const compiled = compileAdlj(source);
    expect(compiled.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(compiled.partialModel);
    expect(printed).toContain(
      "CONTROL createFirstGroup KIND COMMAND_ACTION LABEL 'Create a group' PLACEMENT EMPTY_STATE VISIBLE WHEN CONTEXT Group UNAVAILABLE COMMAND MakeGroup",
    );
    expect(compileAdl(printed).model.shell.controls).toEqual(compiled.model.shell.controls);
  });

  it("rejects an unknown .adlj shell navigation mode", () => {
    const source = JSON.stringify({
      app: { name: "BadNavigation" },
      shell: { nav: { mode: "everythingImplicit" } },
      objects: [{ name: "Item" }],
    });

    expect(() => compileAdlj(source)).toThrowError(AdljParseError);
  });

  it("fails loudly when an expression-bearing field has trailing garbage", () => {
    const document: AdljSourceDocument = {
      app: { name: "TrailingGarbage" },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Value", type: "number", required: true }],
          validations: [{ name: "positive", expression: "Value > 0 extra" }],
        },
      ],
    };

    expect(() => adljSourceToPartialApplicationModel(document)).toThrowError();
  });

  it("compiles an AUTO_ID field with no DEFAULT cleanly through both .adl and .adlj (Phase 74)", () => {
    // Phase 72 refused this shape (ADL_AUTO_ID_NO_DEFAULT) because nothing
    // minted a runtime value from AUTO_ID yet. Phase 74 built that minting
    // (ObjectStore.planCreateForTransaction) and removed the refusal, so both
    // front ends must now resolve this to the identical, diagnostic-free model.
    // See tests/runtime.test.ts's "AUTO_ID minting" suite for proof the field
    // actually mints a value at runtime.
    const document: AdljSourceDocument = {
      app: { name: "AutoIdNoDefault" },
      // Declared explicitly (both empty) so this matches what .adl always
      // resolves for an undeclared contexts/readModels — see
      // learnings/implementation/adlj-json-authoring-surface.md for why a
      // JSON front-end does not infer these defaults for free.
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Item",
          fields: [{ name: "Code", type: "text", required: true, autoId: {} }],
        },
      ],
    };

    const adljResult = compileAdlj(JSON.stringify(document));
    expect(adljResult.diagnostics).toEqual([]);

    // The same shape, hand-ported to .adl text, must resolve identically —
    // proving both front-ends reach validateApplicationModel unchanged.
    const adlResult = compileAdl(`APP AutoIdNoDefault
END.APP

OBJECT Item
  FIELD Code TEXT REQUIRED AUTO_ID
END.OBJECT
`);
    expect(adlResult.diagnostics).toEqual([]);
    expect(adljResult.model).toEqual(adlResult.model);
  });
});

describe('comment threading: AdljSourceDocument "comment" -> PartialApplicationModel comment', () => {
  it('reads the JSON "comment" key into the same field .adl text populates, and the printer emits it as a # line', () => {
    const document: AdljSourceDocument = {
      app: { name: "AdljComment", comment: "Why this app exists" },
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Widget",
          comment: "Why this object exists",
          fields: [
            {
              name: "Name",
              type: "text",
              required: true,
              comment: "Why this field is required",
            },
          ],
        },
      ],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);
    expect(partialModel.app.comment).toBe("Why this app exists");
    expect(partialModel.objects[0]?.comment).toBe("Why this object exists");
    expect(partialModel.objects[0]?.fields?.[0]?.comment).toBe("Why this field is required");

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).toContain("# Why this app exists\nAPP");
    expect(printed).toContain("# Why this object exists\nOBJECT Widget");
    expect(printed).toContain("  # Why this field is required\n  FIELD Name");

    // And the printed text reparses through .adl's own front end carrying
    // the identical comment, proving the two front ends agree on the shape.
    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.partialModel.app.comment).toBe("Why this app exists");
    expect(reparsed.partialModel.objects[0]?.comment).toBe("Why this object exists");
    expect(reparsed.partialModel.objects[0]?.fields?.[0]?.comment).toBe(
      "Why this field is required",
    );
  });

  it("prints a multi-line comment field as one # line per \\n-separated line", () => {
    const document: AdljSourceDocument = {
      app: { name: "MultiLineComment" },
      contexts: [],
      readModels: [],
      objects: [
        {
          name: "Widget",
          comment: "First line\nSecond line",
          fields: [{ name: "Name", type: "text", required: true }],
        },
      ],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).toContain("# First line\n# Second line\nOBJECT Widget");
  });

  it("omits the comment entirely (no printed # line, no field) when the .adlj document declares none", () => {
    const document: AdljSourceDocument = {
      app: { name: "NoComment" },
      contexts: [],
      readModels: [],
      objects: [{ name: "Widget", fields: [{ name: "Name", type: "text", required: true }] }],
    };

    const { partialModel, diagnostics } = compileAdlj(JSON.stringify(document));
    expect(diagnostics).toEqual([]);
    expect(partialModel.app.comment).toBeUndefined();
    expect(partialModel.objects[0]?.comment).toBeUndefined();

    const printed = printPartialApplicationModelAsAdl(partialModel);
    expect(printed).not.toContain("#");
  });
});

/**
 * A `.adlj` document reaching every construct Phase 100 gave text syntax that
 * no shipped application declares, plus (Phase 104) every part of a `MATRIX`
 * that the presentation conformance corpus does not reach. Kept next to the
 * round-trip that consumes it rather than in `examples/`, because it exists to
 * exercise the printer and the parser against each other, not to demonstrate
 * an application.
 */
const PRINTER_COVERAGE_SOURCE = {
  app: { name: "PrinterCoverage", startView: "SongBoard" },
  modelVersion: "1.0.0",
  contexts: [],
  readModels: [
    {
      name: "SongRoster",
      sources: [{ name: "song", object: "Song" }],
      fields: [
        { name: "SongKey", source: "song", field: "Title" },
        { name: "SongLabel", source: "song", field: "Title" },
      ],
    },
    {
      name: "SongSlots",
      sources: [{ name: "slot", object: "Slot" }],
      fields: [
        { name: "SongKey", source: "slot", field: "SongKey" },
        { name: "SlotDay", source: "slot", field: "Day" },
        { name: "SlotState", source: "slot", field: "State" },
        { name: "Conflicted", source: "slot", field: "Conflicted" },
      ],
    },
  ],
  objects: [
    {
      name: "Slot",
      businessKey: "SongKey",
      displayField: "SongKey",
      fields: [
        { name: "SongKey", type: "text", required: true },
        { name: "Day", type: "date", required: true },
        { name: "State", type: "text" },
        { name: "Conflicted", type: "boolean" },
      ],
    },
    {
      name: "Song",
      businessKey: "Title",
      displayField: "Title",
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "Composer", type: "text" },
        { name: "Date", type: "date" },
      ],
      views: [
        {
          name: "SongBoard",
          kind: "composite",
          fields: ["Title", "Composer"],
          presentation: {
            state: [{ name: "visibleMonth", type: "text", defaultValue: "2026-01" }],
            statuses: [
              { name: "current", label: "Current", themeToken: "colorInfo", precedence: 10 },
              { name: "booked", label: "Booked", precedence: 20 },
              { name: "held", label: "Held", precedence: 30 },
              { name: "free", label: "Free" },
            ],
            statusMaps: [
              {
                name: "SlotStatus",
                field: "SlotState",
                values: [
                  { value: "booked", status: "booked" },
                  { value: "held", status: "held" },
                ],
              },
              {
                name: "ConflictStatus",
                field: "Conflicted",
                values: [{ value: true, status: "held" }],
              },
            ],
            sections: [
              {
                name: "Board",
                heading: "Board",
                controls: [
                  {
                    name: "monthPick",
                    kind: "select",
                    state: "visibleMonth",
                    label: "Month",
                    icon: { kind: "named", name: "calendar" },
                    options: [
                      {
                        value: "2026-01",
                        label: "January",
                        icon: { kind: "named", name: "calendar" },
                      },
                      { value: "2026-02", label: "February" },
                    ],
                  },
                  {
                    name: "bandPicker",
                    kind: "contextSelector",
                    label: "Band",
                    icon: { kind: "named", name: "users" },
                  },
                ],
                lists: [
                  {
                    name: "Songs",
                    sourceKind: "object",
                    source: "Song",
                    fields: ["Title", "Composer"],
                    renderAs: "table",
                    emptyState: { text: "No songs", icon: { kind: "named", name: "music" } },
                    row: {
                      fragments: [
                        { kind: "field", field: "Title", style: "bold" },
                        { kind: "field", field: "Composer", fallback: "Unknown", style: "muted" },
                        {
                          kind: "field",
                          field: "Date",
                          format: { kind: "date" },
                          style: "caption",
                        },
                      ],
                    },
                  },
                ],
                matrices: [
                  {
                    // Everything the presentation conformance corpus's two
                    // matrices do NOT reach: `readModel` on both sources,
                    // `recordSource`, a `cell.status` binding distinct from the
                    // cell *source's*, `unsetValue: null`, an explicit
                    // `bulkBehavior`, an explicit `unsetAsAbsence: false`, and
                    // all four status-candidate spellings with more than one
                    // candidate.
                    name: "Slots",
                    density: "spacious",
                    rowSource: {
                      sourceKind: "readModel",
                      source: "SongRoster",
                      keyField: "SongKey",
                      labelField: "SongLabel",
                      fields: ["SongKey", "SongLabel"],
                      sort: [{ field: "SongLabel", direction: "desc" }],
                    },
                    columnAxis: {
                      kind: "dateRange",
                      start: "2026-01-05",
                      end: "2026-01-09",
                      stepDays: 2,
                      labelFormat: { kind: "date", pattern: "EEE d" },
                    },
                    cellSource: {
                      sourceKind: "readModel",
                      source: "SongSlots",
                      rowField: "SongKey",
                      columnField: "SlotDay",
                      fields: ["SongKey", "SlotDay", "SlotState", "Conflicted"],
                      status: { candidates: [{ kind: "map", map: "SlotStatus" }] },
                      recordSource: "Slot",
                    },
                    cell: {
                      status: {
                        candidates: [
                          { kind: "map", map: "SlotStatus", field: "SlotState" },
                          { kind: "map", map: "ConflictStatus", value: true },
                          { kind: "map", map: "SlotStatus" },
                          { kind: "status", status: "current" },
                        ],
                      },
                      unsetStatus: "free",
                      accessibleLabel: "Slot",
                    },
                    edit: {
                      object: "Slot",
                      rowField: "SongKey",
                      columnField: "Day",
                      valueField: "State",
                      cycle: ["booked", "held"],
                      unsetValue: null,
                      unsetAsAbsence: false,
                      bulkBehavior: "sequentialValidatedWrites",
                    },
                  },
                ],
                calendars: [
                  {
                    name: "Planner",
                    sourceKind: "object",
                    source: "Song",
                    dateField: "Date",
                    titleField: "Title",
                    month: {
                      state: "visibleMonth",
                      weekStart: "monday",
                      labelFormat: { kind: "date", pattern: "MMMM yyyy" },
                    },
                    emptyState: {
                      text: "Nothing this month",
                      icon: { kind: "named", name: "calendar" },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("printPartialApplicationModelAsAdl", () => {
  // A permanent CI drift check (Phase 78): for every fixture below, printing
  // the compiled `partialModel` back to `.adl` text and reparsing it must
  // resolve to a model deep-equal to the original. If a future change to a
  // fixture's source, the printer, or the resolver introduces a divergence the
  // printer cannot round-trip, one of these tests catches it.
  //
  // Phase 98 deleted Giggle Band's `.adl` snapshot, which used to supply the
  // rich half of this proof. The replacement subjects are real `.adlj` sources
  // and the `examples/` corpus, so nothing here depends on hand-authored `.adl`
  // text: `.adl` is the printed view of `.adlj`, and this describes what that
  // view can say.
  //
  // Phase 100 restored the Giggle Band half by giving text syntax to the three
  // constructs that had blocked it, so both reference apps round-trip again
  // and the constructs Phase 98 recorded as losing coverage (`STATUS_MAP`,
  // `ICON_MAP`, presentation `TOGGLE`, `UNION`, a qualified
  // `READ_MODEL SOURCE JOIN`, `ATTACHMENT`) are all reached once more.
  it("round-trips the task-tracker fixture: print, reparse, resolve to the identical model", () => {
    const original = compileAdl(readExample("task-tracker.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the Jointly Care reference app: compile its real `.adlj` source, print, reparse", () => {
    // Jointly Care contributes what Giggle Band does not: three `CONTEXT`
    // declarations and three `CONTEXT_GRANT`s, twenty read models, thirty-two
    // policies, and four `MIGRATION` hops.
    const original = compileAdlProjectV2({
      manifestSource: readReference("jointly-care/app.yaml"),
      sources: {
        "domain.adlj": readReference("jointly-care/domain.adlj"),
        "ui.adlj": readReference("jointly-care/ui.adlj"),
      },
    });
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the purchase-order example: edit surfaces, pickers, child collections, lifecycle", () => {
    // What Jointly Care does not exercise: `LIFECYCLE` with terminal states,
    // `EDIT_SECTION`s, an `ORDERED` child collection, both relationship-picker
    // modes, and a policy rule carrying `FIELDS` alongside `ROLE` and `STATE`
    // — the combination that exposed the missing `FIELDS` stop word in
    // `src/parser/grammar/policy.ts` (Phase 98).
    const original = compileAdl(readExample("purchase-order.adl"));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    const reparsed = compileAdl(printed);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("prints MIGRATION blocks, including a hop that reshapes no record", () => {
    // `MIGRATION` had text grammar from the start and was never printed, so
    // every hop vanished from the printed `.adl` — silently, unlike the
    // constructs the printer refuses by name. Neither round-trip fixture that
    // existed before Phase 98 declared a migration, so nothing caught it until
    // Jointly Care's four hops came back as `migrations: []`.
    const original = compileAdlj(
      JSON.stringify({
        app: { name: "MigrationPrinting", startView: "WidgetList" },
        modelVersion: "1.2.0",
        contexts: [],
        readModels: [],
        objects: [
          {
            name: "Widget",
            schemaVersion: 2,
            businessKey: "Code",
            displayField: "Label",
            fields: [
              { name: "Code", type: "text", required: true },
              { name: "Label", type: "text", required: true },
              { name: "PayoutCents", type: "number" },
            ],
            views: [{ name: "WidgetList", kind: "list", fields: ["Code", "Label"] }],
          },
        ],
        migrations: [
          // A version bump whose records need no reshaping is legal and
          // meaningful, and prints as an empty MIGRATION/END.MIGRATION pair.
          { from: "1.0.0", to: "1.1.0" },
          {
            from: "1.1.0",
            to: "1.2.0",
            objects: [
              {
                object: "Widget",
                schemaVersion: 2,
                steps: [
                  { kind: "renameField", from: "Name", to: "Label" },
                  { kind: "addField", field: "PayoutCents", defaultValue: 0 },
                  { kind: "dropField", field: "LegacyNote" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    expect(printed).toContain(
      [
        "MIGRATION FROM '1.0.0' TO '1.1.0'",
        "END.MIGRATION",
        "",
        "MIGRATION FROM '1.1.0' TO '1.2.0'",
        "  OBJECT Widget",
        "    SCHEMA_VERSION 2",
        "    RENAME FIELD Name TO Label",
        "    ADD FIELD PayoutCents DEFAULT(0)",
        "    DROP FIELD LegacyNote",
        "  END.OBJECT",
        "END.MIGRATION",
      ].join("\n"),
    );

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the Giggle Band reference app, including the constructs Phase 100 gave text syntax", () => {
    // The flagship application, and the one the printer refused outright from
    // Phase 87 until Phase 100: its `MonthPlanner` calendar declares a
    // `conflictOverlay` and its `SetListForm` `Songs` collection declares both
    // `projectedFields` and a `summary`. It is also the only fixture reaching
    // `STATUS_MAP`, `ICON_MAP`, presentation `TOGGLE`, a `UNION` read model, a
    // qualified `READ_MODEL SOURCE ... JOIN`, and `ATTACHMENT`.
    const original = compileAdlProjectV2({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adlj": readReference("giggle-band/domain.adlj"),
        "ui.adlj": readReference("giggle-band/ui.adlj"),
      },
    });
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);

    // Pin the three constructs by their printed text as well as by the
    // round-trip: a regression that dropped one silently would still resolve
    // to an equal model if the resolver defaulted it back, and the whole point
    // of this phase is that nothing declared may vanish on the way out.
    expect(printed).toContain(
      [
        "        CONFLICT_OVERLAY FROM READ_MODEL EventAvailabilityConflicts",
        "          DATE_FIELD Date",
        "          FLAG_FIELD IsConflict",
        "          STATUS conflict",
        "        END.CONFLICT_OVERLAY",
      ].join("\n"),
    );
    expect(printed).toContain(
      [
        "      PROJECTED_FIELD DurationSeconds THROUGH Song FIELD DurationSeconds",
        "      SUMMARY SUM DurationSeconds",
        "        LABEL 'Total'",
        "        FORMAT DURATION 'm:ss'",
        "        PLACEMENT FOOTER",
        "      END.SUMMARY",
      ].join("\n"),
    );

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the constructs neither reference app reaches", () => {
    // `SELECT`/`CONTEXT_SELECTOR` controls, a `LIST FIELDS` projection, an
    // empty-state `EMPTY_ICON` on both a list and a calendar, a field
    // fragment's `FALLBACK`, and a calendar's `MONTH_LABEL_FORMAT` all gained
    // text syntax in Phase 100 but appear in no shipped application, so this
    // fixture is what keeps them proven. The `Date` fragment deliberately
    // carries a pattern-less `FORMAT` *and* a `STYLE`: printing that pair used
    // to emit text the parser could not read back, because the format's
    // pattern reader swallowed the following `STYLE` keyword.
    const original = compileAdlj(JSON.stringify(PRINTER_COVERAGE_SOURCE));
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    expect(printed).toContain("        OPTION '2026-01' LABEL 'January' ICON calendar");
    expect(printed).toContain("      CONTEXT_SELECTOR bandPicker");
    expect(printed).toContain("        FIELDS Title Composer");
    expect(printed).toContain("        EMPTY_ICON music");
    expect(printed).toContain("          TEXT Composer FALLBACK 'Unknown' STYLE MUTED");
    expect(printed).toContain("          TEXT Date FORMAT DATE STYLE CAPTION");
    expect(printed).toContain("        MONTH_LABEL_FORMAT DATE 'MMMM yyyy'");
    expect(printed).toContain("        EMPTY_ICON calendar");

    // Phase 104's MATRIX, pinned as text as well as by the round-trip. Each of
    // these three could vanish and still resolve equal, because a resolver
    // default or an absent key would mask it:
    //   * `RECORD_SOURCE` is read by nothing at runtime;
    //   * `CELL ... STATUS` overrides `CELLS ... STATUS`, so printing one as
    //     the other changes which binding wins, not whether there is one;
    //   * `UNSET_VALUE NULL` and an omitted directive are different models,
    //     and a `!value` test in the printer would collapse them.
    expect(printed).toContain(
      [
        "      MATRIX Slots",
        "        DENSITY SPACIOUS",
        "        ROWS FROM READ_MODEL SongRoster",
        "          KEY SongKey",
        "          LABEL SongLabel",
        "          FIELDS SongKey SongLabel",
        "          ORDER BY SongLabel DESC",
        "        END.ROWS",
        "        COLUMNS DATE_RANGE '2026-01-05' TO '2026-01-09' STEP_DAYS 2 LABEL_FORMAT DATE 'EEE d'",
        "        CELLS FROM READ_MODEL SongSlots ROW SongKey COLUMN SlotDay",
        "          FIELDS SongKey SlotDay SlotState Conflicted",
        "          RECORD_SOURCE Slot",
        "          STATUS SlotStatus()",
        "        END.CELLS",
        "        CELL",
        "          STATUS SlotStatus(FIELD SlotState)",
        "          STATUS ConflictStatus(VALUE TRUE)",
        "          STATUS SlotStatus()",
        "          STATUS current",
        "          UNSET_STATUS free",
        "          ACCESSIBLE_LABEL 'Slot'",
        "        END.CELL",
        "        EDIT Slot ROW SongKey COLUMN Day VALUE State",
        "          CYCLE 'booked' 'held'",
        "          UNSET_VALUE NULL",
        "          UNSET_AS_ABSENCE FALSE",
        "          BULK_BEHAVIOR SEQUENTIAL_VALIDATED_WRITES",
        "        END.EDIT",
        "      END.MATRIX",
      ].join("\n"),
    );

    // The negative half of those pins: each construct must not print as the
    // *other* thing it could plausibly print as, because in every one of these
    // pairs both spellings parse and only one is the model that was authored.
    //
    //   `STATUS SlotStatus` (no parentheses) reparses as a direct status
    //   reference named after the map, not as a map candidate deferring to the
    //   map's own field. That is exactly the silent widening Phase 103
    //   measured for policy principals.
    expect(printed).not.toMatch(/^\s*STATUS SlotStatus$/m);
    //   A bare `FROM SongRoster` leaves the source kind unstated, which
    //   resolves to `readModel` by default — right here by luck, wrong for
    //   every object-sourced matrix.
    expect(printed).not.toMatch(/^\s*ROWS FROM SongRoster$/m);
    //   `UNSET_VALUE` with nothing after it, or omitted, is `undefined`.
    expect(printed).not.toMatch(/^\s*UNSET_VALUE$/m);
    //   A bare `UNSET_AS_ABSENCE` means `true`; this matrix declares `false`.
    expect(printed).not.toMatch(/^\s*UNSET_AS_ABSENCE$/m);
    //   `COLUMNS` without its axis-kind word would be an unmarked line that a
    //   second axis kind could only be added by reinterpreting.
    expect(printed).not.toMatch(/^\s*COLUMNS '2026-01-05'/m);

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  it("round-trips the presentation conformance corpus's two matrices", () => {
    // `conformance/presentation/status-matrix-calendar.json`'s `resourceMatrix`
    // model is the closest thing `MATRIX` has to a real application: two
    // matrices, authored at Phase 29 to exercise the matrix *runtime*, and the
    // corpus the eleven `presentation.matrix.*` conformance cases execute
    // against. It cannot have been shaped to fit a grammar that did not exist
    // when it was written, which is what makes it the right subject.
    //
    // `contexts`/`readModels` are supplied here rather than in the corpus:
    // `compileAdlj` omits both keys when a document declares neither while
    // `compileAdl` emits `[]`, a known cosmetic divergence carried forward
    // since Phase 98 and unrelated to matrices. Without them the two resolved
    // models differ in exactly those two keys and their fingerprint, and in
    // nothing else — measured.
    const corpus = JSON.parse(
      readFileSync(
        new URL("../conformance/presentation/status-matrix-calendar.json", import.meta.url),
        "utf8",
      ),
    ) as { models: Record<string, Record<string, unknown>> };
    const resourceMatrix = corpus.models.resourceMatrix;
    expect(resourceMatrix).toBeDefined();

    const original = compileAdlj(
      JSON.stringify({ contexts: [], readModels: [], ...resourceMatrix }),
    );
    expect(original.diagnostics).toEqual([]);

    const printed = printPartialApplicationModelAsAdl(original.partialModel);
    expect(printed).toContain(
      [
        "      MATRIX AvailabilityMatrix",
        "        ROWS FROM OBJECT Member",
        "          KEY MemberKey",
        "          LABEL MemberName",
        "          FIELDS MemberKey MemberName",
        "          ORDER BY MemberName ASC",
        "        END.ROWS",
        "        COLUMNS DATE_RANGE '2026-03-02' TO '2026-03-06' LABEL_FORMAT DATE 'EEE d'",
        "        CELLS FROM OBJECT Availability ROW MemberKey COLUMN Day",
        "          FIELDS MemberKey Day State",
        "          STATUS StateStatus()",
        "        END.CELLS",
        "        CELL",
        "          UNSET_STATUS unset",
        "        END.CELL",
        "        EDIT Availability ROW MemberKey COLUMN Day VALUE State",
        "          CYCLE 'available' 'unavailable'",
        "          UNSET_AS_ABSENCE",
        "        END.EDIT",
        "      END.MATRIX",
      ].join("\n"),
    );
    // Neither matrix declares a `STEP_DAYS` of 1 or a `density` of
    // `comfortable`; both are resolver defaults, and printing one would turn a
    // default into an authored value that a later default change could no
    // longer move.
    expect(printed).not.toContain("STEP_DAYS 1");
    expect(printed).not.toContain("DENSITY COMFORTABLE");
    // The second matrix declares no `edit` at all.
    expect(printed).not.toContain(
      "EDIT Availability ROW MemberKey COLUMN Day VALUE State\n" + "        END.EDIT",
    );

    const reparsed = compileAdl(printed);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.model).toEqual(original.model);
  });

  describe("constructs that still have no ADL text syntax", () => {
    // The printer's contract for what it cannot render is unchanged: throw a
    // clear, named error rather than silently drop declared content.
    //
    // One construct is left. Phase 100 deferred three; Phase 104 gave `MATRIX`
    // text syntax (its round-trips are above, and they cover strictly more
    // than the refusal test they replaced). What remains is a conditional row
    // fragment, and it stays refused on purpose: "how much conditional logic
    // belongs in a row template before it becomes a computed/read-model
    // concern?" is an open *language* question in
    // `docs/spec/ui-language-addendum.md`, and inventing a `WHEN` block inside
    // `ROW` would settle it by fiat rather than by decision.
    function refusalFor(
      sectionExtras: Record<string, unknown>,
      presentationExtras: Record<string, unknown> = {},
    ): () => string {
      const compiled = compileAdlj(
        JSON.stringify({
          app: { name: "StillRefused", startView: "SongBoard" },
          modelVersion: "1.0.0",
          contexts: [],
          readModels: [],
          objects: [
            {
              name: "Song",
              businessKey: "Title",
              displayField: "Title",
              fields: [
                { name: "Title", type: "text", required: true },
                { name: "Date", type: "date" },
              ],
              views: [
                {
                  name: "SongBoard",
                  kind: "composite",
                  fields: ["Title"],
                  presentation: {
                    ...presentationExtras,
                    sections: [{ name: "Board", heading: "Board", ...sectionExtras }],
                  },
                },
              ],
            },
          ],
        }),
      );
      expect(compiled.diagnostics).toEqual([]);
      return () => printPartialApplicationModelAsAdl(compiled.partialModel);
    }

    it("refuses a conditional row fragment by name", () => {
      expect(
        refusalFor({
          lists: [
            {
              name: "Songs",
              sourceKind: "object",
              source: "Song",
              row: {
                fragments: [
                  {
                    kind: "conditional",
                    when: "Title != null",
                    fragments: [{ kind: "field", field: "Title" }],
                  },
                ],
              },
            },
          ],
        }),
      ).toThrow(/conditional row fragment/);
    });
  });
});
