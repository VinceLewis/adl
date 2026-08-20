/**
 * Turning stored records and read-model rows into bound presentation rows,
 * sorting them by a resolved `ORDER BY`, exposing a row's own record identity
 * to a row-scoped action, and the row-fragment separator rule.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import { RECORD_ID_JOIN_FIELD } from "../../model/resolved-model.js";
import type { JsonValue, ResolvedSort, StoredObjectRecord } from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import type { RuntimeReadModelRow } from "../runtime-types.js";
import type { BoundPresentationRow, RuntimePresentationFragment } from "./types.js";

/**
 * Row values plus the row's own record identity, for row-scoped `ACTION`
 * evaluation only.
 *
 * `BoundPresentationRow.values` carries projected field values (an object
 * row's `view.fields`, or a read model's declared `FIELD` projections). It
 * never carries the row's own storage id, because nothing declares a field
 * for it — there was no way for `ACTION ... INPUT ... FROM <expr>` to target
 * the exact record a row renders from, only fields already projected onto it
 * (see `learnings/implementation/ui-presentation-model.md`, "A row-scoped
 * presentation ACTION cannot target an existing record by id").
 *
 * {@link RECORD_ID_JOIN_FIELD} (`"id"`) is already the reserved name this
 * codebase uses for "this record's own id" inside a read model's `JOIN ON`
 * matching (`joinKeyForRecord` in `read-model-service.ts`). Reusing it here
 * keeps one token meaning one thing everywhere a resolved model can name a
 * record's own identity, so `INPUT NoteId FROM id` resolves the exact record
 * this row renders from, for both object- and read-model-backed rows.
 *
 * The primary source's `recordId` is used — `sources[0]`, not `row.id` —
 * because `row.id` is a synthetic display key (`"Object:guid"` for an object
 * row, `"readModel:source:guid|..."` for a read-model row) that no command
 * step's `ID INPUT` could ever resolve to a real record. `sources[0]` is
 * always the row's primary source (`objectRecordToPresentationRow` and
 * `readModelRowToPresentationRow` both put it first), matching the
 * documented "first source is primary" read-model rule.
 *
 * Placed after the row's own values so the reserved identity always wins if
 * a field is ever also (implausibly) named `id` — this token already carries
 * a fixed, system-wide meaning, so a same-named field could never have meant
 * anything else.
 */
/**
 * Pops `output`'s last entry if it is a `text` fragment consisting entirely
 * of whitespace. Called whenever a `field` or `icon` row fragment renders
 * nothing (no value, no fallback icon) — the literal separator a row
 * template places immediately before an optional fragment exists only to
 * separate it from its neighbor, so it should disappear along with it,
 * rather than leaving a visible gap (`evaluateFragments`). A literal that
 * carries real punctuation alongside whitespace (`" - "`) is left alone:
 * that punctuation is still meaningful once the value before it is gone,
 * only a *pure* separator (`" "`) is ever silently dropped.
 */
export function dropTrailingWhitespaceOnlyFragment(output: RuntimePresentationFragment[]): void {
  const last = output[output.length - 1];
  if (last?.kind === "text" && last.text.trim() === "") {
    output.pop();
  }
}

export function rowActionValues(row: BoundPresentationRow): Record<string, JsonValue> {
  const recordId = row.sources[0]?.recordId;
  return recordId === undefined
    ? { ...row.values }
    : { ...row.values, [RECORD_ID_JOIN_FIELD]: recordId };
}

export function readModelRowToPresentationRow(row: RuntimeReadModelRow): BoundPresentationRow {
  return {
    id: row.id,
    values: cloneJson(row.values),
    sources: Object.entries(row.sources).map(([source, reference]) => ({
      source,
      objectName: reference.objectName,
      recordId: reference.recordId,
    })),
  };
}

export function objectRecordToPresentationRow(record: StoredObjectRecord): BoundPresentationRow {
  return {
    id: `${record.meta.object}:${record.meta.guid}`,
    values: cloneJson(record.values),
    sources: [
      {
        objectName: record.meta.object,
        recordId: record.meta.guid,
      },
    ],
  };
}

export function sortPresentationRows(
  rows: BoundPresentationRow[],
  sort: ResolvedSort[],
): BoundPresentationRow[] {
  if (sort.length === 0) {
    return [...rows];
  }

  return [...rows].sort((left, right) => {
    for (const sortItem of sort) {
      const comparison = compareJsonValues(
        left.values[sortItem.field],
        right.values[sortItem.field],
      );
      if (comparison !== 0) {
        return sortItem.direction === "asc" ? comparison : -comparison;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

export function compareJsonValues(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined || left === null) {
    return 1;
  }
  if (right === undefined || right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}
