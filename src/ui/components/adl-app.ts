import { AdlAppElement } from "./adl-app/index.js";

export { AdlAppElement } from "./adl-app/index.js";

export function defineAdlApp(): void {
  if (customElements.get("adl-app") === undefined) {
    customElements.define("adl-app", AdlAppElement);
  }
}
