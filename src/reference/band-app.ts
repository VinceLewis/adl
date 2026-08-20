import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import { IndexedDbObjectStorageBackend } from "../runtime/indexeddb-object-storage.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import giggleBandManifestSource from "./giggle-band/app.yaml?raw";
import giggleBandDomainSource from "./giggle-band/domain.adlj?raw";
import giggleBandUiSource from "./giggle-band/ui.adlj?raw";
import type { ReferenceDemoDefinition, ReferenceDemoSeedOutcome } from "./reference-demo.js";
import type { CompileAdlProjectV2Result } from "../compiler/compile-adl-project-v2.js";
import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";

export const bandReferenceSystemContext: RuntimeContext = {
  userId: "band-reference-system",
  roles: ["SystemAdmin"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

let bandReferenceCompileResultPromise: Promise<CompileAdlProjectV2Result> | undefined;

/**
 * Lazily compiles `.adlj` behind a dynamic `import()`, not a static one, and
 * memoizes the result. `compile-adl-project-v2.js` (needed for `.adlj`
 * sources) pulls in `ajv` and the generated `adlj-schema.json` (~3600
 * lines); a *static* import here would put both back in the real browser
 * bundle on every page load, regardless of which `?demo=` is selected, since
 * this module is unconditionally imported by `reference-demos.js` ->
 * `main.ts`. That is exactly the regression this function exists to avoid —
 * see `src/index.ts`'s barrel comment and
 * `learnings/implementation/adlj-json-authoring-surface.md` for the fuller
 * history of this bundle-size trap. Mirrors `jointly-app.ts`'s
 * `compileJointlyReference()` exactly, now that Giggle Band is genuinely
 * `.adlj`-sourced too.
 */
async function compileBandReference(): Promise<CompileAdlProjectV2Result> {
  if (bandReferenceCompileResultPromise === undefined) {
    bandReferenceCompileResultPromise = (async () => {
      const { compileAdlProjectV2 } = await import("../compiler/compile-adl-project-v2.js");
      const result = compileAdlProjectV2({
        manifestSource: giggleBandManifestSource,
        sources: {
          "domain.adlj": giggleBandDomainSource,
          "ui.adlj": giggleBandUiSource,
        },
      });

      if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new Error(`Giggle Band ADL source is invalid: ${JSON.stringify(result.diagnostics)}`);
      }

      return result;
    })();
  }

  return bandReferenceCompileResultPromise;
}

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
  crossBandAvailability: StoredObjectRecord;
  conflictAvailability: StoredObjectRecord;
  firstSong: StoredObjectRecord;
  secondSong: StoredObjectRecord;
  thirdSong: StoredObjectRecord;
  fourthSong: StoredObjectRecord;
  firstSetList: StoredObjectRecord;
  secondSetList: StoredObjectRecord;
  firstSetListItem: StoredObjectRecord;
  firstEventSetList: StoredObjectRecord;
  invitation: StoredObjectRecord;
}

export async function createBandReferenceModel(): Promise<ResolvedApplicationModel> {
  const { partialModel } = await compileBandReference();
  return resolveApplicationModel(partialModel);
}

export async function createGiggleBandExampleModel(): Promise<ResolvedApplicationModel> {
  const model = await createBandReferenceModel();
  return {
    ...model,
    app: {
      ...model.app,
      name: "Giggle Band ADL Example",
    },
  };
}

export async function createBandReferenceRuntime(
  storage?: ObjectStorageBackend,
): Promise<ApplicationRuntime> {
  const model = await createBandReferenceModel();
  return new ApplicationRuntime(model, {
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
      Facebook: "https://facebook.com/thealphasband",
      Instagram: "https://instagram.com/thealphasband",
      YouTube: "https://youtube.com/@thealphasband",
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
      ContactName: "Jordan Blake",
      ContactPhone: "+44 20 7946 0958",
      ContactEmail: "jordan@alphahall.example.com",
      Amount: 450,
      PaymentMethod: "Bank Transfer",
      Agent: "Riverside Bookings",
      CreatedBy: musician.meta.guid,
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
      CreatedBy: musician.meta.guid,
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
      Date: "2026-08-03",
      Status: "Unavailable",
      Notes: "Unavailable - session prep",
    },
    musicianContext,
  );
  // Same date as `secondEvent` (the Betas rehearsal): Casey marked themselves
  // free before that gig existed. `BandMemberAvailabilityBoard`'s cross-band
  // overlay is what makes the clash visible from the Alphas' own board — the
  // gig-derived status outranks this one on 2026-08-02.
  const crossBandAvailability = await runtime.create(
    "Availability",
    {
      User: musician.meta.guid,
      Date: "2026-08-02",
      Status: "Available",
      Notes: "Thought this evening was free.",
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
  // Same date as `firstEvent` (the Alphas' Canal Street headline gig): Casey
  // is genuinely double-booked -- a real conflict, not merely a coincidence,
  // because `firstEvent.EventType` is `Gig` and this record's own `Status` is
  // `Unavailable`. `EventAvailabilityConflicts` (`domain.adlj`) is what turns
  // this pair into a fact `BandEventCalendar`'s `conflict` status can render;
  // see that read model's own comment for why a plain union could never see
  // it, and `learnings/implementation/reference-app-models.md` for the fuller
  // account of both fixes this seed record exercises.
  const conflictAvailability = await runtime.create(
    "Availability",
    {
      User: musician.meta.guid,
      Date: "2026-08-01",
      Status: "Unavailable",
      Notes: "Forgot I already booked this date.",
    },
    musicianContext,
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
  const thirdSong = await runtime.create(
    "Song",
    {
      Band: firstBand.meta.guid,
      Title: "Harbour Lights",
      Composer: "Casey Morgan",
      DurationSeconds: 236,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const fourthSong = await runtime.create(
    "Song",
    {
      Band: firstBand.meta.guid,
      Title: "Slow Tide",
      Composer: "The Alphas",
      DurationSeconds: 245,
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
  // The set-list child collection on `SetListForm` is the surface Phase 59 makes
  // declarable, so the demo has to seed enough songs for reordering to mean
  // something: one row cannot be moved anywhere.
  //
  // A set-list item is not a bare link to a song, so the seed does not present
  // one. `Arrangement`, `Encore` and `RehearsedOn` are what make the inline row
  // editor exercise the real field renderer — an enum, a boolean and a date —
  // and the demo and the screenshots only show that if the seeded rows carry
  // values a person would recognise. The second item is deliberately left on its
  // defaults so the unset case is on screen beside the set ones.
  const firstSetListItem = await runtime.create(
    "SetListItem",
    {
      Band: firstBand.meta.guid,
      SetList: firstSetList.meta.guid,
      Song: firstSong.meta.guid,
      Position: 1,
      Arrangement: "Acoustic",
      RehearsedOn: "2026-07-05",
      Notes: "Opens on the acoustic guitar.",
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
  await runtime.create(
    "SetListItem",
    {
      Band: firstBand.meta.guid,
      SetList: firstSetList.meta.guid,
      Song: thirdSong.meta.guid,
      Position: 3,
      Arrangement: "Instrumental",
      Encore: true,
      RehearsedOn: "2026-07-06",
      Notes: "Closes the night as the encore.",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  // A second set list in the same band, so the child collection's relationship
  // picker has a candidate: `linkExisting` moves an existing item to this
  // parent, and with only one set list every candidate is already linked.
  const secondSetList = await runtime.create(
    "SetList",
    {
      Band: firstBand.meta.guid,
      Name: "Rehearsal running order",
      Description: "Working order for the Beta Rooms rehearsal.",
      CreatedBy: musician.meta.guid,
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "SetListItem",
    {
      Band: firstBand.meta.guid,
      SetList: secondSetList.meta.guid,
      Song: fourthSong.meta.guid,
      Position: 1,
      RehearsedOn: "2026-07-03",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  // The gig ↔ set-list link, seeded as the two-set night giggle-new's own data
  // shows is the common case: an opening set and a second set, in order. Both
  // are created after `firstEvent` because neither set list existed when the
  // event was, and `EventSetList` is what `BandEventForm`'s `Set Lists` child
  // collection edits.
  const firstEventSetList = await runtime.create(
    "EventSetList",
    {
      Band: firstBand.meta.guid,
      Event: firstEvent.meta.guid,
      SetList: firstSetList.meta.guid,
      Position: 1,
      Notes: "Opening set.",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "EventSetList",
    {
      Band: firstBand.meta.guid,
      Event: firstEvent.meta.guid,
      SetList: secondSetList.meta.guid,
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
      Status: "Accepted",
      SentAt: "2026-07-07",
      RespondedAt: "2026-07-08",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "DevicePreference",
    {
      User: musician.meta.guid,
      SelectedBand: firstBand.meta.guid,
      LastOpenedView: "HomeDashboard",
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
    crossBandAvailability,
    conflictAvailability,
    firstSong,
    secondSong,
    thirdSong,
    fourthSong,
    firstSetList,
    secondSetList,
    firstSetListItem,
    firstEventSetList,
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
    const musicianContext: RuntimeContext = {
      userId: existing[0].meta.guid,
      roles: [],
      channel: "ui",
      now: getSeedNow(systemContext),
    };
    await migratePersistedBandReferenceDemo(runtime, musicianContext, systemContext);
    return {
      musicianContext,
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

async function migratePersistedBandReferenceDemo(
  runtime: ApplicationRuntime,
  musicianContext: RuntimeContext,
  systemContext: RuntimeContext,
): Promise<void> {
  const availableBands = await runtime.listAvailableContexts("Band", musicianContext);
  for (const band of availableBands) {
    const bandSystemContext = contextForBand(systemContext, band.id);
    const staleEvents = await runtime.search(
      "Event",
      { text: "Unavailable - session prep", fields: ["Title"] },
      bandSystemContext,
    );
    for (const event of staleEvents) {
      await runtime.delete("Event", event.meta.guid, bandSystemContext);
    }
  }

  const availabilityRecords = await runtime.search("Availability", undefined, musicianContext);
  for (const availabilityRecord of availabilityRecords.filter(
    (record) => record.values.Notes === "Already booked for the headline show.",
  )) {
    await runtime.delete("Availability", availabilityRecord.meta.guid, musicianContext);
  }

  if (
    !availabilityRecords.some(
      (record) =>
        record.values.Date === "2026-08-03" &&
        record.values.Status === "Unavailable" &&
        record.values.Notes === "Unavailable - session prep",
    )
  ) {
    await runtime.create(
      "Availability",
      {
        User: musicianContext.userId,
        Date: "2026-08-03",
        Status: "Unavailable",
        Notes: "Unavailable - session prep",
      },
      musicianContext,
    );
  }

  // Backfills the genuine gig/unavailability conflict onto any install that
  // seeded before this record existed, so the fix stays demonstrable on an
  // upgraded device too, not only a fresh one.
  if (
    !availabilityRecords.some(
      (record) =>
        record.values.Date === "2026-08-01" &&
        record.values.Status === "Unavailable" &&
        record.values.Notes === "Forgot I already booked this date.",
    )
  ) {
    await runtime.create(
      "Availability",
      {
        User: musicianContext.userId,
        Date: "2026-08-01",
        Status: "Unavailable",
        Notes: "Forgot I already booked this date.",
      },
      musicianContext,
    );
  }
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

function getSeedNow(context: RuntimeContext): Date {
  return context.now ?? bandReferenceSystemContext.now ?? new Date("2026-07-07T08:00:00.000Z");
}

export const BAND_REFERENCE_DATABASE_NAME = "adl-band-reference-demo";
export const GIGGLE_BAND_EXAMPLE_DATABASE_NAME = "adl-giggle-band-example";

/**
 * No default parameter, unlike this function's own pre-`.adlj` shape:
 * `createBandReferenceModel()` is now async (it awaits the dynamic import
 * behind `compileBandReference()`), so it cannot live in a default-parameter
 * position — callers who want that convenience call
 * `await createBandReferenceModel()` explicitly. The demo-mount path
 * (`src/ui/main.ts`) already always supplies `model` explicitly, matching
 * `ReferenceDemoDefinition.createPersistentRuntime`'s contract. Mirrors
 * `jointly-app.ts`'s `createPersistentJointlyReferenceRuntime`.
 */
export function createPersistentBandReferenceRuntime(
  model: ResolvedApplicationModel,
): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({
      databaseName: BAND_REFERENCE_DATABASE_NAME,
    }),
  });
}

export function createPersistentGiggleBandExampleRuntime(
  model: ResolvedApplicationModel,
): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({
      databaseName: GIGGLE_BAND_EXAMPLE_DATABASE_NAME,
    }),
  });
}

async function seedBandReferenceDemo(
  runtime: ApplicationRuntime,
): Promise<ReferenceDemoSeedOutcome> {
  const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);
  return { context: seeded.musicianContext, seeded: seeded.seeded };
}

/**
 * `band` and `giggle-band` are two demo ids over the identical seeded schema:
 * `createGiggleBandExampleModel` only renames `app.name` on top of
 * `createBandReferenceModel`'s model (see above), so both definitions
 * deliberately share the same seed function. That sharing is a fact about
 * these two apps' content, decided here by the apps themselves — not a
 * default any generic dispatch code assumes.
 */
export const bandReferenceDemo: ReferenceDemoDefinition = {
  id: "band",
  createModel: createBandReferenceModel,
  databaseName: BAND_REFERENCE_DATABASE_NAME,
  createPersistentRuntime: createPersistentBandReferenceRuntime,
  seedIfEmpty: seedBandReferenceDemo,
  iconUrl: "/giggle-band-icon.svg",
};

export const giggleBandExampleDemo: ReferenceDemoDefinition = {
  id: "giggle-band",
  createModel: createGiggleBandExampleModel,
  databaseName: GIGGLE_BAND_EXAMPLE_DATABASE_NAME,
  createPersistentRuntime: createPersistentGiggleBandExampleRuntime,
  seedIfEmpty: seedBandReferenceDemo,
  iconUrl: "/giggle-band-icon.svg",
};
