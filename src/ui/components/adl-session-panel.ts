import {
  ADL_CLAIM_INVITE_EVENT,
  ADL_SIGN_IN_EVENT,
  ADL_SIGN_OUT_EVENT,
  AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH,
  AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH,
  type AdlInviteState,
  type AdlSessionState,
  type ClaimInviteDetail,
  type SignInDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * Sign-in, sign-out and invite-claim surface for the authority session.
 *
 * The component makes no network call and no authorization decision: it renders
 * the session state the bridge gives it and dispatches intent events upward.
 * Three rules are load-bearing here and must survive any edit:
 *
 * 1. A bypassed identity verifier (`session.developmentMode`) is labelled as a
 *    development mode in both the signed-out and signed-in states. A deployment
 *    that accepts an unverified account proof must never look like a verified
 *    sign-in.
 * 2. Invite claiming is online-only. Offline the control is disabled, the
 *    refusal is stated, and no event is dispatched, so nothing pre-grants
 *    membership or caches a claim for later replay.
 * 3. The account proof and the invite token exist only as the live value of
 *    their input. They are never written to a data attribute, a URL, storage,
 *    a rendered string, or a field of this element, and both inputs are cleared
 *    as soon as their event is dispatched.
 */

const DEVELOPMENT_WARNING_TEXT =
  "Development sign-in. This authority is accepting an unverified account proof, " +
  "so this is a development mode and not a verified identity.";

const OFFLINE_CLAIM_TEXT =
  "Claiming an invitation needs a connection. It cannot be queued for later, so " +
  "reconnect and claim again.";

const SHORT_ACCOUNT_PROOF_HINT =
  `This account proof looks shorter than the ${AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH} ` +
  "characters the authority requires. The authority still decides.";

const SHORT_INVITE_TOKEN_HINT =
  `This invitation token looks shorter than the ${AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH} ` +
  "characters the authority requires. The authority still decides.";

const EMPTY_ACCOUNT_PROOF_HINT = "Enter the account proof issued by your identity provider.";

const EMPTY_INVITE_TOKEN_HINT = "Enter the invitation token you were sent.";

const DEFAULT_SESSION: AdlSessionState = {
  status: "unavailable",
  developmentMode: false,
  busy: false,
};

const DEFAULT_INVITE: AdlInviteState = { status: "idle" };

export class AdlSessionPanelElement extends HTMLElement {
  private _session: AdlSessionState = { ...DEFAULT_SESSION };
  private _invite: AdlInviteState = { ...DEFAULT_INVITE };
  private _online = true;

  private readonly handleSubmit = (event: Event): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    // Never let the browser navigate: a native submission would put the typed
    // credential in a URL.
    event.preventDefault();
    if (this._session.busy) {
      return;
    }

    if (form.dataset.sessionSignInForm === "true") {
      this.submitSignIn(form);
      return;
    }

    if (form.dataset.sessionInviteForm === "true") {
      this.submitClaimInvite(form);
    }
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("[data-session-sign-out='true']") === null || this._session.busy) {
      return;
    }

    this.dispatchEvent(new CustomEvent(ADL_SIGN_OUT_EVENT, { bubbles: true, composed: true }));
  };

  private readonly handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    // Only the length of the live value is read, and only to show a hint; the
    // value itself is never copied out of the input.
    if (target.dataset.sessionAccountProof === "true") {
      this.setHint(
        "[data-session-proof-hint='true']",
        target.value.length > 0 && target.value.length < AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH
          ? SHORT_ACCOUNT_PROOF_HINT
          : "",
      );
      return;
    }

    if (target.dataset.sessionInviteToken === "true") {
      this.setHint(
        "[data-session-invite-hint='true']",
        target.value.length > 0 && target.value.length < AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH
          ? SHORT_INVITE_TOKEN_HINT
          : "",
      );
    }
  };

  set session(session: AdlSessionState) {
    if (sessionEquals(this._session, session)) {
      return;
    }

    this._session = { ...session };
    this.render();
  }

  get session(): AdlSessionState {
    return { ...this._session };
  }

  set invite(invite: AdlInviteState) {
    if (inviteEquals(this._invite, invite)) {
      return;
    }

    this._invite = { ...invite };
    this.render();
  }

  get invite(): AdlInviteState {
    return { ...this._invite };
  }

  set online(online: boolean) {
    if (this._online === online) {
      return;
    }

    this._online = online;
    // Connectivity flaps while a token is half typed, so the online state is
    // applied in place where possible rather than re-rendering the field away.
    if (!this.applyClaimAvailability()) {
      this.render();
    }
  }

  get online(): boolean {
    return this._online;
  }

  connectedCallback(): void {
    this.addEventListener("submit", this.handleSubmit);
    this.addEventListener("click", this.handleClick);
    this.addEventListener("input", this.handleInput);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("submit", this.handleSubmit);
    this.removeEventListener("click", this.handleClick);
    this.removeEventListener("input", this.handleInput);
  }

  private submitSignIn(form: HTMLFormElement): void {
    const input = form.querySelector<HTMLInputElement>("[data-session-account-proof='true']");
    if (input === null) {
      return;
    }

    const accountProof = input.value;
    if (accountProof.length === 0) {
      this.setHint("[data-session-proof-hint='true']", EMPTY_ACCOUNT_PROOF_HINT);
      return;
    }

    // Cleared before dispatch so the proof does not outlive the attempt, even
    // if a listener re-enters this element synchronously.
    input.value = "";
    this.setHint("[data-session-proof-hint='true']", "");
    this.dispatchEvent(
      new CustomEvent<SignInDetail>(ADL_SIGN_IN_EVENT, {
        bubbles: true,
        composed: true,
        detail: { accountProof },
      }),
    );
  }

  private submitClaimInvite(form: HTMLFormElement): void {
    // Online-only, enforced here as well as by the disabled control: a claim is
    // never queued, cached, or optimistically granted.
    if (!this._online || this._invite.status === "claiming") {
      return;
    }

    const input = form.querySelector<HTMLInputElement>("[data-session-invite-token='true']");
    if (input === null) {
      return;
    }

    const inviteToken = input.value;
    if (inviteToken.length === 0) {
      this.setHint("[data-session-invite-hint='true']", EMPTY_INVITE_TOKEN_HINT);
      return;
    }

    input.value = "";
    this.setHint("[data-session-invite-hint='true']", "");
    this.dispatchEvent(
      new CustomEvent<ClaimInviteDetail>(ADL_CLAIM_INVITE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { inviteToken },
      }),
    );
  }

  private setHint(selector: string, text: string): void {
    const hint = this.querySelector<HTMLElement>(selector);
    if (hint === null) {
      return;
    }

    // textContent, not innerHTML: hint text is never interpolated into markup.
    hint.textContent = text;
    hint.hidden = text.length === 0;
  }

  /** Returns false when there is no claim control to update, so a full render is needed. */
  private applyClaimAvailability(): boolean {
    const claim = this.querySelector<HTMLButtonElement>("[data-session-claim-invite='true']");
    const token = this.querySelector<HTMLInputElement>("[data-session-invite-token='true']");
    const note = this.querySelector<HTMLElement>("[data-session-offline-note='true']");
    if (claim === null || token === null || note === null) {
      return false;
    }

    claim.disabled = this.claimDisabled();
    token.disabled = this.claimDisabled();
    note.hidden = this._online;
    return true;
  }

  private claimDisabled(): boolean {
    return this._session.busy || !this._online || this._invite.status === "claiming";
  }

  private render(): void {
    const status = this._session.status;
    this.dataset.sessionStatus = status;
    this.innerHTML = `
      <section class="adl-session-panel" data-session-status="${escapeHtml(status)}" aria-label="Authority session">
        ${
          status === "signedIn"
            ? this.renderSignedIn()
            : status === "signedOut"
              ? this.renderSignedOut()
              : this.renderUnavailable()
        }
      </section>
    `;
  }

  private renderSignedOut(): string {
    const disabled = this._session.busy ? "disabled" : "";

    return `
      <h2 class="adl-session-heading">Sign in</h2>
      ${this.renderDevelopmentWarning()}
      ${this.renderError()}
      <form class="adl-session-form" data-session-sign-in-form="true">
        <label class="adl-session-label">
          <span>Account proof</span>
          <input
            class="adl-session-input"
            type="password"
            data-session-account-proof="true"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ${disabled}
          />
        </label>
        <p class="adl-session-hint" data-session-proof-hint="true" hidden></p>
        <button class="adl-session-submit" type="submit" data-session-sign-in="true" ${disabled}>
          Sign in
        </button>
      </form>
    `;
  }

  private renderSignedIn(): string {
    const disabled = this._session.busy ? "disabled" : "";
    const claimDisabled = this.claimDisabled() ? "disabled" : "";

    return `
      <p class="adl-session-identity" data-session-identity="true">
        <span>Signed in as</span>
        <strong class="adl-session-identity-value">${escapeHtml(this._session.userId ?? "")}</strong>
      </p>
      ${this.renderDevelopmentWarning()}
      ${this.renderError()}
      <button class="adl-session-sign-out" type="button" data-session-sign-out="true" ${disabled}>
        Sign out
      </button>
      <form class="adl-session-form adl-session-invite-form" data-session-invite-form="true">
        <h2 class="adl-session-heading">Claim an invitation</h2>
        <label class="adl-session-label">
          <span>Invitation token</span>
          <input
            class="adl-session-input"
            type="text"
            data-session-invite-token="true"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ${claimDisabled}
          />
        </label>
        <p class="adl-session-hint" data-session-invite-hint="true" hidden></p>
        <p class="adl-session-offline-note" data-session-offline-note="true" ${
          this._online ? "hidden" : ""
        }>${escapeHtml(OFFLINE_CLAIM_TEXT)}</p>
        <button
          class="adl-session-submit"
          type="submit"
          data-session-claim-invite="true"
          ${claimDisabled}
        >
          Claim invitation
        </button>
        ${this.renderInviteStatus()}
      </form>
    `;
  }

  private renderUnavailable(): string {
    return `
      <p class="adl-session-unavailable" data-session-unavailable="true">
        The authority could not be reached. The app is running on local data.
      </p>
      ${this.renderError()}
    `;
  }

  private renderDevelopmentWarning(): string {
    if (!this._session.developmentMode) {
      return "";
    }

    return `
      <p class="adl-session-development-warning" data-session-development-warning="true">
        <strong>Development mode.</strong>
        <span>${escapeHtml(DEVELOPMENT_WARNING_TEXT)}</span>
      </p>
    `;
  }

  private renderError(): string {
    const error = this._session.error;
    if (error === undefined || error.length === 0) {
      return "";
    }

    return `
      <p class="adl-session-error" data-session-error="true" role="alert">${escapeHtml(error)}</p>
    `;
  }

  private renderInviteStatus(): string {
    const status = this._invite.status;
    if (status === "idle") {
      return "";
    }

    const message = this._invite.message;
    const text =
      status === "claiming"
        ? "Claiming the invitation. The authority decides whether it is granted."
        : status === "accepted"
          ? (message ?? "Invitation accepted. The authority granted the membership.")
          : status === "offline"
            ? (message ?? OFFLINE_CLAIM_TEXT)
            : (message ?? "The authority rejected this invitation.");

    return `
      <p
        class="adl-session-invite-status adl-session-invite-status-${escapeHtml(status)}"
        data-invite-status="${escapeHtml(status)}"
        role="status"
      >${escapeHtml(text)}</p>
    `;
  }
}

export function defineAdlSessionPanel(): void {
  if (customElements.get("adl-session-panel") === undefined) {
    customElements.define("adl-session-panel", AdlSessionPanelElement);
  }
}

function sessionEquals(left: AdlSessionState, right: AdlSessionState): boolean {
  return (
    left.status === right.status &&
    left.userId === right.userId &&
    left.developmentMode === right.developmentMode &&
    left.busy === right.busy &&
    left.error === right.error
  );
}

function inviteEquals(left: AdlInviteState, right: AdlInviteState): boolean {
  return left.status === right.status && left.message === right.message;
}
