export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type FieldType = "text" | "number" | "date" | "datetime" | "time" | "boolean" | "attachment";
