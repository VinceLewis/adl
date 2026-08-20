import type { JsonPrimitive } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";
import type { PresentationDensity } from "./presentation-core.js";

export type PresentationRowLayout = "inline" | "stack";
export type PresentationFragmentStyle = "plain" | "bold" | "muted" | "caption";
export type PresentationFormatKind = "text" | "number" | "date" | "datetime" | "time" | "duration";
export interface ResolvedPresentationRowTemplate {
  layout: PresentationRowLayout;
  density: PresentationDensity;
  fragments: ResolvedPresentationRowFragment[];
}
export type ResolvedPresentationRowFragment =
  | ResolvedPresentationLiteralTextFragment
  | ResolvedPresentationFieldTextFragment
  | ResolvedPresentationIconFragment
  | ResolvedPresentationConditionalFragment;
export interface ResolvedPresentationLiteralTextFragment {
  kind: "text";
  text: string;
  style: PresentationFragmentStyle;
}
export interface ResolvedPresentationFieldTextFragment {
  kind: "field";
  field: string;
  style: PresentationFragmentStyle;
  format?: ResolvedPresentationFormat;
  fallback?: string;
}
export interface ResolvedPresentationIconFragment {
  kind: "icon";
  icon: ResolvedPresentationIconRef;
  label?: string;
}
export interface ResolvedPresentationConditionalFragment {
  kind: "conditional";
  when: ResolvedExpression;
  fragments: ResolvedPresentationRowFragment[];
}
export interface ResolvedPresentationFormat {
  kind: PresentationFormatKind;
  pattern?: string;
}
export type ResolvedPresentationIconRef =
  | { kind: "named"; name: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };
export interface PartialPresentationRowTemplateModel {
  layout?: PresentationRowLayout;
  density?: PresentationDensity;
  fragments?: PartialPresentationRowFragmentModel[];
}
export type PartialPresentationRowFragmentModel =
  | PartialPresentationLiteralTextFragmentModel
  | PartialPresentationFieldTextFragmentModel
  | PartialPresentationIconFragmentModel
  | PartialPresentationConditionalFragmentModel;
export interface PartialPresentationLiteralTextFragmentModel {
  kind: "text";
  text: string;
  style?: PresentationFragmentStyle;
}
export interface PartialPresentationFieldTextFragmentModel {
  kind: "field";
  field: string;
  style?: PresentationFragmentStyle;
  format?: PartialPresentationFormatModel;
  fallback?: string;
}
export interface PartialPresentationIconFragmentModel {
  kind: "icon";
  icon: PartialPresentationIconRefModel;
  label?: string;
}
export interface PartialPresentationConditionalFragmentModel {
  kind: "conditional";
  when: PartialPolicyConditionModel;
  fragments?: PartialPresentationRowFragmentModel[];
}
export interface PartialPresentationFormatModel {
  kind: PresentationFormatKind;
  pattern?: string;
}
export type PartialPresentationIconRefModel =
  | { kind: "named"; name: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };
