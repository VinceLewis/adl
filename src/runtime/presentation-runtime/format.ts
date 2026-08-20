/**
 * Value formatting: `formatPresentationValue` and the number, date, time,
 * datetime and duration formatters behind it, their pattern vocabulary, and
 * the two diagnostics they raise.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonPrimitive,
  JsonValue,
  ResolvedPresentationFormat,
} from "../../model/resolved-model.js";
import type { DiagnosticLocation, RuntimePresentationDiagnostic } from "./types.js";

/**
 * Exported for `edit-surface-runtime.ts`'s child-collection `summary`
 * formatting (Phase 87) — the one consumer of this formatter outside the
 * presentation runtime itself. A `CHILD_COLLECTION` summary is computed over
 * that collection's own already-assembled row set, not over a presentation
 * `LIST`, so it has no `RuntimePresentationDiagnostic` location of its own to
 * synthesize here; the caller supplies one.
 */
export function formatPresentationValue(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  switch (format.kind) {
    case "text":
      return primitiveToText(value, diagnostics, location);
    case "number":
      return formatNumber(value, format, diagnostics, location);
    case "date":
      return formatDate(value, format, diagnostics, location);
    case "time":
      return formatTime(value, format, diagnostics, location);
    case "datetime":
      return formatDateTime(value, format, diagnostics, location);
    case "duration":
      return formatDuration(value, format, diagnostics, location);
  }
}

export function primitiveToText(
  value: JsonValue | undefined,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (value === undefined || value === null) {
    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_FIELD_MISSING",
      message: "Presentation value is missing.",
      path: location.path,
      section: location.section,
      list: location.list,
      field: location.field,
    });
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  diagnostics.push({
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
    message: "Presentation value must be primitive to format as text.",
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  });
  return "";
}

export function formatNumber(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
      message: "Number format requires a finite number value.",
      path: location.path,
      section: location.section,
      list: location.list,
      field: location.field,
    });
    return "";
  }

  if (format.pattern === undefined || format.pattern === "plain") {
    return String(value);
  }

  if (format.pattern === "integer") {
    return String(Math.round(value));
  }

  const fixedMatch = /^fixed:(\d+)$/.exec(format.pattern);
  const decimalPatternMatch = /^0(?:\.(0{1,4}))?$/.exec(format.pattern);
  const digits =
    fixedMatch?.[1] ??
    (decimalPatternMatch?.[1] === undefined ? undefined : String(decimalPatternMatch[1].length));
  if (digits !== undefined) {
    const precision = Number(digits);
    if (precision >= 0 && precision <= 4) {
      return value.toFixed(precision);
    }
  }

  diagnostics.push(unsupportedFormat(format, location));
  return String(value);
}

export function formatDate(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(invalidFormatValue("Date format requires a YYYY-MM-DD text value.", location));
    return "";
  }

  const parts = parseDateParts(value);
  if (parts === undefined) {
    diagnostics.push(
      invalidFormatValue("Date format requires a valid YYYY-MM-DD value.", location),
    );
    return value;
  }

  return applyDatePattern(parts, format, diagnostics, location) ?? value;
}

export function formatTime(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(invalidFormatValue("Time format requires an HH:mm text value.", location));
    return "";
  }

  const parts = parseTimeParts(value);
  if (parts === undefined) {
    diagnostics.push(
      invalidFormatValue("Time format requires a valid HH:mm or HH:mm:ss value.", location),
    );
    return value;
  }

  return applyTimePattern(parts, format, diagnostics, location) ?? value;
}

/**
 * Seconds -> pattern-driven text. Follows `applyTimePattern`'s small,
 * closed-token-vocabulary style rather than inventing a different
 * convention: today only `m:ss` (minutes, then seconds zero-padded to two
 * digits) is supported, which is the shape a song or set-list duration
 * actually needs ("47:20"). Negative or non-finite input is invalid, the
 * same posture `formatNumber` takes.
 */
export function formatDuration(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    diagnostics.push(
      invalidFormatValue(
        "Duration format requires a non-negative finite number of seconds.",
        location,
      ),
    );
    return "";
  }

  const pattern = format.pattern ?? "m:ss";
  if (pattern !== "m:ss") {
    diagnostics.push(unsupportedFormat(format, location));
    return String(value);
  }

  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateTime(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(
      invalidFormatValue("Datetime format requires an ISO datetime text value.", location),
    );
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    diagnostics.push(
      invalidFormatValue("Datetime format requires a valid ISO datetime value.", location),
    );
    return value;
  }

  const parts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
  const time = {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
  const pattern = format.pattern ?? "yyyy-MM-dd HH:mm";
  const segments = pattern.split(/( +)/);
  const formatted: string[] = [];

  for (const segment of segments) {
    if (segment.trim().length === 0) {
      formatted.push(segment);
      continue;
    }

    const hasDateToken = containsDateToken(segment);
    const hasTimeToken = containsTimeToken(segment);
    if (hasDateToken && hasTimeToken) {
      diagnostics.push(unsupportedFormat(format, location));
      return value;
    }
    if (hasDateToken) {
      const dateText = applyDatePattern(
        parts,
        { ...format, pattern: segment },
        diagnostics,
        location,
      );
      if (dateText === undefined) {
        return value;
      }
      formatted.push(dateText);
      continue;
    }
    if (hasTimeToken) {
      const timeText = applyTimePattern(
        time,
        { ...format, pattern: segment },
        diagnostics,
        location,
      );
      if (timeText === undefined) {
        return value;
      }
      formatted.push(timeText);
      continue;
    }
    formatted.push(segment);
  }

  return formatted.join("");
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

export interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDateParts(value: string): DateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day, weekday: date.getUTCDay() };
}

export function parseTimeParts(value: string): TimeParts | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{3})?)?$/.exec(value);
  if (match === null) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }

  return { hour, minute, second };
}

export function applyDatePattern(
  parts: DateParts,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string | undefined {
  const pattern = format.pattern ?? "yyyy-MM-dd";
  if (!/^(yyyy|yy|MMM|MM|M|dd|d|EEE|[-/ ,.])+$/.test(pattern)) {
    diagnostics.push(unsupportedFormat(format, location));
    return undefined;
  }

  return pattern.replace(/yyyy|yy|MMM|MM|M|dd|d|EEE/g, (token) => {
    switch (token) {
      case "yyyy":
        return String(parts.year);
      case "yy":
        return String(parts.year).slice(-2);
      case "MMM":
        return MONTH_SHORT[parts.month - 1] ?? "";
      case "MM":
        return String(parts.month).padStart(2, "0");
      case "M":
        return String(parts.month);
      case "dd":
        return String(parts.day).padStart(2, "0");
      case "d":
        return String(parts.day);
      case "EEE":
        return WEEKDAY_SHORT[parts.weekday] ?? "";
      default:
        return token;
    }
  });
}

export function applyTimePattern(
  parts: TimeParts,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string | undefined {
  const pattern = format.pattern ?? "HH:mm";
  if (!/^(HH|H|hh|h|mm|ss|a|[: .])+$/.test(pattern)) {
    diagnostics.push(unsupportedFormat(format, location));
    return undefined;
  }

  return replaceTimeTokens(pattern, parts);
}

export function replaceTimeTokens(pattern: string, parts: TimeParts): string {
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return pattern.replace(/HH|H|hh|h|mm|ss|a/g, (token) => {
    switch (token) {
      case "HH":
        return String(parts.hour).padStart(2, "0");
      case "H":
        return String(parts.hour);
      case "hh":
        return String(hour12).padStart(2, "0");
      case "h":
        return String(hour12);
      case "mm":
        return String(parts.minute).padStart(2, "0");
      case "ss":
        return String(parts.second).padStart(2, "0");
      case "a":
        return parts.hour < 12 ? "AM" : "PM";
      default:
        return token;
    }
  });
}

export function containsDateToken(pattern: string): boolean {
  return /yyyy|yy|MMM|MM|M|dd|d|EEE/.test(pattern);
}

export function containsTimeToken(pattern: string): boolean {
  return /HH|H|hh|h|mm|ss|a/.test(pattern);
}

export function unsupportedFormat(
  format: ResolvedPresentationFormat,
  location: DiagnosticLocation,
): RuntimePresentationDiagnostic {
  return {
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_UNSUPPORTED",
    message: `Presentation format '${format.pattern ?? format.kind}' is not supported by the deterministic runtime formatter.`,
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  };
}

export function invalidFormatValue(
  message: string,
  location: DiagnosticLocation,
): RuntimePresentationDiagnostic {
  return {
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
    message,
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  };
}

export function isJsonPrimitive(value: JsonValue | undefined): value is JsonPrimitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}
