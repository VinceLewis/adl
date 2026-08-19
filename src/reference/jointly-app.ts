import { compileAdlProject } from "../compiler/compile-adl-project.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import jointlyCareManifestSource from "./jointly-care/app.yaml?raw";
import jointlyCareDomainSource from "./jointly-care/domain.adl?raw";
import jointlyCareUiSource from "./jointly-care/ui.adl?raw";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";

export const jointlyReferenceSystemContext: RuntimeContext = {
  userId: "jointly-reference-system",
  roles: ["SystemAdmin"],
  channel: "api",
  now: new Date("2026-08-15T09:00:00.000Z"),
};

const jointlyReferenceCompileResult = compileAdlProject({
  manifestSource: jointlyCareManifestSource,
  sources: {
    "domain.adl": jointlyCareDomainSource,
    "ui.adl": jointlyCareUiSource,
  },
});

if (
  jointlyReferenceCompileResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")
) {
  throw new Error(
    `Jointly Care ADL source is invalid: ${JSON.stringify(jointlyReferenceCompileResult.diagnostics)}`,
  );
}

export const jointlyReferenceAdlSource = jointlyReferenceCompileResult.source;
export const jointlyReferenceAppManifest = jointlyReferenceCompileResult.manifest;
export const jointlyReferencePartialModel: PartialApplicationModel =
  jointlyReferenceCompileResult.partialModel;

export interface JointlyReferenceSeed {
  model: ResolvedApplicationModel;
  runtime: ApplicationRuntime;
  carerContext: RuntimeContext;
  coCarerContext: RuntimeContext;
  inviteeContext: RuntimeContext;
  firstCircleContext: RuntimeContext;
  secondCircleContext: RuntimeContext;
  carer: StoredObjectRecord;
  coCarer: StoredObjectRecord;
  invitee: StoredObjectRecord;
  firstCircle: StoredObjectRecord;
  secondCircle: StoredObjectRecord;
  firstEvent: StoredObjectRecord;
  secondEvent: StoredObjectRecord;
  firstNote: StoredObjectRecord;
  firstMessage: StoredObjectRecord;
  secondMessage: StoredObjectRecord;
  firstReminder: StoredObjectRecord;
  acceptedInvite: StoredObjectRecord;
  pendingInvite: StoredObjectRecord;
}

export function createJointlyReferenceModel(): ResolvedApplicationModel {
  return resolveApplicationModel(jointlyReferencePartialModel);
}

export function createJointlyReferenceRuntime(storage?: ObjectStorageBackend): ApplicationRuntime {
  return new ApplicationRuntime(createJointlyReferenceModel(), {
    ...(storage === undefined ? {} : { storage }),
  });
}

/**
 * Seeds two carers coordinating across two overlapping circles, plus a third
 * user who has been invited to the first circle but has not yet joined it --
 * the scenario `pendingCircleInvite` (`domain.adl`) and `MyPendingInvites`
 * (`ui.adl`) exist to prove. Mirrors `seedBandReferenceRuntime`'s shape:
 * one "founder" identity that belongs to both business contexts, so
 * cross-context reads (`HomeUpcomingEvents`, `MyPendingCircleInvites`) have
 * more than one row to tell apart.
 */
export async function seedJointlyReferenceRuntime(
  runtime: ApplicationRuntime,
  systemContext: RuntimeContext = jointlyReferenceSystemContext,
): Promise<JointlyReferenceSeed> {
  const carer = await runtime.create(
    "User",
    { Email: "jordan@example.com", DisplayName: "Jordan Casey", Timezone: "Europe/London" },
    systemContext,
  );
  const coCarer = await runtime.create(
    "User",
    { Email: "sam@example.com", DisplayName: "Sam Rivera", Timezone: "Europe/London" },
    systemContext,
  );
  const invitee = await runtime.create(
    "User",
    { Email: "alex@example.com", DisplayName: "Alex Kim", Timezone: "Europe/London" },
    systemContext,
  );

  const firstCircle = await runtime.create(
    "Circle",
    {
      Name: "Mum's Care Circle",
      Description: "Coordinating care visits, appointments and medication for Mum.",
      Owner: carer.meta.guid,
    },
    systemContext,
  );
  const secondCircle = await runtime.create(
    "Circle",
    {
      Name: "Dad's Care Circle",
      Description: "Shared calendar and notes for Dad's recovery.",
      Owner: carer.meta.guid,
    },
    systemContext,
  );

  await runtime.create(
    "CircleMember",
    {
      Circle: firstCircle.meta.guid,
      User: carer.meta.guid,
      Role: "CircleOwner",
      JoinedAt: "2026-06-01",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );
  await runtime.create(
    "CircleMember",
    {
      Circle: firstCircle.meta.guid,
      User: coCarer.meta.guid,
      Role: "CircleMember",
      JoinedAt: "2026-06-03",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );
  await runtime.create(
    "CircleMember",
    {
      Circle: secondCircle.meta.guid,
      User: carer.meta.guid,
      Role: "CircleOwner",
      JoinedAt: "2026-06-10",
    },
    contextForCircle(systemContext, secondCircle.meta.guid),
  );

  const carerContext: RuntimeContext = {
    userId: carer.meta.guid,
    roles: [],
    channel: "api",
    now: getSeedNow(systemContext),
  };
  const coCarerContext: RuntimeContext = {
    userId: coCarer.meta.guid,
    roles: [],
    channel: "api",
    now: getSeedNow(systemContext),
  };
  const inviteeContext: RuntimeContext = {
    userId: invitee.meta.guid,
    roles: [],
    channel: "api",
    now: getSeedNow(systemContext),
  };
  const firstCircleContext = await runtime.withSelectedContext(
    "Circle",
    firstCircle.meta.guid,
    carerContext,
  );
  const secondCircleContext = await runtime.withSelectedContext(
    "Circle",
    secondCircle.meta.guid,
    carerContext,
  );

  const firstEvent = await runtime.create(
    "Event",
    {
      Circle: firstCircle.meta.guid,
      CreatedBy: carer.meta.guid,
      Title: "GP appointment",
      Description: "Routine check-up with Dr Okafor.",
      Location: "Riverside Surgery",
      StartsAt: "2026-08-20T09:30:00.000Z",
      EndsAt: "2026-08-20T10:00:00.000Z",
      AllDay: false,
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );
  // Same week as `firstEvent`, but on the second circle -- what
  // `HomeUpcomingEvents` (SCOPE allAvailableContexts) exists to bring
  // together in one cross-circle feed for a carer who is in both circles.
  const secondEvent = await runtime.create(
    "Event",
    {
      Circle: secondCircle.meta.guid,
      CreatedBy: carer.meta.guid,
      Title: "Physio session",
      Location: "Home visit",
      StartsAt: "2026-08-21T14:00:00.000Z",
      EndsAt: "2026-08-21T15:00:00.000Z",
      AllDay: false,
    },
    contextForCircle(systemContext, secondCircle.meta.guid),
  );

  const firstNote = await runtime.create(
    "Note",
    {
      Circle: firstCircle.meta.guid,
      CreatedBy: coCarer.meta.guid,
      Title: "Medication changes",
      Body: "Evening dose of the blood-pressure tablet moved to 6pm from Monday.",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );

  const firstMessage = await runtime.create(
    "Message",
    {
      Circle: firstCircle.meta.guid,
      SentBy: carer.meta.guid,
      Body: "Booked the GP appointment for Thursday morning, I'll take her.",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );
  const secondMessage = await runtime.create(
    "Message",
    {
      Circle: firstCircle.meta.guid,
      SentBy: coCarer.meta.guid,
      Body: "Thanks -- I'll pick up the prescription on my way over.",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );

  const firstReminder = await runtime.create(
    "Reminder",
    {
      Circle: firstCircle.meta.guid,
      Event: firstEvent.meta.guid,
      CreatedBy: carer.meta.guid,
      Title: "Pick up prescription before the GP visit",
      RemindAt: "2026-08-20T08:00:00.000Z",
      Delivered: false,
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );

  const acceptedInvite = await runtime.create(
    "CircleInvite",
    {
      Circle: firstCircle.meta.guid,
      InvitedBy: carer.meta.guid,
      Invitee: coCarer.meta.guid,
      InviteeEmail: "sam@example.com",
      Status: "accepted",
      SentAt: "2026-06-02",
      RespondedAt: "2026-06-03",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );
  // Alex has an account but is not yet a member of either circle -- only
  // `pendingCircleInvite` (`domain.adl`) gives them access to `firstCircle`
  // at all, and only for as long as this invite stays `'pending'`.
  const pendingInvite = await runtime.create(
    "CircleInvite",
    {
      Circle: firstCircle.meta.guid,
      InvitedBy: carer.meta.guid,
      Invitee: invitee.meta.guid,
      InviteeEmail: "alex@example.com",
      Status: "pending",
      SentAt: "2026-08-14",
    },
    contextForCircle(systemContext, firstCircle.meta.guid),
  );

  return {
    model: runtime.model,
    runtime,
    carerContext,
    coCarerContext,
    inviteeContext,
    firstCircleContext,
    secondCircleContext,
    carer,
    coCarer,
    invitee,
    firstCircle,
    secondCircle,
    firstEvent,
    secondEvent,
    firstNote,
    firstMessage,
    secondMessage,
    firstReminder,
    acceptedInvite,
    pendingInvite,
  };
}

export async function seedJointlyReferenceRuntimeIfEmpty(
  runtime: ApplicationRuntime,
  systemContext: RuntimeContext = jointlyReferenceSystemContext,
): Promise<{ carerContext: RuntimeContext; seeded: boolean }> {
  const existing = await runtime.search(
    "User",
    { text: "jordan@example.com", fields: ["Email"], limit: 1 },
    systemContext,
  );

  if (existing[0] !== undefined) {
    return {
      carerContext: {
        userId: existing[0].meta.guid,
        roles: [],
        channel: "ui",
        now: getSeedNow(systemContext),
      },
      seeded: false,
    };
  }

  const seeded = await seedJointlyReferenceRuntime(runtime, systemContext);
  return {
    carerContext: { ...seeded.carerContext, channel: "ui" },
    seeded: true,
  };
}

export function contextForCircle(context: RuntimeContext, circleId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: {
      ...(context.selectedContexts ?? {}),
      Circle: circleId,
    },
  };
}

function getSeedNow(context: RuntimeContext): Date {
  return context.now ?? jointlyReferenceSystemContext.now ?? new Date("2026-08-15T09:00:00.000Z");
}
