import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import type {
  JsonValue,
  PartialApplicationModel,
  PartialPolicyConditionModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  ResolvedCommandValueExpression,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";

export const bandReferenceSystemContext: RuntimeContext = {
  userId: "band-reference-system",
  roles: ["SystemAdmin"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

export const bandReferencePartialModel = {
  app: {
    name: "Band Reference",
    startView: "HomeDashboard",
    theme: "CorporateLight",
  },
  roles: [
    { name: "SystemAdmin" },
    { name: "BandMember" },
    { name: "BandAdmin", inherits: ["BandMember"] },
  ],
  contexts: [
    {
      name: "User",
      object: "User",
      selection: { mode: "required" },
    },
    {
      name: "Band",
      object: "Band",
      selection: {
        mode: "optional",
        autoSelect: false,
        persistence: "local",
      },
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
        { name: "ProfilePicture", type: "attachment" },
      ],
      sync: { mode: "localFirst", scope: "currentUser" },
      views: [
        {
          name: "UserProfileList",
          kind: "list",
          fields: ["Name", "Email"],
          searchFields: ["Name", "Email"],
          actions: ["read", "search"],
        },
      ],
    },
    {
      name: "Band",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Description", type: "text" },
        { name: "Biography", type: "text" },
      ],
      sync: { mode: "localFirst", scope: "allAvailableContexts" },
      views: [
        {
          name: "BandDirectory",
          kind: "list",
          context: { mode: "all", context: "Band" },
          fields: ["Name", "Description"],
          searchFields: ["Name"],
          actions: ["read", "search"],
        },
        {
          name: "BandProfile",
          kind: "form",
          context: { mode: "required", context: "Band" },
          fields: ["Name", "Description", "Biography"],
          actions: ["save", "delete"],
        },
      ],
    },
    {
      name: "BandMember",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "uniqueBandMemberUser",
          kind: "unique",
          scopeFields: ["Band"],
          fields: ["User"],
        },
      ],
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
        {
          name: "Role",
          type: "text",
          required: true,
          validators: [{ kind: "in", value: ["BandAdmin", "BandMember"] }],
        },
        { name: "JoinedAt", type: "date" },
      ],
      sync: { mode: "localFirst", scope: "allAvailableContexts" },
      views: [
        {
          name: "BandMemberList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["User", "Role", "JoinedAt"],
          searchFields: ["Role"],
          actions: ["read", "search"],
        },
      ],
    },
    {
      name: "BandInvitation",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "uniqueBandInvitationEmail",
          kind: "unique",
          scopeFields: ["Band"],
          fields: ["InviteeEmail"],
        },
      ],
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        {
          name: "Inviter",
          type: "text",
          required: true,
          lookup: { targetObject: "User", displayField: "Name" },
        },
        {
          name: "Invitee",
          type: "text",
          lookup: { targetObject: "User", displayField: "Name" },
        },
        { name: "InviteeEmail", type: "text", required: true, validators: [{ kind: "email" }] },
        {
          name: "Role",
          type: "text",
          required: true,
          defaultValue: "BandMember",
          validators: [{ kind: "in", value: ["BandMember"] }],
        },
        {
          name: "Status",
          type: "text",
          required: true,
          defaultValue: "Pending",
          validators: [{ kind: "in", value: ["Pending", "Accepted", "Declined"] }],
        },
        { name: "SentAt", type: "date" },
        { name: "RespondedAt", type: "date" },
      ],
      sync: { mode: "onlineRequired", scope: "currentContext" },
      views: [
        {
          name: "BandInvitationList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["InviteeEmail", "Role", "Status", "SentAt"],
          searchFields: ["InviteeEmail", "Status"],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
    {
      name: "Event",
      displayField: "Title",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        {
          name: "EventType",
          type: "text",
          required: true,
          defaultValue: "Gig",
          validators: [{ kind: "in", value: ["Gig", "Rehearsal"] }],
        },
        { name: "Date", type: "date", required: true },
        { name: "StartTime", type: "time" },
        { name: "EndTime", type: "time" },
        { name: "Title", type: "text", required: true },
        { name: "VenueName", type: "text" },
        { name: "VenueLocation", type: "text" },
        { name: "Notes", type: "text" },
        {
          name: "Status",
          type: "text",
          required: true,
          validators: [{ kind: "in", value: ["Draft", "Published", "Cancelled"] }],
        },
      ],
      lifecycle: {
        name: "EventLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [{ name: "Draft" }, { name: "Published" }, { name: "Cancelled", terminal: true }],
        actions: [
          {
            name: "publish",
            label: "Publish",
            from: "Draft",
            to: "Published",
            policyRefs: ["EventPolicy"],
          },
          {
            name: "cancel",
            label: "Cancel",
            from: ["Draft", "Published"],
            to: "Cancelled",
            policyRefs: ["EventPolicy"],
          },
        ],
      },
      sync: { mode: "localFirst", scope: "currentContext" },
      views: [
        {
          name: "HomeDashboard",
          kind: "dashboard",
          context: { mode: "all", context: "Band" },
          readModel: "HomeUpcomingEvents",
          fields: ["EventDate", "StartTime", "EventType", "Title", "VenueName", "BandName"],
          sort: [
            { field: "EventDate", direction: "asc" },
            { field: "StartTime", direction: "asc" },
          ],
          actions: ["read", "search"],
        },
        {
          name: "BandEventList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Date", "StartTime", "EventType", "Title", "VenueName", "Status"],
          searchFields: ["Title", "VenueName", "EventType"],
          sort: [
            { field: "Date", direction: "asc" },
            { field: "StartTime", direction: "asc" },
          ],
          actions: ["create", "read", "update", "delete"],
        },
        {
          name: "BandEventForm",
          kind: "form",
          context: { mode: "required", context: "Band" },
          fields: [
            "EventType",
            "Date",
            "StartTime",
            "EndTime",
            "Title",
            "VenueName",
            "VenueLocation",
            "Notes",
            "Status",
          ],
          actions: ["save", "delete"],
        },
      ],
    },
    {
      name: "Availability",
      displayField: "Date",
      constraints: [
        {
          name: "uniqueUserAvailabilityDate",
          kind: "unique",
          scopeFields: ["User"],
          fields: ["Date"],
        },
      ],
      fields: [
        {
          name: "User",
          type: "text",
          required: true,
          lookup: { targetObject: "User", displayField: "Name" },
        },
        { name: "Date", type: "date", required: true },
        {
          name: "Status",
          type: "text",
          required: true,
          validators: [{ kind: "in", value: ["Available", "Unavailable"] }],
        },
        { name: "Notes", type: "text" },
      ],
      sync: { mode: "localFirst", scope: "currentUser" },
      views: [
        {
          name: "MyAvailabilityList",
          kind: "list",
          fields: ["Date", "Status", "Notes"],
          searchFields: ["Status", "Notes"],
          sort: [{ field: "Date", direction: "asc" }],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
    {
      name: "Song",
      displayField: "Title",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "uniqueSongTitleInBand",
          kind: "unique",
          scopeFields: ["Band"],
          fields: ["Title"],
        },
      ],
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Title", type: "text", required: true },
        { name: "Composer", type: "text" },
        { name: "DurationSeconds", type: "number", validators: [{ kind: "min", value: 0 }] },
        { name: "Notes", type: "text" },
      ],
      sync: { mode: "localFirst", scope: "currentContext" },
      views: [
        {
          name: "SongLibrary",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Title", "Composer", "DurationSeconds"],
          searchFields: ["Title", "Composer"],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
    {
      name: "SetList",
      displayField: "Name",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "uniqueSetListNameInBand",
          kind: "unique",
          scopeFields: ["Band"],
          fields: ["Name"],
        },
      ],
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Name", type: "text", required: true },
        { name: "Description", type: "text" },
        {
          name: "CreatedBy",
          type: "text",
          lookup: { targetObject: "User", displayField: "Name" },
        },
      ],
      sync: { mode: "localFirst", scope: "currentContext" },
      views: [
        {
          name: "SetListList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Name", "Description"],
          searchFields: ["Name"],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
    {
      name: "SetListItem",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "orderedSetListItems",
          kind: "ordered",
          scopeFields: ["Band"],
          parentField: "SetList",
          positionField: "Position",
        },
      ],
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        {
          name: "SetList",
          type: "text",
          required: true,
          lookup: { targetObject: "SetList", displayField: "Name" },
        },
        {
          name: "Song",
          type: "text",
          required: true,
          lookup: { targetObject: "Song", displayField: "Title" },
        },
        {
          name: "Position",
          type: "number",
          required: true,
          validators: [{ kind: "min", value: 1 }],
        },
        { name: "Notes", type: "text" },
      ],
      sync: { mode: "localFirst", scope: "currentContext" },
      views: [
        {
          name: "SetListItemList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["SetList", "Position", "Song", "Notes"],
          searchFields: ["Notes"],
          sort: [{ field: "Position", direction: "asc" }],
          actions: ["create", "read", "update", "delete"],
        },
        {
          name: "SetListByPosition",
          kind: "dashboard",
          context: { mode: "required", context: "Band" },
          readModel: "SetListItemsByPosition",
          fields: ["Position", "SongTitle", "SetListName", "DurationSeconds"],
          sort: [{ field: "Position", direction: "asc" }],
          actions: ["read", "search"],
        },
      ],
    },
    {
      name: "StreamingLink",
      scope: { context: "Band", field: "Band" },
      constraints: [
        {
          name: "uniqueStreamingPlatformForSong",
          kind: "unique",
          scopeFields: ["Song"],
          fields: ["Platform"],
        },
      ],
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        {
          name: "Song",
          type: "text",
          required: true,
          lookup: { targetObject: "Song", displayField: "Title" },
        },
        {
          name: "Platform",
          type: "text",
          required: true,
          validators: [
            {
              kind: "in",
              value: ["YouTube", "Spotify", "Apple Music", "SoundCloud", "Bandcamp", "Other"],
            },
          ],
        },
        {
          name: "Url",
          type: "text",
          required: true,
          validators: [{ kind: "regexp", value: "^https?://" }],
        },
      ],
      sync: { mode: "cacheReadonly", scope: "currentContext" },
      views: [
        {
          name: "StreamingLinkList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Song", "Platform", "Url"],
          searchFields: ["Platform", "Url"],
          actions: ["read", "search"],
        },
      ],
    },
    {
      name: "DevicePreference",
      displayField: "LastOpenedView",
      fields: [
        {
          name: "User",
          type: "text",
          required: true,
          lookup: { targetObject: "User", displayField: "Name" },
        },
        {
          name: "SelectedBand",
          type: "text",
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "LastOpenedView", type: "text" },
        {
          name: "OfflineHomeLimit",
          type: "number",
          defaultValue: 30,
          validators: [{ kind: "min", value: 1 }],
        },
      ],
      sync: { mode: "localPrivate", scope: "currentUser" },
      views: [
        {
          name: "DevicePreferenceList",
          kind: "list",
          fields: ["SelectedBand", "LastOpenedView", "OfflineHomeLimit"],
          searchFields: ["LastOpenedView"],
          actions: ["create", "read", "update", "delete"],
        },
      ],
    },
  ],
  commands: [
    {
      name: "AcceptBandInvitation",
      label: "Accept invitation",
      inputs: [{ name: "Invitation", type: "text", required: true }],
      steps: [
        {
          name: "acceptInvitation",
          action: "update",
          object: "BandInvitation",
          recordId: commandInput("Invitation"),
          patch: {
            Status: commandLiteral("Accepted"),
            RespondedAt: commandRuntime("today"),
          },
          preconditions: [
            fieldEqualsRuntimeUser("Invitee"),
            fieldEqualsLiteral("Status", "Pending"),
          ],
        },
        {
          name: "createMembership",
          action: "create",
          object: "BandMember",
          authority: "command",
          values: {
            User: commandRuntime("userId"),
            Band: commandStepField("acceptInvitation", "Band"),
            Role: commandStepField("acceptInvitation", "Role"),
            JoinedAt: commandRuntime("today"),
          },
        },
      ],
    },
  ],
  readModels: [
    {
      name: "HomeUpcomingEvents",
      context: { mode: "all", context: "Band" },
      sources: [
        { name: "event", object: "Event", scope: "allAvailableContexts" },
        { name: "band", object: "Band", scope: "allAvailableContexts" },
      ],
      fields: [
        { name: "EventDate", source: "event", field: "Date" },
        { name: "StartTime", source: "event", field: "StartTime" },
        { name: "EventType", source: "event", field: "EventType" },
        { name: "Title", source: "event", field: "Title" },
        { name: "VenueName", source: "event", field: "VenueName" },
        { name: "BandName", source: "band", field: "Name" },
      ],
      sort: [
        { field: "EventDate", direction: "asc" },
        { field: "StartTime", direction: "asc" },
      ],
    },
    {
      name: "SetListItemsByPosition",
      context: { mode: "required", context: "Band" },
      sources: [
        { name: "item", object: "SetListItem", scope: "currentContext" },
        { name: "setList", object: "SetList", scope: "currentContext" },
        { name: "song", object: "Song", scope: "currentContext" },
      ],
      fields: [
        { name: "Position", source: "item", field: "Position" },
        { name: "SetListName", source: "setList", field: "Name" },
        { name: "SongTitle", source: "song", field: "Title" },
        { name: "DurationSeconds", source: "song", field: "DurationSeconds" },
      ],
      sort: [{ field: "Position", direction: "asc" }],
    },
    {
      name: "CurrentUserAvailability",
      sources: [
        { name: "availability", object: "Availability", scope: "currentUser" },
        { name: "user", object: "User", scope: "currentUser" },
      ],
      fields: [
        { name: "AvailabilityDate", source: "availability", field: "Date" },
        { name: "Status", source: "availability", field: "Status" },
        { name: "UserName", source: "user", field: "Name" },
      ],
      sort: [{ field: "AvailabilityDate", direction: "asc" }],
    },
  ],
  policies: [
    ...createSystemAdminPolicy("User"),
    ...createSystemAdminPolicy("Band"),
    ...createSystemAdminPolicy("BandMember"),
    ...createSystemAdminPolicy("BandInvitation"),
    ...createSystemAdminPolicy("Event"),
    ...createSystemAdminPolicy("Availability"),
    ...createSystemAdminPolicy("Song"),
    ...createSystemAdminPolicy("SetList"),
    ...createSystemAdminPolicy("SetListItem"),
    ...createSystemAdminPolicy("StreamingLink"),
    ...createSystemAdminPolicy("DevicePreference"),
    {
      name: "UserPolicy",
      object: "User",
      rules: [
        {
          name: "allowBandMemberSearchUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "search",
        },
        {
          name: "allowBandMemberReadUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "BandPolicy",
      object: "Band",
      rules: [
        {
          name: "allowBandMemberSearchBands",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "search",
        },
        {
          name: "allowBandMemberReadBand",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
        {
          name: "allowBandAdminUpdateBand",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
        },
        {
          name: "allowBandAdminDeleteBand",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
      ],
    },
    {
      name: "BandMemberPolicy",
      object: "BandMember",
      rules: [
        {
          name: "allowBandMemberSearchMembers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "search",
        },
        {
          name: "allowBandMemberReadMembers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
        {
          name: "allowAuthenticatedReadOwnMembership",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "read",
          condition: fieldEqualsRuntimeUser("User"),
        },
        {
          name: "allowBandAdminCreateMembers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
        },
        {
          name: "allowBandAdminUpdateMembers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
        },
        {
          name: "allowBandAdminDeleteMembers",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
      ],
    },
    {
      name: "BandInvitationPolicy",
      object: "BandInvitation",
      rules: [
        {
          name: "allowBandAdminCreateInvitations",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
        },
        {
          name: "allowBandAdminReadInvitations",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "read",
        },
        {
          name: "allowInviteeReadOwnInvitation",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "read",
          condition: fieldEqualsRuntimeUser("Invitee"),
        },
        {
          name: "allowBandAdminSearchInvitations",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "search",
        },
        {
          name: "allowBandAdminUpdateInvitations",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
        },
        {
          name: "allowInviteeAcceptInvitation",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "update",
          condition: allConditions([
            fieldEqualsRuntimeUser("Invitee"),
            fieldEqualsLiteral("Status", "Accepted"),
          ]),
        },
        {
          name: "denyInviteeIdentityInvitationUpdates",
          effect: "deny",
          principal: { match: "authenticated" },
          action: "update",
          fields: ["Band", "Inviter", "Invitee", "InviteeEmail", "Role"],
          condition: allConditions([
            fieldEqualsRuntimeUser("Invitee"),
            fieldEqualsLiteral("Status", "Accepted"),
          ]),
        },
        {
          name: "allowBandAdminDeleteInvitations",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
      ],
    },
    {
      name: "EventPolicy",
      object: "Event",
      rules: [
        {
          name: "allowBandMemberSearchEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "search",
        },
        {
          name: "allowBandMemberReadEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
        {
          name: "allowBandAdminCreateDraftEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
          state: "Draft",
        },
        {
          name: "allowBandAdminUpdateDraftEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
          state: "Draft",
        },
        {
          name: "allowBandAdminDeleteEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
        {
          name: "allowBandAdminPublishEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "transition",
          state: "Draft",
          lifecycleAction: "publish",
        },
        {
          name: "allowBandAdminCancelEvents",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "transition",
          state: ["Draft", "Published"],
          lifecycleAction: "cancel",
        },
      ],
    },
    {
      name: "AvailabilityPolicy",
      object: "Availability",
      rules: [
        {
          name: "allowAuthenticatedSearchAvailability",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "search",
        },
        {
          name: "allowAuthenticatedCreateAvailability",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "create",
          condition: fieldEqualsRuntimeUser("User"),
        },
        {
          name: "allowAvailabilityOwnerRead",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "read",
          condition: fieldEqualsRuntimeUser("User"),
        },
        {
          name: "allowAvailabilityOwnerUpdate",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "update",
          condition: fieldEqualsRuntimeUser("User"),
        },
        {
          name: "allowAvailabilityOwnerDelete",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "delete",
          condition: fieldEqualsRuntimeUser("User"),
        },
      ],
    },
    {
      name: "SongPolicy",
      object: "Song",
      rules: createBandCollectionRules("Song", "Songs"),
    },
    {
      name: "SetListPolicy",
      object: "SetList",
      rules: createBandCollectionRules("SetList", "SetLists"),
    },
    {
      name: "SetListItemPolicy",
      object: "SetListItem",
      rules: createBandCollectionRules("SetListItem", "SetListItems"),
    },
    {
      name: "StreamingLinkPolicy",
      object: "StreamingLink",
      rules: [
        {
          name: "allowBandMemberSearchStreamingLinks",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "search",
        },
        {
          name: "allowBandMemberReadStreamingLinks",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "DevicePreferencePolicy",
      object: "DevicePreference",
      rules: [
        {
          name: "allowAuthenticatedSearchDevicePreferences",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "search",
        },
        {
          name: "allowAuthenticatedCreateDevicePreferences",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "create",
        },
        {
          name: "allowDevicePreferenceOwnerRead",
          effect: "allow",
          principal: { match: "owner" },
          action: "read",
        },
        {
          name: "allowDevicePreferenceOwnerUpdate",
          effect: "allow",
          principal: { match: "owner" },
          action: "update",
        },
        {
          name: "allowDevicePreferenceOwnerDelete",
          effect: "allow",
          principal: { match: "owner" },
          action: "delete",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

export interface BandReferenceSeed {
  model: ResolvedApplicationModel;
  runtime: ApplicationRuntime;
  musicianContext: RuntimeContext;
  firstBandContext: RuntimeContext;
  secondBandContext: RuntimeContext;
  musician: StoredObjectRecord;
  guest: StoredObjectRecord;
  firstBand: StoredObjectRecord;
  secondBand: StoredObjectRecord;
  firstEvent: StoredObjectRecord;
  secondEvent: StoredObjectRecord;
  availability: StoredObjectRecord;
  firstSong: StoredObjectRecord;
  secondSong: StoredObjectRecord;
  firstSetList: StoredObjectRecord;
  firstSetListItem: StoredObjectRecord;
  invitation: StoredObjectRecord;
}

export function createBandReferenceModel(): ResolvedApplicationModel {
  return resolveApplicationModel(bandReferencePartialModel);
}

export function createBandReferenceRuntime(storage?: ObjectStorageBackend): ApplicationRuntime {
  return new ApplicationRuntime(createBandReferenceModel(), {
    ...(storage === undefined ? {} : { storage }),
  });
}

export async function seedBandReferenceRuntime(
  runtime: ApplicationRuntime,
  systemContext: RuntimeContext = bandReferenceSystemContext,
): Promise<BandReferenceSeed> {
  const model = runtime.model;
  const musician = await runtime.create(
    "User",
    { Name: "Casey Morgan", Email: "casey@example.com" },
    systemContext,
  );
  const guest = await runtime.create(
    "User",
    { Name: "Riley Stone", Email: "riley@example.com" },
    systemContext,
  );
  const firstBand = await runtime.create(
    "Band",
    {
      Name: "The Alphas",
      Description: "Originals and function sets",
      Biography: "A city band coordinating shows and rehearsals.",
    },
    systemContext,
  );
  const secondBand = await runtime.create(
    "Band",
    {
      Name: "The Betas",
      Description: "Acoustic rehearsal project",
      Biography: "A compact rehearsal group.",
    },
    systemContext,
  );

  await runtime.create(
    "BandMember",
    {
      User: musician.meta.guid,
      Band: firstBand.meta.guid,
      Role: "BandAdmin",
      JoinedAt: "2026-07-01",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "BandMember",
    {
      User: musician.meta.guid,
      Band: secondBand.meta.guid,
      Role: "BandMember",
      JoinedAt: "2026-07-02",
    },
    contextForBand(systemContext, secondBand.meta.guid),
  );

  const firstEvent = await runtime.create(
    "Event",
    {
      Band: firstBand.meta.guid,
      EventType: "Gig",
      Date: "2026-08-01",
      StartTime: "20:00",
      EndTime: "22:00",
      Title: "Canal Street headline",
      VenueName: "Alpha Hall",
      VenueLocation: "Canal Street",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const secondEvent = await runtime.create(
    "Event",
    {
      Band: secondBand.meta.guid,
      EventType: "Rehearsal",
      Date: "2026-08-02",
      StartTime: "18:30",
      EndTime: "21:00",
      Title: "New set rehearsal",
      VenueName: "Beta Rooms",
      VenueLocation: "Unit 4",
    },
    contextForBand(systemContext, secondBand.meta.guid),
  );

  const musicianContext: RuntimeContext = {
    userId: musician.meta.guid,
    roles: [],
    channel: "api",
    now: getSeedNow(systemContext),
  };
  const firstBandContext = await runtime.withSelectedContext(
    "Band",
    firstBand.meta.guid,
    musicianContext,
  );
  const secondBandContext = await runtime.withSelectedContext(
    "Band",
    secondBand.meta.guid,
    musicianContext,
  );

  const availability = await runtime.create(
    "Availability",
    {
      User: musician.meta.guid,
      Date: "2026-08-01",
      Status: "Unavailable",
      Notes: "Already booked for the headline show.",
    },
    musicianContext,
  );
  await runtime.create(
    "Availability",
    {
      User: guest.meta.guid,
      Date: "2026-08-03",
      Status: "Available",
      Notes: "Guest availability should not enter Casey's current-user dataset.",
    },
    { ...musicianContext, userId: guest.meta.guid },
  );

  const firstSong = await runtime.create(
    "Song",
    {
      Band: firstBand.meta.guid,
      Title: "Neon Map",
      Composer: "Casey Morgan",
      DurationSeconds: 214,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const secondSong = await runtime.create(
    "Song",
    {
      Band: firstBand.meta.guid,
      Title: "Late Signal",
      Composer: "The Alphas",
      DurationSeconds: 188,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const firstSetList = await runtime.create(
    "SetList",
    {
      Band: firstBand.meta.guid,
      Name: "August headline",
      Description: "Opening run for the Canal Street show.",
      CreatedBy: musician.meta.guid,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const firstSetListItem = await runtime.create(
    "SetListItem",
    {
      Band: firstBand.meta.guid,
      SetList: firstSetList.meta.guid,
      Song: firstSong.meta.guid,
      Position: 1,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "SetListItem",
    {
      Band: firstBand.meta.guid,
      SetList: firstSetList.meta.guid,
      Song: secondSong.meta.guid,
      Position: 2,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const invitation = await runtime.create(
    "BandInvitation",
    {
      Band: firstBand.meta.guid,
      Inviter: musician.meta.guid,
      Invitee: guest.meta.guid,
      InviteeEmail: "riley@example.com",
      SentAt: "2026-07-07",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "DevicePreference",
    {
      User: musician.meta.guid,
      SelectedBand: firstBand.meta.guid,
      LastOpenedView: "HomeDashboard",
      OfflineHomeLimit: 20,
    },
    musicianContext,
  );

  return {
    model,
    runtime,
    musicianContext,
    firstBandContext,
    secondBandContext,
    musician,
    guest,
    firstBand,
    secondBand,
    firstEvent,
    secondEvent,
    availability,
    firstSong,
    secondSong,
    firstSetList,
    firstSetListItem,
    invitation,
  };
}

export async function seedBandReferenceRuntimeIfEmpty(
  runtime: ApplicationRuntime,
  systemContext: RuntimeContext = bandReferenceSystemContext,
): Promise<{ musicianContext: RuntimeContext; seeded: boolean }> {
  const existing = await runtime.search(
    "User",
    { text: "casey@example.com", fields: ["Email"], limit: 1 },
    systemContext,
  );

  if (existing[0] !== undefined) {
    return {
      musicianContext: {
        userId: existing[0].meta.guid,
        roles: [],
        channel: "ui",
        now: getSeedNow(systemContext),
      },
      seeded: false,
    };
  }

  const seeded = await seedBandReferenceRuntime(runtime, systemContext);
  return {
    musicianContext: {
      ...seeded.musicianContext,
      channel: "ui",
    },
    seeded: true,
  };
}

export function contextForBand(context: RuntimeContext, bandId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: {
      ...(context.selectedContexts ?? {}),
      Band: bandId,
    },
  };
}

function createSystemAdminPolicy(object: string): PartialPolicyModel[] {
  return [
    {
      name: `${object}SystemAdminPolicy`,
      object,
      rules: [
        {
          name: `allowSystemAdminAll${object}Ops`,
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
      ],
    },
  ];
}

function createBandCollectionRules(object: string, label: string): PartialPolicyRuleModel[] {
  const rules: PartialPolicyRuleModel[] = [
    {
      name: `allowBandMemberSearch${label}`,
      effect: "allow",
      principal: { match: "specific", roles: ["BandMember"] },
      action: "search",
    },
    {
      name: `allowBandMemberRead${label}`,
      effect: "allow",
      principal: { match: "specific", roles: ["BandMember"] },
      action: "read",
    },
    {
      name: `allowBandAdminCreate${label}`,
      effect: "allow",
      principal: { match: "specific", roles: ["BandAdmin"] },
      action: "create",
    },
    {
      name: `allowBandAdminUpdate${label}`,
      effect: "allow",
      principal: { match: "specific", roles: ["BandAdmin"] },
      action: "update",
    },
    {
      name: `allowBandAdminDelete${label}`,
      effect: "allow",
      principal: { match: "specific", roles: ["BandAdmin"] },
      action: "delete",
    },
  ];

  return rules.map(
    (rule): PartialPolicyRuleModel =>
      object === "SetListItem" && rule.action === "create"
        ? { ...rule, name: `allowBandAdminCreate${label}WithPosition` }
        : rule,
  );
}

function fieldEqualsRuntimeUser(field: string): PartialPolicyConditionModel {
  return {
    kind: "equals",
    left: { kind: "field", field },
    right: { kind: "runtime", property: "userId" },
  };
}

function fieldEqualsLiteral(field: string, value: JsonValue): PartialPolicyConditionModel {
  return {
    kind: "equals",
    left: { kind: "field", field },
    right: { kind: "literal", value },
  };
}

function allConditions(conditions: PartialPolicyConditionModel[]): PartialPolicyConditionModel {
  return {
    kind: "all",
    conditions,
  };
}

function commandLiteral(value: JsonValue): ResolvedCommandValueExpression {
  return {
    kind: "literal",
    value,
  };
}

function commandInput(name: string): ResolvedCommandValueExpression {
  return {
    kind: "input",
    name,
  };
}

function commandRuntime(property: "userId" | "nowIso" | "today"): ResolvedCommandValueExpression {
  return {
    kind: "runtime",
    property,
  };
}

function commandStepField(step: string, field: string): ResolvedCommandValueExpression {
  return {
    kind: "stepField",
    step,
    field,
  };
}

function getSeedNow(context: RuntimeContext): Date {
  return context.now ?? bandReferenceSystemContext.now ?? new Date("2026-07-07T08:00:00.000Z");
}
