import { compileAdlProject } from "../compiler/compile-adl-project.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import giggleBandManifestSource from "./giggle-band/app.yaml?raw";
import giggleBandDomainSource from "./giggle-band/domain.adl?raw";
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
  firstSong: StoredObjectRecord;
  secondSong: StoredObjectRecord;
  firstSetList: StoredObjectRecord;
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

function getSeedNow(context: RuntimeContext): Date {
  return context.now ?? bandReferenceSystemContext.now ?? new Date("2026-07-07T08:00:00.000Z");
}
