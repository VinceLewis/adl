import { defineAdlAccessReview } from "./adl-access-review.js";
import { defineAdlActionBar } from "./adl-action-bar.js";
import { defineAdlApp } from "./adl-app.js";
import { defineAdlAuditReview } from "./adl-audit-review.js";
import { defineAdlComposedView } from "./adl-composed-view.js";
import { defineAdlContextSelector } from "./adl-context-selector.js";
import { defineAdlDashboardView } from "./adl-dashboard-view.js";
import { defineAdlFieldRenderer } from "./adl-field-renderer.js";
import { defineAdlFormView } from "./adl-form-view.js";
import { defineAdlListView } from "./adl-list-view.js";
import { defineAdlMessageArea } from "./adl-message-area.js";
import { defineAdlReportRunner } from "./adl-report-runner.js";
import { defineAdlSessionDevices } from "./adl-session-devices.js";
import { defineAdlSessionPanel } from "./adl-session-panel.js";
import { defineAdlStartupError } from "./adl-startup-error.js";
import { defineAdlSyncRecovery } from "./adl-sync-recovery.js";

export function defineAdlComponents(): void {
  defineAdlMessageArea();
  defineAdlActionBar();
  defineAdlComposedView();
  defineAdlContextSelector();
  defineAdlDashboardView();
  defineAdlFieldRenderer();
  defineAdlListView();
  defineAdlFormView();
  defineAdlSessionPanel();
  defineAdlSessionDevices();
  defineAdlSyncRecovery();
  defineAdlStartupError();
  defineAdlAuditReview();
  defineAdlAccessReview();
  defineAdlReportRunner();
  defineAdlApp();
}
