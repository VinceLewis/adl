import type {
  EditChildOperationKind,
  JsonValue,
  PolicyEffect,
  ResolvedField,
  StoredObjectRecord,
} from "../model/resolved-model.js";

export type UiMode = "create" | "edit";
export type UiMessageKind = "info" | "success" | "warning" | "error";

export interface UiMessage {
  id: string;
  kind: UiMessageKind;
  title: string;
  code?: string;
  details: string[];
}

export interface FieldPresentation {
  field: ResolvedField;
  effect: PolicyEffect;
  hidden: boolean;
  masked: boolean;
  readonly: boolean;
  reasons: string[];
}

export interface ActionBarItem {
  name: string;
  label: string;
  kind: "command" | "lifecycle";
  variant: "primary" | "secondary" | "danger";
  disabled: boolean;
}

export interface SaveRecordDetail {
  mode: UiMode;
  values: Record<string, JsonValue>;
  record?: StoredObjectRecord;
}

export interface DraftRecordDetail {
  mode: UiMode;
  values: Record<string, JsonValue>;
  record?: StoredObjectRecord;
}

export interface TransitionRecordDetail {
  actionName: string;
  record: StoredObjectRecord;
  values: Record<string, JsonValue>;
}

export interface StageChildOperationDetail {
  section: string;
  operation: EditChildOperationKind | "updateChild";
  childObject: string;
  childId?: string;
  childIds?: string[];
  values?: Record<string, JsonValue>;
  stagedOperationId?: string;
  /**
   * The 1-based target position for a `reorder`, matching
   * `RuntimeStagedChildOperation.position`. It is the whole payload of a
   * reorder: the browser never writes the child's order field itself, it names
   * the position it wants and lets the runtime plan the sibling shifts.
   */
  position?: number;
}
