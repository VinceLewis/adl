/**
 * Capturing the authority's own log during a browser test.
 *
 * The `passkey` and `administration` Playwright projects do not spawn an
 * authority process: both harnesses `createServer` from `node:http` inside the
 * Playwright worker. There is no stdout to tail and no log file to slice.
 *
 * There is something better. `createAuthorityHttpHandler` already accepts
 * `logger?: SecurityLogger` (`src/server/authority-http.ts`), and neither
 * harness passed one, so both got `StructuredSecurityLogger`, whose default
 * sink is `console.info` — the authority's log has been going to interleaved
 * worker stdout, attributed to no test. Passing a recorder instead gives an
 * exact, per-test, already-redacted slice, and makes the server's own verdict
 * (`allowed` / `denied` / `failed`) assertable from a browser test for the
 * first time.
 */

import type { SecurityLogEvent, SecurityLogger } from "../../../src/index.js";
import { redactSecurityData } from "../../../src/index.js";

/**
 * A `SecurityLogger` that keeps events in memory, redacted at record time.
 *
 * Slicing is by buffer index, not timestamp: `mark()` before a test body and
 * `since(mark)` after. `fullyParallel: false`, and each authority lives in the
 * `beforeAll` of a single spec file whose tests run serially in one worker, so
 * the slice is exact rather than approximate.
 */
export class RecordingSecurityLogger implements SecurityLogger {
  readonly events: SecurityLogEvent[] = [];

  write(event: SecurityLogEvent): void {
    this.events.push(redactSecurityData(event) as SecurityLogEvent);
  }

  /** Record something the harness itself observed, not the handler. */
  writeHarnessEvent(event: SecurityLogEvent): void {
    this.write(event);
  }

  mark(): number {
    return this.events.length;
  }

  since(mark: number): SecurityLogEvent[] {
    return this.events.slice(mark);
  }
}

/**
 * The active recorder for this worker, if a harness started one.
 *
 * A module-level registry rather than a fixture parameter, because the
 * harnesses are created in `test.beforeAll` in the spec file while the evidence
 * fixture runs per test. Same worker process, so one module instance.
 */
let active: { recorder: RecordingSecurityLogger; origin: string } | undefined;

export function setActiveAuthorityRecorder(
  recorder: RecordingSecurityLogger,
  origin: string,
): void {
  active = { recorder, origin };
}

export function clearActiveAuthorityRecorder(): void {
  active = undefined;
}

export function activeAuthorityRecorder():
  | { recorder: RecordingSecurityLogger; origin: string }
  | undefined {
  return active;
}
