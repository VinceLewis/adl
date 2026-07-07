import { defineAdlActionBar } from "./adl-action-bar.js";
import { defineAdlApp } from "./adl-app.js";
import { defineAdlContextSelector } from "./adl-context-selector.js";
import { defineAdlFieldRenderer } from "./adl-field-renderer.js";
import { defineAdlFormView } from "./adl-form-view.js";
import { defineAdlListView } from "./adl-list-view.js";
import { defineAdlMessageArea } from "./adl-message-area.js";

export function defineAdlComponents(): void {
  defineAdlMessageArea();
  defineAdlActionBar();
  defineAdlContextSelector();
  defineAdlFieldRenderer();
  defineAdlListView();
  defineAdlFormView();
  defineAdlApp();
}
