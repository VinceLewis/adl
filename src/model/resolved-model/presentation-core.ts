import type { FieldType, JsonPrimitive, JsonValue } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";
import type {
  PartialPresentationListModel,
  ResolvedPresentationList,
} from "./presentation-list.js";
import type {
  PartialPresentationMatrixModel,
  ResolvedPresentationMatrix,
} from "./presentation-matrix.js";
import type {
  PartialPresentationCalendarModel,
  ResolvedPresentationCalendar,
} from "./presentation-calendar.js";
import type {
  PartialPresentationIconRefModel,
  ResolvedPresentationIconRef,
} from "./presentation-row-format.js";

export type PresentationLayout = "stack" | "grid" | "split" | "sidebar";
export type PresentationDensity = "compact" | "comfortable" | "spacious";
export type PresentationStateType = Exclude<FieldType, "attachment">;
export type PresentationStatePersistence = "memory" | "session" | "local";
export type PresentationControlKind = "toggle" | "select" | "action" | "contextSelector";
export type PresentationActionPlacement = "primary" | "secondary" | "row";
export type PresentationStatusThemeToken =
  | "colorStatusEvent"
  | "colorStatusAlternate"
  | "colorStatusAvailable"
  | "colorStatusUnavailable"
  | "colorStatusBusyElsewhere"
  | "colorStatusConflict"
  | "colorStatusUnset"
  | "colorInfo";
export type PresentationLegendInclude = "present" | "all";
export interface ResolvedViewPresentation {
  layout: PresentationLayout;
  density: PresentationDensity;
  state: ResolvedPresentationState[];
  iconMaps: ResolvedPresentationIconMap[];
  statuses: ResolvedPresentationStatus[];
  statusMaps: ResolvedPresentationStatusMap[];
  legends: ResolvedPresentationLegend[];
  sections: ResolvedPresentationSection[];
}
export interface ResolvedPresentationState {
  name: string;
  type: PresentationStateType;
  defaultValue: JsonValue;
  persistence: PresentationStatePersistence;
}
export interface ResolvedPresentationIconMap {
  name: string;
  field: string;
  values: ResolvedPresentationIconMapValue[];
  defaultIcon?: string;
}
export interface ResolvedPresentationIconMapValue {
  value: JsonPrimitive;
  icon: string;
}
export interface ResolvedPresentationStatus {
  name: string;
  label: string;
  accessibleLabel: string;
  icon?: ResolvedPresentationIconRef;
  themeToken: PresentationStatusThemeToken;
  precedence: number;
}
export interface ResolvedPresentationStatusMap {
  name: string;
  field: string;
  values: ResolvedPresentationStatusMapValue[];
  defaultStatus?: string;
}
export interface ResolvedPresentationStatusMapValue {
  value: JsonPrimitive;
  status: string;
}
export interface ResolvedPresentationLegend {
  name: string;
  title?: string;
  statuses: string[];
  include: PresentationLegendInclude;
}
export interface ResolvedPresentationSection {
  name: string;
  heading?: string;
  layout: PresentationLayout;
  density: PresentationDensity;
  controls: ResolvedPresentationControl[];
  lists: ResolvedPresentationList[];
  matrices: ResolvedPresentationMatrix[];
  calendars: ResolvedPresentationCalendar[];
}
export type ResolvedPresentationControl =
  | ResolvedPresentationToggleControl
  | ResolvedPresentationSelectControl
  | ResolvedPresentationActionControl
  | ResolvedPresentationContextSelectorControl;
export interface ResolvedPresentationControlBase {
  name: string;
  kind: PresentationControlKind;
  label?: string;
  icon?: ResolvedPresentationIconRef;
}
export interface ResolvedPresentationToggleControl extends ResolvedPresentationControlBase {
  kind: "toggle";
  state: string;
}
export interface ResolvedPresentationSelectControl extends ResolvedPresentationControlBase {
  kind: "select";
  state: string;
  options: ResolvedPresentationSelectOption[];
}
export interface ResolvedPresentationSelectOption {
  value: JsonPrimitive;
  label: string;
  icon?: ResolvedPresentationIconRef;
}
export interface ResolvedPresentationActionControl extends ResolvedPresentationControlBase {
  kind: "action";
  placement: PresentationActionPlacement;
  command?: string;
  view?: string;
  create?: ResolvedPresentationCreateTarget;
  input: Record<string, ResolvedExpression>;
  visibleWhen?: ResolvedExpression;
}
export interface ResolvedPresentationCreateTarget {
  object?: string;
  view?: string;
}
export interface ResolvedPresentationContextSelectorControl
  extends ResolvedPresentationControlBase {
  kind: "contextSelector";
  context?: string;
}
export interface ResolvedPresentationStatusBinding {
  candidates: ResolvedPresentationStatusCandidate[];
}
export type ResolvedPresentationStatusCandidate =
  | { kind: "status"; status: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };
export interface ResolvedPresentationEmptyState {
  text: string;
  icon?: ResolvedPresentationIconRef;
}
export interface PartialViewPresentationModel {
  layout?: PresentationLayout;
  density?: PresentationDensity;
  state?: PartialPresentationStateModel[];
  iconMaps?: PartialPresentationIconMapModel[];
  statuses?: PartialPresentationStatusModel[];
  statusMaps?: PartialPresentationStatusMapModel[];
  legends?: PartialPresentationLegendModel[];
  sections?: PartialPresentationSectionModel[];
}
export interface PartialPresentationStateModel {
  name: string;
  type?: PresentationStateType;
  defaultValue?: JsonValue;
  persistence?: PresentationStatePersistence;
}
export interface PartialPresentationIconMapModel {
  name: string;
  field: string;
  values?: PartialPresentationIconMapValueModel[];
  defaultIcon?: string;
}
export interface PartialPresentationIconMapValueModel {
  value: JsonPrimitive;
  icon: string;
}
export interface PartialPresentationStatusModel {
  name: string;
  label?: string;
  accessibleLabel?: string;
  icon?: PartialPresentationIconRefModel;
  themeToken?: PresentationStatusThemeToken;
  precedence?: number;
}
export interface PartialPresentationStatusMapModel {
  name: string;
  field: string;
  values?: PartialPresentationStatusMapValueModel[];
  defaultStatus?: string;
}
export interface PartialPresentationStatusMapValueModel {
  value: JsonPrimitive;
  status: string;
}
export interface PartialPresentationLegendModel {
  name: string;
  title?: string;
  statuses?: string[];
  include?: PresentationLegendInclude;
}
export interface PartialPresentationSectionModel {
  name: string;
  heading?: string;
  layout?: PresentationLayout;
  density?: PresentationDensity;
  controls?: PartialPresentationControlModel[];
  lists?: PartialPresentationListModel[];
  matrices?: PartialPresentationMatrixModel[];
  calendars?: PartialPresentationCalendarModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export type PartialPresentationControlModel =
  | PartialPresentationToggleControlModel
  | PartialPresentationSelectControlModel
  | PartialPresentationActionControlModel
  | PartialPresentationContextSelectorControlModel;
export interface PartialPresentationControlBaseModel {
  name: string;
  kind: PresentationControlKind;
  label?: string;
  icon?: PartialPresentationIconRefModel;
}
export interface PartialPresentationToggleControlModel extends PartialPresentationControlBaseModel {
  kind: "toggle";
  state: string;
}
export interface PartialPresentationSelectControlModel extends PartialPresentationControlBaseModel {
  kind: "select";
  state: string;
  options?: PartialPresentationSelectOptionModel[];
}
export interface PartialPresentationSelectOptionModel {
  value: JsonPrimitive;
  label: string;
  icon?: PartialPresentationIconRefModel;
}
export interface PartialPresentationActionControlModel extends PartialPresentationControlBaseModel {
  kind: "action";
  placement?: PresentationActionPlacement;
  command?: string;
  view?: string;
  create?: PartialPresentationCreateTargetModel;
  input?: Record<string, ResolvedExpression>;
  visibleWhen?: PartialPolicyConditionModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialPresentationCreateTargetModel {
  object?: string;
  view?: string;
}
export interface PartialPresentationContextSelectorControlModel
  extends PartialPresentationControlBaseModel {
  kind: "contextSelector";
  context?: string;
}
export interface PartialPresentationStatusBindingModel {
  candidates?: PartialPresentationStatusCandidateModel[];
}
export type PartialPresentationStatusCandidateModel =
  | { kind: "status"; status: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };
export interface PartialPresentationEmptyStateModel {
  text?: string;
  icon?: PartialPresentationIconRefModel;
}
