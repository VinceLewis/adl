import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError, lexAdl, parseAdl } from "../src/index.js";

describe("ADL parser", () => {
  it("parses the representative User example into an AST", () => {
    const ast = parseAdl(readExample("user.adl"));
    const user = ast.objects.find((object) => object.name === "User");

    expect(ast.app).toMatchObject({
      name: "UserDirectory",
      theme: "DirectoryTheme",
      startView: "UserList",
    });
    expect(ast.roles.map((role) => role.name)).toEqual(["Admin", "Viewer"]);
    expect(ast.themes[0]).toMatchObject({
      name: "DirectoryTheme",
      base: "CorporateLight",
    });
    expect(user?.fields.map((field) => field.name)).toEqual([
      "Name",
      "Email",
      "Phone",
      "Active",
      "Status",
    ]);
    expect(user?.fields.find((field) => field.name === "Name")?.validators).toEqual([
      expect.objectContaining({ validatorKind: "maxLength", value: 100 }),
    ]);
    expect(user?.fields.find((field) => field.name === "Email")?.validators).toEqual([
      expect.objectContaining({ validatorKind: "email" }),
    ]);
    expect(user?.lifecycle?.actions[0]).toMatchObject({
      name: "activate",
      from: ["Draft"],
      to: "Active",
      allowRules: [expect.objectContaining({ roles: ["Admin"] })],
    });
  });

  it("tracks useful token locations from the lexer", () => {
    const tokens = lexAdl("APP Demo\n  START_VIEW UserList\nEND.APP\n");
    const startView = tokens.find((token) => token.lexeme === "START_VIEW");

    expect(startView?.range.start).toMatchObject({ line: 2, column: 3 });
  });

  it("parses an APP offline grace declaration and requires its unit", () => {
    const ast = parseAdl("APP Demo\n  OFFLINE_GRACE 14 DAYS\nEND.APP\n");

    expect(ast.app.offlineGraceDays).toBe(14);
    // Without the unit word a bare number could later be read as the wrong unit.
    expect(() => parseAdl("APP Demo\n  OFFLINE_GRACE 14\nEND.APP\n")).toThrow();
    expect(() => parseAdl("APP Demo\n  OFFLINE_GRACE forever DAYS\nEND.APP\n")).toThrow();
  });

  it("parses field predicate validators and policy WHEN expressions", () => {
    const ast = parseAdl(`APP Expressions
END.APP

ROLE Requester

OBJECT PurchaseOrder
  FIELD Owner TEXT
  FIELD Value NUMBER VALIDATE Value > 0 MESSAGE 'Positive only.'
END.OBJECT

POLICY PurchaseOrderPolicy ON PurchaseOrder
  ALLOW CREATE ROLE Requester WHEN Owner == runtime.userId AND Value > 10000
END.POLICY
`);

    const purchaseOrder = ast.objects.find((object) => object.name === "PurchaseOrder");
    expect(
      purchaseOrder?.fields.find((field) => field.name === "Value")?.validators[0],
    ).toMatchObject({
      validatorKind: "predicate",
      message: "Positive only.",
      expression: {
        kind: "binary",
        operator: ">",
      },
    });
    expect(ast.policies[0]?.rules[0]?.condition).toMatchObject({
      kind: "binary",
      operator: "and",
    });
  });

  it("parses object validations, decision tables, lifecycle guards, and commands", () => {
    const ast = parseAdl(`APP Phase21
END.APP

OBJECT PurchaseOrder
  FIELD Owner TEXT REQUIRED
  FIELD Value NUMBER REQUIRED
  FIELD Status TEXT DEFAULT Draft
  FIELD Reviewed BOOLEAN DEFAULT FALSE
  VALIDATE ApprovalCommentRequired WHEN Value <= 10000 OR Reviewed == TRUE MESSAGE 'Review required.'

  LIFECYCLE PurchaseOrderLifecycle FIELD Status INITIAL Draft
    STATE Draft
    STATE Approved
    ACTION approve FROM Draft TO Approved WHEN Reviewed == TRUE MESSAGE 'Review first.'
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
  REQUIRE Value > 0 MESSAGE 'Value must be positive.'
  STEP createOrder CREATE PurchaseOrder AUTHORITY command
    VALUE Owner INPUT Owner
    VALUE Value INPUT Value
    VALUE Status LITERAL Draft
    VALUE Reviewed LITERAL TRUE
  END.STEP
END.COMMAND
`);

    expect(ast.objects[0]?.validations[0]).toMatchObject({
      name: "ApprovalCommentRequired",
      message: "Review required.",
    });
    expect(ast.objects[0]?.lifecycle?.actions[0]?.guards[0]).toMatchObject({
      message: "Review first.",
    });
    expect(ast.decisionTables[0]).toMatchObject({
      name: "ApprovalTier",
      object: "PurchaseOrder",
      match: "single",
    });
    expect(ast.commands[0]).toMatchObject({
      name: "CreatePurchaseOrder",
      preconditions: [expect.objectContaining({ message: "Value must be positive." })],
      steps: [expect.objectContaining({ name: "createOrder", action: "create" })],
    });
  });

  it("parses composed view presentation blocks", () => {
    const ast = parseAdl(`APP Presentation
END.APP

OBJECT Event
  FIELD EventType TEXT
  FIELD EventDate DATE
  FIELD Title TEXT

  VIEW HomeDashboard DASHBOARD
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
        ORDER BY EventDate ASC
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
END.OBJECT
`);

    const presentation = ast.objects[0]?.views[0]?.presentation;

    expect(presentation).toMatchObject({
      layout: "stack",
      density: "compact",
      state: [expect.objectContaining({ name: "showGigs", type: "boolean" })],
      iconMaps: [
        expect.objectContaining({
          name: "EventTypeIcon",
          field: "EventType",
          values: [expect.objectContaining({ value: "Gig", icon: "music" })],
        }),
      ],
      statuses: [
        expect.objectContaining({
          name: "event",
          label: "Gig",
          accessibleLabel: "Gig event",
          themeToken: "colorStatusEvent",
          precedence: 10,
        }),
      ],
      statusMaps: [
        expect.objectContaining({
          name: "EventTypeStatus",
          field: "EventType",
          values: [expect.objectContaining({ value: "Gig", status: "event" })],
        }),
      ],
      legends: [
        expect.objectContaining({
          name: "ScheduleStatus",
          title: "Schedule status",
          statuses: ["event"],
        }),
      ],
      sections: [
        expect.objectContaining({
          name: "Schedule",
          controls: [
            expect.objectContaining({ name: "showGigsToggle", state: "showGigs" }),
            expect.objectContaining({
              name: "addEvent",
              command: "CreateEvent",
              placement: "primary",
            }),
          ],
          lists: [
            expect.objectContaining({
              name: "UpcomingEvents",
              renderAs: "compactFeed",
              statusCandidates: [
                expect.objectContaining({
                  kind: "map",
                  map: "EventTypeStatus",
                  field: "EventType",
                }),
              ],
              actions: [expect.objectContaining({ name: "openEvent", view: "EventList" })],
            }),
          ],
        }),
      ],
    });
  });

  it("parses shell navigation metadata", () => {
    const ast = parseAdl(`APP ShellSyntax
END.APP

SHELL
  NAV Home LABEL 'Home' ICON home GROUP Main ORDER 10 ACTIVE_WHEN Home HomeDetail
  NAV Availability LABEL 'Availability' ICON calendar GROUP Main ORDER 20 VISIBLE WHEN CONTEXT Band SELECTED
  CONTROL contextSelector KIND contextSelector PLACEMENT topBar
  CONTROL syncStatus KIND syncStatus PLACEMENT topBar VISIBLE ONLINE
  TOP_BAR CONTEXT_SELECTOR topBar MOBILE_CONTEXT_SELECTOR sheet CONTROLS contextSelector syncStatus
END.SHELL

CONTEXT Band OBJECT Band

OBJECT Band
  FIELD Name TEXT
  VIEW Home LIST
    FIELDS Name
  END.VIEW
  VIEW HomeDetail FORM
    FIELDS Name
  END.VIEW
  VIEW Availability LIST
    FIELDS Name
  END.VIEW
END.OBJECT
`);

    expect(ast.shell).toMatchObject({
      navItems: [
        expect.objectContaining({
          view: "Home",
          label: "Home",
          icon: "home",
          group: "Main",
          order: 10,
          activeWhen: ["Home", "HomeDetail"],
        }),
        expect.objectContaining({
          view: "Availability",
          visibility: { kind: "contextSelected", context: "Band" },
        }),
      ],
      controls: [
        expect.objectContaining({ name: "contextSelector", controlKind: "contextSelector" }),
        expect.objectContaining({
          name: "syncStatus",
          controlKind: "syncStatus",
          visibility: { kind: "online" },
        }),
      ],
      topBar: expect.objectContaining({
        contextSelector: "topBar",
        mobileContextSelector: "sheet",
        controls: ["contextSelector", "syncStatus"],
      }),
    });
  });

  it("parses top-level context grants, nav drawer chrome, and ordered constraint options", () => {
    const ast = parseAdl(`APP Phase56
END.APP

SHELL
  NAV Home LABEL 'Home'
  CONTROL themeSwitch KIND THEME_SWITCH PLACEMENT navDrawer
  CONTROL logout KIND LOGOUT PLACEMENT navDrawer
  NAV_DRAWER TITLE 'Giggle Band' CONTROLS themeSwitch logout
END.SHELL

CONTEXT Band OBJECT Band
CONTEXT_GRANT pendingBandInvitation ON Band OBJECT BandInvitation USER Invitee CONTEXT_FIELD Band WHEN Status == 'Pending'

OBJECT SetListItem
  FIELD Band TEXT REQUIRED
  FIELD SetList TEXT REQUIRED
  FIELD Position NUMBER REQUIRED
  CONSTRAINT orderedSetListItems ORDERED SCOPE Band PARENT SetList POSITION Position REORDER shift COMPACT onDelete
END.OBJECT
`);

    expect(ast.shell?.navDrawer).toEqual({
      kind: "ShellNavDrawerDeclaration",
      title: "Giggle Band",
      controls: ["themeSwitch", "logout"],
      range: expect.anything(),
    });
    expect(ast.contextGrants[0]).toMatchObject({
      kind: "ContextGrantDeclaration",
      name: "pendingBandInvitation",
      context: "Band",
      object: "BandInvitation",
      userField: "Invitee",
      contextField: "Band",
      condition: { kind: "binary", operator: "==" },
    });
    expect(ast.objects[0]?.constraints[0]).toMatchObject({
      kind: "OrderedObjectConstraintDeclaration",
      name: "orderedSetListItems",
      scopeFields: ["Band"],
      parentField: "SetList",
      positionField: "Position",
      reorder: "shift",
      compaction: "onDelete",
    });
  });

  it("parses a protected role constraint declaring a scope, field, guarded values, and minimum count", () => {
    const ast = parseAdl(`APP Phase65
END.APP

OBJECT TeamMember
  FIELD Team TEXT REQUIRED
  FIELD Role TEXT REQUIRED
  CONSTRAINT lastTeamAdminStanding PROTECTED_ROLE SCOPE Team FIELD Role VALUES ('Admin', 'Owner') MIN 1
END.OBJECT
`);

    expect(ast.objects[0]?.constraints[0]).toMatchObject({
      kind: "ProtectedRoleObjectConstraintDeclaration",
      name: "lastTeamAdminStanding",
      scopeFields: ["Team"],
      roleField: "Role",
      roleValues: ["Admin", "Owner"],
      minCount: 1,
    });
  });

  it("parses a protected role constraint with no declared MIN, leaving it for the resolver to default", () => {
    const ast = parseAdl(`APP Phase65
END.APP

OBJECT TeamMember
  FIELD Team TEXT REQUIRED
  FIELD Role TEXT REQUIRED
  CONSTRAINT lastTeamAdminStanding PROTECTED_ROLE SCOPE Team FIELD Role VALUES ('Admin')
END.OBJECT
`);

    expect(ast.objects[0]?.constraints[0]).toMatchObject({
      kind: "ProtectedRoleObjectConstraintDeclaration",
      name: "lastTeamAdminStanding",
      scopeFields: ["Team"],
      roleField: "Role",
      roleValues: ["Admin"],
    });
    expect(
      (ast.objects[0]?.constraints[0] as { minCount?: number } | undefined)?.minCount,
    ).toBeUndefined();
  });

  it("parses a nav drawer with no CONTROLS clause without inventing an empty list", () => {
    const ast = parseAdl(`APP Phase56
END.APP

SHELL
  NAV_DRAWER TITLE 'Giggle Band'
END.SHELL
`);

    expect(ast.shell?.navDrawer).toMatchObject({ title: "Giggle Band" });
    expect(ast.shell?.navDrawer?.controls).toBeUndefined();
  });

  it("parses read-model source joins and cardinality", () => {
    const ast = parseAdl(`APP Phase56
END.APP

READ_MODEL BandAvailability
  SOURCE member OBJECT BandMember SCOPE currentContext
  SOURCE availability OBJECT Availability SCOPE all JOIN member ON User == member.User CARDINALITY many
  SOURCE band OBJECT Band JOIN member ON id == member.Band
  FIELD Note FROM availability.Note
END.READ_MODEL
`);

    expect(ast.readModels[0]?.sources[0]?.join).toBeUndefined();
    expect(ast.readModels[0]?.sources[1]?.join).toMatchObject({
      kind: "ReadModelSourceJoinDeclaration",
      source: "member",
      localField: "User",
      sourceField: "User",
      cardinality: "many",
    });
    // `id` is the record's own identity on either side, and an undeclared
    // cardinality stays undeclared so resolution supplies the default.
    expect(ast.readModels[0]?.sources[2]?.join).toMatchObject({
      source: "member",
      localField: "id",
      sourceField: "Band",
    });
    expect(ast.readModels[0]?.sources[2]?.join?.cardinality).toBeUndefined();
  });

  it("parses command list inputs, iterating steps, and item value expressions", () => {
    const ast = parseAdl(`APP Phase56
END.APP

COMMAND ImportSongs
  INPUT Ids LIST TEXT REQUIRED
  INPUT Tags LIST
  INPUT Songs LIST REQUIRED
    FIELD Title TEXT REQUIRED
    FIELD Composer TEXT
  END.INPUT
  STEP createSongs CREATE Song FOR EACH Songs
    VALUE Title ITEM Title
    VALUE Position ITEM_INDEX
    VALUE Payload ITEM
  END.STEP
  STEP createBand CREATE Band ESTABLISHES CONTEXT Band
    VALUE Name LITERAL 'New band'
  END.STEP
  STEP renumber UPDATE Song ID ITEM FOR_EACH Ids
    PATCH Position ITEM_INDEX
  END.STEP
END.COMMAND
`);

    const command = ast.commands[0];

    expect(command?.inputs[0]).toMatchObject({
      name: "Ids",
      type: "text",
      required: true,
      repeated: true,
      itemFields: [],
    });
    // `LIST` with neither an item type nor a block carries text items.
    expect(command?.inputs[1]).toMatchObject({ name: "Tags", type: "text", repeated: true });
    expect(command?.inputs[2]).toMatchObject({
      name: "Songs",
      repeated: true,
      required: true,
      itemFields: [
        expect.objectContaining({ name: "Title", type: "text", required: true }),
        expect.objectContaining({ name: "Composer", type: "text", required: false }),
      ],
      end: expect.objectContaining({ name: "INPUT" }),
    });
    expect(command?.steps[0]).toMatchObject({
      name: "createSongs",
      action: "create",
      forEach: "Songs",
      values: {
        Title: { kind: "item", field: "Title" },
        Position: { kind: "itemIndex" },
        Payload: { kind: "item" },
      },
    });
    expect(command?.steps[1]).toMatchObject({
      name: "createBand",
      establishesContext: "Band",
    });
    // A bare `ITEM` before a further header clause is still the whole item.
    expect(command?.steps[2]).toMatchObject({
      name: "renumber",
      action: "update",
      forEach: "Ids",
      recordId: { kind: "item" },
    });
  });

  it("parses the contextMember policy principal and its trailing WHEN", () => {
    const ast = parseAdl(`APP Phase56
END.APP

POLICY AvailabilityPolicy ON Availability
  RULE allowBandMemberReadSharedAvailability ALLOW READ CONTEXT_MEMBER Band FIELD User
  ALLOW UPDATE CONTEXT_MEMBER Band FIELD User WHEN Shared == TRUE
END.POLICY
`);

    expect(ast.policies[0]?.rules[0]).toMatchObject({
      name: "allowBandMemberReadSharedAvailability",
      action: "read",
      principal: {
        match: "contextMember",
        contextMember: { context: "Band", field: "User" },
        roles: [],
        groupRoles: [],
        users: [],
        owner: false,
      },
    });
    expect(ast.policies[0]?.rules[1]).toMatchObject({
      action: "update",
      principal: { match: "contextMember", contextMember: { context: "Band", field: "User" } },
      condition: { kind: "binary", operator: "==" },
    });
  });

  it("parses view edit sections, child collections, relationship pickers, and EDIT_CONTAINER", () => {
    const ast = parseAdl(`APP Phase59
END.APP

OBJECT Order
  FIELD Code TEXT
  FIELD Notes TEXT

  VIEW OrderForm FORM
    FIELDS Code Notes
    EDIT_CONTAINER page
    EDIT_SECTION Details HEADING 'Order'
      FIELDS Code Notes
    END.EDIT_SECTION
    CHILD_COLLECTION Lines HEADING 'Lines'
      CHILD OrderLine PARENT_FIELD Order
      CHILD_VIEW OrderLineList
      OPERATIONS createChild linkExisting updateChild unlink remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'
      PICKER OrderLinePicker
        SOURCE OBJECT OrderLine
        SELECTION multiple
        DISPLAY Description Quantity
        SEARCH Description
        SORT Description ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Nothing to link.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT
`);

    const view = ast.objects[0]?.views[0];

    expect(view?.editContainer).toBe("page");
    expect(view?.editSections[0]).toMatchObject({
      kind: "EditFieldsSectionDeclaration",
      name: "Details",
      heading: "Order",
      fields: ["Code", "Notes"],
    });
    expect(view?.editSections[1]).toMatchObject({
      kind: "EditChildCollectionDeclaration",
      name: "Lines",
      heading: "Lines",
      childObject: "OrderLine",
      parentField: "Order",
      childView: "OrderLineList",
      operations: ["createChild", "linkExisting", "updateChild", "unlink", "remove", "reorder"],
      staged: true,
      orderField: "Position",
      emptyText: "No lines yet.",
      picker: {
        kind: "RelationshipPickerDeclaration",
        name: "OrderLinePicker",
        sourceKind: "object",
        source: "OrderLine",
        selection: "multiple",
        displayFields: ["Description", "Quantity"],
        searchFields: ["Description"],
        sort: [{ field: "Description", direction: "asc" }],
        excludeAlreadyLinked: true,
        emptyText: "Nothing to link.",
      },
    });

    const linkingSection = view?.editSections[1];
    if (linkingSection?.kind !== "EditChildCollectionDeclaration") {
      throw new Error("Expected a child collection declaration.");
    }

    // A picker with no CANDIDATE_FIELD links existing children, so the field
    // must be absent rather than defaulted to anything.
    expect(linkingSection.picker?.candidateField).toBeUndefined();
  });

  /*
   * `CANDIDATE_FIELD` is what turns a picker from "re-parent one of these
   * children" into "add one of these things", so the child field it names has to
   * survive into the AST alongside a source that is the *candidate* object.
   */
  it("parses a minting relationship picker's CANDIDATE_FIELD", () => {
    const ast = parseAdl(`APP Phase60
END.APP

OBJECT SetList
  FIELD Name TEXT

  VIEW SetListForm FORM
    FIELDS Name
    CHILD_COLLECTION Items
      CHILD SetListItem PARENT_FIELD SetList
      OPERATIONS createChild updateChild remove reorder
      ORDER_FIELD Position
      PICKER SongPicker
        SOURCE OBJECT Song
        CANDIDATE_FIELD Song
        SELECTION multiple
        DISPLAY Title Composer
        SEARCH Title
        SORT Title ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Every song is already in this set list.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT
`);

    const section = ast.objects[0]?.views[0]?.editSections[0];
    if (section?.kind !== "EditChildCollectionDeclaration") {
      throw new Error("Expected a child collection declaration.");
    }

    expect(section.picker).toMatchObject({
      kind: "RelationshipPickerDeclaration",
      name: "SongPicker",
      sourceKind: "object",
      // The candidate object, not the child object: the picker offers songs and
      // mints the set-list item that names one.
      source: "Song",
      candidateField: "Song",
      selection: "multiple",
      displayFields: ["Title", "Composer"],
      searchFields: ["Title"],
      sort: [{ field: "Title", direction: "asc" }],
      excludeAlreadyLinked: true,
      emptyText: "Every song is already in this set list.",
    });
  });

  /*
   * `STAGED` and `EXCLUDE_LINKED` both resolve to `true` by default, so the bare
   * word has to mean `true` for the declaration to read as English. Turning one
   * off is otherwise unsayable, which is the whole reason the explicit form
   * exists — so both forms are pinned here.
   */
  it("parses the bare and explicit forms of STAGED and EXCLUDE_LINKED, and a read-model picker source", () => {
    const ast = parseAdl(`APP Phase59
END.APP

OBJECT Order
  FIELD Code TEXT

  VIEW OrderForm FORM
    FIELDS Code
    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      STAGED false
      PICKER OrderLinePicker
        SOURCE READ_MODEL OrderLineCandidates
        SELECTION single
        EXCLUDE_LINKED false
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT
`);

    const section = ast.objects[0]?.views[0]?.editSections[0];
    if (section?.kind !== "EditChildCollectionDeclaration") {
      throw new Error("Expected a child collection declaration.");
    }

    expect(section.staged).toBe(false);
    // Absent rather than empty, so resolution still applies its own defaults.
    expect(section.operations).toBeUndefined();
    expect(section.heading).toBeUndefined();
    expect(section.picker).toMatchObject({
      sourceKind: "readModel",
      source: "OrderLineCandidates",
      selection: "single",
      excludeAlreadyLinked: false,
    });
  });

  it("reports malformed edit surface declarations with the options it accepts", () => {
    const wrap = (body: string): string => `APP Phase59
END.APP

OBJECT Order
  FIELD Code TEXT

  VIEW OrderForm FORM
${body}
  END.VIEW
END.OBJECT
`;

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      EMPTY_TEXT 'No lines yet.'
    END.CHILD_COLLECTION`),
      "Expected CHILD_COLLECTION CHILD directive with PARENT_FIELD",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine
    END.CHILD_COLLECTION`),
      "Expected CHILD_COLLECTION CHILD directive",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS explode createChild updateChild
    END.CHILD_COLLECTION`),
      "Expected child collection operation createChild, linkExisting, updateChild, unlink, remove, or reorder, but found 'explode'.",
    );

    expectParseFailure(
      wrap("    EDIT_CONTAINER popup"),
      "Expected edit container mode MODAL, DRAWER, PAGE, or SPLITPANE, but found 'popup'.",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order`),
      "or END.CHILD_COLLECTION",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      PICKER OrderLinePicker
        SOURCE OBJECT OrderLine
    END.CHILD_COLLECTION`),
      "or END.PICKER",
    );

    expectParseFailure(
      wrap(`    EDIT_SECTION Details
      FIELDS Code`),
      "or END.EDIT_SECTION",
    );

    expectParseFailure(
      wrap(`    EDIT_SECTION Details
      CHILD OrderLine PARENT_FIELD Order
    END.EDIT_SECTION`),
      "Expected EDIT_SECTION directive HEADING, FIELDS, or END.EDIT_SECTION, but found 'CHILD'.",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      SELECTION single
    END.CHILD_COLLECTION`),
      "Expected CHILD_COLLECTION directive HEADING, CHILD, CHILD_VIEW, OPERATIONS, STAGED, ORDER_FIELD, EMPTY_TEXT, PICKER, or END.CHILD_COLLECTION, but found 'SELECTION'.",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      PICKER OrderLinePicker
        STAGED
      END.PICKER
    END.CHILD_COLLECTION`),
      "Expected PICKER directive SOURCE, CANDIDATE_FIELD, SELECTION, DISPLAY, SEARCH, SORT, EXCLUDE_LINKED, EMPTY_TEXT, or END.PICKER, but found 'STAGED'.",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      PICKER OrderLinePicker
        SOURCE TABLE OrderLine
      END.PICKER
    END.CHILD_COLLECTION`),
      "Expected relationship picker source kind OBJECT or READ_MODEL, but found 'TABLE'.",
    );

    expectParseFailure(
      wrap(`    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      PICKER OrderLinePicker
        SELECTION many
      END.PICKER
    END.CHILD_COLLECTION`),
      "Expected relationship picker selection mode SINGLE or MULTIPLE, but found 'many'.",
    );

    expectParseFailure(
      wrap(`    EDIT_SECTION Details FIELDS Code
    END.EDIT_SECTION`),
      "Expected EDIT_SECTION header option HEADING or end of line, but found 'FIELDS'.",
    );
  });

  /*
   * An unknown operation must be reported at its own token. Reading the whole
   * line first and then mapping it names the *last* operation as unexpected,
   * which is usually a valid word and sends the author to the wrong column.
   */
  it("locates an unknown child operation at the offending word", () => {
    try {
      parseAdl(`APP Phase59
END.APP

OBJECT Order
  FIELD Code TEXT

  VIEW OrderForm FORM
    CHILD_COLLECTION Lines
      CHILD OrderLine PARENT_FIELD Order
      OPERATIONS explode createChild updateChild
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic.message).toContain("'explode'");
      expect(error.diagnostic.sourceRange.start).toMatchObject({ line: 10, column: 18 });
      return;
    }

    throw new Error("Expected an unknown child operation to throw.");
  });

  it("reports malformed Phase 56 declarations with the options it accepts", () => {
    expectParseFailure(
      `APP Phase56
END.APP

CONTEXT Band OBJECT Band
CONTEXT_GRANT pendingInvitation ON Rehearsal OBJECT Invitation USER Invitee CONTEXT_FIELD Rehearsal
`,
      "Expected CONTEXT_GRANT ON to name a declared CONTEXT (Band), but found 'Rehearsal'.",
    );

    expectParseFailure(
      `APP Phase56
END.APP

CONTEXT Band OBJECT Band
CONTEXT_GRANT pendingInvitation ON Band OBJECT Invitation USER Invitee
`,
      "Expected CONTEXT_FIELD in CONTEXT_GRANT",
    );

    expectParseFailure(
      `APP Phase56
END.APP

WIDGET Broken
`,
      "Expected a top-level SHELL, ROLE, CONTEXT, CONTEXT_GRANT, OBJECT, READ_MODEL, DECISION_TABLE, COMMAND, POLICY, THEME, SYNC, MIGRATION, or end of file",
    );

    expectParseFailure(
      `APP Phase56
END.APP

SHELL
  NAV_DRAWER HEADING 'Giggle Band'
END.SHELL
`,
      "Expected SHELL NAV_DRAWER option TITLE, CONTROLS, or end of line",
    );

    expectParseFailure(
      `APP Phase56
END.APP

OBJECT SetListItem
  FIELD SetList TEXT
  FIELD Position NUMBER
  CONSTRAINT ordered ORDERED PARENT SetList POSITION Position REORDER sideways
END.OBJECT
`,
      "Expected ORDERED CONSTRAINT REORDER mode STRICT or SHIFT",
    );

    expectParseFailure(
      `APP Phase65
END.APP

OBJECT TeamMember
  FIELD Team TEXT
  FIELD Role TEXT
  CONSTRAINT lastTeamAdminStanding PROTECTED_ROLE SCOPE Team VALUES ('Admin')
END.OBJECT
`,
      "Expected FIELD in PROTECTED_ROLE constraint",
    );

    expectParseFailure(
      `APP Phase65
END.APP

OBJECT TeamMember
  FIELD Team TEXT
  FIELD Role TEXT
  CONSTRAINT lastTeamAdminStanding PROTECTED_ROLE SCOPE Team FIELD Role
END.OBJECT
`,
      "Expected VALUES in PROTECTED_ROLE constraint",
    );

    expectParseFailure(
      `APP Phase56
END.APP

READ_MODEL BandAvailability
  SOURCE member OBJECT BandMember
  SOURCE availability OBJECT Availability CARDINALITY many
  FIELD Note FROM availability.Note
END.READ_MODEL
`,
      "Expected JOIN before CARDINALITY in READ_MODEL SOURCE declaration",
    );

    expectParseFailure(
      `APP Phase56
END.APP

READ_MODEL BandAvailability
  SOURCE member OBJECT BandMember
  SOURCE availability OBJECT Availability JOIN member ON User == other.User
  FIELD Note FROM availability.Note
END.READ_MODEL
`,
      "Expected joined field qualified by the joined source 'member' in READ_MODEL SOURCE JOIN",
    );

    expectParseFailure(
      `APP Phase56
END.APP

COMMAND ImportSongs
  INPUT Songs LIST REQUIRED
    FIELD Title TEXT REQUIRED
END.COMMAND
`,
      "Expected COMMAND INPUT item directive FIELD or END.INPUT",
    );

    expectParseFailure(
      `APP Phase56
END.APP

COMMAND ImportSongs
  INPUT Songs LIST REQUIRED
  STEP createSongs CREATE Song FOR Songs
  END.STEP
END.COMMAND
`,
      "Expected command step FOR EACH clause",
    );

    expectParseFailure(
      `APP Phase56
END.APP

COMMAND RenameBand
  STEP renameBand UPDATE Band ID LITERAL 'band-1' ESTABLISHES CONTEXT Band
  END.STEP
END.COMMAND
`,
      "Expected COMMAND STEP header option AUTHORITY, ID, FOR EACH, or end of line",
    );

    expectParseFailure(
      `APP Phase56
END.APP

POLICY AvailabilityPolicy ON Availability
  ALLOW READ CONTEXT_MEMBER Band User
END.POLICY
`,
      "Expected principal CONTEXT_MEMBER FIELD clause",
    );
  });

  it("reports missing block terminators with a source location", () => {
    expect(() =>
      parseAdl(`APP Broken
END.APP

OBJECT User
  FIELD Name TEXT
`),
    ).toThrow(ParseError);

    try {
      parseAdl(`APP Broken
END.APP

OBJECT User
  FIELD Name TEXT
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic).toMatchObject({
        code: "ADL_PARSE_EXPECTED_TOKEN",
      });
      expect(error.diagnostic.message).toContain("END.OBJECT");
      expect(error.diagnostic.sourceRange.start.line).toBeGreaterThanOrEqual(5);
    }
  });

  it("reports malformed UI blocks with a source location", () => {
    try {
      parseAdl(`APP BrokenUi
END.APP

OBJECT Event
  FIELD Title TEXT

  VIEW HomeDashboard DASHBOARD
    SECTION Schedule
      LIST UpcomingEvents FROM HomeUpcomingEvents
        ROW
          TEXT Title
        END.ROW
    END.SECTION
  END.VIEW
END.OBJECT
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic).toMatchObject({
        code: "ADL_PARSE_EXPECTED_TOKEN",
      });
      expect(error.diagnostic.message).toContain("END.LIST");
      expect(error.diagnostic.sourceRange.start.line).toBeGreaterThanOrEqual(13);
      return;
    }

    throw new Error("Expected missing END.LIST to throw.");
  });

  it("rejects unsupported procedural keywords", () => {
    expect(() =>
      parseAdl(`APP Bad
END.APP

FETCH FILE(User)
`),
    ).toThrow(ParseError);

    try {
      parseAdl(`APP Bad
END.APP

FETCH FILE(User)
`);
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expect(error.diagnostic).toMatchObject({
        code: "ADL_PARSE_UNSUPPORTED_PROCEDURAL_KEYWORD",
      });
      expect(error.diagnostic.message).toContain("FETCH");
      expect(error.diagnostic.sourceRange.start).toMatchObject({ line: 4, column: 1 });
    }
  });
});

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

function expectParseFailure(source: string, expectedMessage: string): void {
  try {
    parseAdl(source);
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw error;
    }

    expect(error.diagnostic.message).toContain(expectedMessage);
    return;
  }

  throw new Error(`Expected parsing to fail with: ${expectedMessage}`);
}
