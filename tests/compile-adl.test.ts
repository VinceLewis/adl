import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  MODEL_VALIDATION_CODES,
  PolicyDeniedError,
  RuntimeValidationError,
  compileAdl,
  compileAdlProject,
  validateApplicationModel,
} from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const operatorContext: RuntimeContext = {
  userId: "operator-1",
  roles: ["Operator"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const clerkContext: RuntimeContext = {
  userId: "clerk-1",
  roles: ["Clerk"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

describe("compileAdl", () => {
  it("compiles the User ADL example into the runtime resolved model shape", async () => {
    const result = compileAdl(readExample("user.adl"));
    const user = result.model.objects.find((object) => object.name === "User");
    const theme = result.model.themes.find((candidate) => candidate.name === "DirectoryTheme");

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.app).toEqual({
      name: "UserDirectory",
      theme: "DirectoryTheme",
      startView: "UserList",
      // Undeclared, so the documented default stands rather than a surprise.
      offlineGraceDays: 30,
    });
    expect(theme).toMatchObject({
      name: "DirectoryTheme",
      base: "CorporateLight",
      tokens: {
        colorPrimary: "#155EEF",
        density: "compact",
        radius: "medium",
        nav: "side",
      },
    });
    expect(user?.fields.find((field) => field.name === "Email")).toMatchObject({
      type: "text",
      required: true,
      validators: [{ kind: "email" }],
    });
    expect(user?.lifecycle?.actions.find((action) => action.name === "activate")).toMatchObject({
      policyRefs: ["UserActivatePolicy"],
    });

    const runtime = new ApplicationRuntime(result.model);
    const created = await runtime.create(
      "User",
      { Name: "Ada Lovelace", Email: "ada@example.com" },
      adminContext,
    );

    expect(created.values).toMatchObject({
      Name: "Ada Lovelace",
      Email: "ada@example.com",
      Active: true,
      Status: "Draft",
    });
  });

  it("compiles the PurchaseOrder example with lifecycle, policy, sync, and theme declarations", () => {
    const result = compileAdl(readExample("purchase-order.adl"));
    const purchaseOrder = result.model.objects.find((object) => object.name === "PurchaseOrder");
    const policyNames = result.model.policies.map((policy) => policy.name);

    expect(result.diagnostics).toEqual([]);
    expect(purchaseOrder).toMatchObject({
      businessKey: "PONumber",
      displayField: "Supplier",
      sync: {
        mode: "localFirst",
        scope: "assignedToUser",
        conflict: "stateTransitionWins",
      },
    });
    expect(purchaseOrder?.fields.find((field) => field.name === "PONumber")?.autoId).toEqual({
      prefix: "PO-",
      pad: 6,
    });
    expect(purchaseOrder?.views.find((view) => view.name === "PurchaseOrderList")?.sort).toEqual([
      { field: "PONumber", direction: "asc" },
    ]);
    expect(policyNames).toEqual(
      expect.arrayContaining([
        "PurchaseOrderPolicy",
        "PurchaseOrderSubmitPolicy",
        "PurchaseOrderApprovePolicy",
      ]),
    );
    expect(
      result.model.policies
        .find((policy) => policy.name === "PurchaseOrderPolicy")
        ?.rules.find(
          (rule) =>
            rule.effect === "hidden" &&
            rule.action === "read" &&
            rule.fields.includes("InternalNotes"),
        ),
    ).toMatchObject({
      effect: "hidden",
      action: "read",
      fields: ["InternalNotes"],
      principal: { roles: ["Requester"] },
    });
  });

  /*
   * The example is the round trip: an ADL file an author could write, compiled
   * with no diagnostics into the same resolved edit-surface shape hand-built
   * partial models used to be the only producer of.
   */
  it("compiles the PurchaseOrder example's edit surface into resolved edit sections", () => {
    const result = compileAdl(readExample("purchase-order.adl"));
    const form = result.model.objects
      .find((object) => object.name === "PurchaseOrder")
      ?.views.find((view) => view.name === "PurchaseOrderForm");

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(form?.editContainer).toBe("page");
    expect(form?.editSections).toEqual([
      {
        name: "Details",
        heading: "Order details",
        kind: "fields",
        fields: ["PONumber", "Supplier", "Value", "Status"],
      },
      {
        name: "Commentary",
        heading: "Commentary",
        kind: "fields",
        fields: ["InternalNotes", "ApprovalComment"],
      },
      {
        name: "Lines",
        heading: "Order lines",
        kind: "childCollection",
        childObject: "PurchaseOrderLine",
        parentField: "PurchaseOrder",
        childView: "PurchaseOrderLineList",
        operations: ["createChild", "linkExisting", "updateChild", "unlink", "remove", "reorder"],
        staged: true,
        orderField: "Position",
        emptyState: { text: "No order lines yet." },
        picker: {
          name: "PurchaseOrderLinePicker",
          sourceKind: "object",
          source: "PurchaseOrderLine",
          selection: "multiple",
          displayFields: ["Description", "Quantity", "LineValue"],
          searchFields: ["Description"],
          sort: [{ field: "Description", direction: "asc" }],
          excludeAlreadyLinked: true,
          emptyState: { text: "No unassigned order lines to link." },
        },
      },
    ]);
  });

  it("applies resolver edit-surface defaults to declarations that omit them", () => {
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
    END.EDIT_SECTION
    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      STAGED false
    END.CHILD_COLLECTION
    CHILD_COLLECTION LinkedLines
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS linkExisting
      PICKER OrderLinePicker
        EXCLUDE_LINKED false
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW

  VIEW OrderLinkForm FORM
    FIELDS Code
    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS linkExisting
      PICKER OrderLinePicker
        SOURCE READ_MODEL OrderLineCandidates
        SELECTION single
        DISPLAY Description
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

READ_MODEL OrderLineCandidates
  SOURCE line OBJECT OrderLine
  FIELD Description FROM line.Description
END.READ_MODEL
`);

    const order = result.model.objects.find((object) => object.name === "Order");
    const list = order?.views.find((view) => view.name === "OrderList");
    const form = order?.views.find((view) => view.name === "OrderForm");
    const linkForm = order?.views.find((view) => view.name === "OrderLinkForm");

    expect(result.diagnostics).toEqual([]);

    // A view that declares no edit sections still gets the default single
    // `fields` section over its own field list.
    expect(list?.editContainer).toBe("modal");
    expect(list?.editSections).toEqual([
      { name: "Fields", kind: "fields", fields: ["Code", "Notes"] },
    ]);

    // An EDIT_SECTION with no FIELDS means the view's own fields, which is a
    // different statement from an empty field list.
    expect(form?.editSections[0]).toEqual({
      name: "Details",
      kind: "fields",
      fields: ["Code", "Notes"],
    });
    expect(form?.editSections[1]).toEqual({
      name: "Lines",
      kind: "childCollection",
      childObject: "OrderLine",
      parentField: "Order",
      operations: ["createChild", "updateChild", "unlink"],
      staged: false,
      emptyState: { text: "" },
    });
    expect(form?.editSections[2]).toEqual({
      name: "LinkedLines",
      kind: "childCollection",
      childObject: "OrderLine",
      parentField: "Order",
      operations: ["linkExisting"],
      staged: true,
      emptyState: { text: "" },
      picker: {
        name: "OrderLinePicker",
        // An object-sourced picker with no SOURCE defaults to the child object.
        sourceKind: "object",
        source: "OrderLine",
        selection: "multiple",
        displayFields: [],
        searchFields: [],
        sort: [],
        excludeAlreadyLinked: false,
        emptyState: { text: "No records available to link." },
      },
    });

    expect(linkForm?.editSections[0]).toMatchObject({
      kind: "childCollection",
      picker: {
        sourceKind: "readModel",
        source: "OrderLineCandidates",
        selection: "single",
        excludeAlreadyLinked: true,
      },
    });
  });

  it("normalizes context-aware sync scope spellings", () => {
    const result = compileAdl(`APP DatasetScopes
END.APP

OBJECT BandEvent
  FIELD Band TEXT
  SYNC LOCAL_FIRST SCOPE ALL_AVAILABLE_CONTEXTS
END.OBJECT

OBJECT UserPreference
  FIELD Name TEXT
  SYNC LOCAL_PRIVATE SCOPE CurrentUser
END.OBJECT
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.model.objects.map((object) => [object.name, object.sync])).toEqual([
      [
        "BandEvent",
        {
          mode: "localFirst",
          scope: "allAvailableContexts",
          conflict: "manual",
        },
      ],
      [
        "UserPreference",
        {
          mode: "localPrivate",
          scope: "currentUser",
          conflict: "manual",
        },
      ],
    ]);
  });

  it("enforces parser-generated inline lifecycle action policies at runtime", async () => {
    const result = compileAdl(`APP TicketDesk
  START_VIEW TicketList
END.APP

ROLE Operator
ROLE Clerk

OBJECT Ticket
  DISPLAY Title
  FIELD Title TEXT REQUIRED
  FIELD Status TEXT REQUIRED

  LIFECYCLE TicketLifecycle FIELD Status INITIAL Draft
    STATE Draft
    STATE Open

    ACTION open FROM Draft TO Open LABEL 'Open'
      ALLOW ROLE Operator
    END.ACTION
  END.LIFECYCLE

  VIEW TicketList LIST
    FIELDS Title Status
    SEARCH Title
    ACTIONS create read
  END.VIEW

  VIEW TicketForm FORM
    FIELDS Title Status
    ACTIONS save open
  END.VIEW
END.OBJECT

POLICY TicketPolicy ON Ticket
  ALLOW CREATE ROLE Operator Clerk
  ALLOW READ ROLE Operator Clerk
  ALLOW SEARCH ROLE Operator Clerk
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.model.policies.find((policy) => policy.name === "TicketOpenPolicy"),
    ).toMatchObject({
      object: "Ticket",
      rules: [
        expect.objectContaining({
          effect: "allow",
          action: "transition",
          state: ["Draft"],
          lifecycleAction: "open",
          principal: expect.objectContaining({ roles: ["Operator"] }),
        }),
      ],
    });

    const runtime = new ApplicationRuntime(result.model);
    const operatorTicket = await runtime.create("Ticket", { Title: "Printer" }, operatorContext);
    const clerkTicket = await runtime.create("Ticket", { Title: "Monitor" }, clerkContext);

    await expect(
      runtime.transition("Ticket", clerkTicket.meta.guid, "open", clerkContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const opened = await runtime.transition(
      "Ticket",
      operatorTicket.meta.guid,
      "open",
      operatorContext,
    );
    expect(opened.values.Status).toBe("Open");
  });

  it("compiles policy WHEN expressions and predicate validators into runtime enforcement", async () => {
    const result = compileAdl(`APP ExpressionOrders
END.APP

ROLE Requester

OBJECT PurchaseOrder
  FIELD Owner TEXT REQUIRED
  FIELD Value NUMBER REQUIRED VALIDATE Value > 0 MESSAGE 'Value must be positive.'
  FIELD Status TEXT REQUIRED DEFAULT Draft
END.OBJECT

POLICY PurchaseOrderPolicy ON PurchaseOrder
  ALLOW CREATE ROLE Requester WHEN Owner == runtime.userId AND Value > 10000
  ALLOW READ ROLE Requester WHEN Owner == runtime.userId
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.model.policies.find((policy) => policy.name === "PurchaseOrderPolicy")?.rules[0]
        ?.condition,
    ).toMatchObject({
      kind: "binary",
      operator: "and",
    });

    const runtime = new ApplicationRuntime(result.model);
    const requester = {
      userId: "requester-1",
      roles: ["Requester"],
      channel: "api",
      now: new Date("2026-07-17T12:30:00.000Z"),
    } satisfies RuntimeContext;

    const created = await runtime.create(
      "PurchaseOrder",
      { Owner: "requester-1", Value: 12000 },
      requester,
    );

    expect(created.values.Owner).toBe("requester-1");

    await expect(
      runtime.create("PurchaseOrder", { Owner: "other-user", Value: 12000 }, requester),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      runtime.create("PurchaseOrder", { Owner: "requester-1", Value: -1 }, requester),
    ).rejects.toMatchObject({
      name: RuntimeValidationError.name,
      issues: [expect.objectContaining({ message: "Value must be positive." })],
    });
  });

  it("compiles computed fields and read-model expression fields", async () => {
    const result = compileAdl(`APP ComputedOrders
END.APP

ROLE Admin

OBJECT LineItem
  FIELD UnitPrice NUMBER REQUIRED
  FIELD Quantity NUMBER REQUIRED
  FIELD Discount NUMBER DEFAULT 0
  COMPUTED FIELD Gross NUMBER = UnitPrice * Quantity
  COMPUTED FIELD Net NUMBER = Gross - Discount
END.OBJECT

READ_MODEL LineItemSummary
  SOURCE line OBJECT LineItem
  FIELD Quantity FROM line.Quantity
  FIELD Net FROM line.Net
  FIELD NetWithTax NUMBER = Net * 1.2
END.READ_MODEL

POLICY LineItemPolicy ON LineItem
  ALLOW ALL ROLE Admin
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.model.objects[0]?.computedFields).toEqual([
      expect.objectContaining({
        name: "Gross",
        strategy: "readTime",
        dependencies: ["Quantity", "UnitPrice"],
        evaluationOrder: 0,
      }),
      expect.objectContaining({
        name: "Net",
        strategy: "readTime",
        dependencies: ["Discount", "Gross"],
        evaluationOrder: 1,
      }),
    ]);
    expect(result.model.readModels?.[0]?.fields[2]).toMatchObject({
      name: "NetWithTax",
      expression: { kind: "binary", operator: "*" },
    });
  });

  it("compiles Phase 21 declarative logic into direct runtime enforcement", async () => {
    const result = compileAdl(`APP DeclarativeLogic
END.APP

ROLE Requester
ROLE Approver

OBJECT PurchaseOrder
  FIELD Owner TEXT REQUIRED
  FIELD Value NUMBER REQUIRED
  FIELD ApprovalComment TEXT
  FIELD Reviewed BOOLEAN DEFAULT FALSE
  FIELD Status TEXT REQUIRED DEFAULT Draft
  VALIDATE ApprovalCommentRequired WHEN Value <= 10000 OR ApprovalComment != NULL MESSAGE 'Approval comment is required above 10000.'

  LIFECYCLE PurchaseOrderLifecycle FIELD Status INITIAL Draft
    STATE Draft
    STATE Approved
    ACTION approve FROM Draft TO Approved WHEN Reviewed == TRUE MESSAGE 'Purchase order must be reviewed before approval.'
      ALLOW ROLE Approver
    END.ACTION
  END.LIFECYCLE
END.OBJECT

DECISION_TABLE ApprovalTier ON PurchaseOrder MATCH SINGLE
  INPUT amount = Value
  ROW standard WHEN amount <= 10000 OUTPUT tier 'standard'
  ROW senior WHEN amount > 10000 OUTPUT tier 'senior'
  DEFAULT OUTPUT tier 'unknown'
END.DECISION_TABLE

COMMAND CreatePurchaseOrder LABEL 'Create purchase order'
  INPUT Owner TEXT REQUIRED
  INPUT Value NUMBER REQUIRED
  REQUIRE Value > 0 MESSAGE 'Command value must be positive.'
  STEP createOrder CREATE PurchaseOrder AUTHORITY command
    VALUE Owner INPUT Owner
    VALUE Value INPUT Value
    VALUE Reviewed LITERAL TRUE
    VALUE Status LITERAL Draft
  END.STEP
END.COMMAND

POLICY PurchaseOrderPolicy ON PurchaseOrder
  ALLOW CREATE ROLE Requester
  ALLOW READ ROLE Requester Approver
  ALLOW UPDATE ROLE Requester Approver
  ALLOW TRANSITION ROLE Approver ACTION approve STATE Draft
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.model.objects[0]?.validations[0]).toMatchObject({
      name: "ApprovalCommentRequired",
    });
    expect(result.model.decisionTables?.[0]).toMatchObject({
      name: "ApprovalTier",
      match: "single",
    });
    expect(result.model.commands?.[0]?.preconditions[0]).toMatchObject({
      name: "CreatePurchaseOrderRequirement1",
    });

    const runtime = new ApplicationRuntime(result.model);
    const requester = {
      userId: "requester-1",
      roles: ["Requester"],
      channel: "api",
      now: new Date("2026-07-17T12:30:00.000Z"),
    } satisfies RuntimeContext;
    const approver = {
      userId: "approver-1",
      roles: ["Approver"],
      channel: "api",
      now: new Date("2026-07-17T12:30:00.000Z"),
    } satisfies RuntimeContext;

    await expect(
      runtime.create("PurchaseOrder", { Owner: "requester-1", Value: 12000 }, requester),
    ).rejects.toMatchObject({
      name: RuntimeValidationError.name,
      issues: [expect.objectContaining({ message: "Approval comment is required above 10000." })],
    });

    const created = await runtime.create(
      "PurchaseOrder",
      { Owner: "requester-1", Value: 12000, ApprovalComment: "Budget approved" },
      requester,
    );
    const tier = await runtime.evaluateDecisionTable("ApprovalTier", created.values, requester);
    expect(tier).toMatchObject({
      rowName: "senior",
      outputs: { tier: "senior" },
      inputValues: { amount: 12000 },
    });

    await expect(
      runtime.transition("PurchaseOrder", created.meta.guid, "approve", approver),
    ).rejects.toMatchObject({
      code: "ADL_LIFECYCLE_ERROR",
      message: "Purchase order must be reviewed before approval.",
    });

    await runtime.update("PurchaseOrder", created.meta.guid, { Reviewed: true }, requester);
    const approved = await runtime.transition(
      "PurchaseOrder",
      created.meta.guid,
      "approve",
      approver,
    );
    expect(approved.values.Status).toBe("Approved");

    await expect(
      runtime.executeCommand("CreatePurchaseOrder", { Owner: "requester-1", Value: -1 }, requester),
    ).rejects.toMatchObject({
      decision: {
        reasons: [expect.objectContaining({ message: "Command value must be positive." })],
      },
    });
  });

  it("returns structured validation diagnostics for parsed but invalid models", () => {
    const result = compileAdl(`APP Broken
  START_VIEW BrokenList
END.APP

OBJECT Broken
  FIELD Name TEXT

  VIEW BrokenList LIST
    FIELDS Missing
  END.VIEW
END.OBJECT
`);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: MODEL_VALIDATION_CODES.VIEW_FIELD_UNKNOWN,
          path: "objects[0].views[0].fields[0]",
        }),
      ]),
    );
  });

  it("compiles UI ADL syntax into the resolved presentation model", () => {
    const result = compileAdl(`APP Presentation
  START_VIEW HomeDashboard
END.APP

OBJECT Event
  FIELD EventType TEXT
  FIELD EventDate DATE
  FIELD StartTime TIME
  FIELD Title TEXT

  VIEW HomeDashboard DASHBOARD
    READ_MODEL HomeUpcomingEvents
    FIELDS EventDate StartTime EventType Title
    LAYOUT stack
    DENSITY compact
    STATE showGigs BOOLEAN DEFAULT true

    ICON_MAP EventTypeIcon FOR EventType
      Gig -> music
    END.ICON_MAP

    STATUS event LABEL 'Gig' ARIA_LABEL 'Gig event' ICON EventTypeIcon(Gig) THEME colorStatusEvent PRECEDENCE 10

    STATUS_MAP EventTypeStatus FOR EventType
      Gig -> event
    END.STATUS_MAP

    LEGEND ScheduleStatus TITLE 'Schedule status' STATUSES event

    SECTION Schedule
      HEADING 'Upcoming events'

      TOGGLE showGigsToggle STATE showGigs
        LABEL 'Gigs'
        ICON EventTypeIcon(Gig)
      END.TOGGLE

      ACTION addEvent COMMAND CreateEvent LABEL 'Add Event' ICON calendar PLACEMENT primary
      END.ACTION

      LIST UpcomingEvents FROM HomeUpcomingEvents
        ORDER BY EventDate ASC, StartTime ASC
        WHERE EventType == 'Gig' AND showGigs == true
        RENDER_AS compactFeed
        DENSITY compact
        EMPTY_TEXT 'No upcoming events'
        STATUS EventTypeStatus(EventType)

        ACTION openEvent VIEW EventList LABEL 'Open' PLACEMENT row
          INPUT title FROM Title
        END.ACTION

        ROW
          ICON EventTypeIcon(EventType)
          TEXT EventDate FORMAT date 'EEE d MMM'
          TEXT ' - '
          TEXT Title STYLE bold
        END.ROW
      END.LIST
    END.SECTION
  END.VIEW

  VIEW EventList LIST
    FIELDS EventDate StartTime EventType Title
    ACTIONS read
  END.VIEW
END.OBJECT

READ_MODEL HomeUpcomingEvents
  SOURCE event OBJECT Event
  FIELD EventDate FROM event.EventDate
  FIELD StartTime FROM event.StartTime
  FIELD EventType FROM event.EventType
  FIELD Title FROM event.Title
END.READ_MODEL

COMMAND CreateEvent
END.COMMAND
`);

    const home = result.model.objects[0]?.views.find((view) => view.name === "HomeDashboard");

    expect(result.diagnostics).toEqual([]);
    expect(home?.presentation).toMatchObject({
      layout: "stack",
      density: "compact",
      state: [{ name: "showGigs", type: "boolean", defaultValue: true, persistence: "memory" }],
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
          label: "Gig",
          accessibleLabel: "Gig event",
          icon: { kind: "map", map: "EventTypeIcon", value: "Gig" },
          themeToken: "colorStatusEvent",
          precedence: 10,
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
          title: "Schedule status",
          statuses: ["event"],
          include: "present",
        },
      ],
      sections: [
        {
          name: "Schedule",
          heading: "Upcoming events",
          controls: [
            {
              name: "showGigsToggle",
              kind: "toggle",
              state: "showGigs",
              label: "Gigs",
              icon: { kind: "map", map: "EventTypeIcon", value: "Gig" },
            },
            {
              name: "addEvent",
              kind: "action",
              label: "Add Event",
              icon: { kind: "named", name: "calendar" },
              placement: "primary",
              command: "CreateEvent",
              input: {},
            },
          ],
          lists: [
            expect.objectContaining({
              name: "UpcomingEvents",
              source: "HomeUpcomingEvents",
              renderAs: "compactFeed",
              status: { candidates: [{ kind: "map", map: "EventTypeStatus", field: "EventType" }] },
              actions: [
                {
                  name: "openEvent",
                  kind: "action",
                  label: "Open",
                  placement: "row",
                  view: "EventList",
                  input: { title: { kind: "field", field: "Title" } },
                },
              ],
              row: expect.objectContaining({
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
              }),
            }),
          ],
        },
      ],
    });
  });

  it("compiles Phase 56 source syntax into the partial and resolved models", () => {
    const result = compileAdl(`APP Phase56Capabilities
END.APP

SHELL
  NAV BandHome LABEL 'Home'
  CONTROL themeSwitch KIND THEME_SWITCH PLACEMENT navDrawer
  CONTROL logout KIND LOGOUT PLACEMENT navDrawer
  NAV_DRAWER TITLE 'Giggle Band' CONTROLS themeSwitch logout
END.SHELL

ROLE Member

CONTEXT Band OBJECT Band MEMBERSHIP BandMember USER User CONTEXT_FIELD Band ROLE_FIELD Role ROLES Leader Member
CONTEXT_GRANT pendingBandInvitation ON Band OBJECT BandInvitation USER Invitee CONTEXT_FIELD Band WHEN Status == 'Pending'

OBJECT Band
  FIELD Name TEXT REQUIRED

  VIEW BandHome LIST
    FIELDS Name
  END.VIEW
END.OBJECT

OBJECT User
  FIELD Name TEXT REQUIRED
END.OBJECT

OBJECT BandMember
  FIELD Band TEXT REQUIRED LOOKUP Band DISPLAY Name
  FIELD User TEXT REQUIRED LOOKUP User DISPLAY Name
  FIELD Role TEXT REQUIRED
END.OBJECT

OBJECT BandInvitation
  FIELD Band TEXT REQUIRED LOOKUP Band DISPLAY Name
  FIELD Invitee TEXT REQUIRED LOOKUP User DISPLAY Name
  FIELD Status TEXT REQUIRED DEFAULT Pending
END.OBJECT

OBJECT Availability
  SCOPE Band FIELD Band
  FIELD Band TEXT REQUIRED LOOKUP Band DISPLAY Name
  FIELD User TEXT REQUIRED LOOKUP User DISPLAY Name
  FIELD Note TEXT
END.OBJECT

OBJECT Song
  FIELD Band TEXT REQUIRED LOOKUP Band DISPLAY Name
  FIELD Title TEXT REQUIRED
  FIELD Composer TEXT
END.OBJECT

OBJECT SetListItem
  FIELD Band TEXT REQUIRED LOOKUP Band DISPLAY Name
  FIELD SetList TEXT REQUIRED
  FIELD Position NUMBER REQUIRED
  CONSTRAINT orderedSetListItems ORDERED SCOPE Band PARENT SetList POSITION Position REORDER shift COMPACT onDelete
END.OBJECT

READ_MODEL BandAvailability
  SOURCE member OBJECT BandMember SCOPE currentContext
  SOURCE availability OBJECT Availability SCOPE all JOIN member ON User == member.User CARDINALITY many
  FIELD User FROM member.User
  FIELD Note FROM availability.Note
END.READ_MODEL

COMMAND ImportSongs
  INPUT Ids LIST TEXT OPTIONAL
  INPUT Songs LIST REQUIRED
    FIELD Title TEXT REQUIRED
    FIELD Composer TEXT
  END.INPUT
  STEP createSongs CREATE Song FOR EACH Songs
    VALUE Band LITERAL 'band-1'
    VALUE Title ITEM Title
    VALUE Composer ITEM Composer
  END.STEP
END.COMMAND

COMMAND CreateBand
  INPUT Name TEXT REQUIRED
  STEP createBand CREATE Band ESTABLISHES CONTEXT Band
    VALUE Name INPUT Name
  END.STEP
  STEP createMembership CREATE BandMember
    VALUE Band STEP createBand META guid
    VALUE User RUNTIME userId
    VALUE Role LITERAL Leader
  END.STEP
END.COMMAND

POLICY AvailabilityPolicy ON Availability
  RULE allowBandMemberReadSharedAvailability ALLOW READ CONTEXT_MEMBER Band FIELD User
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.partialModel.shell?.navDrawer).toEqual({
      title: "Giggle Band",
      controls: ["themeSwitch", "logout"],
    });
    expect(result.model.shell.navDrawer).toEqual({
      title: "Giggle Band",
      controls: ["themeSwitch", "logout"],
    });

    // A grant declared at top level lands on the context named by its ON clause.
    expect(result.partialModel.contexts?.[0]?.grants).toEqual([
      {
        name: "pendingBandInvitation",
        object: "BandInvitation",
        userField: "Invitee",
        contextField: "Band",
        condition: expect.objectContaining({ kind: "binary", operator: "==" }),
      },
    ]);
    expect(result.model.contexts?.[0]?.grants).toEqual([
      expect.objectContaining({
        name: "pendingBandInvitation",
        object: "BandInvitation",
        userField: "Invitee",
        contextField: "Band",
      }),
    ]);

    const setListItem = result.model.objects.find((object) => object.name === "SetListItem");
    expect(setListItem?.constraints[0]).toEqual({
      name: "orderedSetListItems",
      kind: "ordered",
      parentField: "SetList",
      positionField: "Position",
      scopeFields: ["Band"],
      minPosition: 1,
      reorder: "shift",
      compaction: "onDelete",
    });

    expect(result.partialModel.readModels?.[0]?.sources[1]?.join).toEqual({
      source: "member",
      localField: "User",
      sourceField: "User",
      cardinality: "many",
    });
    expect(result.model.readModels?.[0]?.sources[1]?.join).toEqual({
      source: "member",
      localField: "User",
      sourceField: "User",
      cardinality: "many",
    });

    const importSongs = result.model.commands?.find((command) => command.name === "ImportSongs");
    expect(result.partialModel.commands?.[0]?.inputs).toEqual([
      { name: "Ids", type: "text", required: false, repeated: true },
      {
        name: "Songs",
        type: "text",
        required: true,
        repeated: true,
        itemFields: [
          { name: "Title", type: "text", required: true },
          // No modifier on the item FIELD line means optional, so the parser
          // states it rather than letting resolution default it to required.
          { name: "Composer", type: "text", required: false },
        ],
      },
    ]);
    expect(importSongs?.inputs).toEqual([
      { name: "Ids", type: "text", required: false, repeated: true, itemFields: [] },
      {
        name: "Songs",
        type: "text",
        required: true,
        repeated: true,
        itemFields: [
          { name: "Title", type: "text", required: true },
          { name: "Composer", type: "text", required: false },
        ],
      },
    ]);
    expect(importSongs?.steps[0]).toMatchObject({
      name: "createSongs",
      action: "create",
      forEach: "Songs",
      values: {
        Title: { kind: "item", field: "Title" },
        Composer: { kind: "item", field: "Composer" },
      },
    });

    const createBand = result.model.commands?.find((command) => command.name === "CreateBand");
    expect(createBand?.steps[0]).toMatchObject({
      name: "createBand",
      action: "create",
      establishesContext: "Band",
    });

    const availabilityRule = result.model.policies
      .find((policy) => policy.name === "AvailabilityPolicy")
      ?.rules.find((rule) => rule.name === "allowBandMemberReadSharedAvailability");
    expect(availabilityRule?.principal).toEqual({
      match: "contextMember",
      contextMember: { context: "Band", field: "User" },
      roles: [],
      groupRoles: [],
      users: [],
      owner: false,
    });
  });

  it("compiles the Giggle Band ADL reference app from app.yaml into the runtime model", async () => {
    const result = compileAdlProject({
      manifestSource: readReference("giggle-band/app.yaml"),
      sources: {
        "domain.adl": readReference("giggle-band/domain.adl"),
        "ui.adl": readReference("giggle-band/ui.adl"),
      },
    });

    expect(result.manifest).toMatchObject({
      name: "Giggle Band ADL Example",
      id: "giggle-band",
      sources: ["domain.adl", "ui.adl"],
    });
    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.app).toEqual({
      name: "Giggle Band ADL Example",
      theme: "CorporateLight",
      startView: "HomeDashboard",
      offlineGraceDays: 30,
    });
    expect(result.model.shell.nav.items.map((item) => [item.view, item.label, item.order])).toEqual(
      [
        ["HomeDashboard", "Home", 10],
        ["BandEventList", "Gigs", 20],
        ["BandEventCalendar", "Calendar", 30],
        ["MyAvailabilityList", "Availability", 40],
        ["BandMemberAvailabilityBoard", "Who is free", 45],
        ["SongLibrary", "Songs", 50],
        ["SetListList", "Set Lists", 60],
        // The set list's own form, which now edits its items in place. Declared
        // in `ui.adl` rather than left to derivation, so it gets a label a person
        // would use and a deterministic place beside the list it belongs to.
        ["SetListForm", "Set list editor", 62],
        ["StreamingLinkList", "Streaming", 65],
        ["BandDirectory", "Bands", 70],
        // Undeclared views keep their derived ordering after the declared ones,
        // which is why adding three NAV entries moves this block from 80 to 110.
        ["UserProfileList", "User Profile List", 110],
        ["BandProfile", "Band Profile", 120],
        ["BandMemberList", "Band Member List", 130],
        ["BandInvitationList", "Band Invitation List", 140],
        ["BandEventForm", "Band Event Form", 150],
        ["SetListItemList", "Set List Item List", 160],
        ["SetListByPosition", "Set List By Position", 170],
        ["DevicePreferenceList", "Device Preference List", 180],
      ],
    );
    expect(
      result.model.shell.nav.items.find((item) => item.view === "MyAvailabilityList")?.visibility,
    ).toEqual({ kind: "contextSelected", context: "Band" });
    expect(result.model.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Band",
          object: "Band",
          membership: expect.objectContaining({
            object: "BandMember",
            userField: "User",
            contextField: "Band",
            roleField: "Role",
            roles: ["BandAdmin", "BandMember"],
          }),
        }),
      ]),
    );
    expect(result.model.objects.find((object) => object.name === "SetListItem")).toMatchObject({
      scope: { context: "Band", field: "Band" },
      constraints: [
        expect.objectContaining({
          name: "orderedSetListItems",
          kind: "ordered",
          parentField: "SetList",
          positionField: "Position",
        }),
      ],
    });
    expect(result.model.readModels?.map((readModel) => readModel.name)).toEqual(
      expect.arrayContaining([
        "HomeUpcomingEvents",
        "SetListItemsByPosition",
        "CalendarPlanningItems",
        "PendingInvitations",
      ]),
    );
    expect(
      result.model.readModels?.find((readModel) => readModel.name === "HomeUpcomingEvents"),
    ).toMatchObject({
      strategy: "union",
    });
    expect(
      result.model.readModels?.find((readModel) => readModel.name === "CalendarPlanningItems"),
    ).toMatchObject({
      strategy: "union",
    });
    expect(
      result.model.objects
        .find((object) => object.name === "Event")
        ?.views.find((view) => view.name === "HomeDashboard")?.presentation,
    ).toMatchObject({
      density: "compact",
      state: expect.arrayContaining([
        expect.objectContaining({ name: "showGigs", defaultValue: true }),
        expect.objectContaining({ name: "showRehearsals", defaultValue: true }),
        expect.objectContaining({ name: "showUnavailable", defaultValue: true }),
      ]),
      iconMaps: [
        expect.objectContaining({
          name: "EventTypeIcon",
          values: expect.arrayContaining([
            { value: "Gig", icon: "music" },
            { value: "Rehearsal", icon: "microphone" },
            { value: "Unavailable", icon: "x" },
          ]),
        }),
      ],
      statuses: expect.arrayContaining([
        expect.objectContaining({ name: "event", label: "Gig" }),
        expect.objectContaining({ name: "rehearsal", label: "Rehearsal" }),
        expect.objectContaining({ name: "unavailable", label: "Unavailable" }),
      ]),
      statusMaps: [
        expect.objectContaining({
          name: "EventTypeStatus",
          values: expect.arrayContaining([
            { value: "Gig", status: "event" },
            { value: "Rehearsal", status: "rehearsal" },
            { value: "Unavailable", status: "unavailable" },
          ]),
        }),
      ],
      legends: [
        expect.objectContaining({
          name: "ScheduleStatus",
          statuses: ["event", "rehearsal", "unavailable"],
        }),
      ],
      sections: expect.arrayContaining([
        expect.objectContaining({ name: "Welcome" }),
        expect.objectContaining({ name: "Filters" }),
        expect.objectContaining({
          name: "Schedule",
          lists: [
            expect.objectContaining({
              name: "UpcomingEvents",
              renderAs: "compactFeed",
              status: { candidates: [{ kind: "map", map: "EventTypeStatus", field: "EventType" }] },
            }),
          ],
        }),
        expect.objectContaining({
          name: "Invitations",
          lists: [
            expect.objectContaining({
              name: "PendingInvitations",
              emptyState: { text: "No pending invitations" },
            }),
          ],
        }),
      ]),
    });
    expect(result.model.commands?.map((command) => command.name)).toContain("AcceptBandInvitation");

    const runtime = new ApplicationRuntime(result.model);
    const systemContext: RuntimeContext = {
      userId: "band-reference-system",
      roles: ["SystemAdmin"],
      channel: "api",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    const musician = await runtime.create(
      "User",
      { Name: "Casey Morgan", Email: "casey@example.com" },
      systemContext,
    );
    const band = await runtime.create("Band", { Name: "The Alphas" }, systemContext);
    const bandContext: RuntimeContext = {
      ...systemContext,
      selectedContexts: { Band: band.meta.guid },
    };

    await runtime.create(
      "BandMember",
      { User: musician.meta.guid, Band: band.meta.guid, Role: "BandAdmin" },
      bandContext,
    );
    const song = await runtime.create(
      "Song",
      { Band: band.meta.guid, Title: "Neon Map" },
      bandContext,
    );
    const setList = await runtime.create(
      "SetList",
      { Band: band.meta.guid, Name: "August headline" },
      bandContext,
    );
    const item = await runtime.create(
      "SetListItem",
      { Band: band.meta.guid, SetList: setList.meta.guid, Song: song.meta.guid, Position: 1 },
      bandContext,
    );

    expect(item.values.Position).toBe(1);
  });
});

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

function readReference(name: string): string {
  return readFileSync(new URL(`../src/reference/${name}`, import.meta.url), "utf8");
}
