import type {
  PartialPresentationFormatModel,
  PartialPresentationIconRefModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  ResolvedPresentationFormat,
  ResolvedPresentationIconRef,
  ResolvedPresentationRowFragment,
  ResolvedPresentationRowTemplate,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";

export function resolvePresentationRowTemplate(
  input: PartialPresentationRowTemplateModel | undefined,
): ResolvedPresentationRowTemplate {
  return {
    layout: input?.layout ?? "inline",
    density: input?.density ?? "comfortable",
    fragments: (input?.fragments ?? []).map(resolvePresentationRowFragment),
  };
}
function resolvePresentationRowFragment(
  input: PartialPresentationRowFragmentModel,
): ResolvedPresentationRowFragment {
  if (input.kind === "text") {
    return {
      kind: "text",
      text: input.text,
      style: input.style ?? "plain",
    };
  }

  if (input.kind === "field") {
    return {
      kind: "field",
      field: input.field,
      style: input.style ?? "plain",
      ...(input.format === undefined ? {} : { format: resolvePresentationFormat(input.format) }),
      ...(input.fallback === undefined ? {} : { fallback: input.fallback }),
    };
  }

  if (input.kind === "icon") {
    return {
      kind: "icon",
      icon: resolvePresentationIconRef(input.icon),
      ...(input.label === undefined ? {} : { label: input.label }),
    };
  }

  return {
    kind: "conditional",
    when: resolveExpression(input.when),
    fragments: (input.fragments ?? []).map(resolvePresentationRowFragment),
  };
}
export function resolvePresentationFormat(
  input: PartialPresentationFormatModel,
): ResolvedPresentationFormat {
  return {
    kind: input.kind,
    ...(input.pattern === undefined ? {} : { pattern: input.pattern }),
  };
}
export function resolvePresentationIconRef(
  input: PartialPresentationIconRefModel,
): ResolvedPresentationIconRef {
  if (input.kind === "named") {
    return { kind: "named", name: input.name };
  }

  return {
    kind: "map",
    map: input.map,
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}
