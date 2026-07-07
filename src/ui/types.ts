import type {
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

export interface TransitionRecordDetail {
  actionName: string;
  record: StoredObjectRecord;
}
