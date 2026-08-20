import type { JsonPrimitive } from "./shared.js";
import type { ResolvedSort } from "./view.js";
import type {
  PartialPresentationStatusBindingModel,
  PresentationDensity,
  ResolvedPresentationStatusBinding,
} from "./presentation-core.js";
import type {
  PartialPresentationFormatModel,
  ResolvedPresentationFormat,
} from "./presentation-row-format.js";

export type PresentationMatrixSourceKind = "readModel" | "object";
export type PresentationMatrixColumnKind = "dateRange";
export type PresentationMatrixBulkBehavior = "sequentialValidatedWrites";
export interface ResolvedPresentationMatrix {
  name: string;
  density: PresentationDensity;
  rowSource: ResolvedPresentationMatrixAxisSource;
  columnAxis: ResolvedPresentationMatrixDateColumnAxis;
  cellSource: ResolvedPresentationMatrixCellSource;
  cell: ResolvedPresentationMatrixCell;
  edit?: ResolvedPresentationMatrixEdit;
}
export interface ResolvedPresentationMatrixAxisSource {
  sourceKind: PresentationMatrixSourceKind;
  source: string;
  keyField?: string;
  labelField: string;
  fields: string[];
  sort: ResolvedSort[];
}
export interface ResolvedPresentationMatrixDateColumnAxis {
  kind: "dateRange";
  start: string;
  end: string;
  stepDays: number;
  labelFormat?: ResolvedPresentationFormat;
}
export interface ResolvedPresentationMatrixCellSource {
  sourceKind: PresentationMatrixSourceKind;
  source: string;
  rowField: string;
  columnField: string;
  fields: string[];
  status?: ResolvedPresentationStatusBinding;
  recordSource?: string;
}
export interface ResolvedPresentationMatrixCell {
  status?: ResolvedPresentationStatusBinding;
  unsetStatus?: string;
  accessibleLabel?: string;
}
export interface ResolvedPresentationMatrixEdit {
  object: string;
  rowField: string;
  columnField: string;
  valueField: string;
  cycle: JsonPrimitive[];
  unsetValue?: JsonPrimitive | null;
  unsetAsAbsence: boolean;
  bulkBehavior: PresentationMatrixBulkBehavior;
}
export interface PartialPresentationMatrixModel {
  name: string;
  density?: PresentationDensity;
  rowSource: PartialPresentationMatrixAxisSourceModel;
  columnAxis: PartialPresentationMatrixDateColumnAxisModel;
  cellSource: PartialPresentationMatrixCellSourceModel;
  cell?: PartialPresentationMatrixCellModel;
  edit?: PartialPresentationMatrixEditModel;
}
export interface PartialPresentationMatrixAxisSourceModel {
  sourceKind?: PresentationMatrixSourceKind;
  source: string;
  keyField?: string;
  labelField: string;
  fields?: string[];
  sort?: ResolvedSort[];
}
export interface PartialPresentationMatrixDateColumnAxisModel {
  kind?: PresentationMatrixColumnKind;
  start: string;
  end: string;
  stepDays?: number;
  labelFormat?: PartialPresentationFormatModel;
}
export interface PartialPresentationMatrixCellSourceModel {
  sourceKind?: PresentationMatrixSourceKind;
  source: string;
  rowField: string;
  columnField: string;
  fields?: string[];
  status?: PartialPresentationStatusBindingModel;
  recordSource?: string;
}
export interface PartialPresentationMatrixCellModel {
  status?: PartialPresentationStatusBindingModel;
  unsetStatus?: string;
  accessibleLabel?: string;
}
export interface PartialPresentationMatrixEditModel {
  object: string;
  rowField: string;
  columnField: string;
  valueField: string;
  cycle?: JsonPrimitive[];
  unsetValue?: JsonPrimitive | null;
  unsetAsAbsence?: boolean;
  bulkBehavior?: PresentationMatrixBulkBehavior;
}
