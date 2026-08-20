import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";
import type { ResolvedSort } from "./view.js";
import type {
  PartialPresentationActionControlModel,
  PartialPresentationEmptyStateModel,
  PartialPresentationStatusBindingModel,
  PresentationDensity,
  ResolvedPresentationActionControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationStatusBinding,
} from "./presentation-core.js";
import type {
  PartialPresentationRowTemplateModel,
  ResolvedPresentationRowTemplate,
} from "./presentation-row-format.js";

export type PresentationListSourceKind = "readModel" | "object";
export type PresentationListRenderStyle = "table" | "feed" | "compactFeed" | "cards";
export interface ResolvedPresentationList {
  name: string;
  sourceKind: PresentationListSourceKind;
  source: string;
  renderAs: PresentationListRenderStyle;
  density: PresentationDensity;
  fields: string[];
  sort: ResolvedSort[];
  filter?: ResolvedExpression;
  emptyState: ResolvedPresentationEmptyState;
  status?: ResolvedPresentationStatusBinding;
  actions: ResolvedPresentationActionControl[];
  row: ResolvedPresentationRowTemplate;
}
export interface PartialPresentationListModel {
  name: string;
  sourceKind?: PresentationListSourceKind;
  source: string;
  renderAs?: PresentationListRenderStyle;
  density?: PresentationDensity;
  fields?: string[];
  sort?: ResolvedSort[];
  filter?: PartialPolicyConditionModel;
  emptyState?: PartialPresentationEmptyStateModel;
  status?: PartialPresentationStatusBindingModel;
  actions?: PartialPresentationActionControlModel[];
  row?: PartialPresentationRowTemplateModel;
}
