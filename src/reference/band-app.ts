import { compileAdlProject } from "../compiler/compile-adl-project.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import { IndexedDbObjectStorageBackend } from "../runtime/indexeddb-object-storage.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import giggleBandManifestSource from "./giggle-band/app.yaml?raw";
import giggleBandDomainSource from "./giggle-band/domain.adl?raw";
import giggleBandUiSource from "./giggle-band/ui.adl?raw";
import type { ReferenceDemoDefinition, ReferenceDemoSeedOutcome } from "./reference-demo.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";

export const bandReferenceSystemContext: RuntimeContext = {
  userId: "band-reference-system",
  roles: ["SystemAdmin"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const bandReferenceCompileResult = compileAdlProject({
  manifestSource: giggleBandManifestSource,
  sources: {
    "domain.adl": giggleBandDomainSource,
    "ui.adl": giggleBandUiSource,
  },
});

if (bandReferenceCompileResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  throw new Error(
    `Giggle Band ADL source is invalid: ${JSON.stringify(bandReferenceCompileResult.diagnostics)}`,
  );
}

export const bandReferenceAdlSource = bandReferenceCompileResult.source;
export const bandReferenceAppManifest = bandReferenceCompileResult.manifest;
export const bandReferencePartialModel: PartialApplicationModel =
  bandReferenceCompileResult.partialModel;

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
  firstSong: StoredObjectRecord;
  secondSong: StoredObjectRecord;
  thirdSong: StoredObjectRecord;
  fourthSong: StoredObjectRecord;
  firstSetList: StoredObjectRecord;
  secondSetList: StoredObjectRecord;
  firstSetListItem: StoredObjectRecord;
  invitation: StoredObjectRecord;
}

export function createBandReferenceModel(): ResolvedApplicationModel {
  return resolveApplicationModel(bandReferencePartialModel);
}

export function createGiggleBandExampleModel(): ResolvedApplicationModel {
  const model = createBandReferenceModel();
  return {
    ...model,
    app: {
      ...model.app,
      name: "Giggle Band ADL Example",
    },
  };
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
  // The gig ↔ set-list link: `firstSetList` did not exist yet when `firstEvent`
  // was created, so this is an update rather than a value at create time.
  await runtime.update(
    "Event",
    firstEvent.meta.guid,
    { SetList: firstSetList.meta.guid },
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
    firstSong,
    secondSong,
    thirdSong,
    fourthSong,
    firstSetList,
    secondSetList,
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

export function createPersistentBandReferenceRuntime(
  model: ResolvedApplicationModel = createBandReferenceModel(),
): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({
      databaseName: BAND_REFERENCE_DATABASE_NAME,
    }),
  });
}

export function createPersistentGiggleBandExampleRuntime(
  model: ResolvedApplicationModel = createGiggleBandExampleModel(),
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
};

export const giggleBandExampleDemo: ReferenceDemoDefinition = {
  id: "giggle-band",
  createModel: createGiggleBandExampleModel,
  databaseName: GIGGLE_BAND_EXAMPLE_DATABASE_NAME,
  createPersistentRuntime: createPersistentGiggleBandExampleRuntime,
  seedIfEmpty: seedBandReferenceDemo,
};
