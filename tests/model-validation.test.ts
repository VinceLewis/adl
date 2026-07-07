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
        MODEL_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_LIFECYCLE_ACTION_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.POLICY_STATE_UNKNOWN,
        MODEL_VALIDATION_CODES.SYNC_MODE_INVALID,
        MODEL_VALIDATION_CODES.SYNC_OBJECT_UNKNOWN,
        MODEL_VALIDATION_CODES.THEME_BASE_UNKNOWN,
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
  (invalid.sync[0] as unknown as { mode: string }).mode = "sometimes";
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
    tokens: { ...baseTheme.tokens, radius: "medium" },
  });

  return invalid;
}

function cloneResolved<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
