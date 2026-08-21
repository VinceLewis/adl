import type {
  ResolvedShell,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedShellVisibility,
  ShellContextSelectorPlacement,
  ShellControlKind,
  ShellControlPlacement,
  ShellMobileContextSelectorMode,
  ShellNavigationMode,
  ShellVisibilityKind,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic, ModelValidationCode } from "./codes.js";
import { validateIconName } from "./icon.js";
import { diagnostic, indexByName, reportDuplicateNames } from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";

const SHELL_CONTROL_KINDS = new Set<ShellControlKind>([
  "contextSelector",
  "themeSwitch",
  "logout",
  "pwaInstall",
  "syncStatus",
  "connectivity",
  "commandAction",
]);
const SHELL_CONTROL_PLACEMENTS = new Set<ShellControlPlacement>([
  "topBar",
  "navDrawer",
  "emptyState",
]);
const SHELL_CONTEXT_SELECTOR_PLACEMENTS = new Set<ShellContextSelectorPlacement>([
  "topBar",
  "navDrawer",
  "hidden",
]);
const SHELL_MOBILE_CONTEXT_SELECTOR_MODES = new Set<ShellMobileContextSelectorMode>([
  "dropdown",
  "sheet",
]);
const SHELL_NAVIGATION_MODES = new Set<ShellNavigationMode>([
  "explicitOnly",
  "includeUnlistedViews",
]);
const SHELL_VISIBILITY_KINDS = new Set<ShellVisibilityKind>([
  "always",
  "contextAvailable",
  "contextUnavailable",
  "contextSelected",
  "online",
  "offline",
]);
const SHELL_ICON_PATTERN = /^[a-z][a-z0-9-]*$/;
export function validateShell(
  shell: ResolvedShell,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!SHELL_NAVIGATION_MODES.has(shell.nav.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_NAV_MODE_INVALID,
        `Shell navigation has invalid mode '${String(shell.nav.mode)}'.`,
        "shell.nav.mode",
      ),
    );
  }

  reportDuplicateNames(
    shell.nav.items,
    "shell.nav.items",
    MODEL_VALIDATION_CODES.SHELL_NAV_DUPLICATE,
    diagnostics,
    "Shell navigation item names must be unique.",
  );
  reportDuplicateShellOrders(shell.nav.items, diagnostics);

  for (let itemIndex = 0; itemIndex < shell.nav.items.length; itemIndex += 1) {
    const item = shell.nav.items[itemIndex];
    if (item === undefined) {
      continue;
    }
    validateShellNavItem(item, `shell.nav.items[${itemIndex}]`, indexes, diagnostics);
  }

  reportDuplicateNames(
    shell.controls,
    "shell.controls",
    MODEL_VALIDATION_CODES.SHELL_CONTROL_DUPLICATE,
    diagnostics,
    "Shell control names must be unique.",
  );
  const controlsByName = indexByName(shell.controls);

  for (let controlIndex = 0; controlIndex < shell.controls.length; controlIndex += 1) {
    const control = shell.controls[controlIndex];
    if (control === undefined) {
      continue;
    }
    validateShellControl(control, `shell.controls[${controlIndex}]`, indexes, diagnostics);
  }

  if (!SHELL_CONTEXT_SELECTOR_PLACEMENTS.has(shell.topBar.contextSelector)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTEXT_SELECTOR_PLACEMENT_INVALID,
        `Shell top bar has invalid context selector placement '${String(
          shell.topBar.contextSelector,
        )}'.`,
        "shell.topBar.contextSelector",
      ),
    );
  }

  if (!SHELL_MOBILE_CONTEXT_SELECTOR_MODES.has(shell.topBar.mobileContextSelector)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_MOBILE_CONTEXT_SELECTOR_INVALID,
        `Shell top bar has invalid mobile context selector mode '${String(
          shell.topBar.mobileContextSelector,
        )}'.`,
        "shell.topBar.mobileContextSelector",
      ),
    );
  }

  validateShellRegionControls(
    shell.topBar.controls,
    "topBar",
    "shell.topBar.controls",
    "Shell top bar",
    {
      unknown: MODEL_VALIDATION_CODES.SHELL_TOP_BAR_CONTROL_UNKNOWN,
      placement: MODEL_VALIDATION_CODES.SHELL_TOP_BAR_CONTROL_PLACEMENT_MISMATCH,
    },
    controlsByName,
    diagnostics,
  );
  validateShellRegionControls(
    shell.navDrawer.controls,
    "navDrawer",
    "shell.navDrawer.controls",
    "Shell navigation drawer",
    {
      unknown: MODEL_VALIDATION_CODES.SHELL_NAV_DRAWER_CONTROL_UNKNOWN,
      placement: MODEL_VALIDATION_CODES.SHELL_NAV_DRAWER_CONTROL_PLACEMENT_MISMATCH,
    },
    controlsByName,
    diagnostics,
  );
}
/**
 * A region's control list names controls; a control's own `placement` says which
 * region renders it. Both had to agree for anything to appear, and nothing
 * checked that they did, so a control listed in the region it is not placed in
 * simply never rendered and the model looked correct.
 */
function validateShellRegionControls(
  controlNames: string[],
  placement: ShellControlPlacement,
  regionPath: string,
  regionLabel: string,
  codes: { unknown: ModelValidationCode; placement: ModelValidationCode },
  controlsByName: Map<string, NamedReference<ResolvedShellControl>>,
  diagnostics: Diagnostic[],
): void {
  for (let controlIndex = 0; controlIndex < controlNames.length; controlIndex += 1) {
    const controlName = controlNames[controlIndex];
    if (controlName === undefined) {
      continue;
    }

    const control = controlsByName.get(controlName)?.item;
    if (control === undefined) {
      diagnostics.push(
        diagnostic(
          codes.unknown,
          `${regionLabel} references unknown control '${controlName}'.`,
          `${regionPath}[${controlIndex}]`,
        ),
      );
      continue;
    }

    if (control.placement !== placement) {
      diagnostics.push(
        diagnostic(
          codes.placement,
          `${regionLabel} lists control '${controlName}', which is placed in '${String(control.placement)}' and so never renders there.`,
          `${regionPath}[${controlIndex}]`,
        ),
      );
    }
  }
}
function reportDuplicateShellOrders(
  items: ResolvedShellNavItem[],
  diagnostics: Diagnostic[],
): void {
  const orderPaths = new Map<number, number>();

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    if (item === undefined) {
      continue;
    }

    const existingIndex = orderPaths.get(item.order);
    if (existingIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.SHELL_NAV_ORDER_DUPLICATE,
          `Shell navigation order ${item.order} is used by more than one item.`,
          `shell.nav.items[${itemIndex}].order`,
        ),
      );
      continue;
    }

    orderPaths.set(item.order, itemIndex);
  }
}
function validateShellNavItem(
  item: ResolvedShellNavItem,
  itemPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!indexes.viewNames.has(item.view)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_NAV_VIEW_UNKNOWN,
        `Shell navigation item '${item.name}' references unknown view '${item.view}'.`,
        `${itemPath}.view`,
      ),
    );
  }

  validateShellIcon(
    item.icon,
    `${itemPath}.icon`,
    MODEL_VALIDATION_CODES.SHELL_NAV_ICON_INVALID,
    diagnostics,
  );
  validateShellVisibility(item.visibility, `${itemPath}.visibility`, indexes, diagnostics);

  for (let activeIndex = 0; activeIndex < item.activeWhen.length; activeIndex += 1) {
    const activeView = item.activeWhen[activeIndex];
    if (activeView === undefined || indexes.viewNames.has(activeView)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_NAV_ACTIVE_VIEW_UNKNOWN,
        `Shell navigation item '${item.name}' active state references unknown view '${activeView}'.`,
        `${itemPath}.activeWhen[${activeIndex}]`,
      ),
    );
  }
}
function validateShellControl(
  control: ResolvedShellControl,
  controlPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!SHELL_CONTROL_KINDS.has(control.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_KIND_INVALID,
        `Shell control '${control.name}' has invalid kind '${String(control.kind)}'.`,
        `${controlPath}.kind`,
      ),
    );
  }

  if (!SHELL_CONTROL_PLACEMENTS.has(control.placement)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_PLACEMENT_INVALID,
        `Shell control '${control.name}' has invalid placement '${String(control.placement)}'.`,
        `${controlPath}.placement`,
      ),
    );
  }

  validateShellIcon(
    control.icon,
    `${controlPath}.icon`,
    MODEL_VALIDATION_CODES.SHELL_CONTROL_ICON_INVALID,
    diagnostics,
  );
  validateShellVisibility(control.visibility, `${controlPath}.visibility`, indexes, diagnostics);

  if (control.context !== undefined && !indexes.contextsByName.has(control.context)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_CONTEXT_UNKNOWN,
        `Shell control '${control.name}' references unknown context '${control.context}'.`,
        `${controlPath}.context`,
      ),
    );
  }

  validateShellControlCommand(control, controlPath, indexes, diagnostics);
}
/**
 * `COMMAND` belongs to exactly one control kind, and both halves are checked:
 * a `commandAction` without one has nothing to run, and any other kind with one
 * is stating something no renderer will ever read — the silent-no-op shape this
 * repository keeps finding and closing.
 *
 * The input check exists because the form is generated from the command's own
 * declared inputs, and two shapes have no control to generate: a `repeated`
 * input is a list of items, and an `attachment` is a file. Refusing at compile
 * time is the difference between an unpromptable command being a model error
 * and being a form that silently drops a value the command requires.
 */
function validateShellControlCommand(
  control: ResolvedShellControl,
  controlPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (control.kind !== "commandAction") {
    if (control.command !== undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.SHELL_CONTROL_COMMAND_UNEXPECTED,
          `Shell control '${control.name}' declares command '${control.command}', but only a 'commandAction' control runs one.`,
          `${controlPath}.command`,
        ),
      );
    }
    return;
  }

  if (control.command === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_COMMAND_REQUIRED,
        `Shell control '${control.name}' is a 'commandAction' and must declare the command it runs.`,
        `${controlPath}.command`,
      ),
    );
    return;
  }

  const command = indexes.commandsByName.get(control.command)?.item;
  if (command === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_COMMAND_UNKNOWN,
        `Shell control '${control.name}' references unknown command '${control.command}'.`,
        `${controlPath}.command`,
      ),
    );
    return;
  }

  for (let inputIndex = 0; inputIndex < command.inputs.length; inputIndex += 1) {
    const input = command.inputs[inputIndex];
    if (input === undefined) {
      continue;
    }
    const unsupported = input.repeated
      ? "repeated"
      : input.type === "attachment"
        ? "attachment"
        : undefined;
    if (unsupported === undefined) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_CONTROL_COMMAND_INPUT_UNSUPPORTED,
        `Shell control '${control.name}' runs command '${command.name}', whose input '${input.name}' is ${unsupported} and cannot be prompted for.`,
        `${controlPath}.command`,
      ),
    );
  }
}
function validateShellVisibility(
  visibility: ResolvedShellVisibility,
  visibilityPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!SHELL_VISIBILITY_KINDS.has(visibility.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_VISIBILITY_KIND_INVALID,
        `Shell visibility kind '${String(visibility.kind)}' is not supported.`,
        `${visibilityPath}.kind`,
      ),
    );
  }

  if (
    (visibility.kind === "contextAvailable" ||
      visibility.kind === "contextUnavailable" ||
      visibility.kind === "contextSelected") &&
    (visibility.context === undefined || !indexes.contextsByName.has(visibility.context))
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SHELL_VISIBILITY_CONTEXT_UNKNOWN,
        `Shell visibility references unknown context '${visibility.context ?? ""}'.`,
        `${visibilityPath}.context`,
      ),
    );
  }
}
/**
 * Two checks, deliberately not one. `SHELL_ICON_PATTERN` is about the *shape*
 * of the name — a shell-specific lexical rule with its own long-standing code —
 * while {@link validateIconName} is about whether any renderer can draw it. A
 * name that fails the shape rule reports only the shape diagnostic, because
 * saying it is also not in the vocabulary adds nothing.
 */
function validateShellIcon(
  icon: string | undefined,
  iconPath: string,
  code: ModelValidationCode,
  diagnostics: Diagnostic[],
): void {
  if (icon === undefined) {
    return;
  }

  if (!SHELL_ICON_PATTERN.test(icon)) {
    diagnostics.push(
      diagnostic(
        code,
        `Shell icon reference '${icon}' is not a supported semantic icon name.`,
        iconPath,
      ),
    );
    return;
  }

  validateIconName(icon, iconPath, diagnostics);
}
