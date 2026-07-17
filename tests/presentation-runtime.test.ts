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
