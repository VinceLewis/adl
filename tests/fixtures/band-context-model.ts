import type { PartialApplicationModel } from "../../src/index.js";

export const bandContextPartialModel = {
  app: {
    name: "BandOps",
    startView: "HomeDashboard",
  },
  roles: [{ name: "BandAdmin" }, { name: "BandMember" }],
  contexts: [
    {
      name: "User",
      object: "User",
      selection: { mode: "required" },
    },
    {
      name: "Band",
      selection: { mode: "optional" },
      membership: {
        object: "BandMember",
        userField: "User",
        contextField: "Band",
        roleField: "Role",
        roles: ["BandAdmin", "BandMember"],
      },
    },
  ],
  objects: [
    {
      name: "User",
      businessKey: "Email",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Email", type: "text", required: true, validators: [{ kind: "email" }] },
      ],
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
        { name: "Date", type: "date", required: true },
        { name: "Venue", type: "text", required: true },
      ],
      views: [
        {
          name: "HomeDashboard",
          kind: "dashboard",
          context: { mode: "all", context: "Band" },
          readModel: "UpcomingGigsByBand",
          fields: ["GigDate", "Venue", "BandName"],
          sort: [{ field: "GigDate", direction: "asc" }],
          actions: ["read", "search"],
        },
        {
          name: "BandGigList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Date", "Venue"],
          searchFields: ["Venue"],
          sort: [{ field: "Date", direction: "asc" }],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
  ],
  readModels: [
    {
      name: "UpcomingGigsByBand",
      context: { mode: "all", context: "Band" },
      sources: [
        { name: "gig", object: "Gig", scope: "allAvailableContexts" },
        { name: "band", object: "Band", scope: "allAvailableContexts" },
      ],
      fields: [
        { name: "GigDate", source: "gig", field: "Date" },
        { name: "Venue", source: "gig", field: "Venue" },
        { name: "BandName", source: "band", field: "Name" },
      ],
      sort: [{ field: "GigDate", direction: "asc" }],
    },
  ],
} satisfies PartialApplicationModel;
