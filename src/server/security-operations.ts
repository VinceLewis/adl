import type { AuthorityRateLimits } from "./authority-config.js";

export interface SecurityLogEvent {
  event: string;
  outcome: "allowed" | "denied" | "failed";
  endpoint?: string;
  status?: number;
  reason?: string;
  occurredAt: string;
  [key: string]: unknown;
}

export interface SecurityLogger {
  write(event: SecurityLogEvent): void;
}

/** JSON-line logger that structurally redacts credentials and protected data. */
export class StructuredSecurityLogger implements SecurityLogger {
  constructor(private readonly sink: (line: string) => void = (line) => console.info(line)) {}
  write(event: SecurityLogEvent): void {
    this.sink(JSON.stringify(redactSecurityData(event)));
  }
}

export function redactSecurityData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecurityData);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /(?:token|cookie|authorization|proof|password|secret|record|payload)/iu.test(key)
          ? "[REDACTED]"
          : redactSecurityData(entry),
      ]),
    );
  }
  return value;
}

export interface AuthorityMetricsSnapshot {
  requests: Record<string, number>;
  rejections: Record<string, number>;
  rateLimited: Record<string, number>;
  /** Retention runs by outcome: completed, dryRun, held, failed. */
  retentionRuns: Record<string, number>;
  /** Rows retention deleted, by projection. A dry run adds nothing here. */
  retentionDeleted: Record<string, number>;
}

/** Small dependency-free metrics source; production adapters may scrape it. */
export class AuthorityMetrics {
  private readonly requests = new Map<string, number>();
  private readonly rejections = new Map<string, number>();
  private readonly rateLimited = new Map<string, number>();
  private readonly retentionRuns = new Map<string, number>();
  private readonly retentionDeleted = new Map<string, number>();
  incrementRequest(endpoint: string): void {
    increment(this.requests, endpoint);
  }
  incrementRejection(reason: string): void {
    increment(this.rejections, reason);
  }
  incrementRateLimited(endpoint: string): void {
    increment(this.rateLimited, endpoint);
  }
  /**
   * One retention run finished. The outcome is the whole label: a hold and a
   * failure are operationally different things and an operator alerting on
   * "retention stopped happening" needs to tell them apart.
   */
  incrementRetentionRun(outcome: string): void {
    increment(this.retentionRuns, outcome);
  }
  /**
   * Rows deleted from one projection. Counts only — the projection name is the
   * label, and no row, key or payload is ever a metric dimension. A zero is
   * still recorded so a projection that is configured but quiet is visibly
   * different from one that was never pruned at all.
   */
  incrementRetentionDeleted(projection: string, count: number): void {
    this.retentionDeleted.set(projection, (this.retentionDeleted.get(projection) ?? 0) + count);
  }
  snapshot(): AuthorityMetricsSnapshot {
    return {
      requests: Object.fromEntries(this.requests),
      rejections: Object.fromEntries(this.rejections),
      rateLimited: Object.fromEntries(this.rateLimited),
      retentionRuns: Object.fromEntries(this.retentionRuns),
      retentionDeleted: Object.fromEntries(this.retentionDeleted),
    };
  }
  prometheus(): string {
    return [
      "# TYPE adl_authority_requests_total counter",
      ...toPrometheus("adl_authority_requests_total", this.requests),
      "# TYPE adl_authority_rejections_total counter",
      ...toPrometheus("adl_authority_rejections_total", this.rejections, "reason"),
      "# TYPE adl_authority_rate_limited_total counter",
      ...toPrometheus("adl_authority_rate_limited_total", this.rateLimited),
      "# TYPE adl_authority_retention_runs_total counter",
      ...toPrometheus("adl_authority_retention_runs_total", this.retentionRuns, "outcome"),
      "# TYPE adl_authority_retention_deleted_total counter",
      ...toPrometheus("adl_authority_retention_deleted_total", this.retentionDeleted, "projection"),
      "",
    ].join("\n");
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface AuthorityRateLimiter {
  check(bucket: keyof AuthorityRateLimits, clientKey: string, limit: number): RateLimitDecision;
}

/** In-memory fixed window limiter. Deployments may substitute a shared store. */
export class FixedWindowRateLimiter implements AuthorityRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000,
  ) {}
  check(bucket: keyof AuthorityRateLimits, clientKey: string, limit: number): RateLimitDecision {
    const key = `${bucket}\u0000${clientKey}`;
    const now = this.now();
    const current = this.windows.get(key);
    const window =
      current === undefined || now - current.startedAt >= this.windowMs
        ? { startedAt: now, count: 0 }
        : current;
    window.count += 1;
    this.windows.set(key, window);
    return window.count <= limit
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((this.windowMs - (now - window.startedAt)) / 1000),
          ),
        };
  }
}

function increment(values: Map<string, number>, key: string): void {
  values.set(key, (values.get(key) ?? 0) + 1);
}
function toPrometheus(name: string, entries: Map<string, number>, label = "endpoint"): string[] {
  return [...entries].map(([key, value]) => `${name}{${label}=${JSON.stringify(key)}} ${value}`);
}
