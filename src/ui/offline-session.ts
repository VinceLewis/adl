import { StorageError } from "../runtime/runtime-types.js";

/**
 * Offline session lifetime for the browser.
 *
 * Two things live here, and the distinction between them is load-bearing:
 *
 * 1. **A cached identity.** The server-derived user id this device last
 *    authenticated as, so a reload with no connection still knows who is using
 *    the app and can evaluate local policy for them. It is *not* a credential.
 *    It is never presented to the authority as proof of anything, and the
 *    server-derived identity wins on every successful contact.
 * 2. **The grace clock.** When that authentication last succeeded, which is
 *    what the model's declared offline grace is measured from.
 *
 * The grace gates **sync only**. Local reads and local-first writes work
 * offline indefinitely, inside the grace and outside it, and nothing here may
 * ever be consulted to decide whether a local operation may proceed.
 */

/** What this device remembers about the identity it last authenticated as. */
export interface PersistedSessionIdentity {
  /** Server-derived. The browser never chooses or edits this. */
  userId: string;
  /** ISO instant of the last successful authentication to the authority. */
  lastVerifiedAt: string;
}

export interface SessionIdentityStorage {
  read(): Promise<PersistedSessionIdentity | null>;
  write(identity: PersistedSessionIdentity): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The identity an app with a configured authority runs as before anyone has
 * signed in, and after they sign out.
 *
 * It deliberately matches no membership record, so context roles resolve to
 * nothing and policy denies: a signed-out browser sees no data. This exists
 * because the alternative was worse — the app fell back to
 * `LOCAL_DEMO_IDENTITY`, which is a *local demo* identity and must never stand
 * in for an account when a real session is expected.
 */
export const SIGNED_OUT_IDENTITY = "adl-signed-out";

export type OfflineGraceStatus = "noIdentity" | "withinGrace" | "expired";

export interface OfflineGraceState {
  status: OfflineGraceStatus;
  /** ISO instant this device must authenticate again by, to keep syncing. */
  expiresAt?: string;
  /** ISO instant of the last successful authentication. */
  lastVerifiedAt?: string;
  /** The declared grace this state was evaluated against, in days. */
  offlineGraceDays: number;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Decides whether this device may still sync without authenticating again.
 *
 * A device that has never authenticated here is `noIdentity` rather than
 * `expired`: it is not inside a grace that ran out, it simply has no session to
 * extend, and the sign-in surface — not a "sync paused" prompt — is the right
 * thing to show it.
 */
export function evaluateOfflineGrace(
  identity: PersistedSessionIdentity | null,
  offlineGraceDays: number,
  now: Date,
): OfflineGraceState {
  if (identity === null) {
    return { status: "noIdentity", offlineGraceDays };
  }

  const verifiedAt = new Date(identity.lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) {
    // An unreadable timestamp is treated as no grace at all rather than as an
    // unlimited one: a corrupt record must never widen what a device may do.
    return { status: "expired", lastVerifiedAt: identity.lastVerifiedAt, offlineGraceDays };
  }

  const expiresAt = new Date(verifiedAt.getTime() + offlineGraceDays * MILLISECONDS_PER_DAY);
  return {
    status: expiresAt.getTime() > now.getTime() ? "withinGrace" : "expired",
    expiresAt: expiresAt.toISOString(),
    lastVerifiedAt: identity.lastVerifiedAt,
    offlineGraceDays,
  };
}

/**
 * Whether a successful contact should also rotate the session.
 *
 * Rotation is what actually restarts the grace server-side, but every rotation
 * writes a session row and re-issues two cookies, so doing it on literally
 * every sync would churn hard for no added safety. Past the halfway point there
 * is still a full half-grace of slack before anything expires, which is ample
 * for a device that syncs at all regularly.
 */
export function shouldRotateSession(
  identity: PersistedSessionIdentity | null,
  offlineGraceDays: number,
  now: Date,
): boolean {
  if (identity === null) {
    return true;
  }

  const verifiedAt = new Date(identity.lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) {
    return true;
  }

  const elapsed = now.getTime() - verifiedAt.getTime();
  return elapsed > (offlineGraceDays * MILLISECONDS_PER_DAY) / 2;
}

/** Test and tooling wiring. A browser gets the IndexedDB implementation. */
export class InMemorySessionIdentityStorage implements SessionIdentityStorage {
  private identity: PersistedSessionIdentity | null = null;
  async read(): Promise<PersistedSessionIdentity | null> {
    return this.identity === null ? null : { ...this.identity };
  }
  async write(identity: PersistedSessionIdentity): Promise<void> {
    this.identity = { ...identity };
  }
  async clear(): Promise<void> {
    this.identity = null;
  }
}

export interface IndexedDbSessionIdentityStorageOptions {
  databaseName?: string;
  storeName?: string;
  version?: number;
}

const DEFAULT_DATABASE_NAME = "adl-runtime-session-identity";
const DEFAULT_STORE_NAME = "sessionIdentity";
const IDENTITY_KEY = "__adl_session_identity";

/**
 * Browser persistence for the cached identity, in IndexedDB alongside records
 * and sync state rather than in `localStorage`.
 *
 * It gets its own database for the same reason sync state does: two classes
 * opening one database at different versions would deadlock the first upgrade.
 * Nothing secret is stored — a user id and a timestamp, never a session token,
 * which stays in an HttpOnly cookie this code cannot read.
 */
export class IndexedDbSessionIdentityStorage implements SessionIdentityStorage {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbSessionIdentityStorageOptions = {}) {
    this.databaseName =
      options.databaseName === undefined
        ? DEFAULT_DATABASE_NAME
        : `${options.databaseName}-session-identity`;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.version = options.version ?? 1;
  }

  async read(): Promise<PersistedSessionIdentity | null> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, "readonly");
    const value = await request<PersistedSessionIdentity | undefined>(
      tx.objectStore(this.storeName).get(IDENTITY_KEY),
    );
    await done(tx);
    return value === undefined ? null : { ...value };
  }

  async write(identity: PersistedSessionIdentity): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, "readwrite");
    await request(tx.objectStore(this.storeName).put({ ...identity }, IDENTITY_KEY));
    await done(tx);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, "readwrite");
    await request(tx.objectStore(this.storeName).delete(IDENTITY_KEY));
    await done(tx);
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise !== undefined) return this.dbPromise;
    if (globalThis.indexedDB === undefined)
      throw new StorageError("IndexedDB is not available in this runtime.");
    this.dbPromise = new Promise((resolve, reject) => {
      const open = globalThis.indexedDB.open(this.databaseName, this.version);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(this.storeName))
          open.result.createObjectStore(this.storeName);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () =>
        reject(
          new StorageError("Failed to open IndexedDB session identity.", {
            cause: open.error?.message,
          }),
        );
    });
    return this.dbPromise;
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(
        new StorageError("IndexedDB session-identity request failed.", {
          cause: value.error?.message,
        }),
      );
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new StorageError("IndexedDB session-identity transaction failed.", {
          cause: tx.error?.message,
        }),
      );
  });
}
