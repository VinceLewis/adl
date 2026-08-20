/**
 * Deletes the three IndexedDB databases a browser-persisted ADL app owns for
 * one `databaseName`: `<databaseName>` itself (object records and
 * `__adl_application_metadata`, `IndexedDbObjectStorageBackend`),
 * `` `${databaseName}-sync-state` `` (`IndexedDbSyncStateStorage`,
 * `sync-state-storage.ts`), and `` `${databaseName}-session-identity` ``
 * (`IndexedDbSessionIdentityStorage`, `src/ui/offline-session.ts`).
 *
 * The three suffixes are duplicated here rather than imported because none
 * of the three storage classes exposes its own delete/teardown method today
 * (checked before writing this: `IndexedDbObjectStorageBackend`,
 * `IndexedDbSyncStateStorage`, and `IndexedDbSessionIdentityStorage` all
 * expose `open`/`read`/`write`-shaped surfaces, no `deleteDatabase`). If one
 * of them grows a delete method later, prefer calling through it -- and
 * through the other two once they also have one -- over this literal list,
 * so the suffix logic has exactly one place it can drift from this one.
 *
 * This is a genuine, user-initiated "start completely fresh" action, used
 * only by the startup-failure fallback UI's "Reset local data and reload"
 * button (`src/ui/components/adl-startup-error.ts`) after every other
 * recovery path -- most importantly, model migration -- has already been
 * ruled out. It deliberately includes session identity: see
 * docs/phases/phase-84-startup-failure-recovery-ui.md's Decision section for
 * why that is correct here despite `tests/browser-model-migration.test.ts`'s
 * warning that an *automatic migration* must never touch it. That warning is
 * about a migration silently discarding a signed-in user's identity as a
 * side effect of something else; this is the opposite, an explicit action
 * taken because the app is unrecoverable otherwise.
 */
export async function deleteAppLocalDatabases(databaseName: string): Promise<void> {
  const names = [databaseName, `${databaseName}-sync-state`, `${databaseName}-session-identity`];
  await Promise.all(names.map(deleteIndexedDbDatabase));
}

function deleteIndexedDbDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (globalThis.indexedDB === undefined) {
      resolve();
      return;
    }

    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to delete IndexedDB database '${name}'.`));
    // A connection to this database is still open elsewhere (most likely this
    // same page's own failed runtime). The delete is queued and completes once
    // that connection closes, which navigation away from this page (the
    // caller always reloads right after) guarantees. Treated as best-effort
    // success rather than an error so a reload is never blocked on it.
    request.onblocked = () => resolve();
  });
}
