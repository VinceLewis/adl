import {
  ADL_CLAIM_INVITE_EVENT,
  ADL_PASSKEY_SIGN_IN_EVENT,
  ADL_REGISTER_PASSKEY_EVENT,
  ADL_SIGN_IN_EVENT,
  ADL_SIGN_OUT_EVENT,
  AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH,
  AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH,
  PASSKEY_IDENTITY_MODE,
  type AdlInviteState,
  type AdlSessionState,
  type ClaimInviteDetail,
  type RegisterPasskeyDetail,
  type SignInDetail,
} from "../authority-bridge.js";
import { DEFAULT_OFFLINE_GRACE_DAYS } from "../../model/defaults.js";
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
 * 4. In `passkey` mode there is no credential to type at all. The surface
 *    offers a sign-in that runs an authority-challenged ceremony and a
 *    registration that needs an invitation, and it never shows an account-proof
 *    field — a passkey deployment must not keep a second, weaker way in beside
 *    the ceremony.
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

const PASSKEY_SIGN_IN_TEXT =
  "Sign in with the passkey on this device. Your device proves who you are to the " +
  "server; nothing you type is used as a credential.";

/*
 * Three routes, and each one now says where it comes from. The old copy
 * offered an "Invitation token" field and nowhere explained where a token
 * comes from, which left the only way in undocumented on the surface that is
 * meant to explain it. This panel is generic shell chrome shared by every ADL
 * app, so none of this copy may name bands, circles or groups.
 */
const PASSKEY_REGISTER_TEXT =
  "Someone already using this app can send you an invitation token. Paste it here " +
  "to join what they have set up — or to set up a replacement device for an " +
  "account you have lost access to.";

const PASSKEY_SELF_REGISTER_TEXT =
  "New here? Create an account with a passkey on this device. You will start with " +
  "nothing of your own until you set something up or someone invites you.";

const PASSKEY_ADD_DEVICE_TEXT =
  "Register another passkey so you can sign in from a second device. This adds to " +
  "your existing access; it does not replace it.";

const PASSKEY_UNSUPPORTED_TEXT =
  "This browser cannot use passkeys, so it cannot sign in to this deployment. " +
  "Use a browser with WebAuthn support.";

const OFFLINE_IDENTITY_TEXT =
  "The authority server could not be reached, so this device is working from its " +
  "own data. Everything here keeps working offline.";

const GRACE_EXPIRED_TEXT =
  "Syncing is paused. This device has not reached the server for longer than the " +
  "offline period allows, so it needs a fresh sign-in before it can sync again. " +
  "Nothing has been lost: the app still works offline and any unsent changes are kept.";

const DEFAULT_SESSION: AdlSessionState = {
  status: "unavailable",
  developmentMode: false,
  identityMode: "unknown",
  passkeySupported: false,
  // Fail closed. The control appears only once the authority has said it may.
  selfServiceRegistration: false,
  busy: false,
  grace: { status: "noIdentity", offlineGraceDays: DEFAULT_OFFLINE_GRACE_DAYS },
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
      return;
    }

    if (form.dataset.sessionPasskeyForm === "true") {
      this.submitRegisterPasskey(form);
    }
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (this._session.busy) {
      return;
    }

    if (target.closest("[data-session-passkey-sign-in='true']") !== null) {
      this.dispatchEvent(
        new CustomEvent(ADL_PASSKEY_SIGN_IN_EVENT, { bubbles: true, composed: true }),
      );
      return;
    }

    if (target.closest("[data-session-self-register='true']") !== null) {
      /*
       * The same event, with the same empty detail, that the signed-in
       * "Register another passkey" control dispatches. There is deliberately
       * no new event and no new bridge method: the browser sends no invite
       * token and no session cookie, and the *authority* decides what that
       * means. A separate control rather than an empty-token submission of the
       * invitation form, because they are two different intents — and because
       * it leaves that form's own empty-token refusal intact.
       */
      this.dispatchEvent(
        new CustomEvent<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT, {
          bubbles: true,
          composed: true,
          detail: {},
        }),
      );
      return;
    }

    if (target.closest("[data-session-add-passkey='true']") !== null) {
      // Adding a device to an identity that already holds a session needs no
      // invitation: the session itself is the authorisation.
      this.dispatchEvent(
        new CustomEvent<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT, {
          bubbles: true,
          composed: true,
          detail: {},
        }),
      );
      return;
    }

    if (target.closest("[data-session-sign-out='true']") === null) {
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

    if (
      target.dataset.sessionInviteToken === "true" ||
      target.dataset.sessionPasskeyInvite === "true"
    ) {
      this.setHint(
        target.dataset.sessionPasskeyInvite === "true"
          ? "[data-session-passkey-hint='true']"
          : "[data-session-invite-hint='true']",
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

  /**
   * Starts an invite-backed registration. The token is read from the live input
   * and cleared before dispatch, exactly as the account proof and the claim
   * token are: it is a credential and must not outlive the attempt.
   */
  private submitRegisterPasskey(form: HTMLFormElement): void {
    const input = form.querySelector<HTMLInputElement>("[data-session-passkey-invite='true']");
    if (input === null) {
      return;
    }

    const inviteToken = input.value;
    if (inviteToken.length === 0) {
      this.setHint("[data-session-passkey-hint='true']", EMPTY_INVITE_TOKEN_HINT);
      return;
    }

    input.value = "";
    this.setHint("[data-session-passkey-hint='true']", "");
    this.dispatchEvent(
      new CustomEvent<RegisterPasskeyDetail>(ADL_REGISTER_PASSKEY_EVENT, {
        bubbles: true,
        composed: true,
        detail: { inviteToken },
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

  private get passkeyMode(): boolean {
    return this._session.identityMode === PASSKEY_IDENTITY_MODE;
  }

  private renderSignedOut(): string {
    return this.passkeyMode ? this.renderPasskeySignedOut() : this.renderProofSignedOut();
  }

  /**
   * The passkey way in. There is deliberately no credential field: the device
   * proves the identity to the authority, and the only thing a person may type
   * is an invitation token, which authorises registering a device rather than
   * signing in.
   */
  private renderPasskeySignedOut(): string {
    const disabled = this._session.busy || !this._session.passkeySupported ? "disabled" : "";

    return `
      <h2 class="adl-session-heading">Sign in</h2>
      ${this.renderDevelopmentWarning()}
      ${this.renderError()}
      ${
        this._session.passkeySupported
          ? ""
          : `<p class="adl-session-error" data-session-passkey-unsupported="true" role="alert">${escapeHtml(
              PASSKEY_UNSUPPORTED_TEXT,
            )}</p>`
      }
      <p class="adl-session-hint adl-session-passkey-explainer">${escapeHtml(PASSKEY_SIGN_IN_TEXT)}</p>
      <button
        class="adl-session-submit"
        type="button"
        data-session-passkey-sign-in="true"
        ${disabled}
      >
        Sign in with a passkey
      </button>
      ${
        this._session.selfServiceRegistration
          ? `<section class="adl-session-route" data-session-self-register-route="true">
              <h2 class="adl-session-heading">Create an account</h2>
              <p class="adl-session-hint adl-session-passkey-explainer">${escapeHtml(
                PASSKEY_SELF_REGISTER_TEXT,
              )}</p>
              <button
                class="adl-session-submit"
                type="button"
                data-session-self-register="true"
                ${disabled}
              >
                Create an account
              </button>
            </section>`
          : ""
      }
      <form class="adl-session-passkey-form" data-session-passkey-form="true">
        <h2 class="adl-session-heading">Join with an invitation</h2>
        <p class="adl-session-hint adl-session-passkey-explainer">${escapeHtml(
          PASSKEY_REGISTER_TEXT,
        )}</p>
        <label class="adl-session-label">
          <span>Invitation token</span>
          <input
            class="adl-session-input"
            type="text"
            data-session-passkey-invite="true"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ${disabled}
          />
        </label>
        <p class="adl-session-hint" data-session-passkey-hint="true" hidden></p>
        <button
          class="adl-session-submit"
          type="submit"
          data-session-register-passkey="true"
          ${disabled}
        >
          Register a passkey
        </button>
      </form>
    `;
  }

  private renderProofSignedOut(): string {
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
      ${this.renderNotice()}
      ${this.renderError()}
      <button class="adl-session-sign-out" type="button" data-session-sign-out="true" ${disabled}>
        Sign out
      </button>
      ${
        this.passkeyMode && this._session.passkeySupported
          ? `
      <section class="adl-session-add-passkey">
        <h2 class="adl-session-heading">Add another device</h2>
        <p class="adl-session-hint adl-session-passkey-explainer">${escapeHtml(
          PASSKEY_ADD_DEVICE_TEXT,
        )}</p>
        <button
          class="adl-session-submit"
          type="button"
          data-session-add-passkey="true"
          ${disabled}
        >
          Register another passkey
        </button>
      </section>`
          : ""
      }
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

  /**
   * The offline state. It says who the app believes is using it, because that
   * identity is what its local data is scoped to — losing it is what made a
   * user's own records unreadable to them.
   *
   * Outside the grace this also carries the sync-paused prompt and, in passkey
   * mode, the ceremony that clears it. There is deliberately no credential
   * field: a grace-expired prompt must not become a second, weaker way in.
   */
  private renderUnavailable(): string {
    const identity = this._session.userId;

    return `
      <p class="adl-session-unavailable" data-session-unavailable="true">
        ${escapeHtml(OFFLINE_IDENTITY_TEXT)}
      </p>
      ${
        identity === undefined
          ? ""
          : `
      <p class="adl-session-identity" data-session-identity="true">
        <span>Working offline as</span>
        <strong class="adl-session-identity-value">${escapeHtml(identity)}</strong>
      </p>`
      }
      ${this.renderGrace()}
      ${this.renderError()}
    `;
  }

  /**
   * The grace clock, rendered only when this device has actually authenticated
   * here. `noIdentity` is not an expired grace — there is no session to extend
   * — so it gets the ordinary sign-in surface instead of a scary refusal.
   */
  private renderGrace(): string {
    const grace = this._session.grace;
    if (grace.status === "noIdentity") {
      return "";
    }

    if (grace.status === "withinGrace") {
      const by = formatGraceDate(grace.expiresAt);
      return `
      <p class="adl-session-grace" data-session-grace="withinGrace" role="status">
        Syncing resumes when this device reconnects${
          by === "" ? "" : `, as long as it signs in again by ${escapeHtml(by)}`
        }.
      </p>
    `;
    }

    const disabled = this._session.busy || !this._session.passkeySupported ? "disabled" : "";
    return `
      <section class="adl-session-grace-expired" data-session-grace="expired">
        <p class="adl-session-grace-expired-text" role="alert">${escapeHtml(GRACE_EXPIRED_TEXT)}</p>
        ${
          this.passkeyMode && this._session.passkeySupported
            ? `<button
          class="adl-session-submit"
          type="button"
          data-session-passkey-sign-in="true"
          ${disabled}
        >
          Sign in with a passkey
        </button>`
            : ""
        }
      </section>
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

  private renderNotice(): string {
    const notice = this._session.notice;
    if (notice === undefined || notice.length === 0) {
      return "";
    }

    return `
      <p class="adl-session-notice" data-session-notice="true" role="status">${escapeHtml(notice)}</p>
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
    left.identityMode === right.identityMode &&
    left.passkeySupported === right.passkeySupported &&
    /*
     * Load-bearing. This is a pure-equality short circuit ahead of `render()`,
     * and the readiness probe answers *after* the panel has already rendered
     * once from the fail-closed default — so omitting this field means the
     * panel never re-renders when the answer arrives and the create-an-account
     * control never appears at all.
     */
    left.selfServiceRegistration === right.selfServiceRegistration &&
    left.busy === right.busy &&
    left.error === right.error &&
    left.notice === right.notice &&
    left.grace.status === right.grace.status &&
    left.grace.expiresAt === right.grace.expiresAt
  );
}

/** Date only: the hour a grace lapses is noise, and the day is what a person acts on. */
function formatGraceDate(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function inviteEquals(left: AdlInviteState, right: AdlInviteState): boolean {
  return left.status === right.status && left.message === right.message;
}
