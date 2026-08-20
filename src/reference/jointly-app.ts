import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import { IndexedDbObjectStorageBackend } from "../runtime/indexeddb-object-storage.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import jointlyCareManifestSource from "./jointly-care/app.yaml?raw";
import jointlyCareDomainSource from "./jointly-care/domain.adlj?raw";
import jointlyCareUiSource from "./jointly-care/ui.adlj?raw";
import type { ReferenceDemoDefinition, ReferenceDemoSeedOutcome } from "./reference-demo.js";
import type { CompileAdlProjectV2Result } from "../compiler/compile-adl-project-v2.js";
import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";

export const jointlyReferenceSystemContext: RuntimeContext = {
  userId: "jointly-reference-system",
  roles: ["SystemAdmin"],
  channel: "api",
  now: new Date("2026-08-15T09:00:00.000Z"),
};

let jointlyReferenceCompileResultPromise: Promise<CompileAdlProjectV2Result> | undefined;

/**
 * Lazily compiles `.adlj` behind a dynamic `import()`, not a static one, and
 * memoizes the result. `compile-adl-project-v2.js` (needed for `.adlj`
 * sources) pulls in `ajv` and the generated `adlj-schema.json` (~3600 lines);
 * a *static* import here would put both back in the real browser bundle on
 * every page load, regardless of which `?demo=` is selected, since this
 * module is unconditionally imported by `reference-demos.js` -> `main.ts`.
 * That is exactly the regression this function exists to avoid — see
 * `src/index.ts`'s barrel comment and
 * `learnings/implementation/adlj-json-authoring-surface.md` for the fuller
 * history of this bundle-size trap. Unlike those earlier cases, this one is
 * not a dead code path being accidentally reached: Jointly Care's demo
 * genuinely needs `.adlj` compilation, so the fix is deferring *when* the
 * cost is paid (lazily, only for this demo), not avoiding the import
 * entirely.
 */
async function compileJointlyReference(): Promise<CompileAdlProjectV2Result> {
  if (jointlyReferenceCompileResultPromise === undefined) {
    jointlyReferenceCompileResultPromise = (async () => {
      const { compileAdlProjectV2 } = await import("../compiler/compile-adl-project-v2.js");
      const result = compileAdlProjectV2({
        manifestSource: jointlyCareManifestSource,
        sources: {
          "domain.adlj": jointlyCareDomainSource,
          "ui.adlj": jointlyCareUiSource,
        },
      });

      if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new Error(
          `Jointly Care ADL source is invalid: ${JSON.stringify(result.diagnostics)}`,
        );
      }

      return result;
    })();
  }

  return jointlyReferenceCompileResultPromise;
}

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

export async function createJointlyReferenceModel(): Promise<ResolvedApplicationModel> {
  const { partialModel } = await compileJointlyReference();
  return resolveApplicationModel(partialModel);
}

export async function createJointlyReferenceRuntime(
  storage?: ObjectStorageBackend,
): Promise<ApplicationRuntime> {
  const model = await createJointlyReferenceModel();
  return new ApplicationRuntime(model, {
    ...(storage === undefined ? {} : { storage }),
  });
}

/**
 * Seeds two carers coordinating across two overlapping circles, plus a third
 * user who has been invited to the first circle but has not yet joined it --
 * the scenario `pendingCircleInvite` (`domain.adlj`) and `MyPendingInvites`
 * (`ui.adlj`) exist to prove. Mirrors `seedBandReferenceRuntime`'s shape:
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
  // `pendingCircleInvite` (`domain.adlj`) gives them access to `firstCircle`
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

export const JOINTLY_CARE_EXAMPLE_DATABASE_NAME = "adl-jointly-care-example";

/**
 * No default parameter, unlike `band-app.ts`'s equivalents: their default
 * (`= createXModel()`) can be synchronous because plain `.adl` text has
 * nothing to dynamically import. `createJointlyReferenceModel()` is async, so
 * it cannot live in a default-parameter position — callers who want that
 * convenience call `await createJointlyReferenceModel()` explicitly. The
 * demo-mount path (`src/ui/main.ts`) already always supplies `model`
 * explicitly, matching `ReferenceDemoDefinition.createPersistentRuntime`'s
 * contract.
 */
export function createPersistentJointlyReferenceRuntime(
  model: ResolvedApplicationModel,
): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({
      databaseName: JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    }),
  });
}

async function seedJointlyReferenceDemo(
  runtime: ApplicationRuntime,
): Promise<ReferenceDemoSeedOutcome> {
  const seeded = await seedJointlyReferenceRuntimeIfEmpty(runtime);
  return { context: seeded.carerContext, seeded: seeded.seeded };
}

export const jointlyReferenceDemo: ReferenceDemoDefinition = {
  id: "jointly-care",
  createModel: createJointlyReferenceModel,
  databaseName: JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
  createPersistentRuntime: createPersistentJointlyReferenceRuntime,
  seedIfEmpty: seedJointlyReferenceDemo,
};
