import {
  ADL_LOAD_MORE_ADMINISTRATION_EVENT,
  ADL_REVOKE_MEMBER_SESSIONS_EVENT,
  type AdlAdministrationList,
  type AdlAdministrationListName,
  type AdlAdministrationState,
  type LoadMoreAdministrationDetail,
  type RevokeMemberSessionsDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * Access review for the business context currently selected: who is a member,
 * what invitations are outstanding, whether restore verification is healthy, and
 * what retention is configured to do.
 *
 * Four rules are load-bearing:
 *
 * 1. This component makes no network call and no authorization decision. It
 *    renders what the bridge gives it and dispatches intent upward. The server
 *    derives identity, role and scope for every read, and refuses a revocation
 *    for anyone who is not a current member of the administered context — so
 *    this surface cannot be used to reach outside that scope or to escalate the
 *    operator's own access.
 * 2. A refused read and an empty one look identical. Nothing here says "you are
 *    not permitted"; `unavailable` means no context is selected to administer,
 *    never that the caller lacks permission.
 * 3. Nothing rendered here is a credential. Membership and invite entries are
 *    the server's own status summaries — invite tokens and session verifiers
 *    never leave it — and every interpolated key and value is escaped.
 * 4. Everything is passed through, never derived from. No count, total or
 *    aggregate is computed in the browser; recovery and retention are already
 *    metadata-shaped by the server and are shown exactly as returned.
 */

const UNAVAILABLE_TEXT =
  "Select a business context to review its access. There is nothing to " +
  "administer until one is selected.";

const EXPLAINER_TEXT =
  "Membership, invitations, restore verification and retention for the selected " +
  "context. The server decides what appears here every time it is loaded.";

const MEMBERS_EMPTY_TEXT = "No memberships are recorded here.";
const INVITES_EMPTY_TEXT = "No invitations are recorded here.";

const REVOKE_LABEL = "End their sessions";

const RETENTION_UNAVAILABLE_TEXT = "Retention status is unavailable for this deployment.";

const DEFAULT_STATE: AdlAdministrationState = {
  status: "unavailable",
  accessAudit: { entries: [] },
  runtimeAudit: { entries: [] },
  memberships: { entries: [] },
  invites: { entries: [] },
};

export class AdlAccessReviewElement extends HTMLElement {
  private _state: AdlAdministrationState = cloneState(DEFAULT_STATE);
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this.disabled) {
      return;
    }

    const revoke = target.closest<HTMLElement>("[data-revoke-member]");
    const userId = revoke?.dataset.revokeMember;
    if (userId !== undefined && userId.length > 0) {
      this.dispatchEvent(
        new CustomEvent<RevokeMemberSessionsDetail>(ADL_REVOKE_MEMBER_SESSIONS_EVENT, {
          bubbles: true,
          composed: true,
          detail: { userId },
        }),
      );
      return;
    }

    const more = target.closest<HTMLElement>("[data-access-more]");
    const list = more?.dataset.accessMore;
    if (list === undefined || list.length === 0) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<LoadMoreAdministrationDetail>(ADL_LOAD_MORE_ADMINISTRATION_EVENT, {
        bubbles: true,
        composed: true,
        detail: { list: list as AdlAdministrationListName },
      }),
    );
  };

  set state(state: AdlAdministrationState) {
    this._state = cloneState(state);
    this.render();
  }

  get state(): AdlAdministrationState {
    return cloneState(this._state);
  }

  set busy(busy: boolean) {
    this._busy = busy;
    this.render();
  }

  get busy(): boolean {
    return this._busy;
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
  }

  private get disabled(): boolean {
    return this._busy || this._state.status === "loading";
  }

  private render(): void {
    // Mirrored on the host as well as the rendered root so shell chrome can
    // style or observe the status without reaching inside the component.
    this.setAttribute("data-access-review-status", this._state.status);

    if (this._state.status === "unavailable") {
      this.innerHTML = `
        <section
          class="adl-access-review"
          data-access-review-status="${escapeHtml(this._state.status)}"
          aria-label="Access review"
        >
          <p class="adl-administration-empty" data-access-review-unavailable="true">${escapeHtml(
            UNAVAILABLE_TEXT,
          )}</p>
        </section>
      `;
      return;
    }

    const disabled = this.disabled ? "disabled" : "";
    this.innerHTML = `
      <section
        class="adl-access-review"
        data-access-review-status="${escapeHtml(this._state.status)}"
        aria-label="Access review"
      >
        <h2 class="adl-administration-heading">Access review</h2>
        <p class="adl-administration-hint">${escapeHtml(EXPLAINER_TEXT)}</p>
        ${this.renderMemberships(disabled)}
        ${this.renderInvites(disabled)}
        ${this.renderRecovery()}
        ${this.renderRetention()}
      </section>
    `;
  }

  private renderMemberships(disabled: string): string {
    const list = this._state.memberships;
    return `
      <section class="adl-administration-section" data-access-list="memberships">
        <h3 class="adl-administration-subheading">Members</h3>
        ${
          list.entries.length === 0
            ? `<p class="adl-administration-empty" data-access-empty="memberships">${escapeHtml(
                MEMBERS_EMPTY_TEXT,
              )}</p>`
            : `<ul class="adl-administration-entries">
          ${list.entries.map((entry) => this.renderMember(entry, disabled)).join("")}
        </ul>`
        }
        ${renderMore(list, "memberships", disabled)}
      </section>
    `;
  }

  /**
   * A membership with no readable user id offers no revocation. Read policy may
   * have masked it, and the authority identifies the person to sign out by that
   * id — there is nothing to act on, and inventing a fallback would send a
   * revocation for the wrong subject.
   */
  private renderMember(entry: Record<string, unknown>, disabled: string): string {
    const userId = entry.userId;
    const status = formatValue(entry.status);
    const revocable = typeof userId === "string" && userId.length > 0 && status === "active";
    return `
      <li class="adl-administration-entry adl-access-member" data-membership-status="${escapeHtml(
        status,
      )}">
        <span class="adl-access-member-id">${escapeHtml(
          typeof userId === "string" && userId.length > 0 ? userId : "Member",
        )}</span>
        <span class="adl-access-member-detail">Role: ${escapeHtml(formatValue(entry.role))}</span>
        <span class="adl-access-member-detail">Status: ${escapeHtml(status)}</span>
        ${
          revocable
            ? `<button
          class="adl-access-member-revoke"
          type="button"
          data-revoke-member="${escapeHtml(userId)}"
          ${disabled}
        >${escapeHtml(REVOKE_LABEL)}</button>`
            : ""
        }
      </li>
    `;
  }

  private renderInvites(disabled: string): string {
    const list = this._state.invites;
    return `
      <section class="adl-administration-section" data-access-list="invites">
        <h3 class="adl-administration-subheading">Invitations</h3>
        ${
          list.entries.length === 0
            ? `<p class="adl-administration-empty" data-access-empty="invites">${escapeHtml(
                INVITES_EMPTY_TEXT,
              )}</p>`
            : `<ul class="adl-administration-entries">
          ${list.entries.map((entry) => renderEntry(entry)).join("")}
        </ul>`
        }
        ${renderMore(list, "invites", disabled)}
      </section>
    `;
  }

  /** Flags only. The server sends no count of anything protected, and none is derived here. */
  private renderRecovery(): string {
    const recovery = this._state.recovery;
    return `
      <section class="adl-administration-section" data-access-recovery="true">
        <h3 class="adl-administration-subheading">Restore verification</h3>
        ${
          recovery === undefined
            ? `<p class="adl-administration-empty">Restore verification status has not been loaded.</p>`
            : `<p class="adl-administration-status-line">Verification: ${escapeHtml(
                recovery.ready === true ? "Healthy" : "Not verified",
              )}</p>
        <p class="adl-administration-status-line">Recovery required: ${escapeHtml(
          recovery.recoveryRequired === true ? "Yes" : "No",
        )}</p>
        <p class="adl-administration-status-line">Last restore: ${escapeHtml(
          typeof recovery.lastRestoreAt === "string" && recovery.lastRestoreAt.length > 0
            ? recovery.lastRestoreAt
            : "No restore recorded",
        )}</p>`
        }
      </section>
    `;
  }

  /**
   * Retention is reported and never triggered. There is deliberately no run
   * button: retention is application-wide, while every authorisation reachable
   * from this surface is scoped to one business context, so a trigger here would
   * hand a context manager a destructive application-wide action they do not
   * otherwise have. An operator runs it from the scheduled process entry.
   */
  private renderRetention(): string {
    const retention = this._state.retention;
    if (retention === undefined || retention === null) {
      return `
        <section class="adl-administration-section" data-access-retention="true">
          <h3 class="adl-administration-subheading">Retention</h3>
          <p class="adl-administration-empty">${escapeHtml(RETENTION_UNAVAILABLE_TEXT)}</p>
        </section>
      `;
    }

    const lastRun = retention.lastRun;
    return `
      <section class="adl-administration-section" data-access-retention="true">
        <h3 class="adl-administration-subheading">Retention</h3>
        <p class="adl-administration-status-line" data-retention-schedule="true">Schedule: ${escapeHtml(
          retention.scheduled === true
            ? `runs every ${formatValue(retention.intervalMinutes)} minutes`
            : "not scheduled in this process",
        )}</p>
        <p class="adl-administration-status-line">Minimum retention: ${escapeHtml(
          formatDays(retention.minimumRetentionDays),
        )}</p>
        <p class="adl-administration-status-line">Session retention: ${escapeHtml(
          formatDays(retention.sessionRetentionDays),
        )}</p>
        <p class="adl-administration-status-line">Challenge retention: ${escapeHtml(
          formatDays(retention.challengeRetentionDays),
        )}</p>
        <p class="adl-administration-status-line" data-retention-hold="true">Legal hold: ${escapeHtml(
          retention.legalHold === true ? "On, so nothing is pruned" : "Off",
        )}</p>
        ${
          isRecord(lastRun)
            ? `<p class="adl-administration-status-line" data-retention-last-run="true">Last run: ${escapeHtml(
                formatValue(lastRun.outcome),
              )} at ${escapeHtml(formatValue(lastRun.finishedAt))}, cutoff ${escapeHtml(
                lastRun.effectiveCutoff === null || lastRun.effectiveCutoff === undefined
                  ? "none"
                  : formatValue(lastRun.effectiveCutoff),
              )}</p>
        <p class="adl-administration-status-line">Removed: ${escapeHtml(
          formatValue(lastRun.prunedRuntimeAudit),
        )} audit, ${escapeHtml(formatValue(lastRun.prunedOutcomes))} outcome, ${escapeHtml(
          formatValue(lastRun.prunedSessions),
        )} session, ${escapeHtml(formatValue(lastRun.prunedChallenges))} challenge rows</p>`
            : `<p class="adl-administration-empty" data-retention-last-run="none">Retention has not run yet.</p>`
        }
      </section>
    `;
  }
}

export function defineAdlAccessReview(): void {
  if (customElements.get("adl-access-review") === undefined) {
    customElements.define("adl-access-review", AdlAccessReviewElement);
  }
}

function renderMore(
  list: AdlAdministrationList,
  name: "memberships" | "invites",
  disabled: string,
): string {
  if (list.nextCursor === undefined) {
    return "";
  }

  const moreDisabled = disabled.length > 0 || list.loadingMore === true ? "disabled" : "";
  return `
    <button
      class="adl-administration-more"
      type="button"
      data-access-more="${escapeHtml(name)}"
      ${moreDisabled}
    >Show more</button>
  `;
}

/**
 * An entry is rendered from its own keys rather than a fixed field list, so a
 * key the server adds appears and one it stops sending simply disappears.
 */
function renderEntry(entry: Record<string, unknown>): string {
  return `
    <li class="adl-administration-entry">
      <dl class="adl-administration-pairs">
        ${Object.entries(entry)
          .map(
            ([key, value]) =>
              `<dt class="adl-administration-key">${escapeHtml(key)}</dt><dd class="adl-administration-value">${escapeHtml(
                formatValue(value),
              )}</dd>`,
          )
          .join("")}
      </dl>
    </li>
  `;
}

/** A window in days, read as English. "1 days" is the server's number, badly said. */
function formatDays(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value} day${value === 1 ? "" : "s"}`
    : formatValue(value);
}

/** Values arrive as `unknown`: stringify without inventing a format for them. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneState(state: AdlAdministrationState): AdlAdministrationState {
  return {
    ...state,
    accessAudit: { ...state.accessAudit, entries: [...state.accessAudit.entries] },
    runtimeAudit: { ...state.runtimeAudit, entries: [...state.runtimeAudit.entries] },
    memberships: { ...state.memberships, entries: [...state.memberships.entries] },
    invites: { ...state.invites, entries: [...state.invites.entries] },
  };
}
