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
