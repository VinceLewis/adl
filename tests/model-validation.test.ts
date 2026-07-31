import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIFECYCLE_STATE_FIELD,
  MODEL_VALIDATION_CODES,
  compileAdl,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  ResolvedSyncPolicy,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const validPartialModel = {
  app: {
    name: "CareOps",
  },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "PatientRecord",
      businessKey: "PatientNumber",
      displayField: "Name",
      fields: [
        { name: "PatientNumber", type: "text", required: true, autoId: { prefix: "PAT-", pad: 6 } },
        { name: "Name", type: "text", required: true },
        { name: "DateOfBirth", type: "date" },
      ],
      lifecycle: {
        name: "PatientLifecycle",
        states: [{ name: "Draft" }, { name: "Active" }, { name: "Archived", terminal: true }],
        actions: [
          {
            name: "activate",
            from: "Draft",
            to: "Active",
            policyRefs: ["PatientActivationPolicy"],
            hooks: {
              before: ["hooks.patient.validateActivation"],
            },
          },
        ],
      },
    },
  ],
  policies: [
    {
      name: "PatientActivationPolicy",
      object: "PatientRecord",
      rules: [
        {
          name: "allowAdminActivation",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "transition",
          lifecycleAction: "activate",
          state: "Draft",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

describe("validateApplicationModel", () => {
  it("accepts a valid resolved model produced by resolveApplicationModel", () => {
    const resolved = resolveApplicationModel(validPartialModel);

    expect(resolved.objects[0]?.lifecycle?.stateField).toBe(DEFAULT_LIFECYCLE_STATE_FIELD);
    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("accepts the Phase 1 default deny policy shape", () => {
    const resolved = resolveApplicationModel({
      app: { name: "DefaultDenyApp" },
      objects: [
        {
          name: "Task",
          businessKey: "TaskNumber",
          displayField: "Title",
          fields: [
            { name: "TaskNumber", type: "text", required: true },
            { name: "Title", type: "text", required: true },
          ],
        },
      ],
    });

    expect(resolved.policies).toEqual([
      {
        name: "TaskDefaultDeny",
        object: "Task",
        defaultEffect: "deny",
        rules: [],
      },
    ]);
    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("accepts valid business context, object scope, view context, and read-model declarations", () => {
    const resolved = resolveApplicationModel(bandContextPartialModel);

    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("accepts valid composed view presentation declarations", () => {
    const resolved = resolveApplicationModel(createPresentationPartialModel());

    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("accepts valid relationship picker declarations", () => {
    const resolved = resolveApplicationModel(createRelationshipPickerPartialModel());

    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("reports invalid relationship picker declarations", () => {
    const invalidSource = resolveApplicationModel(createRelationshipPickerPartialModel());
    const event = invalidSource.objects.find((object) => object.name === "Event");
    const form = event?.views.find((view) => view.name === "EventForm");
    const section = form?.editSections.find((candidate) => candidate.kind === "childCollection");
    if (
      section === undefined ||
      section.kind !== "childCollection" ||
      section.picker === undefined
    ) {
      throw new Error("Expected valid relationship picker fixture.");
    }

    section.operations = ["createChild"];
    section.picker.sourceKind = "readModel";
    section.picker.source = "MissingCandidates";
    section.picker.selection = "invalid" as "multiple";
    section.picker.displayFields = ["MissingDisplay"];
    section.picker.searchFields = ["MissingSearch"];
    section.picker.sort = [{ field: "MissingSort", direction: "asc" }];

    expect(validateApplicationModel(invalidSource).map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_LINK_OPERATION_REQUIRED,
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SELECTION_INVALID,
      ]),
    );

    const invalidFields = resolveApplicationModel(createRelationshipPickerPartialModel());
    const fieldsSection = invalidFields.objects
      .find((object) => object.name === "Event")
      ?.views.find((view) => view.name === "EventForm")
      ?.editSections.find((candidate) => candidate.kind === "childCollection");
    if (
      fieldsSection === undefined ||
      fieldsSection.kind !== "childCollection" ||
      fieldsSection.picker === undefined
    ) {
      throw new Error("Expected valid relationship picker fixture.");
    }
    fieldsSection.picker.displayFields = ["MissingDisplay"];
    fieldsSection.picker.searchFields = ["MissingSearch"];
    fieldsSection.picker.sort = [{ field: "MissingSort", direction: "asc" }];

    expect(validateApplicationModel(invalidFields).map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_DISPLAY_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SEARCH_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SORT_FIELD_UNKNOWN,
      ]),
    );
  });

  /*
   * These diagnostics existed long before any ADL syntax could reach them, so
   * until now nothing proved an authored file produces them. Each broken
   * declaration below is one an author can actually write.
   */
  it("reports edit surface and relationship picker diagnostics from ADL source", () => {
    const result = compileAdl(`APP Orders
  START_VIEW OrderList
END.APP

OBJECT Order
  KEY Code
  DISPLAY Code
  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT

  VIEW OrderList LIST
    FIELDS Code Notes
  END.VIEW

  VIEW OrderForm FORM
    FIELDS Code Notes
    EDIT_SECTION Details
      FIELDS Code Missing
    END.EDIT_SECTION
    EDIT_SECTION Details
      FIELDS Notes
    END.EDIT_SECTION
    CHILD_COLLECTION UnknownChild
      CHILD Nowhere PARENT_FIELD Order
    END.CHILD_COLLECTION
    CHILD_COLLECTION UnknownParentField
      CHILD OrderLine PARENT_FIELD Missing
    END.CHILD_COLLECTION
    CHILD_COLLECTION NotALookupBack
      CHILD OrderLine PARENT_FIELD Description
    END.CHILD_COLLECTION
    CHILD_COLLECTION UnknownChildView
      CHILD OrderLine PARENT_FIELD Order
      CHILD_VIEW NoSuchView
    END.CHILD_COLLECTION
    CHILD_COLLECTION UnknownOrderField
      CHILD OrderLine PARENT_FIELD Order
      ORDER_FIELD Missing
    END.CHILD_COLLECTION
    CHILD_COLLECTION ReorderWithoutOrderField
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS createChild reorder
    END.CHILD_COLLECTION
    CHILD_COLLECTION PickerWithoutLink
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS createChild
      PICKER LinesPicker
        DISPLAY Description
      END.PICKER
    END.CHILD_COLLECTION
    CHILD_COLLECTION PickerFields
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS linkExisting
      PICKER LinesPicker
        DISPLAY NoDisplay
        SEARCH NoSearch
        SORT NoSort ASC
      END.PICKER
    END.CHILD_COLLECTION
    CHILD_COLLECTION PickerWrongSource
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS linkExisting
      PICKER LinesPicker
        SOURCE OBJECT Order
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT

OBJECT OrderLine
  DISPLAY Description
  FIELD Order TEXT REQUIRED LOOKUP Order DISPLAY Code
  FIELD Description TEXT
  FIELD Position NUMBER REQUIRED
END.OBJECT
`);

    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_DUPLICATE,
        "objects[0].views[1].editSections[1].name",
      ],
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[0].fields[1]",
      ],
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_CHILD_OBJECT_UNKNOWN,
        "objects[0].views[1].editSections[2].childObject",
      ],
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_PARENT_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[3].parentField",
      ],
      // Declared, but a lookup at something other than the parent, so it cannot
      // be the field this collection is a collection of.
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_PARENT_FIELD_INVALID,
        "objects[0].views[1].editSections[4].parentField",
      ],
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_CHILD_VIEW_UNKNOWN,
        "objects[0].views[1].editSections[5].childView",
      ],
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_ORDER_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[6].orderField",
      ],
      // Reorder with no order field at all: the same code, because the missing
      // thing is the same thing.
      [
        MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_ORDER_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[7].orderField",
      ],
      [
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_LINK_OPERATION_REQUIRED,
        "objects[0].views[1].editSections[8].picker.name",
      ],
      [
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_DISPLAY_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[9].picker.displayFields[0]",
      ],
      [
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SEARCH_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[9].picker.searchFields[0]",
      ],
      [
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SORT_FIELD_UNKNOWN,
        "objects[0].views[1].editSections[9].picker.sort[0].field",
      ],
      [
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        "objects[0].views[1].editSections[10].picker.source",
      ],
    ]);
    expect(
      result.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_PARENT_FIELD_INVALID,
      )?.message,
    ).toBe(
      "Edit child collection 'NotALookupBack' parent field 'Description' must lookup parent object 'Order'.",
    );
    expect(
      result.diagnostics.find(
        (diagnostic) =>
          diagnostic.code === MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
      )?.message,
    ).toBe(
      "Relationship picker 'LinesPicker' object source 'Order' must be child object 'OrderLine'.",
    );
  });

  /*
   * The grace is also the authority's session lifetime, so a value that is not
   * a whole number of days in range must be a diagnostic rather than quietly
   * becoming the default or a lifetime nobody declared.
   */
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["not a number", Number.NaN],
    ["beyond the bound", 366],
  ])("refuses a %s offline grace", (_label, offlineGraceDays) => {
    const model = resolveApplicationModel(validPartialModel);
    const invalid = { ...model, app: { ...model.app, offlineGraceDays } };

    expect(validateApplicationModel(invalid).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.APP_OFFLINE_GRACE_INVALID,
    );
  });

  it("accepts a declared offline grace inside the bound", () => {
    const model = resolveApplicationModel({
      ...validPartialModel,
      app: { ...validPartialModel.app, offlineGraceDays: 14 },
    });

    expect(model.app.offlineGraceDays).toBe(14);
    expect(validateApplicationModel(model).map((diagnostic) => diagnostic.code)).not.toContain(
      MODEL_VALIDATION_CODES.APP_OFFLINE_GRACE_INVALID,
    );
  });

  it("does not mutate the resolved model", () => {
    const resolved = resolveApplicationModel(validPartialModel);
    const before = JSON.stringify(resolved);

    validateApplicationModel(resolved);

    expect(JSON.stringify(resolved)).toBe(before);
  });

  it("returns multiple structured diagnostics from a single invalid model", () => {
    const invalid = createInvalidResolvedModel();
    const diagnostics = validateApplicationModel(invalid);
    const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

    expect(diagnostics.length).toBeGreaterThan(20);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(
      diagnostics.every(
        (diagnostic) =>
          diagnostic.code.startsWith("ADL_") &&
          diagnostic.message.length > 0 &&
          diagnostic.path !== undefined,
      ),
    ).toBe(true);

    expect([...codes]).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.APP_START_VIEW_UNKNOWN,
        MODEL_VALIDATION_CODES.APP_THEME_UNKNOWN,
        MODEL_VALIDATION_CODES.AUTO_ID_NON_TEXT,
        MODEL_VALIDATION_CODES.FIELD_DEFAULT_INCOMPATIBLE,
        MODEL_VALIDATION_CODES.FIELD_DUPLICATE,
        MODEL_VALIDATION_CODES.HOOK_REFERENCE_INVALID,
        MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_FROM_UNKNOWN,
        MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_POLICY_UNKNOWN,
        MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_TO_UNKNOWN,
        MODEL_VALIDATION_CODES.LIFECYCLE_INITIAL_STATE_UNKNOWN,
        MODEL_VALIDATION_CODES.LIFECYCLE_STATE_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.LOOKUP_DISPLAY_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.LOOKUP_TARGET_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.LOOKUP_TARGET_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.OBJECT_BUSINESS_KEY_UNKNOWN,
        MODEL_VALIDATION_CODES.OBJECT_DISPLAY_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.OBJECT_DUPLICATE,
        MODEL_VALIDATION_CODES.OBJECT_POLICY_UNKNOWN,
        MODEL_VALIDATION_CODES.OBJECT_SYNC_MODE_INVALID,
        MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_DAYS_INVALID,
        MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_LIMIT_INVALID,
        MODEL_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_LIFECYCLE_ACTION_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_STATE_UNKNOWN,
        MODEL_VALIDATION_CODES.SYNC_MODE_INVALID,
        MODEL_VALIDATION_CODES.SYNC_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.SYNC_WINDOW_DAYS_INVALID,
        MODEL_VALIDATION_CODES.SYNC_WINDOW_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.SYNC_WINDOW_LIMIT_INVALID,
        MODEL_VALIDATION_CODES.THEME_BASE_UNKNOWN,
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        MODEL_VALIDATION_CODES.VIEW_EDIT_CONTAINER_INVALID,
        MODEL_VALIDATION_CODES.VIEW_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.VIEW_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.VIEW_SEARCH_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.VIEW_SORT_FIELD_UNKNOWN,
      ]),
    );
  });

  it("treats metadata fields as invalid for ordinary author-facing field references", () => {
    const resolved = resolveApplicationModel({
      ...validPartialModel,
      policies: [
        ...validPartialModel.policies,
        {
          name: "InvalidMetadataFieldPolicy",
          object: "PatientRecord",
          rules: [
            {
              name: "cannotEditMetadataState",
              effect: "allow",
              action: "update",
              fields: [DEFAULT_LIFECYCLE_STATE_FIELD],
            },
          ],
        },
      ],
    });

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
    );
  });

  /**
   * A sync window is a span of days measured against a moment, so the field it
   * names has to hold one. Before this was checked, a model could declare a
   * window over any field that existed — `_syncStatus`, say, which is a text
   * metadata field — and the runtime would parse its value as a date, fail, and
   * exclude the record. The dataset came back empty and nothing said why.
   */
  it("refuses a sync window measured over a field that is not a date or datetime", () => {
    const resolved = resolveApplicationModel({
      ...validPartialModel,
      objects: [
        {
          ...validPartialModel.objects[0],
          sync: { mode: "localFirst", scope: "recent", window: { field: "_syncStatus", days: 7 } },
        },
      ],
    } as PartialApplicationModel);

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_FIELD_NOT_TEMPORAL,
    );
  });

  it("accepts a sync window measured over a datetime metadata field", () => {
    const resolved = resolveApplicationModel({
      ...validPartialModel,
      objects: [
        {
          ...validPartialModel.objects[0],
          sync: { mode: "localFirst", scope: "recent", window: { field: "_updatedAt", days: 7 } },
        },
      ],
    } as PartialApplicationModel);

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).not.toContain(
      MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_FIELD_NOT_TEMPORAL,
    );
  });

  it("reports expression diagnostics for policy conditions and predicate validators", () => {
    const resolved = resolveApplicationModel({
      app: { name: "ExpressionDiagnostics" },
      objects: [
        {
          name: "Invoice",
          fields: [
            {
              name: "Amount",
              type: "number",
              validators: [
                {
                  kind: "predicate",
                  expression: {
                    kind: "binary",
                    operator: ">",
                    left: { kind: "field", field: "MissingAmount" },
                    right: { kind: "literal", value: 0 },
                  },
                },
              ],
            },
            { name: "Status", type: "text" },
          ],
        },
      ],
      policies: [
        {
          name: "InvoicePolicy",
          object: "Invoice",
          rules: [
            {
              name: "badRuntimeReference",
              effect: "allow",
              action: "read",
              condition: { kind: "runtime", property: "roles" as "userId" },
            },
            {
              name: "nonBooleanCondition",
              effect: "allow",
              action: "read",
              condition: {
                kind: "binary",
                operator: "+",
                left: { kind: "field", field: "Amount" },
                right: { kind: "literal", value: 1 },
              },
            },
            {
              name: "wrongOperandType",
              effect: "allow",
              action: "read",
              condition: {
                kind: "binary",
                operator: ">",
                left: { kind: "field", field: "Status" },
                right: { kind: "literal", value: 100 },
              },
            },
          ],
        },
      ],
    });

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.FIELD_VALIDATOR_EXPRESSION_INVALID,
        MODEL_VALIDATION_CODES.POLICY_CONDITION_RUNTIME_PROPERTY_INVALID,
        MODEL_VALIDATION_CODES.POLICY_CONDITION_TYPE,
      ]),
    );
  });

  it("reports decision-table default, overlap, and unreachable diagnostics", () => {
    const resolved = resolveApplicationModel({
      app: { name: "DecisionDiagnostics" },
      objects: [
        {
          name: "Invoice",
          fields: [
            { name: "Amount", type: "number" },
            { name: "Status", type: "text" },
          ],
        },
      ],
      decisionTables: [
        {
          name: "InvoiceTier",
          object: "Invoice",
          match: "single",
          inputs: [{ name: "amount", expression: { kind: "field", field: "Amount" } }],
          rows: [
            {
              name: "large",
              condition: {
                kind: "binary",
                operator: ">",
                left: { kind: "field", field: "amount" },
                right: { kind: "literal", value: 100 },
              },
              outputs: { tier: "large" },
            },
            {
              name: "alsoLarge",
              condition: {
                kind: "binary",
                operator: ">",
                left: { kind: "field", field: "amount" },
                right: { kind: "literal", value: 50 },
              },
              outputs: { tier: "alsoLarge" },
            },
            {
              name: "impossible",
              condition: {
                kind: "binary",
                operator: "and",
                left: {
                  kind: "binary",
                  operator: ">",
                  left: { kind: "field", field: "amount" },
                  right: { kind: "literal", value: 100 },
                },
                right: {
                  kind: "binary",
                  operator: "<",
                  left: { kind: "field", field: "amount" },
                  right: { kind: "literal", value: 10 },
                },
              },
              outputs: { tier: "never" },
            },
          ],
        },
      ],
    });

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.DECISION_TABLE_DEFAULT_MISSING,
        MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_OVERLAP,
        MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_UNREACHABLE,
      ]),
    );
  });

  it("reports invalid business context and read-model declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(bandContextPartialModel));
    const bandContext = invalid.contexts?.find((context) => context.name === "Band");
    const bandMember = invalid.objects.find((object) => object.name === "BandMember");
    const gig = invalid.objects.find((object) => object.name === "Gig");
    const readModel = invalid.readModels?.find(
      (candidate) => candidate.name === "UpcomingGigsByBand",
    );

    if (
      bandContext === undefined ||
      bandContext.membership === undefined ||
      bandMember === undefined ||
      gig === undefined ||
      readModel === undefined ||
      invalid.contexts === undefined
    ) {
      throw new Error("Expected valid band context fixture.");
    }

    bandContext.object = "MissingContextObject";
    (bandContext.selection as unknown as { mode: string }).mode = "sometimes";
    (bandContext.selection as unknown as { persistence: string }).persistence = "forever";
    (bandContext.selection as unknown as { source: string }).source = "cookie";
    (bandContext.selection as unknown as { routeParam: string }).routeParam = "";
    bandContext.membership.userField = "MissingUser";
    bandContext.membership.contextField = "Role";

    const roleField = bandMember.fields.find((field) => field.name === "Role");
    if (roleField === undefined) {
      throw new Error("Expected BandMember.Role field.");
    }
    (roleField as unknown as { type: string }).type = "number";

    invalid.contexts.push({
      name: "MissingMembership",
      object: "Band",
      selection: {
        mode: "optional",
        autoSelect: true,
        persistence: "none",
        source: "runtime",
      },
      membership: {
        object: "MissingBandMember",
        userField: "User",
        contextField: "Band",
        roleField: "Role",
        roles: [],
      },
      grants: [],
    });

    gig.scope = { context: "Band", field: "Venue" };
    const homeDashboard = gig.views.find((view) => view.name === "HomeDashboard");
    if (homeDashboard === undefined || homeDashboard.context === undefined) {
      throw new Error("Expected HomeDashboard view context.");
    }
    homeDashboard.context.context = "MissingContext";
    homeDashboard.readModel = "MissingReadModel";

    if (readModel.context === undefined) {
      throw new Error("Expected read model context.");
    }
    readModel.context.context = "MissingContext";
    const gigSource = readModel.sources.find((source) => source.name === "gig");
    if (gigSource === undefined) {
      throw new Error("Expected read model gig source.");
    }
    gigSource.object = "MissingGig";
    (gigSource as unknown as { scope: string }).scope = "nearby";
    readModel.sort.push({ field: "MissingSortField", direction: "asc" });
    readModel.fields.push(
      { name: "UnknownSourceField", source: "missing", field: "Date", type: "date" },
      { name: "UnknownBandField", source: "band", field: "MissingName", type: "text" },
    );

    const diagnostics = validateApplicationModel(invalid);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_CONTEXT_FIELD_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_ROLE_FIELD_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_MODE_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_PERSISTENCE_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_ROUTE_PARAM_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_SOURCE_INVALID,
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_FIELD_CONTEXT_MISMATCH,
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SOURCE_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_SORT_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_SCOPE_INVALID,
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_UNKNOWN,
        MODEL_VALIDATION_CODES.VIEW_READ_MODEL_UNKNOWN,
      ]),
    );
  });

  it("reports invalid presentation references and unsupported values", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPresentationPartialModel()));
    const home = invalid.objects[0]?.views[0];
    const presentation = home?.presentation;
    const filters = presentation?.sections[0];
    const schedule = presentation?.sections[1];
    const toggle = filters?.controls[0];
    const list = schedule?.lists[0];
    const state = presentation?.state[0];
    const iconMap = presentation?.iconMaps[0];

    if (
      home === undefined ||
      presentation === undefined ||
      filters === undefined ||
      schedule === undefined ||
      toggle === undefined ||
      toggle.kind !== "toggle" ||
      list === undefined ||
      state === undefined ||
      iconMap === undefined
    ) {
      throw new Error("Expected presentation fixture.");
    }

    (presentation as unknown as { layout: string }).layout = "masonry";
    (state as unknown as { type: string }).type = "attachment";
    state.defaultValue = 42;
    iconMap.field = "MissingIconField";
    toggle.state = "missingState";
    toggle.icon = { kind: "map", map: "MissingIconMap", value: "Gig" };
    presentation.shell = {
      regions: [{ region: "topBar", title: "Home", controls: ["missingControl"] }],
    };
    (presentation.shell.regions[0] as unknown as { region: string }).region = "floating";
    list.source = "MissingReadModel";
    list.fields.push("MissingListField");
    list.row.fragments.push({
      kind: "field",
      field: "MissingRowField",
      style: "plain",
      format: { kind: "date", pattern: "" },
    });
    (list.row.fragments[1] as unknown as { style: string }).style = "italic";
    list.filter = { kind: "field", field: "MissingFilterField" };

    const diagnostics = validateApplicationModel(invalid);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_STATE_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_FILTER_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_FORMAT_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_ICON_MAP_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_ICON_MAP_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_LAYOUT_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_SOURCE_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_ROW_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_ROW_FRAGMENT_STYLE_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_SHELL_CONTROL_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_SHELL_REGION_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_STATE_DEFAULT_INCOMPATIBLE,
        MODEL_VALIDATION_CODES.PRESENTATION_STATE_TYPE_INVALID,
      ]),
    );
  });

  it("reports invalid presentation status maps, legends, and precedence", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPresentationStatusPartialModel()));
    const presentation = invalid.objects[0]?.views[0]?.presentation;

    if (presentation === undefined) {
      throw new Error("Expected presentation fixture.");
    }

    presentation.statuses.push({ ...presentation.statuses[0]!, name: "available" });
    (presentation.statuses[0] as unknown as { themeToken: string }).themeToken = "brandGreen";
    presentation.statuses[0]!.precedence = 1.5;
    presentation.statusMaps.push({ ...presentation.statusMaps[0]!, name: "AvailabilityStatus" });
    presentation.statusMaps[0]!.field = "MissingAvailability";
    presentation.statusMaps[0]!.values.push({ value: "Available", status: "duplicateValue" });
    presentation.statusMaps[0]!.values.push({ value: "Unknown", status: "missingStatus" });
    presentation.statusMaps[0]!.defaultStatus = "missingDefault";
    presentation.legends.push({ ...presentation.legends[0]!, name: "AvailabilityLegend" });
    (presentation.legends[0] as unknown as { include: string }).include = "visible";
    presentation.legends[0]!.statuses.push("missingLegendStatus");
    const list = presentation.sections[0]?.lists[0];
    if (list === undefined) {
      throw new Error("Expected status list fixture.");
    }
    list.status = {
      candidates: [
        { kind: "status", status: "missingDirectStatus" },
        { kind: "map", map: "MissingStatusMap" },
        { kind: "map", map: "AvailabilityStatus", field: "MissingListField" },
      ],
    };

    const diagnostics = validateApplicationModel(invalid);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_DUPLICATE,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_THEME_TOKEN_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_PRECEDENCE_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_DUPLICATE,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_STATUS_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_VALUE_DUPLICATE,
        MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_DUPLICATE,
        MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_INCLUDE_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_STATUS_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_STATUS_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_STATUS_MAP_UNKNOWN,
      ]),
    );
  });

  it("reports invalid presentation matrix declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPresentationMatrixPartialModel()));
    const matrix = invalid.objects[0]?.views[0]?.presentation?.sections[0]?.matrices[0];
    if (matrix === undefined || matrix.edit === undefined) {
      throw new Error("Expected matrix fixture.");
    }

    (matrix.rowSource as unknown as { sourceKind: string }).sourceKind = "query";
    matrix.rowSource.labelField = "MissingName";
    matrix.columnAxis.start = "soon";
    matrix.columnAxis.stepDays = 0;
    matrix.cellSource.rowField = "MissingUser";
    matrix.cell.status = {
      candidates: [
        { kind: "status", status: "missingStatus" },
        { kind: "map", map: "MissingStatusMap" },
        { kind: "map", map: "AvailabilityStatus", field: "MissingCellField" },
      ],
    };
    matrix.edit.rowField = "MissingUser";
    matrix.edit.cycle = [];
    matrix.edit.unsetAsAbsence = false;
    (matrix.edit as unknown as { bulkBehavior: string }).bulkBehavior = "singleTransaction";

    const diagnostics = validateApplicationModel(invalid);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_BULK_BEHAVIOR_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_COLUMN_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_EDIT_CYCLE_EMPTY,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_EDIT_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_SOURCE_KIND_INVALID,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_STATUS_MAP_UNKNOWN,
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_STATUS_UNKNOWN,
      ]),
    );
  });

  it("reports invalid theme tokens and base-theme cycles", () => {
    const resolved = resolveApplicationModel({
      ...validPartialModel,
      themes: [
        { name: "ThemeA", base: "ThemeB", tokens: { colorPrimary: "" } },
        { name: "ThemeB", base: "ThemeA", tokens: { radius: "small" } },
      ],
    });

    const themeA = resolved.themes.find((theme) => theme.name === "ThemeA");
    if (themeA === undefined) {
      throw new Error("Expected ThemeA in resolved fixture.");
    }

    (themeA.tokens as unknown as { density: string }).density = "crowded";

    const diagnostics = validateApplicationModel(resolved);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain(MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID);
    expect(codes).toContain(MODEL_VALIDATION_CODES.THEME_BASE_CYCLE);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
          path: "themes[3].tokens.colorPrimary",
        }),
        expect.objectContaining({
          code: MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
          path: "themes[3].tokens.density",
        }),
      ]),
    );
  });

  it("reports invalid shell navigation and control declarations", () => {
    const invalid = cloneResolved(
      resolveApplicationModel({
        app: { name: "ShellDiagnostics", startView: "Home" },
        contexts: [{ name: "Band", object: "Band" }],
        shell: {
          nav: {
            items: [
              {
                name: "home",
                view: "MissingView",
                icon: "Bad Icon",
                order: 10,
                activeWhen: ["AlsoMissing"],
                visibility: { kind: "contextSelected", context: "MissingContext" },
              },
              { name: "home", view: "Home", order: 10 },
            ],
          },
          topBar: {
            contextSelector: "topBar",
            mobileContextSelector: "sheet",
            controls: ["missingControl"],
          },
          controls: [
            {
              name: "syncStatus",
              kind: "syncStatus",
              icon: "Bad Icon",
              placement: "topBar",
              context: "MissingContext",
            },
            { name: "syncStatus", kind: "logout", placement: "navDrawer" },
          ],
        },
        objects: [
          {
            name: "Band",
            fields: [{ name: "Name", type: "text" }],
            views: [{ name: "Home", kind: "list", fields: ["Name"] }],
          },
        ],
      }),
    );

    (invalid.shell.controls[0] as unknown as { kind: string }).kind = "unsupported";
    (invalid.shell.controls[0] as unknown as { placement: string }).placement = "footer";
    (invalid.shell.topBar as unknown as { contextSelector: string }).contextSelector = "toolbar";
    (invalid.shell.topBar as unknown as { mobileContextSelector: string }).mobileContextSelector =
      "popover";
    (invalid.shell.nav.items[1]?.visibility as unknown as { kind: string }).kind = "sometimes";

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.SHELL_CONTEXT_SELECTOR_PLACEMENT_INVALID,
        MODEL_VALIDATION_CODES.SHELL_CONTROL_CONTEXT_UNKNOWN,
        MODEL_VALIDATION_CODES.SHELL_CONTROL_DUPLICATE,
        MODEL_VALIDATION_CODES.SHELL_CONTROL_ICON_INVALID,
        MODEL_VALIDATION_CODES.SHELL_CONTROL_KIND_INVALID,
        MODEL_VALIDATION_CODES.SHELL_CONTROL_PLACEMENT_INVALID,
        MODEL_VALIDATION_CODES.SHELL_MOBILE_CONTEXT_SELECTOR_INVALID,
        MODEL_VALIDATION_CODES.SHELL_NAV_ACTIVE_VIEW_UNKNOWN,
        MODEL_VALIDATION_CODES.SHELL_NAV_DUPLICATE,
        MODEL_VALIDATION_CODES.SHELL_NAV_ICON_INVALID,
        MODEL_VALIDATION_CODES.SHELL_NAV_ORDER_DUPLICATE,
        MODEL_VALIDATION_CODES.SHELL_NAV_VIEW_UNKNOWN,
        MODEL_VALIDATION_CODES.SHELL_TOP_BAR_CONTROL_UNKNOWN,
        MODEL_VALIDATION_CODES.SHELL_VISIBILITY_KIND_INVALID,
      ]),
    );
  });

  it("accepts context grants, ordered reorder, joins, batch commands, and drawer chrome", () => {
    const resolved = resolveApplicationModel(createPhase56PartialModel());

    expect(validateApplicationModel(resolved)).toEqual([]);
  });

  it("reports invalid business context grant declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const band = invalid.contexts?.find((context) => context.name === "Band");
    if (band === undefined) {
      throw new Error("Expected Band context fixture.");
    }

    band.grants = [
      {
        name: "pendingInvitation",
        object: "BandInvitation",
        userField: "MissingInvitedUser",
        contextField: "Status",
      },
      {
        name: "pendingInvitation",
        object: "BandInvitation",
        userField: "InvitedUser",
        contextField: "Band",
        condition: { kind: "field", field: "Status" },
      },
      {
        name: "missingObject",
        object: "MissingInvitation",
        userField: "InvitedUser",
        contextField: "Band",
      },
      {
        name: "unknownConditionField",
        object: "BandInvitation",
        userField: "InvitedUser",
        contextField: "Band",
        condition: {
          kind: "binary",
          operator: "==",
          left: { kind: "field", field: "MissingStatus" },
          right: { kind: "literal", value: "Pending" },
        },
      },
      {
        name: "unsupportedConditionRuntime",
        object: "BandInvitation",
        userField: "InvitedUser",
        contextField: "Band",
        condition: { kind: "runtime", property: "roles" as "userId" },
      },
      {
        name: "unsupportedConditionOperator",
        object: "BandInvitation",
        userField: "InvitedUser",
        contextField: "Band",
        condition: {
          kind: "unary",
          operator: "invert" as "not",
          operand: { kind: "literal", value: true },
        },
      },
    ];

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_RUNTIME_PROPERTY_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_TYPE,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONTEXT_FIELD_INVALID,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_DUPLICATE,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_OBJECT_UNKNOWN,
      ]),
    );
  });

  /*
   * An unknown context object is already reported against the context. Repeating
   * it once per grant would blame the grant for a mistake made elsewhere, and
   * there is no context object to check the grant's context field against.
   */
  it("does not cascade a grant context-field diagnostic from an unknown context object", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const band = invalid.contexts?.find((context) => context.name === "Band");
    if (band === undefined) {
      throw new Error("Expected Band context fixture.");
    }

    band.object = "MissingContextObject";

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toContain(MODEL_VALIDATION_CODES.CONTEXT_OBJECT_UNKNOWN);
    expect(codes).not.toContain(MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONTEXT_FIELD_INVALID);
  });

  it("reports invalid ordered constraint reorder and compaction behaviour", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const constraint = invalid.objects.find((object) => object.name === "SetListItem")
      ?.constraints[0];
    if (constraint === undefined || constraint.kind !== "ordered") {
      throw new Error("Expected ordered constraint fixture.");
    }

    (constraint as unknown as { reorder: string }).reorder = "swap";
    (constraint as unknown as { compaction: string }).compaction = "always";

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_COMPACTION_INVALID,
        MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_REORDER_INVALID,
      ]),
    );
  });

  it("reports invalid read model source join declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const readModel = invalid.readModels?.find(
      (candidate) => candidate.name === "BandMemberDirectory",
    );
    const member = readModel?.sources[0];
    const user = readModel?.sources[1];
    if (readModel === undefined || member === undefined || user === undefined) {
      throw new Error("Expected read model join fixture.");
    }

    // The first source has nothing to join onto, and naming a later source asks
    // the runtime to key on rows it has not read yet.
    member.join = { source: "user", localField: "id", sourceField: "id", cardinality: "one" };
    user.join = {
      source: "user",
      localField: "MissingLocalField",
      sourceField: "MissingSourceField",
      cardinality: "either" as "one",
    };

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_CARDINALITY_INVALID,
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_PRIMARY_SOURCE_INVALID,
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_SOURCE_UNKNOWN,
      ]),
    );

    // A union interleaves independent feeds, so no row exists to join onto.
    const union = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const unionReadModel = union.readModels?.find(
      (candidate) => candidate.name === "BandMemberDirectory",
    );
    if (unionReadModel === undefined) {
      throw new Error("Expected read model join fixture.");
    }
    unionReadModel.strategy = "union";

    expect(validateApplicationModel(union).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.READ_MODEL_JOIN_STRATEGY_INVALID,
    );
  });

  it("reports invalid repeated command input declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const importSongs = invalid.commands?.find((command) => command.name === "ImportSongs");
    const songs = importSongs?.inputs.find((input) => input.name === "songs");
    const setList = importSongs?.inputs.find((input) => input.name === "setList");
    if (songs === undefined || setList === undefined) {
      throw new Error("Expected batch command fixture.");
    }

    songs.defaultValue = "Untitled";
    songs.itemFields.push({ name: "Title", type: "text", required: false });
    songs.itemFields.push({
      name: "Duration",
      type: "duration" as "number",
      required: false,
    });
    setList.itemFields = [{ name: "Title", type: "text", required: false }];

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELDS_INVALID,
        MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELD_DUPLICATE,
        MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELD_TYPE_INVALID,
        MODEL_VALIDATION_CODES.COMMAND_INPUT_REPEATED_DEFAULT_INVALID,
      ]),
    );
  });

  it("reports invalid iterating command step declarations", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const importSongs = invalid.commands?.find((command) => command.name === "ImportSongs");
    const createItems = importSongs?.steps[0];
    if (importSongs === undefined || createItems === undefined || createItems.action !== "create") {
      throw new Error("Expected batch command fixture.");
    }

    createItems.values.Title = { kind: "item", field: "MissingItemField" };
    importSongs.steps.push(
      {
        name: "iteratesUnknownInput",
        action: "create",
        object: "SetListItem",
        authority: "caller",
        forEach: "missingInput",
        values: { Title: { kind: "item", field: "Title" } },
        preconditions: [],
      },
      {
        name: "iteratesSingleInput",
        action: "create",
        object: "SetListItem",
        authority: "caller",
        forEach: "setList",
        values: { SetList: { kind: "input", name: "setList" } },
        preconditions: [],
      },
      {
        // No forEach, so there is no current item for these to name.
        name: "readsItemWithoutIterating",
        action: "create",
        object: "SetListItem",
        authority: "caller",
        values: { Title: { kind: "item" }, Position: { kind: "itemIndex" } },
        preconditions: [],
      },
      {
        // createItems writes one record per song, so "its guid" names a set.
        name: "referencesIteratingStep",
        action: "create",
        object: "SetListItem",
        authority: "caller",
        values: {
          SetList: { kind: "stepMeta", step: "createItems", property: "guid" },
          Title: { kind: "stepField", step: "createItems", field: "Title" },
        },
        preconditions: [],
      },
    );

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.COMMAND_STEP_FOR_EACH_NOT_REPEATED,
        MODEL_VALIDATION_CODES.COMMAND_STEP_FOR_EACH_UNKNOWN,
        MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_OUTSIDE_FOR_EACH,
        MODEL_VALIDATION_CODES.COMMAND_STEP_ITERATING_REFERENCE,
      ]),
    );
  });

  it("reports an item field read against a list of scalars", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const importSongs = invalid.commands?.find((command) => command.name === "ImportSongs");
    const songs = importSongs?.inputs.find((input) => input.name === "songs");
    const createItems = importSongs?.steps[0];
    if (songs === undefined || createItems === undefined || createItems.action !== "create") {
      throw new Error("Expected batch command fixture.");
    }

    songs.itemFields = [];

    expect(validateApplicationModel(invalid).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_FIELD_UNKNOWN,
    );
    expect(createItems.values.Title).toEqual({ kind: "item", field: "Title" });
  });

  it("reports invalid established-context command step declarations", () => {
    const unknown = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const unknownStep = unknown.commands?.find((command) => command.name === "CreateBand")
      ?.steps[0];
    if (unknownStep === undefined || unknownStep.action !== "create") {
      throw new Error("Expected create-band fixture.");
    }
    unknownStep.establishesContext = "MissingContext";

    expect(validateApplicationModel(unknown).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.COMMAND_STEP_CONTEXT_UNKNOWN,
    );

    const mismatched = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const mismatchedStep = mismatched.commands?.find((command) => command.name === "CreateBand")
      ?.steps[0];
    if (mismatchedStep === undefined || mismatchedStep.action !== "create") {
      throw new Error("Expected create-band fixture.");
    }
    mismatchedStep.object = "Song";
    mismatchedStep.values = { Title: { kind: "input", name: "name" } };

    expect(validateApplicationModel(mismatched).map((diagnostic) => diagnostic.code)).toContain(
      MODEL_VALIDATION_CODES.COMMAND_STEP_CONTEXT_OBJECT_MISMATCH,
    );
  });

  it("reports a command whose steps disagree about sync queueability", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    setObjectSyncMode(invalid, "BandMember", "localPrivate");

    const diagnostics = validateApplicationModel(invalid).filter(
      (candidate) => candidate.code === MODEL_VALIDATION_CODES.COMMAND_STEP_SYNC_MODE_MIXED,
    );

    // One command, one diagnostic: the disagreement is not any single step's
    // fault, so reporting it per step would say the same thing twice.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toBe("commands[1].steps");
    expect(diagnostics[0]?.message).toContain("CreateBand");
    expect(diagnostics[0]?.message).toContain("'Band' (localFirst)");
    expect(diagnostics[0]?.message).toContain("'BandMember' (localPrivate)");
  });

  it("accepts a command mixing localFirst and onlineRequired steps", () => {
    // Both modes queue, so the whole command still has one delivery answer.
    const resolved = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    setObjectSyncMode(resolved, "BandMember", "onlineRequired");

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).not.toContain(
      MODEL_VALIDATION_CODES.COMMAND_STEP_SYNC_MODE_MIXED,
    );
  });

  it("accepts a command whose steps all withhold their writes from the authority", () => {
    // Nothing to disagree about: the command never enters the queue at all.
    const resolved = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    setObjectSyncMode(resolved, "Band", "localPrivate");
    setObjectSyncMode(resolved, "BandMember", "localPrivate");

    expect(validateApplicationModel(resolved).map((diagnostic) => diagnostic.code)).not.toContain(
      MODEL_VALIDATION_CODES.COMMAND_STEP_SYNC_MODE_MIXED,
    );
  });

  it("does not report mixed sync queueability on top of an unknown step object", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const createBand = invalid.commands?.find((command) => command.name === "CreateBand")?.steps[0];
    if (createBand === undefined || createBand.action !== "create") {
      throw new Error("Expected create-band fixture.");
    }
    createBand.object = "MissingObject";
    // The established context names the object this step creates, so leaving it
    // declared would report a mismatch that is not what this case is about.
    delete createBand.establishesContext;
    setObjectSyncMode(invalid, "BandMember", "localPrivate");

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toContain(MODEL_VALIDATION_CODES.COMMAND_STEP_OBJECT_UNKNOWN);
    expect(codes).not.toContain(MODEL_VALIDATION_CODES.COMMAND_STEP_SYNC_MODE_MIXED);
  });

  it("reports invalid context member policy principals", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));
    const visibility = invalid.policies.find((policy) => policy.name === "BandMemberVisibility");
    const rule = visibility?.rules[0];
    const ownerRule = invalid.policies
      .find((policy) => policy.name === "SongVisibility")
      ?.rules.find((candidate) => candidate.name === "allowEveryoneRead");
    if (visibility === undefined || rule === undefined || ownerRule === undefined) {
      throw new Error("Expected context member policy fixture.");
    }

    rule.principal.contextMember = { context: "MissingContext", field: "MissingUserField" };
    visibility.rules.push(
      {
        ...cloneResolved(rule),
        name: "allowMembersOfContextWithoutRoster",
        principal: {
          match: "contextMember",
          roles: [],
          groupRoles: [],
          users: [],
          owner: false,
          contextMember: { context: "Solo", field: "User" },
        },
      },
      {
        ...cloneResolved(rule),
        name: "matchesContextMembersWithoutSelector",
        principal: {
          match: "contextMember",
          roles: [],
          groupRoles: [],
          users: [],
          owner: false,
        },
      },
    );
    ownerRule.principal.contextMember = { context: "Band", field: "Title" };

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBERSHIP_MISSING,
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_MISSING,
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_UNEXPECTED,
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_UNKNOWN,
      ]),
    );
  });

  it("reports shell controls listed in a region they are not placed in", () => {
    const invalid = cloneResolved(resolveApplicationModel(createPhase56PartialModel()));

    invalid.shell.navDrawer.controls.push("contextSelector", "missingDrawerControl");
    invalid.shell.topBar.controls.push("themeSwitch");

    const codes = validateApplicationModel(invalid).map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        MODEL_VALIDATION_CODES.SHELL_NAV_DRAWER_CONTROL_PLACEMENT_MISMATCH,
        MODEL_VALIDATION_CODES.SHELL_NAV_DRAWER_CONTROL_UNKNOWN,
        MODEL_VALIDATION_CODES.SHELL_TOP_BAR_CONTROL_PLACEMENT_MISMATCH,
      ]),
    );
  });
});

function createInvalidResolvedModel(): ResolvedApplicationModel {
  const invalid = cloneResolved(resolveApplicationModel(validPartialModel));
  const duplicateObject = cloneResolved(invalid.objects[0]);
  const patient = invalid.objects[0];

  if (patient === undefined || duplicateObject === undefined) {
    throw new Error("Expected valid test fixture object.");
  }

  invalid.app.startView = "MissingStartView";
  invalid.app.theme = "MissingTheme";

  invalid.objects.push(duplicateObject);

  patient.businessKey = "MissingBusinessKey";
  patient.displayField = "MissingDisplayField";
  patient.policies.push("CompletelyMissingObjectPolicy");

  const autoIdField = patient.fields[0];
  const nameField = patient.fields[1];
  const lookupWithUnknownTarget = patient.fields[2];

  if (
    autoIdField === undefined ||
    nameField === undefined ||
    lookupWithUnknownTarget === undefined
  ) {
    throw new Error("Expected valid test fixture fields.");
  }

  patient.fields.push({
    ...nameField,
    storageName: "duplicate_name",
  });

  autoIdField.type = "number";
  nameField.defaultValue = 42;
  lookupWithUnknownTarget.lookup = {
    targetObject: "MissingLookupTarget",
    displayField: "Name",
  };
  patient.fields.push({
    name: "Assignee",
    storageName: "assignee",
    type: "text",
    required: false,
    validators: [],
    readonly: false,
    hidden: false,
    lookup: {
      targetObject: "PatientRecord",
      targetField: "MissingTargetField",
      displayField: "MissingLookupDisplay",
    },
    systemManaged: false,
  });

  const lifecycle = patient.lifecycle;
  if (lifecycle === undefined) {
    throw new Error("Expected valid test fixture lifecycle.");
  }

  patient.lifecycle = {
    ...lifecycle,
    name: lifecycle.name,
    stateField: "MissingStateField",
    initialState: "MissingInitialState",
    states: lifecycle.states,
    actions: lifecycle.actions,
  };

  const action = patient.lifecycle.actions[0];
  if (action === undefined) {
    throw new Error("Expected valid test fixture lifecycle action.");
  }

  action.from = ["MissingFromState"];
  action.to = "MissingToState";
  action.policyRefs = ["MissingActionPolicy"];
  action.hooks.before = ["hooks.patient.validHook", "bad hook reference"];

  const listView = patient.views[0];
  const formView = patient.views[1];
  if (listView === undefined || formView === undefined) {
    throw new Error("Expected valid test fixture views.");
  }

  listView.object = "MissingViewObject";
  (listView as unknown as { editContainer: string }).editContainer = "alwaysOpen";
  formView.fields.push("MissingViewField");
  formView.searchFields.push("MissingSearchField");
  formView.sort.push({ field: "MissingSortField", direction: "asc" });

  (patient.sync as unknown as { mode: string }).mode = "occasionally";
  patient.sync.window = { field: "MissingSyncWindowField", days: 0, limit: -1 };
  const topLevelSync = invalid.sync[0];
  if (topLevelSync === undefined) {
    throw new Error("Expected valid top-level sync policy.");
  }
  (topLevelSync as unknown as { mode: string }).mode = "sometimes";
  topLevelSync.window = { field: "MissingTopLevelSyncWindowField", days: -2, limit: 0 };
  invalid.sync.push({
    object: "MissingSyncObject",
    mode: "badMode",
    scope: "all",
    conflict: "manual",
  } as unknown as ResolvedSyncPolicy);

  invalid.policies.push({
    name: "MissingObjectPolicy",
    object: "MissingPolicyObject",
    defaultEffect: "deny",
    rules: [],
  });

  const activationPolicy = invalid.policies.find(
    (policy) => policy.name === "PatientActivationPolicy",
  );
  const activationRule = activationPolicy?.rules[0];
  if (activationRule === undefined) {
    throw new Error("Expected valid test fixture policy rule.");
  }

  activationRule.fields = ["MissingPolicyField"];
  activationRule.state = ["MissingPolicyState"];
  activationRule.lifecycleAction = "missingLifecycleAction";

  const baseTheme = invalid.themes[0];
  if (baseTheme === undefined) {
    throw new Error("Expected valid test fixture theme.");
  }

  invalid.themes.push({
    name: "BrokenTheme",
    base: "MissingBaseTheme",
    tokens: { ...baseTheme.tokens, colorBorder: "", radius: "medium" },
  });

  return invalid;
}

function cloneResolved<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function setObjectSyncMode(
  model: ResolvedApplicationModel,
  objectName: string,
  mode: ResolvedSyncPolicy["mode"],
): void {
  const object = model.objects.find((candidate) => candidate.name === objectName);
  if (object === undefined) {
    throw new Error(`Expected object '${objectName}' in the fixture.`);
  }
  object.sync.mode = mode;
}

function createPresentationPartialModel(): PartialApplicationModel {
  return {
    app: {
      name: "Giggle",
      startView: "Home",
    },
    objects: [
      {
        name: "Event",
        fields: [
          { name: "Title", type: "text" },
          { name: "EventType", type: "text" },
          { name: "EventDate", type: "date" },
          { name: "StartTime", type: "time" },
        ],
        views: [
          {
            name: "Home",
            kind: "composite",
            readModel: "HomeUpcomingEvents",
            fields: ["EventDate", "StartTime", "Title", "EventType"],
            presentation: {
              density: "compact",
              state: [{ name: "showGigs", type: "boolean", defaultValue: true }],
              iconMaps: [
                {
                  name: "EventTypeIcon",
                  field: "EventType",
                  values: [{ value: "Gig", icon: "music" }],
                },
              ],
              sections: [
                {
                  name: "Filters",
                  controls: [
                    {
                      name: "showGigsToggle",
                      kind: "toggle",
                      state: "showGigs",
                      label: "Gigs",
                      icon: { kind: "map", map: "EventTypeIcon", value: "Gig" },
                    },
                  ],
                },
                {
                  name: "Schedule",
                  lists: [
                    {
                      name: "UpcomingEvents",
                      source: "HomeUpcomingEvents",
                      renderAs: "compactFeed",
                      fields: ["EventDate", "StartTime", "Title"],
                      sort: [{ field: "EventDate", direction: "asc" }],
                      filter: { kind: "field", field: "showGigs" },
                      emptyState: { text: "No upcoming events" },
                      row: {
                        fragments: [
                          {
                            kind: "icon",
                            icon: { kind: "map", map: "EventTypeIcon", field: "EventType" },
                          },
                          {
                            kind: "field",
                            field: "EventDate",
                            format: { kind: "date", pattern: "EEE d MMM" },
                          },
                          { kind: "text", text: " - " },
                          { kind: "field", field: "Title", style: "bold" },
                        ],
                      },
                    },
                  ],
                },
              ],
              shell: {
                regions: [{ region: "topBar", title: "Home", controls: ["showGigsToggle"] }],
              },
            },
          },
        ],
      },
    ],
    readModels: [
      {
        name: "HomeUpcomingEvents",
        sources: [{ object: "Event" }],
        fields: [
          { name: "EventDate", source: "Event", field: "EventDate", type: "date" },
          { name: "StartTime", source: "Event", field: "StartTime", type: "time" },
          { name: "Title", source: "Event", field: "Title", type: "text" },
          { name: "EventType", source: "Event", field: "EventType", type: "text" },
        ],
      },
    ],
  };
}

function createPresentationStatusPartialModel(): PartialApplicationModel {
  return {
    app: { name: "StatusValidation", startView: "Planner" },
    objects: [
      {
        name: "Slot",
        fields: [
          { name: "Name", type: "text" },
          { name: "Availability", type: "text" },
          { name: "Conflict", type: "boolean", defaultValue: false },
        ],
        views: [
          {
            name: "Planner",
            kind: "composite",
            fields: ["Name", "Availability", "Conflict"],
            presentation: {
              statuses: [
                { name: "available", label: "Available", precedence: 10 },
                { name: "conflict", label: "Conflict", precedence: 100 },
              ],
              statusMaps: [
                {
                  name: "AvailabilityStatus",
                  field: "Availability",
                  values: [{ value: "Available", status: "available" }],
                },
              ],
              legends: [{ name: "AvailabilityLegend", statuses: ["available", "conflict"] }],
              sections: [
                {
                  name: "Planner",
                  lists: [
                    {
                      name: "Slots",
                      sourceKind: "object",
                      source: "Slot",
                      fields: ["Name", "Availability", "Conflict"],
                      row: { fragments: [{ kind: "field", field: "Name" }] },
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
}

function createPresentationMatrixPartialModel(): PartialApplicationModel {
  return {
    app: { name: "MatrixValidation", startView: "Planner" },
    objects: [
      {
        name: "Member",
        fields: [
          { name: "User", type: "text" },
          { name: "Name", type: "text" },
        ],
        views: [
          {
            name: "Planner",
            kind: "composite",
            fields: ["User", "Name"],
            presentation: {
              statuses: [
                { name: "available", label: "Available", precedence: 10 },
                { name: "unset", label: "Unset", precedence: 0 },
              ],
              statusMaps: [
                {
                  name: "AvailabilityStatus",
                  field: "Status",
                  values: [{ value: "Available", status: "available" }],
                  defaultStatus: "unset",
                },
              ],
              sections: [
                {
                  name: "Planner",
                  matrices: [
                    {
                      name: "AvailabilityMatrix",
                      rowSource: {
                        sourceKind: "object",
                        source: "Member",
                        keyField: "User",
                        labelField: "Name",
                      },
                      columnAxis: { start: "2026-08-01", end: "2026-08-03" },
                      cellSource: {
                        sourceKind: "object",
                        source: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        fields: ["User", "Date", "Status"],
                      },
                      cell: {
                        unsetStatus: "unset",
                        status: { candidates: [{ kind: "map", map: "AvailabilityStatus" }] },
                      },
                      edit: {
                        object: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        valueField: "Status",
                        cycle: ["Available"],
                        unsetAsAbsence: true,
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        name: "Availability",
        fields: [
          { name: "User", type: "text" },
          { name: "Date", type: "date" },
          { name: "Status", type: "text" },
        ],
      },
    ],
  };
}

/**
 * One model that declares every Phase 56 addition at once: a context grant that
 * is not membership, an ordered collection that reorders and compacts, a
 * read-model source joined explicitly through a junction object, a batch command
 * that iterates a repeated input, a command that establishes the context it
 * creates, a co-member principal, and a navigation drawer with its own controls.
 */
function createPhase56PartialModel(): PartialApplicationModel {
  return {
    app: { name: "GrantOps", startView: "GigList" },
    roles: [{ name: "BandAdmin" }, { name: "BandMember" }],
    shell: {
      controls: [
        { name: "contextSelector", kind: "contextSelector", placement: "topBar" },
        { name: "themeSwitch", kind: "themeSwitch", placement: "navDrawer" },
      ],
      topBar: { controls: ["contextSelector"] },
      navDrawer: { title: "Menu", controls: ["themeSwitch"] },
    },
    contexts: [
      {
        name: "Band",
        object: "Band",
        selection: { mode: "optional" },
        membership: {
          object: "BandMember",
          userField: "User",
          contextField: "Band",
          roleField: "Role",
          roles: ["BandAdmin", "BandMember"],
        },
        grants: [
          {
            name: "pendingInvitation",
            object: "BandInvitation",
            userField: "InvitedUser",
            contextField: "Band",
            condition: {
              kind: "binary",
              operator: "==",
              left: { kind: "field", field: "Status" },
              right: { kind: "literal", value: "Pending" },
            },
          },
        ],
      },
      { name: "Solo", object: "User", selection: { mode: "optional" } },
    ],
    objects: [
      {
        name: "User",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "Band",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "BandMember",
        scope: { context: "Band", field: "Band" },
        fields: [
          {
            name: "User",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          {
            name: "Band",
            type: "text",
            required: true,
            lookup: { targetObject: "Band", displayField: "Name" },
          },
          { name: "Role", type: "text", required: true },
        ],
      },
      {
        name: "BandInvitation",
        scope: { context: "Band", field: "Band" },
        fields: [
          {
            name: "InvitedUser",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          {
            name: "Band",
            type: "text",
            required: true,
            lookup: { targetObject: "Band", displayField: "Name" },
          },
          { name: "Status", type: "text", required: true },
        ],
      },
      {
        name: "Song",
        displayField: "Title",
        fields: [{ name: "Title", type: "text", required: true }],
      },
      {
        name: "SetListItem",
        displayField: "Title",
        constraints: [
          {
            name: "SetListOrder",
            kind: "ordered",
            parentField: "SetList",
            positionField: "Position",
            reorder: "shift",
            compaction: "onDelete",
          },
        ],
        fields: [
          { name: "SetList", type: "text", required: true },
          { name: "Position", type: "number", required: true },
          { name: "Title", type: "text", required: true },
        ],
      },
      {
        name: "Gig",
        displayField: "Venue",
        scope: { context: "Band", field: "Band" },
        fields: [
          {
            name: "Band",
            type: "text",
            required: true,
            lookup: { targetObject: "Band", displayField: "Name" },
          },
          { name: "Venue", type: "text", required: true },
        ],
      },
    ],
    policies: [
      {
        name: "BandMemberVisibility",
        object: "BandMember",
        rules: [
          {
            name: "allowCoMemberRead",
            effect: "allow",
            action: "read",
            principal: {
              match: "contextMember",
              contextMember: { context: "Band", field: "User" },
            },
          },
        ],
      },
      {
        name: "SongVisibility",
        object: "Song",
        rules: [{ name: "allowEveryoneRead", effect: "allow", action: "read" }],
      },
    ],
    readModels: [
      {
        name: "BandMemberDirectory",
        context: { mode: "required", context: "Band" },
        strategy: "join",
        sources: [
          { name: "member", object: "BandMember", scope: "currentContext" },
          {
            name: "user",
            object: "User",
            scope: "all",
            // The junction record points at the user, so the hop keys the user's
            // own id against the field naming it.
            join: { source: "member", localField: "id", sourceField: "User", cardinality: "one" },
          },
        ],
        fields: [
          { name: "MemberRole", source: "member", field: "Role", type: "text" },
          { name: "UserName", source: "user", field: "Name", type: "text" },
        ],
      },
    ],
    commands: [
      {
        name: "ImportSongs",
        inputs: [
          {
            name: "songs",
            type: "text",
            repeated: true,
            itemFields: [
              { name: "Title", type: "text" },
              { name: "Artist", type: "text" },
            ],
          },
          { name: "setList", type: "text", required: true },
        ],
        steps: [
          {
            name: "createItems",
            action: "create",
            object: "SetListItem",
            forEach: "songs",
            values: {
              SetList: { kind: "input", name: "setList" },
              Title: { kind: "item", field: "Title" },
              Position: { kind: "itemIndex" },
            },
          },
        ],
      },
      {
        name: "CreateBand",
        inputs: [{ name: "name", type: "text", required: true }],
        steps: [
          {
            name: "createBand",
            action: "create",
            object: "Band",
            establishesContext: "Band",
            values: { Name: { kind: "input", name: "name" } },
          },
          {
            name: "createMembership",
            action: "create",
            object: "BandMember",
            values: {
              Band: { kind: "stepMeta", step: "createBand", property: "guid" },
              User: { kind: "runtime", property: "userId" },
              Role: { kind: "literal", value: "BandAdmin" },
            },
          },
        ],
      },
    ],
  };
}

function createRelationshipPickerPartialModel(): PartialApplicationModel {
  return {
    app: { name: "RelationshipPicker", startView: "EventList" },
    objects: [
      {
        name: "Event",
        fields: [{ name: "Title", type: "text" }],
        views: [
          { name: "EventList", kind: "list", fields: ["Title"] },
          {
            name: "EventForm",
            kind: "form",
            fields: ["Title"],
            editSections: [
              { name: "Details", kind: "fields", fields: ["Title"] },
              {
                name: "SetLists",
                kind: "childCollection",
                childObject: "SetList",
                parentField: "Event",
                operations: ["linkExisting"],
                picker: {
                  sourceKind: "object",
                  source: "SetList",
                  selection: "multiple",
                  displayFields: ["Title"],
                  searchFields: ["Title"],
                  sort: [{ field: "Title", direction: "asc" }],
                },
              },
            ],
          },
        ],
      },
      {
        name: "SetList",
        fields: [
          { name: "Event", type: "text", lookup: { targetObject: "Event", displayField: "Title" } },
          { name: "Title", type: "text" },
        ],
      },
    ],
  };
}
