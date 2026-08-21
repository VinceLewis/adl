// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ICON_NAMES,
  MODEL_VALIDATION_CODES,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  ApplicationRuntime as ApplicationRuntimeType,
  PartialApplicationModel,
  ResolvedApplicationModel,
} from "../src/index.js";
import { ApplicationRuntime } from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { AdlComposedViewElement } from "../src/ui/components/adl-composed-view.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import { createBandReferenceModel } from "../src/reference/band-app.js";
import { createJointlyReferenceModel } from "../src/reference/jointly-app.js";
import type { RuntimePresentationView } from "../src/runtime/presentation-runtime.js";

/**
 * The icon vocabulary has one job: keep the compiler, the shell renderer and
 * the presentation renderer talking about the same set of names.
 *
 * Before Phase 99 there was no vocabulary at all — `iconGlyph` and `iconSvg`
 * each carried their own `switch`, each knew names the other did not, and each
 * quietly rendered nothing for the rest. So the load-bearing assertions here
 * are the two that *loop over* `ICON_NAMES` rather than listing names by hand:
 * a name added to the vocabulary but not drawn by both renderers fails them.
 */
describe("icon vocabulary", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
  });

  it("is exactly the union of what the two renderers supported, plus the names real content already used", () => {
    // `home`, `list`, `users`, `sync`, `log-out`, `logout`, `mic` came from the
    // shell's `iconGlyph`; `x`, `close`, `menu` from presentation's `iconSvg`;
    // `music`, `microphone`, `calendar` from both. `check` and `dot` are named
    // by the conformance corpus, which is content this vocabulary must not
    // reject. Alias pairs (`mic`/`microphone`, `log-out`/`logout`, `x`/`close`)
    // are kept whole: both spellings were already accepted somewhere.
    expect([...ICON_NAMES]).toEqual([
      "calendar",
      "check",
      "close",
      "dot",
      "home",
      "list",
      "log-out",
      "logout",
      "menu",
      "mic",
      "microphone",
      "music",
      "sync",
      "users",
      "x",
    ]);
  });

  it("renders a glyph in the shell for every name in the vocabulary", async () => {
    const model = resolveApplicationModel({
      app: { name: "Icon Shell", startView: "Home" },
      shell: {
        nav: {
          items: ICON_NAMES.map((icon, index) => ({
            name: `nav-${icon}`,
            view: "Home",
            label: icon,
            icon,
            order: (index + 1) * 10,
          })),
        },
      },
      objects: [
        {
          name: "Item",
          fields: [{ name: "Name", type: "text" }],
          views: [{ name: "Home", kind: "list", fields: ["Name"] }],
        },
      ],
    });
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = model;
    app.runtime = new ApplicationRuntime(model) as ApplicationRuntimeType;
    app.context = { userId: "icon-viewer", roles: [], channel: "ui" };
    document.body.append(app);
    await app.whenReady();

    // Nav items live in the drawer, so it has to be open for them to exist.
    const menu = app.querySelector<HTMLButtonElement>("button[data-shell-menu='true']");
    expect(menu).not.toBeNull();
    menu?.click();
    await app.whenReady();

    const blank: string[] = [];
    for (const icon of ICON_NAMES) {
      const rendered = app.querySelector<HTMLElement>(`[data-shell-icon='${icon}']`);
      if (rendered === null || rendered.textContent?.trim() === "") {
        blank.push(icon);
      }
    }

    expect(blank).toEqual([]);
  });

  it("renders an SVG path in presentation for every name in the vocabulary", () => {
    const view = document.createElement("adl-composed-view") as AdlComposedViewElement;
    document.body.append(view);
    view.presentation = presentationWithEveryIcon();

    const blank: string[] = [];
    for (const icon of ICON_NAMES) {
      const path = view.querySelector<SVGPathElement>(
        `.adl-presentation-icon[data-icon='${icon}'] svg path`,
      );
      if (path === null || (path.getAttribute("d") ?? "").trim() === "") {
        blank.push(icon);
      }
    }

    expect(blank).toEqual([]);
    // The single-letter fallback is the failure this vocabulary exists to
    // remove, so no vocabulary name may reach it.
    expect(view.querySelector(".adl-presentation-icon-fallback")).toBeNull();
  });

  it("reports an unknown icon name at every place a model names an icon", () => {
    const diagnostics = validateApplicationModel(
      resolveApplicationModel(createUnknownIconPartialModel()),
    );
    const unknownIcons = diagnostics.filter(
      (entry) => entry.code === MODEL_VALIDATION_CODES.ICON_NAME_UNKNOWN,
    );

    expect(unknownIcons.map((entry) => entry.path).sort()).toEqual([
      "objects[0].views[0].presentation.iconMaps[0].defaultIcon",
      "objects[0].views[0].presentation.iconMaps[0].values[0].icon",
      "objects[0].views[0].presentation.sections[0].controls[0].icon.name",
      "objects[0].views[0].presentation.sections[0].controls[1].icon.name",
      "objects[0].views[0].presentation.sections[0].controls[1].options[0].icon.name",
      "objects[0].views[0].presentation.sections[1].calendars[0].actions[0].icon.name",
      "objects[0].views[0].presentation.sections[1].calendars[0].emptyState.icon.name",
      "objects[0].views[0].presentation.sections[1].lists[0].actions[0].icon.name",
      "objects[0].views[0].presentation.sections[1].lists[0].emptyState.icon.name",
      "objects[0].views[0].presentation.sections[1].lists[0].row.fragments[0].icon.name",
      "objects[0].views[0].presentation.sections[1].lists[0].row.fragments[2].fragments[0].icon.name",
      "objects[0].views[0].presentation.statuses[0].icon.name",
      "shell.controls[0].icon",
      "shell.nav.items[0].icon",
    ]);
    expect(unknownIcons.every((entry) => entry.severity === "error")).toBe(true);
    expect(unknownIcons[0]?.message).toContain("is not a supported icon");
  });

  it("accepts every icon name in the vocabulary at those same places", () => {
    const diagnostics = validateApplicationModel(
      resolveApplicationModel(createUnknownIconPartialModel("calendar")),
    );

    expect(
      diagnostics.filter((entry) => entry.code === MODEL_VALIDATION_CODES.ICON_NAME_UNKNOWN),
    ).toEqual([]);
  });

  it("keeps the shell's lexical icon rule separate from the vocabulary", () => {
    // `Bad Icon` fails the shape rule, so it reports only that. Reporting both
    // would say nothing the first diagnostic does not.
    const diagnostics = validateApplicationModel(
      resolveApplicationModel({
        app: { name: "Shape", startView: "Home" },
        shell: {
          nav: { items: [{ name: "home", view: "Home", icon: "Bad Icon", order: 10 }] },
        },
        objects: [
          {
            name: "Item",
            fields: [{ name: "Name", type: "text" }],
            views: [{ name: "Home", kind: "list", fields: ["Name"] }],
          },
        ],
      }),
    );

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      MODEL_VALIDATION_CODES.SHELL_NAV_ICON_INVALID,
    ]);
  });

  it("leaves both reference apps free of unknown icon names", async () => {
    const models: ResolvedApplicationModel[] = [
      await createBandReferenceModel(),
      await createJointlyReferenceModel(),
    ];

    for (const model of models) {
      expect(
        validateApplicationModel(model).filter(
          (entry) => entry.code === MODEL_VALIDATION_CODES.ICON_NAME_UNKNOWN,
        ),
      ).toEqual([]);
    }
  });
});

/**
 * A runtime presentation view carrying one empty-state icon per vocabulary
 * name. Empty states are the cheapest icon site to build by hand, and they go
 * through the same `renderIcon` every other presentation icon does.
 */
function presentationWithEveryIcon(): RuntimePresentationView {
  return {
    object: "Item",
    view: "Home",
    layout: "stack",
    density: "comfortable",
    state: {},
    legends: [],
    diagnostics: [],
    sections: [
      {
        name: "Icons",
        layout: "stack",
        density: "comfortable",
        controls: [],
        matrices: [],
        calendars: [],
        lists: ICON_NAMES.map((icon) => ({
          name: `list-${icon}`,
          sourceKind: "object" as const,
          source: "Item",
          renderAs: "feed" as const,
          density: "comfortable" as const,
          rows: [],
          emptyState: { text: icon, icon: { name: icon, source: { kind: "named" as const } } },
        })),
      },
    ],
  };
}

/**
 * One model that names an icon everywhere the resolved model allows one:
 * shell navigation, a shell control, an icon map's values and default, a
 * presentation status, a control, a select option, a list's empty state and
 * action, a row icon fragment, the same fragment nested inside a conditional,
 * and a calendar's empty state and action.
 */
function createUnknownIconPartialModel(icon = "not-an-icon"): PartialApplicationModel {
  return {
    app: { name: "IconValidation", startView: "Home" },
    shell: {
      nav: { items: [{ name: "home", view: "Home", icon, order: 10 }] },
      topBar: { controls: ["signOut"] },
      controls: [{ name: "signOut", kind: "logout", icon, placement: "topBar" }],
    },
    objects: [
      {
        name: "Event",
        fields: [
          { name: "Title", type: "text" },
          { name: "EventType", type: "text" },
          { name: "EventDate", type: "date" },
        ],
        views: [
          {
            name: "Home",
            kind: "composite",
            fields: ["Title", "EventType", "EventDate"],
            presentation: {
              state: [
                { name: "showGigs", type: "boolean", defaultValue: true },
                { name: "eventType", type: "text", defaultValue: "Gig" },
                { name: "month", type: "text", defaultValue: "2026-02" },
              ],
              iconMaps: [
                {
                  name: "EventTypeIcon",
                  field: "EventType",
                  values: [{ value: "Gig", icon }],
                  defaultIcon: icon,
                },
              ],
              statuses: [
                {
                  name: "planned",
                  label: "Planned",
                  icon: { kind: "named", name: icon },
                  precedence: 10,
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
                      icon: { kind: "named", name: icon },
                    },
                    {
                      name: "eventTypeSelect",
                      kind: "select",
                      state: "eventType",
                      label: "Event type",
                      icon: { kind: "named", name: icon },
                      options: [
                        { value: "Gig", label: "Gigs", icon: { kind: "named", name: icon } },
                      ],
                    },
                  ],
                },
                {
                  name: "Schedule",
                  lists: [
                    {
                      name: "Events",
                      sourceKind: "object",
                      source: "Event",
                      fields: ["Title", "EventType", "EventDate"],
                      emptyState: { text: "Nothing", icon: { kind: "named", name: icon } },
                      actions: [
                        {
                          name: "add",
                          kind: "action",
                          label: "Add",
                          placement: "primary",
                          create: { object: "Event" },
                          icon: { kind: "named", name: icon },
                        },
                      ],
                      row: {
                        fragments: [
                          { kind: "icon", icon: { kind: "named", name: icon } },
                          { kind: "field", field: "Title", style: "bold" },
                          {
                            kind: "conditional",
                            when: {
                              kind: "binary",
                              operator: "==",
                              left: { kind: "field", field: "EventType" },
                              right: { kind: "literal", value: "Gig" },
                            },
                            fragments: [{ kind: "icon", icon: { kind: "named", name: icon } }],
                          },
                        ],
                      },
                    },
                  ],
                  calendars: [
                    {
                      name: "MonthPlan",
                      sourceKind: "object",
                      source: "Event",
                      dateField: "EventDate",
                      titleField: "Title",
                      fields: ["Title", "EventDate"],
                      month: { state: "month" },
                      emptyState: { text: "Nothing", icon: { kind: "named", name: icon } },
                      actions: [
                        {
                          name: "addOnDay",
                          kind: "action",
                          label: "Add event",
                          create: { object: "Event" },
                          icon: { kind: "named", name: icon },
                        },
                      ],
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
