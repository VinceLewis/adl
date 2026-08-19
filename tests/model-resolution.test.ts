import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ADL_MODEL_VERSION,
  BUILT_IN_THEME_NAMES,
  CORPORATE_DARK_THEME_TOKENS,
  DEFAULT_LIFECYCLE_STATE_FIELD,
  DEFAULT_OBJECT_SCHEMA_VERSION,
  DEFAULT_SYNC_MODE,
  DEFAULT_OFFLINE_GRACE_DAYS,
  DEFAULT_THEME_NAME,
  SYSTEM_ID_FIELD,
  explainResolvedModel,
  resolveApplicationModel,
  toStorageName,
} from "../src/index.js";
import type {
  PartialApplicationModel,
  PartialSyncWindowModel,
  ResolvedApplicationModel,
  SyncScope,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const minimalModel = {
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
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

describe("resolveApplicationModel", () => {
  it("exports importable resolved model types", () => {
    const resolved = resolveApplicationModel(minimalModel);

    expectTypeOf(resolved).toEqualTypeOf<ResolvedApplicationModel>();
    expect(resolved.modelVersion).toBe(ADL_MODEL_VERSION);
  });

  it("resolves a minimal hardcoded partial model with explicit defaults", () => {
    const resolved = resolveApplicationModel(minimalModel);
    const patient = resolved.objects[0];

    expect(patient).toMatchObject({
      name: "PatientRecord",
      schemaVersion: DEFAULT_OBJECT_SCHEMA_VERSION,
      tableName: "patient_record",
      systemIdField: SYSTEM_ID_FIELD,
      businessKey: "PatientNumber",
      displayField: "Name",
    });
    expect(patient?.metadataFields.map((field) => field.name)).toEqual([
      "_guid",
      "_object",
      "_schemaVersion",
      "_revision",
      "_state",
      "_createdAt",
      "_createdBy",
      "_updatedAt",
      "_updatedBy",
      "_deletedAt",
      "_deletedBy",
      "_syncStatus",
    ]);
    expect(patient?.fields.map((field) => [field.name, field.storageName])).toEqual([
      ["PatientNumber", "patient_number"],
      ["Name", "name"],
      ["DateOfBirth", "date_of_birth"],
    ]);
    expect(patient?.lifecycle).toMatchObject({
      name: "PatientLifecycle",
      stateField: DEFAULT_LIFECYCLE_STATE_FIELD,
      initialState: "Draft",
    });
    expect(patient?.views.map((view) => [view.name, view.kind])).toEqual([
      ["PatientRecordList", "list"],
      ["PatientRecordForm", "form"],
    ]);
    expect(patient?.views.map((view) => [view.name, view.editContainer])).toEqual([
      ["PatientRecordList", "modal"],
      ["PatientRecordForm", "modal"],
    ]);
    expect(patient?.sync.mode).toBe(DEFAULT_SYNC_MODE);
    expect(patient?.policies).toEqual(["PatientRecordDefaultDeny", "PatientActivationPolicy"]);
    expect(resolved.policies[0]).toMatchObject({
      name: "PatientRecordDefaultDeny",
      object: "PatientRecord",
      defaultEffect: "deny",
      rules: [],
    });
    expect(resolved.app).toEqual({
      name: "CareOps",
      startView: "PatientRecordList",
      theme: DEFAULT_THEME_NAME,
      offlineGraceDays: DEFAULT_OFFLINE_GRACE_DAYS,
    });
    expect(resolved.shell.nav.items[0]).toMatchObject({
      view: "PatientRecordList",
      label: "Patient Record List",
      group: "Patient Record",
      order: 10,
      activeWhen: ["PatientRecordList"],
      visibility: { kind: "always" },
    });
    expect(resolved.shell.topBar).toEqual({
      contextSelector: "topBar",
      mobileContextSelector: "sheet",
      // `connectivity` and `syncStatus` both, because they answer different
      // questions: whether the device can reach the authority, and what state
      // the device's own records are in.
      controls: ["contextSelector", "connectivity", "syncStatus"],
    });
    expect(resolved.themes.map((theme) => theme.name)).toEqual([...BUILT_IN_THEME_NAMES]);
    expect(resolved.sync).toEqual([
      {
        object: "PatientRecord",
        mode: "localFirst",
        scope: "all",
        conflict: "manual",
      },
    ]);
    expect(resolved.audit.enabled).toBe(true);
    expect(resolved.operationLog.operations).toEqual([
      "create",
      "update",
      "delete",
      "transition",
      "command",
      "batch",
    ]);
    expect("contexts" in resolved).toBe(false);
    expect("readModels" in resolved).toBe(false);

    expect(
      explainResolvedModel(resolved, minimalModel).entries.find(
        (entry) => entry.path === "objects[0].views[0].editContainer",
      ),
    ).toMatchObject({
      value: "modal",
      origin: "platformDefault",
    });
  });

  /*
   * ADL syntax requires a picker name, so this default is only reachable from a
   * hand-built partial model. It still has to hold: the resolved model, not the
   * language, is the contract every consumer reads.
   */
  it("names an unnamed relationship picker after its section and defaults its source", () => {
    const resolved = resolveApplicationModel({
      app: { name: "Orders", startView: "OrderList" },
      objects: [
        {
          name: "Order",
          fields: [{ name: "Code", type: "text" }],
          views: [
            { name: "OrderList", kind: "list", fields: ["Code"] },
            {
              name: "OrderForm",
              kind: "form",
              fields: ["Code"],
              editSections: [
                {
                  name: "Lines",
                  kind: "childCollection",
                  childObject: "OrderLine",
                  parentField: "Order",
                  operations: ["linkExisting"],
                  picker: {},
                },
              ],
            },
          ],
        },
        {
          name: "OrderLine",
          fields: [
            {
              name: "Order",
              type: "text",
              lookup: { targetObject: "Order", displayField: "Code" },
            },
          ],
        },
      ],
    });

    const section = resolved.objects[0]?.views[1]?.editSections[0];
    if (section?.kind !== "childCollection") {
      throw new Error("Expected a child collection edit section.");
    }

    expect(section.picker).toEqual({
      name: "LinesPicker",
      sourceKind: "object",
      source: "OrderLine",
      selection: "multiple",
      displayFields: [],
      searchFields: [],
      sort: [],
      excludeAlreadyLinked: true,
      emptyState: { text: "No records available to link." },
    });
  });

  /*
   * A read-model picker has no child object to fall back on, so an omitted
   * source resolves to the empty string and the validator reports it, rather
   * than the resolver silently inventing a read model that does not exist.
   */
  it("leaves a read-model picker source empty when the partial model omits it", () => {
    const resolved = resolveApplicationModel({
      app: { name: "Orders", startView: "OrderList" },
      objects: [
        {
          name: "Order",
          fields: [{ name: "Code", type: "text" }],
          views: [
            { name: "OrderList", kind: "list", fields: ["Code"] },
            {
              name: "OrderForm",
              kind: "form",
              fields: ["Code"],
              editSections: [
                {
                  name: "Lines",
                  kind: "childCollection",
                  childObject: "OrderLine",
                  parentField: "Order",
                  operations: ["linkExisting"],
                  picker: { sourceKind: "readModel" },
                },
              ],
            },
          ],
        },
        {
          name: "OrderLine",
          fields: [
            {
              name: "Order",
              type: "text",
              lookup: { targetObject: "Order", displayField: "Code" },
            },
          ],
        },
      ],
    });

    const section = resolved.objects[0]?.views[1]?.editSections[0];
    if (section?.kind !== "childCollection") {
      throw new Error("Expected a child collection edit section.");
    }

    expect(section.picker).toMatchObject({ sourceKind: "readModel", source: "" });
  });

  it("produces deterministic output for the same input", () => {
    const first = resolveApplicationModel(minimalModel);
    const second = resolveApplicationModel(minimalModel);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("honours explicit storage, schema, view, sync, and theme overrides", () => {
    const resolved = resolveApplicationModel({
      modelVersion: "custom-model-version",
      app: {
        name: "Ops",
        startView: "TicketBoard",
        theme: "OpsTheme",
      },
      objects: [
        {
          name: "Ticket",
          schemaVersion: 3,
          tableName: "support_ticket",
          fields: [{ name: "Ticket ID", storageName: "ticket_id", type: "text" }],
          policies: ["ExternallyDefinedTicketPolicy"],
          views: [
            { name: "TicketBoard", kind: "grid", fields: ["Ticket ID"], editContainer: "drawer" },
          ],
          sync: { mode: "onlineRequired", scope: "assignedToUser", conflict: "serverWins" },
        },
      ],
      themes: [{ name: "OpsTheme", tokens: { density: "compact", nav: "top" } }],
    });

    expect(resolved.modelVersion).toBe("custom-model-version");
    expect(resolved.objects[0]).toMatchObject({
      schemaVersion: 3,
      tableName: "support_ticket",
      policies: ["TicketDefaultDeny", "ExternallyDefinedTicketPolicy"],
      views: [
        { name: "TicketBoard", kind: "grid", fields: ["Ticket ID"], editContainer: "drawer" },
      ],
      sync: { mode: "onlineRequired", scope: "assignedToUser", conflict: "serverWins" },
    });
    expect(resolved.themes.find((theme) => theme.name === "OpsTheme")?.tokens).toMatchObject({
      density: "compact",
      nav: "top",
      colorPrimary: "#155EEF",
      colorBorder: "#D9E1EC",
      colorStatusConflict: "#B42318",
    });
  });

  it("resolves explicit shell navigation metadata and inspectable defaults", () => {
    const resolved = resolveApplicationModel({
      app: {
        name: "ShellOps",
        startView: "TicketBoard",
      },
      shell: {
        nav: {
          items: [
            {
              view: "TicketBoard",
              label: "Work",
              icon: "home",
              group: "Main",
              order: 20,
              activeWhen: ["TicketBoard", "TicketList"],
            },
            {
              view: "TicketList",
              label: "Tickets",
              icon: "list",
              group: "Main",
              order: 10,
              visibility: { kind: "offline" },
            },
          ],
        },
        topBar: {
          contextSelector: "topBar",
          mobileContextSelector: "sheet",
          controls: ["syncStatus"],
        },
        controls: [{ name: "syncStatus", kind: "syncStatus", placement: "topBar" }],
      },
      objects: [
        {
          name: "Ticket",
          fields: [{ name: "Title", type: "text" }],
          views: [
            { name: "TicketBoard", kind: "dashboard", fields: ["Title"] },
            { name: "TicketList", kind: "list", fields: ["Title"] },
          ],
        },
      ],
    });

    expect(resolved.shell.nav.items.map((item) => [item.view, item.label, item.order])).toEqual([
      ["TicketList", "Tickets", 10],
      ["TicketBoard", "Work", 20],
    ]);
    expect(resolved.shell.nav.items[0]).toMatchObject({
      icon: "list",
      group: "Main",
      visibility: { kind: "offline" },
    });
    expect(resolved.shell.controls).toEqual([
      {
        name: "syncStatus",
        kind: "syncStatus",
        placement: "topBar",
        visibility: { kind: "always" },
      },
    ]);

    expect(
      explainResolvedModel(resolved, {
        app: { name: "ShellOps", startView: "TicketBoard" },
        shell: {
          nav: { items: [{ view: "TicketBoard", label: "Work" }] },
        },
        objects: [
          {
            name: "Ticket",
            fields: [{ name: "Title", type: "text" }],
            views: [{ name: "TicketBoard", kind: "dashboard", fields: ["Title"] }],
          },
        ],
      }).entries.find((entry) => entry.path === "shell.nav.items[1].label"),
    ).toMatchObject({
      value: "Work",
      origin: "source",
    });
  });

  it("resolves all object-level sync modes", () => {
    const resolved = resolveApplicationModel({
      app: {
        name: "SyncModes",
      },
      objects: [
        createSyncModeObject("LocalFirstRecord", "localFirst"),
        createSyncModeObject("CacheRecord", "cacheReadonly"),
        createSyncModeObject("OnlineRecord", "onlineRequired"),
        createSyncModeObject("PrivateRecord", "localPrivate"),
      ],
    });

    expect(resolved.sync.map((sync) => [sync.object, sync.mode])).toEqual([
      ["LocalFirstRecord", "localFirst"],
      ["CacheRecord", "cacheReadonly"],
      ["OnlineRecord", "onlineRequired"],
      ["PrivateRecord", "localPrivate"],
    ]);
    expect(resolved.objects.map((object) => [object.name, object.sync.mode])).toEqual([
      ["LocalFirstRecord", "localFirst"],
      ["CacheRecord", "cacheReadonly"],
      ["OnlineRecord", "onlineRequired"],
      ["PrivateRecord", "localPrivate"],
    ]);
  });

  it("resolves context-aware sync scopes and inspectable recent windows", () => {
    const resolved = resolveApplicationModel({
      app: {
        name: "SyncScopes",
      },
      objects: [
        createSyncScopeObject("CurrentUserRecord", "currentUser"),
        createSyncScopeObject("CurrentContextRecord", "currentContext"),
        createSyncScopeObject("AllContextRecord", "allAvailableContexts"),
        createSyncScopeObject("DefaultRecentRecord", "recent"),
        createSyncScopeObject("WindowedRecentRecord", "recent", {
          field: "UpdatedAt",
          days: 7,
          limit: 20,
        }),
      ],
    });

    expect(resolved.objects.map((object) => [object.name, object.sync.scope])).toEqual([
      ["CurrentUserRecord", "currentUser"],
      ["CurrentContextRecord", "currentContext"],
      ["AllContextRecord", "allAvailableContexts"],
      ["DefaultRecentRecord", "recent"],
      ["WindowedRecentRecord", "recent"],
    ]);
    expect(
      resolved.objects.find((object) => object.name === "DefaultRecentRecord")?.sync,
    ).toMatchObject({
      window: { field: "_updatedAt", days: 30, windowSource: "impliedByScope" },
    });
    expect(
      resolved.objects.find((object) => object.name === "WindowedRecentRecord")?.sync,
    ).toMatchObject({
      window: { field: "UpdatedAt", days: 7, limit: 20, windowSource: "authored" },
    });
  });

  it("resolves business contexts, object scopes, view contexts, and read models", () => {
    const resolved = resolveApplicationModel(bandContextPartialModel);
    const bandContext = resolved.contexts?.find((context) => context.name === "Band");
    const gig = resolved.objects.find((object) => object.name === "Gig");
    const homeDashboard = gig?.views.find((view) => view.name === "HomeDashboard");
    const readModel = resolved.readModels?.find(
      (candidate) => candidate.name === "UpcomingGigsByBand",
    );

    expect(bandContext).toEqual({
      name: "Band",
      object: "Band",
      selection: {
        mode: "optional",
        autoSelect: true,
        persistence: "none",
        source: "runtime",
      },
      membership: {
        object: "BandMember",
        userField: "User",
        contextField: "Band",
        roleField: "Role",
        roles: ["BandAdmin", "BandMember"],
      },
      grants: [],
    });
    expect(gig?.scope).toEqual({ context: "Band", field: "Band" });
    expect(homeDashboard).toMatchObject({
      context: { mode: "all", context: "Band" },
      readModel: "UpcomingGigsByBand",
      fields: ["GigDate", "Venue", "BandName"],
      sort: [{ field: "GigDate", direction: "asc" }],
    });
    expect(readModel).toMatchObject({
      name: "UpcomingGigsByBand",
      context: { mode: "all", context: "Band" },
      sources: [
        { name: "gig", object: "Gig", scope: "allAvailableContexts" },
        { name: "band", object: "Band", scope: "allAvailableContexts" },
      ],
      sort: [{ field: "GigDate", direction: "asc" }],
    });
    expect(readModel?.fields).toEqual([
      { name: "GigDate", type: "date", source: "gig", field: "Date" },
      { name: "Venue", type: "text", source: "gig", field: "Venue" },
      { name: "BandName", type: "text", source: "band", field: "Name" },
    ]);
  });

  it("resolves composed view presentation declarations with explicit defaults", () => {
    const resolved = resolveApplicationModel(createPresentationPartialModel());
    const home = resolved.objects[0]?.views.find((view) => view.name === "Home");

    expect(home?.presentation).toMatchObject({
      layout: "stack",
      density: "compact",
      state: [
        {
          name: "showGigs",
          type: "boolean",
          defaultValue: true,
          persistence: "memory",
        },
      ],
      iconMaps: [
        {
          name: "EventTypeIcon",
          field: "EventType",
          values: [{ value: "Gig", icon: "music" }],
        },
      ],
      statuses: [
        {
          name: "event",
          label: "Event",
          accessibleLabel: "Event",
          themeToken: "colorStatusEvent",
          precedence: 0,
        },
      ],
      statusMaps: [
        {
          name: "EventTypeStatus",
          field: "EventType",
          values: [{ value: "Gig", status: "event" }],
        },
      ],
      legends: [
        {
          name: "ScheduleStatus",
          statuses: ["event"],
          include: "present",
        },
      ],
      sections: [
        {
          name: "Filters",
          layout: "stack",
          density: "comfortable",
          controls: [
            {
              name: "showGigsToggle",
              kind: "toggle",
              state: "showGigs",
              label: "Gigs",
              icon: { kind: "map", map: "EventTypeIcon", value: "Gig" },
            },
          ],
          lists: [],
        },
        {
          name: "Schedule",
          layout: "stack",
          density: "comfortable",
          controls: [],
          lists: [
            {
              name: "UpcomingEvents",
              sourceKind: "readModel",
              source: "HomeUpcomingEvents",
              renderAs: "compactFeed",
              density: "comfortable",
              fields: ["EventDate", "StartTime", "Title"],
              emptyState: { text: "No upcoming events" },
              status: { candidates: [{ kind: "map", map: "EventTypeStatus" }] },
              row: {
                layout: "inline",
                density: "comfortable",
                fragments: [
                  { kind: "icon", icon: { kind: "map", map: "EventTypeIcon", field: "EventType" } },
                  {
                    kind: "field",
                    field: "EventDate",
                    style: "plain",
                    format: { kind: "date", pattern: "EEE d MMM" },
                  },
                  { kind: "text", text: " - ", style: "plain" },
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
    });
  });

  it("resolves customer themes from explicit base themes and token overrides", () => {
    const resolved = resolveApplicationModel({
      ...minimalModel,
      app: {
        ...minimalModel.app,
        theme: "CustomerDark",
      },
      themes: [
        {
          name: "CustomerDark",
          base: "CorporateDark",
          tokens: {
            colorPrimary: "#F04438",
            radius: "large",
            density: "spacious",
          },
        },
      ],
    });

    const theme = resolved.themes.find((candidate) => candidate.name === "CustomerDark");

    expect(resolved.app.theme).toBe("CustomerDark");
    expect(resolved.themes.map((candidate) => candidate.name)).toEqual([
      ...BUILT_IN_THEME_NAMES,
      "CustomerDark",
    ]);
    expect(theme?.base).toBe("CorporateDark");
    expect(theme?.tokens).toMatchObject({
      ...CORPORATE_DARK_THEME_TOKENS,
      colorPrimary: "#F04438",
      radius: "large",
      density: "spacious",
    });
  });

  it("normalises storage names deterministically", () => {
    expect(toStorageName("PurchaseOrder")).toBe("purchase_order");
    expect(toStorageName("Purchase Order.Status")).toBe("purchase_order_status");
    expect(toStorageName("123 Value")).toBe("_123_value");
  });
});

function createSyncModeObject(
  name: string,
  mode: "localFirst" | "cacheReadonly" | "onlineRequired" | "localPrivate",
): PartialApplicationModel["objects"][number] {
  return {
    name,
    displayField: "Name",
    fields: [{ name: "Name", type: "text", required: true }],
    sync: { mode },
  };
}

function createSyncScopeObject(
  name: string,
  scope: SyncScope,
  window?: PartialSyncWindowModel,
): PartialApplicationModel["objects"][number] {
  return {
    name,
    displayField: "Name",
    fields: [
      { name: "Name", type: "text", required: true },
      { name: "UpdatedAt", type: "datetime" },
    ],
    sync: {
      scope,
      ...(window === undefined ? {} : { window }),
    },
  };
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
              statuses: [{ name: "event" }],
              statusMaps: [
                {
                  name: "EventTypeStatus",
                  field: "EventType",
                  values: [{ value: "Gig", status: "event" }],
                },
              ],
              legends: [{ name: "ScheduleStatus", statuses: ["event"] }],
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
                      status: { candidates: [{ kind: "map", map: "EventTypeStatus" }] },
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
