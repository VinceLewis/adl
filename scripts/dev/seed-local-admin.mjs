#!/usr/bin/env node
/**
 * Seeds the first administrator, a business context, and one invitation into a
 * LOCAL development database, then prints the invite token.
 *
 * Why this has to exist: registration is never anonymous. A passkey ceremony
 * needs either a live session or a valid invite, so a brand-new database has no
 * way to admit its first identity through the product surface — the runbook
 * calls this out as a documented gap and gives an operator raw SQL for it
 * (`docs/operations/authority-production-runbook.md`, "First admin: there is no
 * bootstrap flow"). This script performs that same out-of-band step through the
 * repository's own server modules instead of hand-written INSERTs, so the
 * records it writes are the shape the model actually validates.
 *
 * It is developer tooling, and deliberately not a route: nothing here is
 * reachable over HTTP, and the authority gains no anonymous registration path.
 * Do not point it at a real deployment.
 *
 * Run `npm run build:authority` first (`npm run dev:seed` does), start the
 * authority once so the application model row exists, then run this.
 *
 * Reads the same environment as the server: ADL_DATABASE_URL,
 * ADL_APPLICATION_ID, ADL_MODEL_PATH.
 */
import pg from "pg";
import { ApplicationRuntime } from "../../dist-server/src/runtime/application-runtime.js";
import { loadAuthorityModel } from "../../dist-server/src/server/authority-entrypoint.js";
import {
  AuthorityAccessLifecycleService,
  PostgresAuthorityAccessStore,
} from "../../dist-server/src/server/access-lifecycle.js";
import {
  ContextMembershipDescriptors,
  ContextMembershipProjectionWriter,
} from "../../dist-server/src/server/authority-membership-projection.js";
import {
  OpaqueSessionAdapter,
  PostgresAuthorityIdentitySessionStore,
} from "../../dist-server/src/server/opaque-session-adapter.js";
import { PostgresObjectStorageBackend } from "../../dist-server/src/server/postgres-object-storage.js";

const databaseUrl = required("ADL_DATABASE_URL");
const applicationId = required("ADL_APPLICATION_ID");
const modelPath = required("ADL_MODEL_PATH");

const CONTEXT_OBJECT = process.env.ADL_DEV_SEED_CONTEXT_OBJECT ?? "Band";
const MEMBERSHIP_OBJECT = process.env.ADL_DEV_SEED_MEMBERSHIP_OBJECT ?? "BandMember";
const CONTEXT_NAME = process.env.ADL_DEV_SEED_CONTEXT_NAME ?? "Band";
const ADMIN_ROLE = process.env.ADL_DEV_SEED_ADMIN_ROLE ?? "BandAdmin";
const INVITE_ROLE = process.env.ADL_DEV_SEED_INVITE_ROLE ?? "BandMember";
const CONTEXT_TITLE = process.env.ADL_DEV_SEED_CONTEXT_TITLE ?? "Local Development Band";

const model = loadAuthorityModel(modelPath);
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(pool, applicationId),
    { sessionTtlMs: 60 * 60 * 1000 },
  );
  const storage = new PostgresObjectStorageBackend(pool, applicationId, model);

  // The application model row is written by the authority at startup, and every
  // accepted record references it. Fail with the reason rather than a foreign
  // key violation nobody can read.
  if ((await storage.readApplicationMetadata()) === null)
    fail("No application model row yet. Start the authority once (npm run start:authority) first.");

  // Idempotent: the link table returns the existing identity for a known
  // (provider, subject) pair, so re-running this never mints a second user.
  const admin = await sessions.provisionIdentity("seed", "local-development-admin");

  const runtime = new ApplicationRuntime(model, { storage });
  const operator = { userId: admin.userId, roles: ["SystemAdmin"], channel: "ui" };

  let contextId = await existingContextId(admin.userId);
  if (contextId === undefined) {
    const context = await runtime.create(CONTEXT_OBJECT, { Name: CONTEXT_TITLE }, operator);
    contextId = context.meta.guid;
    await runtime.create(
      MEMBERSHIP_OBJECT,
      { User: admin.userId, [CONTEXT_OBJECT]: contextId, Role: ADMIN_ROLE },
      { ...operator, selectedContexts: { [CONTEXT_NAME]: contextId } },
    );
  }

  // Records written straight to storage bypass the authority's unit of work, so
  // the derived membership projection would not see them until the next
  // authority restart rebuilt it. Rebuild it here, exactly as startup does: it
  // derives everything from accepted records, so it can neither invent nor drop
  // a membership.
  await rebuildMembershipProjection();

  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new PostgresAuthorityAccessStore(pool, applicationId, model),
  );
  const adminSession = await sessions.issueSession(admin.userId);
  const invite = await accessLifecycle.createInvite(adminSession.sessionToken, {
    contextName: CONTEXT_NAME,
    contextId,
    role: INVITE_ROLE,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  console.log(`administrator user id : ${admin.userId}`);
  console.log(`${CONTEXT_NAME.padEnd(22)}: ${contextId} (${CONTEXT_TITLE})`);
  console.log(`invitation role       : ${INVITE_ROLE}`);
  console.log(`invitation expires    : in 24 hours`);
  console.log();
  console.log("Paste this invitation code into the app's sign-in panel:");
  console.log();
  console.log(`  ${invite.inviteToken}`);
  console.log();
} finally {
  await pool.end();
}

async function existingContextId(userId) {
  const result = await pool.query(
    `select record->'values'->>$3 as context_id
       from adl_authority_records
      where application_id = $1
        and object_name = $4
        and deleted_at is null
        and record->'values'->>'User' = $2
      limit 1`,
    [applicationId, userId, CONTEXT_OBJECT, MEMBERSHIP_OBJECT],
  );
  return result.rows[0]?.context_id ?? undefined;
}

async function rebuildMembershipProjection() {
  const descriptors = new ContextMembershipDescriptors(model);
  if (descriptors.empty) return;
  const writer = new ContextMembershipProjectionWriter(pool, applicationId, descriptors);
  await pool.query("begin");
  try {
    await writer.rebuild();
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback").catch(() => undefined);
    throw error;
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) fail(`${name} is required.`);
  return value;
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
