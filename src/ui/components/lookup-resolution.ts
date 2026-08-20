import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type { ResolvedField, StoredObjectRecord } from "../../model/resolved-model.js";
import type { RuntimeContext } from "../../runtime/runtime-types.js";

/**
 * Resolves the target record a `LOOKUP` field's stored value identifies, for
 * display purposes (list-cell and form-field lookup labels).
 *
 * A `LOOKUP` with no `TARGET_FIELD` stores the target record's own id, so an
 * identity read resolves it directly — but through
 * `runtime.readFieldsForDisplay`, asking for the display field alone, not
 * through `runtime.read`. A label is a field read: an application may
 * legitimately say `ALLOW READ AUTHENTICATED FIELDS Name` on its `User`
 * object, granting every signed-in caller a person's name and nothing else,
 * and `runtime.read` would refuse that at the row gate. Because this helper's
 * callers fall back to the raw stored id on a refusal, and do so silently, the
 * visible result of getting this wrong is an application that renders
 * `user-...` everywhere a name belongs. A
 * `LOOKUP ... TARGET_FIELD` stores a natural-key value instead: the stored
 * value never equals the target record's id, so it must be resolved with an
 * exact-match search on that field instead. `runtime.search` may return
 * fuzzy/substring matches, so candidates are still filtered for an exact
 * match here before one is used — the search results are not trusted as
 * already-exact.
 */
export async function resolveLookupTargetRecord(
  runtime: ApplicationRuntime,
  field: ResolvedField,
  storedValue: string,
  context: RuntimeContext,
): Promise<StoredObjectRecord | null | undefined> {
  const lookup = field.lookup;
  if (lookup === undefined) {
    return undefined;
  }

  const targetField = lookup.targetField;
  if (targetField === undefined) {
    return runtime.readFieldsForDisplay(
      lookup.targetObject,
      storedValue,
      [lookup.displayField],
      context,
    );
  }

  const candidates = await runtime.search(
    lookup.targetObject,
    { text: storedValue, fields: [targetField] },
    context,
  );

  return candidates.find((candidate) => candidate.values[targetField] === storedValue);
}
