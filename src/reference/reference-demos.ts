import { bandReferenceDemo, giggleBandExampleDemo } from "./band-app.js";
import { jointlyReferenceDemo } from "./jointly-app.js";
import type { ReferenceDemoDefinition } from "./reference-demo.js";

/**
 * Every reference app the browser demo picker (`?demo=`) can mount. Adding an
 * app here — and nowhere else — is the whole registration: `src/ui/main.ts`'s
 * `mountDemo` only ever looks a demo up by id in this list.
 */
export const referenceDemos: ReferenceDemoDefinition[] = [
  giggleBandExampleDemo,
  bandReferenceDemo,
  jointlyReferenceDemo,
];

export function findReferenceDemo(id: string | null): ReferenceDemoDefinition | undefined {
  if (id === null) return undefined;
  return referenceDemos.find((demo) => demo.id === id);
}
