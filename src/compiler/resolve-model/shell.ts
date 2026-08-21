import type {
  PartialShellControlModel,
  PartialShellModel,
  PartialShellNavItemModel,
  PartialShellVisibilityModel,
  ResolvedObject,
  ResolvedShell,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedShellVisibility,
} from "../../model/resolved-model.js";
import { titleCaseIdentifier } from "./read-model.js";

export function resolveShell(
  input: PartialShellModel | undefined,
  objects: ResolvedObject[],
): ResolvedShell {
  const mode = input?.nav?.mode ?? "explicitOnly";
  const sourceItems = input?.nav?.items ?? [];
  const declaredViews = new Set(sourceItems.map((item) => item.view));
  const defaultItems =
    mode === "includeUnlistedViews"
      ? objects
          .flatMap((object) => object.views.map((view) => ({ object, view })))
          .filter(({ view }) => !declaredViews.has(view.name))
          .map(({ object, view }, index) =>
            resolveShellNavItem(
              {
                view: view.name,
                label: titleCaseIdentifier(view.name),
                group: titleCaseIdentifier(object.name),
                order: (sourceItems.length + index + 1) * 10,
              },
              sourceItems.length + index,
            ),
          )
      : [];

  const navItems = [
    ...sourceItems.map((item, index) => resolveShellNavItem(item, index)),
    ...defaultItems,
  ].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  const controls = (input?.controls ?? createDefaultShellControls()).map(resolveShellControl);

  return {
    nav: { mode, items: navItems },
    topBar: {
      contextSelector: input?.topBar?.contextSelector ?? "topBar",
      mobileContextSelector: input?.topBar?.mobileContextSelector ?? "sheet",
      controls: [
        ...(input?.topBar?.controls ??
          controls.filter((control) => control.placement === "topBar").map((c) => c.name)),
      ],
    },
    navDrawer: {
      ...(input?.navDrawer?.title === undefined ? {} : { title: input.navDrawer.title }),
      // Defaulting to the controls that asked for the drawer keeps a declared
      // placement meaningful without a second declaration repeating it.
      controls: [
        ...(input?.navDrawer?.controls ??
          controls.filter((control) => control.placement === "navDrawer").map((c) => c.name)),
      ],
    },
    controls,
  };
}
function resolveShellNavItem(input: PartialShellNavItemModel, index: number): ResolvedShellNavItem {
  return {
    name: input.name ?? input.view,
    view: input.view,
    label: input.label ?? titleCaseIdentifier(input.view),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.group === undefined ? {} : { group: input.group }),
    order: input.order ?? (index + 1) * 10,
    activeWhen: [...(input.activeWhen ?? [input.view])],
    visibility: resolveShellVisibility(input.visibility),
  };
}
function createDefaultShellControls(): PartialShellControlModel[] {
  return [
    {
      name: "contextSelector",
      kind: "contextSelector",
      placement: "topBar",
    },
    // Both, because they answer different questions and the default shell must
    // keep answering the one it always did. Before Phase 58 the `syncStatus`
    // control rendered connectivity, so dropping `connectivity` here would take
    // the online/offline indicator away from every model that declares no shell.
    {
      name: "connectivity",
      kind: "connectivity",
      label: "Connection",
      placement: "topBar",
    },
    {
      name: "syncStatus",
      kind: "syncStatus",
      label: "Sync status",
      placement: "topBar",
    },
  ];
}
function resolveShellControl(input: PartialShellControlModel): ResolvedShellControl {
  return {
    name: input.name,
    kind: input.kind,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    placement: input.placement ?? "topBar",
    visibility: resolveShellVisibility(input.visibility),
    ...(input.command === undefined ? {} : { command: input.command }),
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}
function resolveShellVisibility(
  input: PartialShellVisibilityModel | undefined,
): ResolvedShellVisibility {
  return {
    kind: input?.kind ?? "always",
    ...(input?.context === undefined ? {} : { context: input.context }),
  };
}
