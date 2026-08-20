import type {
  PartialViewPresentationModel,
  ResolvedViewPresentation,
} from "./presentation-core.js";

export type ViewKind =
  | "list"
  | "detail"
  | "form"
  | "dashboard"
  | "masterDetail"
  | "grid"
  | "composite";
export type EditContainerMode = "modal" | "drawer" | "page" | "splitPane";
export type RelationshipPickerSourceKind = "object" | "readModel";
export type RelationshipPickerSelectionMode = "single" | "multiple";
export type EditSectionKind = "fields" | "childCollection";
export type EditChildOperationKind =
  | "createChild"
  | "linkExisting"
  | "updateChild"
  | "unlink"
  | "remove"
  | "reorder";
/**
 * `syncStatus` reports the sync state of the device's *records*; `connectivity`
 * reports whether the device can reach the authority. They were one control
 * until Phase 58, which is why a control named for record state rendered
 * "Online"/"Offline" and no surface answered the question it was named after.
 */
export type ViewContextMode = "none" | "required" | "optional" | "all";
export interface ResolvedView {
  name: string;
  object: string;
  kind: ViewKind;
  context?: ResolvedViewContext;
  readModel?: string;
  editContainer: EditContainerMode;
  fields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  actions: string[];
  editSections: ResolvedEditSection[];
  presentation?: ResolvedViewPresentation;
}
export interface ResolvedViewContext {
  mode: ViewContextMode;
  context?: string;
}
export interface ResolvedSort {
  field: string;
  direction: "asc" | "desc";
}
export type ResolvedEditSection = ResolvedEditFieldsSection | ResolvedEditChildCollectionSection;
export interface ResolvedEditSectionBase {
  name: string;
  kind: EditSectionKind;
  heading?: string;
}
export interface ResolvedEditFieldsSection extends ResolvedEditSectionBase {
  kind: "fields";
  fields: string[];
}
export interface ResolvedEditChildCollectionSection extends ResolvedEditSectionBase {
  kind: "childCollection";
  childObject: string;
  parentField: string;
  childView?: string;
  operations: EditChildOperationKind[];
  staged: boolean;
  orderField?: string;
  emptyState: ResolvedEditChildCollectionEmptyState;
  picker?: ResolvedRelationshipPicker;
}
export interface ResolvedEditChildCollectionEmptyState {
  text: string;
}
export interface ResolvedRelationshipPicker {
  name: string;
  sourceKind: RelationshipPickerSourceKind;
  source: string;
  /**
   * The child field that receives the chosen candidate's record id, which turns
   * the picker from one that *links* into one that *creates*.
   *
   * Without it a picker offers existing child records and sets their parent
   * field — "move a set-list item into this set list". With it the candidates are
   * a related object and each choice mints a new child naming it — "add this
   * song to this set list", which is the operation a person actually performs and
   * which was previously inexpressible.
   *
   * The candidates are then the field's own lookup target, so what is offered is
   * decided by the model rather than by the picker's source alone.
   */
  candidateField?: string;
  selection: RelationshipPickerSelectionMode;
  displayFields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  excludeAlreadyLinked: boolean;
  emptyState: ResolvedRelationshipPickerEmptyState;
}
export interface ResolvedRelationshipPickerEmptyState {
  text: string;
}
export interface PartialViewModel {
  name: string;
  object?: string;
  kind: ViewKind;
  context?: PartialViewContextModel;
  readModel?: string;
  editContainer?: EditContainerMode;
  fields?: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  actions?: string[];
  editSections?: PartialEditSectionModel[];
  presentation?: PartialViewPresentationModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialViewContextModel {
  mode: ViewContextMode;
  context?: string;
}
export type PartialEditSectionModel =
  | PartialEditFieldsSectionModel
  | PartialEditChildCollectionSectionModel;
export interface PartialEditSectionBaseModel {
  name: string;
  kind: EditSectionKind;
  heading?: string;
}
export interface PartialEditFieldsSectionModel extends PartialEditSectionBaseModel {
  kind: "fields";
  fields?: string[];
}
export interface PartialEditChildCollectionSectionModel extends PartialEditSectionBaseModel {
  kind: "childCollection";
  childObject: string;
  parentField: string;
  childView?: string;
  operations?: EditChildOperationKind[];
  staged?: boolean;
  orderField?: string;
  emptyState?: PartialEditChildCollectionEmptyStateModel;
  picker?: PartialRelationshipPickerModel;
}
export interface PartialEditChildCollectionEmptyStateModel {
  text?: string;
}
export interface PartialRelationshipPickerModel {
  name?: string;
  sourceKind?: RelationshipPickerSourceKind;
  source?: string;
  candidateField?: string;
  selection?: RelationshipPickerSelectionMode;
  displayFields?: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  excludeAlreadyLinked?: boolean;
  emptyState?: PartialRelationshipPickerEmptyStateModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialRelationshipPickerEmptyStateModel {
  text?: string;
}
