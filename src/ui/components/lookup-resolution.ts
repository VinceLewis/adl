import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type { ResolvedField, StoredObjectRecord } from "../../model/resolved-model.js";
import type { RuntimeContext } from "../../runtime/runtime-types.js";

/**
 * Resolves the target record a `LOOKUP` field's stored value identifies, for
 * display purposes (list-cell and form-field lookup labels).
 *
 * A `LOOKUP` with no `TARGET_FIELD` stores the target record's own id, so an
 * identity `read` resolves it directly — unchanged behaviour. A
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
    return runtime.read(lookup.targetObject, storedValue, context);
  }

  const candidates = await runtime.search(
    lookup.targetObject,
    { text: storedValue, fields: [targetField] },
    context,
  );

  return candidates.find((candidate) => candidate.values[targetField] === storedValue);
}
