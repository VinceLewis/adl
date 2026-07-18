import { describe, expect, it } from "vitest";
import { ApplicationRuntime, resolveApplicationModel } from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";
import { createBandReferenceRuntime, seedBandReferenceRuntime } from "../src/reference/band-app.js";

describe("presentation runtime", () => {
  it("evaluates the Giggle home dashboard into renderer-neutral sections", async () => {
    const seeded = await createSeededPresentationRuntime();

    const home = await seeded.runtime.evaluatePresentationView(
      "Event",
      "HomeDashboard",
      seeded.firstBandContext,
    );
    const schedule = home.sections.find((section) => section.name === "Schedule");
    const invitations = home.sections.find((section) => section.name === "Invitations");
    const filters = home.sections.find((section) => section.name === "Filters");

    expect(home.diagnostics).toEqual([]);
    expect(home.sections.map((section) => section.name)).toEqual([
      "Welcome",
      "Filters",
      "Schedule",
      "Invitations",
    ]);
    expect(home.state).toEqual({
      showGigs: true,
      showRehearsals: true,
      showUnavailable: true,
    });
    expect(filters?.controls).toEqual([
      expect.objectContaining({
        kind: "toggle",
        state: "showGigs",
        value: true,
        icon: { name: "music", source: { kind: "map", map: "EventTypeIcon", value: "Gig" } },
      }),
      expect.objectContaining({
        kind: "toggle",
        state: "showRehearsals",
        value: true,
        icon: {
          name: "microphone",
          source: { kind: "map", map: "EventTypeIcon", value: "Rehearsal" },
        },
      }),
      expect.objectContaining({
        kind: "toggle",
        state: "showUnavailable",
        value: true,
        icon: { name: "x", source: { kind: "map", map: "EventTypeIcon", value: "Unavailable" } },
      }),
    ]);
    expect(schedule?.lists[0]?.rows.map((row) => row.values.Title)).toEqual([
      "Canal Street headline",
      "New set rehearsal",
      "Unavailable - session prep",
    ]);
    expect(schedule?.lists[0]?.rows.map((row) => row.status?.name)).toEqual([
      "event",
      "rehearsal",
      "unavailable",
    ]);
    expect(home.legends).toEqual([
      {
        name: "ScheduleStatus",
        title: "Schedule status",
        include: "present",
        items: [
          {
            status: expect.objectContaining({
              name: "event",
              label: "Gig",
              accessibleLabel: "Gig event",
              themeToken: "colorStatusEvent",
            }),
          },
          {
            status: expect.objectContaining({
              name: "rehearsal",
              label: "Rehearsal",
              accessibleLabel: "Rehearsal event",
              themeToken: "colorStatusRehearsal",
            }),
          },
          {
            status: expect.objectContaining({
              name: "unavailable",
              label: "Unavailable",
              accessibleLabel: "Unavailable block",
              themeToken: "colorStatusUnavailable",
            }),
          },
        ],
      },
    ]);
    expect(schedule?.lists[0]?.rows[0]?.fragments).toEqual([
      {
        kind: "icon",
        icon: { name: "music", source: { kind: "map", map: "EventTypeIcon", value: "Gig" } },
      },
      { kind: "text", text: "Sat 1 Aug", style: "plain" },
      { kind: "text", text: " ", style: "plain" },
      { kind: "text", text: "8:00PM", style: "plain" },
      { kind: "text", text: " - ", style: "plain" },
      { kind: "text", text: "The Alphas", style: "plain" },
      { kind: "text", text: " - ", style: "plain" },
      { kind: "text", text: "Canal Street headline", style: "bold" },
      { kind: "text", text: " - ", style: "plain" },
      { kind: "text", text: "Alpha Hall", style: "plain" },
    ]);
    expect(invitations?.lists[0]?.rows).toEqual([]);
    expect(invitations?.lists[0]?.emptyState).toEqual({ text: "No pending invitations" });
  });

  it("applies local toggle state without changing runtime records", async () => {
    const seeded = await createSeededPresentationRuntime();

    const filtered = await seeded.runtime.evaluatePresentationView(
      "Event",
      "HomeDashboard",
      seeded.firstBandContext,
      {
        updates: { showRehearsals: false },
      },
    );
    const schedule = filtered.sections.find((section) => section.name === "Schedule");
    const homeRows = await seeded.runtime.executeReadModel(
      "HomeUpcomingEvents",
      seeded.firstBandContext,
    );

    expect(filtered.diagnostics).toEqual([]);
    expect(filtered.state).toEqual({
      showGigs: true,
      showRehearsals: false,
      showUnavailable: true,
    });
    expect(schedule?.lists[0]?.rows.map((row) => row.values.Title)).toEqual([
      "Canal Street headline",
      "Unavailable - session prep",
    ]);
    expect(homeRows.rows.map((row) => row.values.Title)).toEqual([
      "Canal Street headline",
      "New set rehearsal",
      "Unavailable - session prep",
    ]);
  });

  it("returns configured empty states for empty presentation lists", async () => {
    const seeded = await createSeededPresentationRuntime();

    const home = await seeded.runtime.evaluatePresentationView(
      "Event",
      "HomeDashboard",
      seeded.firstBandContext,
    );
    const invitations = home.sections.find((section) => section.name === "Invitations");

    expect(home.diagnostics).toEqual([]);
    expect(invitations?.lists[0]?.rows).toEqual([]);
    expect(invitations?.lists[0]?.emptyState).toEqual({ text: "No pending invitations" });
  });

  it("binds object-backed lists and reports unsupported deterministic formats", async () => {
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createObjectBackedPresentationModel());
    await runtime.create(
      "Article",
      {
        Title: "Second",
        Published: true,
        PublishedOn: "2026-07-10",
        ReadMinutes: 12.25,
      },
      context,
    );
    await runtime.create(
      "Article",
      {
        Title: "First",
        Published: true,
        PublishedOn: "2026-07-01",
        ReadMinutes: 8,
      },
      context,
    );

    const view = await runtime.evaluatePresentationView("Article", "ArticleHome", context);
    const articles = view.sections[0]?.lists[0];

    expect(articles?.rows.map((row) => row.values.Title)).toEqual(["First", "Second"]);
    expect(articles?.rows[0]?.fragments).toEqual([
      { kind: "text", text: "First", style: "bold" },
      { kind: "text", text: " - ", style: "plain" },
      { kind: "text", text: "8.0", style: "plain" },
      { kind: "text", text: " - ", style: "plain" },
      { kind: "text", text: "2026-07-01", style: "plain" },
    ]);
    expect(view.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "ADL_PRESENTATION_FORMAT_UNSUPPORTED",
        list: "Articles",
        field: "PublishedOn",
      }),
      expect.objectContaining({
        severity: "warning",
        code: "ADL_PRESENTATION_FORMAT_UNSUPPORTED",
        list: "Articles",
        field: "PublishedOn",
      }),
    ]);
  });

  it("selects one effective semantic status by precedence and declaration order", async () => {
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createStatusPresentationModel());
    await runtime.create(
      "Slot",
      { Name: "Open", Availability: "Available", BusyElsewhere: false, HasConflict: false },
      context,
    );
    await runtime.create(
      "Slot",
      { Name: "Double booked", Availability: "Available", BusyElsewhere: true, HasConflict: true },
      context,
    );

    const view = await runtime.evaluatePresentationView("Slot", "Planner", context);
    const rows = view.sections[0]?.lists[0]?.rows ?? [];

    expect(view.diagnostics).toEqual([]);
    expect(rows.map((row) => [row.values.Name, row.status?.name])).toEqual([
      ["Open", "available"],
      ["Double booked", "conflict"],
    ]);
    expect(rows[1]?.status).toMatchObject({
      name: "conflict",
      precedence: 100,
      source: { kind: "map", map: "ConflictStatus", value: true },
    });
    expect(view.legends[0]).toMatchObject({
      name: "PlannerLegend",
      items: [
        { status: expect.objectContaining({ name: "available" }) },
        { status: expect.objectContaining({ name: "conflict" }) },
      ],
    });
  });

  it("evaluates command, navigation, and row actions with renderer-neutral state", async () => {
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createActionPresentationModel());
    await runtime.create("Note", { Title: "Existing", Pinned: true }, context);

    const view = await runtime.evaluatePresentationView("Note", "Home", context);
    const actions = view.sections[0]?.controls.filter((control) => control.kind === "action");
    const rowActions = view.sections[0]?.lists[0]?.rows[0]?.actions;

    expect(actions).toEqual([
      expect.objectContaining({
        name: "quickAdd",
        kind: "action",
        placement: "primary",
        command: "CreateQuickNote",
        visible: true,
        enabled: true,
        input: {},
      }),
      expect.objectContaining({
        name: "blockedAdd",
        kind: "action",
        placement: "secondary",
        command: "BlockedCommand",
        visible: true,
        enabled: false,
        reasons: ["Blocked for this user."],
      }),
      expect.objectContaining({
        name: "openList",
        kind: "action",
        view: "NoteList",
        visible: true,
        enabled: true,
      }),
    ]);
    expect(rowActions).toEqual([
      expect.objectContaining({
        name: "openRow",
        kind: "action",
        placement: "row",
        view: "NoteList",
        input: { title: "Existing" },
        visible: true,
        enabled: true,
      }),
    ]);
  });

  it("evaluates availability matrices with policy-shaped editability and derived statuses", async () => {
    const admin: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const musician: RuntimeContext = {
      userId: "user-1",
      roles: ["Musician"],
      channel: "ui",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createAvailabilityMatrixModel());
    await runtime.create("Member", { User: "user-1", Name: "Avery" }, admin);
    await runtime.create("Member", { User: "user-2", Name: "Blair" }, admin);
    await runtime.create(
      "Availability",
      {
        User: "user-1",
        Date: "2026-08-01",
        Status: "Available",
        BusyElsewhere: false,
        Conflict: false,
        BusyDetail: "",
      },
      admin,
    );
    await runtime.create(
      "Availability",
      {
        User: "user-2",
        Date: "2026-08-01",
        Status: "Available",
        BusyElsewhere: true,
        Conflict: false,
        BusyDetail: "Other band booking",
      },
      admin,
    );

    const view = await runtime.evaluatePresentationView("Member", "AvailabilityPlanner", musician);
    const matrix = view.sections[0]?.matrices[0];
    const ownFirst = matrix?.rows[0]?.cells[0];
    const ownUnset = matrix?.rows[0]?.cells[1];
    const otherBusy = matrix?.rows[1]?.cells[0];

    expect(view.diagnostics).toEqual([]);
    expect(matrix?.columns.map((column) => column.key)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(matrix?.rows.map((row) => row.label)).toEqual(["Avery", "Blair"]);
    expect(ownFirst?.status?.name).toBe("available");
    expect(ownFirst?.edit).toMatchObject({
      enabled: true,
      nextValue: "Unavailable",
      operation: "update",
      syncMode: "localFirst",
      bulkBehavior: "sequentialValidatedWrites",
    });
    expect(ownUnset?.status?.name).toBe("unset");
    expect(ownUnset?.edit).toMatchObject({
      enabled: true,
      nextValue: "Available",
      operation: "create",
    });
    expect(otherBusy?.status?.name).toBe("busyElsewhere");
    expect(otherBusy?.values.Status).toBe("Available");
    expect(otherBusy?.values.BusyDetail).toBeUndefined();
    expect(otherBusy?.edit?.enabled).toBe(false);
    expect(view.legends[0]?.items.map((item) => item.status.name)).toEqual([
      "unset",
      "available",
      "busyElsewhere",
    ]);
  });

  it("cycles matrix cells and applies range edits through validated object operations", async () => {
    const admin: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const musician: RuntimeContext = {
      userId: "user-1",
      roles: ["Musician"],
      channel: "ui",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createAvailabilityMatrixModel());
    await runtime.create("Member", { User: "user-1", Name: "Avery" }, admin);
    await runtime.create("Member", { User: "user-2", Name: "Blair" }, admin);
    await runtime.create(
      "Availability",
      {
        User: "user-1",
        Date: "2026-08-01",
        Status: "Available",
        BusyElsewhere: false,
        Conflict: false,
        BusyDetail: "",
      },
      admin,
    );

    const cycle = await runtime.cyclePresentationMatrixCell({
      objectName: "Member",
      viewName: "AvailabilityPlanner",
      matrixName: "AvailabilityMatrix",
      rowKey: "user-1",
      columnKey: "2026-08-01",
      context: musician,
    });
    expect(cycle.applied).toEqual([
      expect.objectContaining({ rowKey: "user-1", columnKey: "2026-08-01", operation: "update" }),
    ]);
    expect((await runtime.search("Availability", {}, musician))[0]?.values.Status).toBe(
      "Unavailable",
    );

    await runtime.applyPresentationMatrixRangeEdit({
      objectName: "Member",
      viewName: "AvailabilityPlanner",
      matrixName: "AvailabilityMatrix",
      rowKeys: ["user-1"],
      startColumnKey: "2026-08-02",
      endColumnKey: "2026-08-03",
      value: "Available",
      context: musician,
    });
    expect(
      (await runtime.search("Availability", {}, musician)).map((record) => [
        record.values.Date,
        record.values.Status,
      ]),
    ).toEqual([
      ["2026-08-01", "Unavailable"],
      ["2026-08-02", "Available"],
      ["2026-08-03", "Available"],
    ]);

    await runtime.applyPresentationMatrixRangeEdit({
      objectName: "Member",
      viewName: "AvailabilityPlanner",
      matrixName: "AvailabilityMatrix",
      rowKeys: ["user-1"],
      startColumnKey: "2026-08-02",
      endColumnKey: "2026-08-03",
      value: null,
      context: musician,
    });
    expect(
      (await runtime.search("Availability", {}, musician)).map((record) => record.values.Date),
    ).toEqual(["2026-08-01"]);
  });

  it("evaluates calendar month planning cells with statuses, conflicts, and actions", async () => {
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "api",
      now: new Date("2026-08-02T09:00:00.000Z"),
    };
    const runtime = new ApplicationRuntime(createCalendarPlanningModel());
    await runtime.create(
      "Event",
      {
        Date: "2026-08-01",
        StartTime: "20:00",
        EventType: "Gig",
        Title: "Canal Street headline",
      },
      context,
    );
    await runtime.create(
      "Event",
      {
        Date: "2026-08-01",
        StartTime: "18:00",
        EventType: "Rehearsal",
        Title: "Warm-up rehearsal",
      },
      context,
    );
    await runtime.create(
      "Event",
      {
        Date: "2026-08-02",
        StartTime: "19:00",
        EventType: "Conflict",
        Title: "Double booking",
      },
      context,
    );

    const view = await runtime.evaluatePresentationView("Event", "Calendar", context);
    const calendar = view.sections[0]?.calendars[0];
    const augustFirst = calendar?.cells.find((cell) => cell.date === "2026-08-01");
    const conflict = calendar?.cells.find((cell) => cell.date === "2026-08-02");
    const empty = calendar?.cells.find((cell) => cell.date === "2026-08-04");

    expect(view.diagnostics).toEqual([]);
    expect(calendar?.month).toMatchObject({
      value: "2026-08",
      label: "August 2026",
      state: "visibleMonth",
      previous: "2026-07",
      next: "2026-09",
      canNavigatePrevious: false,
      canNavigateNext: false,
    });
    expect(calendar?.weekdays.map((weekday) => weekday.label)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(calendar?.cells).toHaveLength(42);
    expect(calendar?.cells[0]?.date).toBe("2026-07-27");
    expect(augustFirst).toMatchObject({
      eventCount: 2,
      status: expect.objectContaining({ name: "event" }),
      statusCounts: { event: 1, rehearsal: 1 },
      values: { Date: "2026-08-01", EventCount: 2, HasEvents: true, HasConflict: false },
    });
    expect(augustFirst?.items.map((item) => item.title)).toEqual([
      "Warm-up rehearsal",
      "Canal Street headline",
    ]);
    expect(augustFirst?.actions).toEqual([
      expect.objectContaining({
        name: "addEventOnDate",
        create: { object: "Event" },
        input: { Date: "2026-08-01" },
      }),
      expect.objectContaining({
        name: "viewEventsOnDate",
        view: "EventList",
        input: { Date: "2026-08-01" },
      }),
    ]);
    expect(conflict).toMatchObject({
      eventCount: 1,
      hasConflict: true,
      status: expect.objectContaining({ name: "conflict" }),
    });
    expect(empty?.eventCount).toBe(0);
    expect(empty?.actions).toEqual([
      expect.objectContaining({
        name: "addEventOnDate",
        create: { object: "Event" },
        input: { Date: "2026-08-04" },
      }),
    ]);
    expect(view.legends[0]?.items.map((item) => item.status.name)).toEqual([
      "event",
      "rehearsal",
      "conflict",
    ]);
  });
});

async function createSeededPresentationRuntime() {
  const runtime = createBandReferenceRuntime();
  return seedBandReferenceRuntime(runtime);
}

function createObjectBackedPresentationModel() {
  return resolveApplicationModel({
    app: {
      name: "Editorial",
      startView: "ArticleHome",
    },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Article",
        fields: [
          { name: "Title", type: "text" },
          { name: "Published", type: "boolean", defaultValue: false },
          { name: "PublishedOn", type: "date" },
          { name: "ReadMinutes", type: "number" },
        ],
        views: [
          {
            name: "ArticleHome",
            kind: "composite",
            fields: ["Title", "PublishedOn", "ReadMinutes", "Published"],
            presentation: {
              sections: [
                {
                  name: "Main",
                  lists: [
                    {
                      name: "Articles",
                      sourceKind: "object",
                      source: "Article",
                      fields: ["Title", "PublishedOn", "ReadMinutes", "Published"],
                      sort: [{ field: "PublishedOn", direction: "asc" }],
                      filter: { kind: "field", field: "Published" },
                      row: {
                        fragments: [
                          { kind: "field", field: "Title", style: "bold" },
                          { kind: "text", text: " - " },
                          {
                            kind: "field",
                            field: "ReadMinutes",
                            format: { kind: "number", pattern: "fixed:1" },
                          },
                          { kind: "text", text: " - " },
                          {
                            kind: "field",
                            field: "PublishedOn",
                            format: { kind: "date", pattern: "quarter" },
                          },
                        ],
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
    policies: [
      {
        name: "ArticlePolicy",
        object: "Article",
        rules: [
          {
            name: "allowAdminAllArticleActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createActionPresentationModel() {
  return resolveApplicationModel({
    app: {
      name: "ActionDemo",
      startView: "Home",
    },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Note",
        fields: [
          { name: "Title", type: "text", required: true },
          { name: "Pinned", type: "boolean", defaultValue: false },
        ],
        views: [
          {
            name: "Home",
            kind: "composite",
            fields: ["Title", "Pinned"],
            presentation: {
              sections: [
                {
                  name: "Main",
                  controls: [
                    {
                      name: "quickAdd",
                      kind: "action",
                      label: "Add Note",
                      placement: "primary",
                      command: "CreateQuickNote",
                    },
                    {
                      name: "blockedAdd",
                      kind: "action",
                      label: "Blocked",
                      command: "BlockedCommand",
                    },
                    {
                      name: "openList",
                      kind: "action",
                      label: "Open List",
                      view: "NoteList",
                    },
                  ],
                  lists: [
                    {
                      name: "Notes",
                      sourceKind: "object",
                      source: "Note",
                      fields: ["Title", "Pinned"],
                      actions: [
                        {
                          name: "openRow",
                          kind: "action",
                          label: "Open",
                          view: "NoteList",
                          input: { title: { kind: "field", field: "Title" } },
                        },
                      ],
                      row: {
                        fragments: [{ kind: "field", field: "Title" }],
                      },
                    },
                  ],
                },
              ],
            },
          },
          { name: "NoteList", kind: "list", fields: ["Title", "Pinned"], actions: ["read"] },
        ],
      },
    ],
    commands: [
      {
        name: "CreateQuickNote",
        steps: [
          {
            name: "createNote",
            action: "create",
            object: "Note",
            authority: "command",
            values: {
              Title: { kind: "literal", value: "Quick note" },
              Pinned: { kind: "literal", value: false },
            },
          },
        ],
      },
      {
        name: "BlockedCommand",
        preconditions: [
          {
            name: "blocked",
            expression: { kind: "literal", value: false },
            message: "Blocked for this user.",
          },
        ],
        steps: [],
      },
    ],
    policies: [
      {
        name: "NotePolicy",
        object: "Note",
        rules: [
          {
            name: "allowAdminAllNoteActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createStatusPresentationModel() {
  return resolveApplicationModel({
    app: {
      name: "Planner",
      startView: "Planner",
    },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Slot",
        fields: [
          { name: "Name", type: "text", required: true },
          { name: "Availability", type: "text" },
          { name: "BusyElsewhere", type: "boolean", defaultValue: false },
          { name: "HasConflict", type: "boolean", defaultValue: false },
        ],
        views: [
          {
            name: "Planner",
            kind: "composite",
            fields: ["Name", "Availability", "BusyElsewhere", "HasConflict"],
            presentation: {
              statuses: [
                { name: "unset", label: "Unset", precedence: 0 },
                { name: "available", label: "Available", precedence: 10 },
                { name: "busyElsewhere", label: "Busy Elsewhere", precedence: 50 },
                { name: "conflict", label: "Conflict", precedence: 100 },
              ],
              statusMaps: [
                {
                  name: "AvailabilityStatus",
                  field: "Availability",
                  values: [{ value: "Available", status: "available" }],
                },
                {
                  name: "BusyStatus",
                  field: "BusyElsewhere",
                  values: [{ value: true, status: "busyElsewhere" }],
                  defaultStatus: "unset",
                },
                {
                  name: "ConflictStatus",
                  field: "HasConflict",
                  values: [{ value: true, status: "conflict" }],
                  defaultStatus: "unset",
                },
              ],
              legends: [{ name: "PlannerLegend", statuses: ["available", "conflict"] }],
              sections: [
                {
                  name: "Slots",
                  lists: [
                    {
                      name: "Slots",
                      sourceKind: "object",
                      source: "Slot",
                      fields: ["Name", "Availability", "BusyElsewhere", "HasConflict"],
                      status: {
                        candidates: [
                          { kind: "map", map: "AvailabilityStatus" },
                          { kind: "map", map: "BusyStatus" },
                          { kind: "map", map: "ConflictStatus" },
                        ],
                      },
                      row: {
                        fragments: [{ kind: "field", field: "Name" }],
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
    policies: [
      {
        name: "SlotPolicy",
        object: "Slot",
        rules: [
          {
            name: "allowAdminAllSlotActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createCalendarPlanningModel() {
  return resolveApplicationModel({
    app: {
      name: "CalendarDemo",
      startView: "Calendar",
    },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Event",
        fields: [
          { name: "Date", type: "date", required: true },
          { name: "StartTime", type: "time" },
          {
            name: "EventType",
            type: "text",
            required: true,
            validators: [{ kind: "in", value: ["Gig", "Rehearsal", "Conflict"] }],
          },
          { name: "Title", type: "text", required: true },
        ],
        views: [
          {
            name: "Calendar",
            kind: "composite",
            fields: ["Date", "StartTime", "EventType", "Title"],
            presentation: {
              state: [{ name: "visibleMonth", type: "date", defaultValue: "2026-08-01" }],
              statuses: [
                { name: "event", label: "Gig", precedence: 10 },
                { name: "rehearsal", label: "Rehearsal", precedence: 10 },
                { name: "conflict", label: "Conflict", precedence: 100 },
              ],
              statusMaps: [
                {
                  name: "EventTypeStatus",
                  field: "EventType",
                  values: [
                    { value: "Gig", status: "event" },
                    { value: "Rehearsal", status: "rehearsal" },
                    { value: "Conflict", status: "conflict" },
                  ],
                },
              ],
              legends: [{ name: "CalendarLegend", statuses: ["event", "rehearsal", "conflict"] }],
              sections: [
                {
                  name: "Calendar",
                  calendars: [
                    {
                      name: "MonthPlanner",
                      sourceKind: "object",
                      source: "Event",
                      dateField: "Date",
                      titleField: "Title",
                      summaryFields: ["StartTime"],
                      sort: [
                        { field: "Date", direction: "asc" },
                        { field: "StartTime", direction: "asc" },
                      ],
                      month: {
                        state: "visibleMonth",
                        weekStart: "monday",
                        minDate: "2026-08-01",
                        maxDate: "2026-08-31",
                      },
                      status: {
                        candidates: [{ kind: "map", map: "EventTypeStatus" }],
                      },
                      actions: [
                        {
                          name: "addEventOnDate",
                          kind: "action",
                          label: "Add Event",
                          create: { object: "Event" },
                          input: { Date: { kind: "field", field: "Date" } },
                        },
                        {
                          name: "viewEventsOnDate",
                          kind: "action",
                          label: "View Events",
                          view: "EventList",
                          visibleWhen: { kind: "field", field: "HasEvents" },
                          input: { Date: { kind: "field", field: "Date" } },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          { name: "EventList", kind: "list", fields: ["Date", "StartTime", "EventType", "Title"] },
        ],
      },
    ],
    policies: [
      {
        name: "EventPolicy",
        object: "Event",
        rules: [
          {
            name: "allowAdminAllEventActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createAvailabilityMatrixModel() {
  const ownsAvailability = {
    kind: "binary" as const,
    operator: "==" as const,
    left: { kind: "field" as const, field: "User" },
    right: { kind: "runtime" as const, property: "userId" as const },
  };

  return resolveApplicationModel({
    app: {
      name: "Availability",
      startView: "AvailabilityPlanner",
    },
    roles: [{ name: "Admin" }, { name: "Musician" }],
    objects: [
      {
        name: "Member",
        fields: [
          { name: "User", type: "text", required: true },
          { name: "Name", type: "text", required: true },
        ],
        views: [
          {
            name: "AvailabilityPlanner",
            kind: "composite",
            fields: ["User", "Name"],
            presentation: {
              statuses: [
                { name: "unset", label: "Unset", precedence: 0 },
                { name: "available", label: "Available", precedence: 10 },
                { name: "unavailable", label: "Unavailable", precedence: 20 },
                { name: "busyElsewhere", label: "Busy Elsewhere", precedence: 50 },
                { name: "conflict", label: "Conflict", precedence: 100 },
              ],
              statusMaps: [
                {
                  name: "AvailabilityStatus",
                  field: "Status",
                  values: [
                    { value: "Available", status: "available" },
                    { value: "Unavailable", status: "unavailable" },
                  ],
                  defaultStatus: "unset",
                },
                {
                  name: "BusyStatus",
                  field: "BusyElsewhere",
                  values: [{ value: true, status: "busyElsewhere" }],
                  defaultStatus: "unset",
                },
                {
                  name: "ConflictStatus",
                  field: "Conflict",
                  values: [{ value: true, status: "conflict" }],
                  defaultStatus: "unset",
                },
              ],
              legends: [{ name: "AvailabilityLegend" }],
              sections: [
                {
                  name: "Availability",
                  matrices: [
                    {
                      name: "AvailabilityMatrix",
                      rowSource: {
                        sourceKind: "object",
                        source: "Member",
                        keyField: "User",
                        labelField: "Name",
                        fields: ["User", "Name"],
                        sort: [{ field: "Name", direction: "asc" }],
                      },
                      columnAxis: {
                        start: "2026-08-01",
                        end: "2026-08-03",
                        labelFormat: { kind: "date", pattern: "EEE d MMM" },
                      },
                      cellSource: {
                        sourceKind: "object",
                        source: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        fields: [
                          "User",
                          "Date",
                          "Status",
                          "BusyElsewhere",
                          "Conflict",
                          "BusyDetail",
                        ],
                      },
                      cell: {
                        unsetStatus: "unset",
                        status: {
                          candidates: [
                            { kind: "map", map: "AvailabilityStatus" },
                            { kind: "map", map: "BusyStatus" },
                            { kind: "map", map: "ConflictStatus" },
                          ],
                        },
                      },
                      edit: {
                        object: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        valueField: "Status",
                        cycle: ["Available", "Unavailable"],
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
          { name: "User", type: "text", required: true },
          { name: "Date", type: "date", required: true },
          { name: "Status", type: "text", required: true },
          { name: "BusyElsewhere", type: "boolean", defaultValue: false },
          { name: "Conflict", type: "boolean", defaultValue: false },
          { name: "BusyDetail", type: "text" },
        ],
        constraints: [
          { name: "oneAvailabilityPerUserDate", kind: "unique", fields: ["User", "Date"] },
        ],
      },
    ],
    policies: [
      {
        name: "MemberPolicy",
        object: "Member",
        rules: [
          {
            name: "allowAdminAllMembers",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowMusicianReadMembers",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "read",
          },
          {
            name: "allowMusicianSearchMembers",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "search",
          },
        ],
      },
      {
        name: "AvailabilityPolicy",
        object: "Availability",
        rules: [
          {
            name: "allowAdminAllAvailability",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowMusicianSearchAvailability",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "search",
          },
          {
            name: "allowMusicianReadAvailability",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "read",
          },
          {
            name: "hideBusyDetail",
            effect: "hidden",
            principal: { match: "specific", roles: ["Musician"] },
            action: "read",
            fields: ["BusyDetail"],
          },
          {
            name: "allowOwnAvailabilityCreate",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "create",
            condition: ownsAvailability,
          },
          {
            name: "allowOwnAvailabilityUpdate",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "update",
            condition: ownsAvailability,
          },
          {
            name: "allowOwnAvailabilityDelete",
            effect: "allow",
            principal: { match: "specific", roles: ["Musician"] },
            action: "delete",
            condition: ownsAvailability,
          },
        ],
      },
    ],
  });
}
