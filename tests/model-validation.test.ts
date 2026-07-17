import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIFECYCLE_STATE_FIELD,
  MODEL_VALIDATION_CODES,
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
