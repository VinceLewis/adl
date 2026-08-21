/**
 * The icon vocabulary: the single source of truth for every semantic icon name
 * ADL recognises.
 *
 * This lives in the model layer rather than in a renderer on purpose. Until
 * Phase 99 there were *two* vocabularies, both buried in rendering code and
 * disagreeing with each other: `iconGlyph` in
 * `src/ui/components/adl-app/render-chrome.ts` knew `home`, `list`, `users`,
 * `sync` and `log-out`; `iconSvg` in `src/ui/components/adl-composed-view.ts`
 * knew `x`, `close` and `menu`. Each silently rendered nothing (or a bare
 * initial letter) for a name only the other knew, so a legal-looking model
 * produced a blank space that could only be discovered by looking at a screen.
 *
 * Two rules keep that from coming back:
 *
 * 1. Every renderer switches over *this* list, and every name in it must render
 *    something real in *every* renderer. The renderers may disagree about the
 *    form — the shell's text chrome draws a single glyph, presentation draws an
 *    inline SVG — but never about the set. `tests/icon-vocabulary.test.ts`
 *    asserts that by looping over {@link ICON_NAMES}, so adding a name here
 *    without teaching both renderers fails the suite.
 * 2. The compiler rejects any icon name that is not in this list, with
 *    `ADL_ICON_NAME_UNKNOWN`. See `docs/spec/language.md` ("Icon vocabulary").
 *
 * The list is the union of what the two renderers supported when it was
 * introduced, plus `check` and `dot`, which the conformance corpus already
 * named. Nothing that rendered before rejects now. Aliases (`mic`/`microphone`,
 * `log-out`/`logout`, `x`/`close`) are all kept: both spellings of each pair
 * were already accepted somewhere, and dropping one would reject a model that
 * renders correctly today for no gain.
 *
 * Adding a name is a language change: add it here, give both renderers a real
 * rendering for it, and document it in `docs/spec/language.md`. Removing one is
 * a breaking change to every app that names it.
 */
export const ICON_NAMES = [
  "calendar",
  "check",
  "close",
  "dot",
  "home",
  "list",
  "log-out",
  "logout",
  "menu",
  "mic",
  "microphone",
  "music",
  "sync",
  "users",
  "x",
] as const;

/** A name drawn from {@link ICON_NAMES}. */
export type IconName = (typeof ICON_NAMES)[number];

/** {@link ICON_NAMES} as a set, for membership tests. */
export const ICON_NAME_SET: ReadonlySet<string> = new Set<string>(ICON_NAMES);

/** Whether `name` is a recognised icon name. */
export function isIconName(name: string): name is IconName {
  return ICON_NAME_SET.has(name);
}
