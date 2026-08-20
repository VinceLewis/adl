import type {
  PartialPresentationListModel,
  ResolvedPresentationList,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";
import { resolveSort } from "./view.js";
import {
  resolvePresentationAction,
  resolvePresentationEmptyState,
  resolvePresentationStatusCandidate,
} from "./presentation-core.js";
import { resolvePresentationRowTemplate } from "./presentation-row-format.js";

export function resolvePresentationList(
  input: PartialPresentationListModel,
): ResolvedPresentationList {
  return {
    name: input.name,
    sourceKind: input.sourceKind ?? "readModel",
    source: input.source,
    renderAs: input.renderAs ?? "table",
    density: input.density ?? "comfortable",
    fields: [...(input.fields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    ...(input.filter === undefined ? {} : { filter: resolveExpression(input.filter) }),
    emptyState: resolvePresentationEmptyState(input.emptyState),
    ...(input.status === undefined
      ? {}
      : {
          status: {
            candidates: (input.status.candidates ?? []).map(resolvePresentationStatusCandidate),
          },
        }),
    actions: (input.actions ?? []).map((action) =>
      resolvePresentationAction(action, action.placement ?? "row"),
    ),
    row: resolvePresentationRowTemplate(input.row),
  };
}
