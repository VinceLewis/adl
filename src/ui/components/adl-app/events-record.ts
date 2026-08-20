import type { JsonValue, StoredObjectRecord } from "../../../model/resolved-model.js";
import { infoMessage, successMessage } from "../../runtime-error-messages.js";
import type {
  DraftRecordDetail,
  SaveRecordDetail,
  StageChildOperationDetail,
  TransitionRecordDetail,
} from "../../types.js";
import type {
  PresentationActionDetail,
  PresentationCalendarNavigateDetail,
  PresentationMatrixCellCycleDetail,
  PresentationRecordSelectDetail,
  PresentationStateChangeDetail,
} from "../adl-composed-view.js";
import type { ContextSelectionDetail } from "../adl-context-selector.js";
import { titleCaseIdentifier } from "../html.js";
import type { RuntimeStagedChildOperation } from "../../../runtime/edit-surface-runtime.js";
import { AdlAppShellEventsElement } from "./events-shell.js";

export class AdlAppRecordEventsElement extends AdlAppShellEventsElement {
  protected readonly handleSearch = (event: Event): void => {
    const detail = (event as CustomEvent<{ text: string }>).detail;
    if (detail === undefined) {
      return;
    }

    this.searchText = detail.text;
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  };

  protected readonly handleSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ recordId: string }>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const record = await this.runtime.read(this.activeObject.name, detail.recordId, context);
      if (record !== null) {
        this.mode = "edit";
        this.setEditTarget(this.activeObject.name);
        this.selectedRecord = record;
        this.editContainerOpen = true;
        this.draftValues = {};
        this.stagedChildChanges = [];
        this.fieldIssues = [];
        await this.refreshEditSurface();
        this.render();
      }
    });
  };

  protected readonly handleNew = (): void => {
    this.mode = "create";
    this.setEditTarget(this.activeObject.name);
    this.selectedRecord = undefined;
    this.editContainerOpen = true;
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.fieldIssues = [];
    this.messages = [];
    void this.runCommand(async () => {
      await this.refreshEditSurface();
      this.render();
    });
  };

  protected readonly handleDraft = (event: Event): void => {
    const detail = (event as CustomEvent<DraftRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.mode === "edit" && detail.record?.meta.guid !== this.selectedRecord?.meta.guid) {
      return;
    }

    this.draftValues = { ...detail.values };
  };

  protected readonly handleSave = (event: Event): void => {
    const detail = (event as CustomEvent<SaveRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      this.draftValues = { ...detail.values };
      if (detail.mode === "create") {
        const created = await this.runtime.create(
          editObject.name,
          this.applySelectedScopeToCreateValues(detail.values, editObject),
          context,
        );
        await this.applyPendingChildChanges(created.meta.guid, context);
        this.messages = [successMessage(`${editObject.name} created.`)];
        this.draftValues = {};
        this.stagedChildChanges = [];
        this.fieldIssues = [];
        await this.refreshRecords(editContainer === "splitPane" ? created.meta.guid : undefined);
        if (editContainer !== "splitPane") {
          this.closeEditContainer(false);
        }
        this.render();
        return;
      }

      if (detail.record === undefined) {
        return;
      }

      if (Object.keys(detail.values).length === 0 && this.stagedChildChanges.length === 0) {
        this.messages = [infoMessage("No changes to save.")];
        this.draftValues = {};
        if (editContainer !== "splitPane") {
          this.closeEditContainer(false);
        }
        this.render();
        return;
      }

      const updated =
        Object.keys(detail.values).length === 0
          ? detail.record
          : await this.runtime.update(
              editObject.name,
              detail.record.meta.guid,
              detail.values,
              context,
            );
      await this.applyPendingChildChanges(updated.meta.guid, context);
      this.messages = [successMessage(`${editObject.name} saved.`)];
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      if (editContainer !== "splitPane") {
        this.closeEditContainer(false);
      }
      this.render();
    });
  };

  protected readonly handleDelete = (event: Event): void => {
    const detail = (event as CustomEvent<{ record: StoredObjectRecord }>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      await this.runtime.delete(editObject.name, detail.record.meta.guid, context);
      this.messages = [successMessage(`${editObject.name} deleted.`)];
      this.selectedRecord = undefined;
      this.mode = "create";
      this.editContainerOpen = editContainer === "splitPane";
      this.draftValues = {};
      this.stagedChildChanges = [];
      await this.refreshRecords();
      if (editContainer !== "splitPane") {
        this.clearEditTarget();
      }
      this.render();
    });
  };

  protected readonly handleCancel = (): void => {
    this.fieldIssues = [];
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    if (this.activeEditContainer !== "splitPane") {
      this.closeEditContainer(true);
      this.render();
      return;
    }

    this.messages = [];
    this.draftValues = {};
    if (this.records[0] !== undefined) {
      this.mode = "edit";
      this.selectedRecord = this.records[0];
    } else {
      this.mode = "create";
      this.selectedRecord = undefined;
    }
    this.render();
  };

  protected readonly handleTransition = (event: Event): void => {
    const detail = (event as CustomEvent<TransitionRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      this.draftValues = { ...detail.values };
      const record =
        Object.keys(detail.values).length === 0
          ? detail.record
          : await this.runtime.update(
              editObject.name,
              detail.record.meta.guid,
              detail.values,
              context,
            );
      const updated = await this.runtime.transition(
        editObject.name,
        record.meta.guid,
        detail.actionName,
        context,
      );
      this.messages = [successMessage(`${titleCaseIdentifier(detail.actionName)} completed.`)];
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      if (editContainer !== "splitPane") {
        this.closeEditContainer(false);
      }
      this.render();
    });
  };

  protected readonly handleStageChildOperation = (event: Event): void => {
    const detail = (event as CustomEvent<StageChildOperationDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.operation === "remove" && detail.stagedOperationId !== undefined) {
      this.stagedChildChanges = this.stagedChildChanges.filter(
        (operation) => operation.id !== detail.stagedOperationId,
      );
    } else {
      const childIds =
        detail.childIds ?? (detail.childId === undefined ? [undefined] : [detail.childId]);
      // A staged batch now commits as one transaction whose writes are all
      // planned against pre-transaction state, so two staged operations naming
      // the same child record would be last-write-wins rather than sequential.
      // Repeated edits of one row — dragging it twice, tapping Move up three
      // times — therefore collapse into the single operation that carries the
      // user's final intent, before anything is submitted.
      const retained = this.stagedChildChanges.filter(
        (operation) => !collapsesStagedChildOperation(operation, detail, childIds),
      );
      this.stagedChildChanges = [
        ...retained,
        ...childIds.map((childId) => {
          // A chosen candidate is a *value* of the new child, not the child's own
          // id. Staging it as `childId` would name a set-list item that does not
          // exist yet and, worse, would name the song's record as though it were
          // one.
          const candidate =
            detail.candidateField === undefined || childId === undefined
              ? undefined
              : { [detail.candidateField]: childId };
          const values =
            candidate === undefined ? detail.values : { ...(detail.values ?? {}), ...candidate };
          return {
            id: `child-${Date.now()}-${this.nextStagedChildSequence()}`,
            section: detail.section,
            operation: detail.operation,
            childObject: detail.childObject,
            ...(childId === undefined || candidate !== undefined ? {} : { childId }),
            ...(values === undefined ? {} : { values }),
            ...(detail.position === undefined ? {} : { position: detail.position }),
          };
        }),
      ];
    }

    void this.runCommand(async () => {
      await this.refreshEditSurface();
      this.render();
    });
  };

  protected readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const menuButton = target.closest<HTMLButtonElement>("[data-shell-menu='true']");
    if (menuButton !== null) {
      this.navDrawerOpen = !this.navDrawerOpen;
      this.render();
      return;
    }

    if (target.closest("[data-shell-overlay='true']") !== null) {
      this.navDrawerOpen = false;
      this.render();
      return;
    }

    const shellAction =
      target.closest<HTMLButtonElement>("[data-shell-action]")?.dataset.shellAction;
    if (shellAction === "sign-out") {
      this.handleSignOut();
      return;
    }

    if (shellAction === "install") {
      this.handleInstallClick();
      return;
    }

    const navButton = target.closest<HTMLButtonElement>("[data-view-nav]");
    const viewName = navButton?.dataset.viewNav;
    if (viewName !== undefined) {
      this.navigateToView(viewName);
      return;
    }

    if (target.closest("[data-edit-container-close='true']") !== null) {
      this.closeEditContainer(true);
      this.render();
    }
  };

  protected readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    if (this.navDrawerOpen) {
      this.navDrawerOpen = false;
    } else if (this.editContainerOpen && this.activeEditContainer !== "splitPane") {
      this.closeEditContainer(true);
    } else {
      return;
    }

    this.render();
  };

  protected readonly handleContextSelection = (event: Event): void => {
    const detail = (event as CustomEvent<ContextSelectionDetail>).detail;
    if (detail === undefined) {
      return;
    }

    this.setSelectedContextId(detail.contextName, detail.contextId, true);
    this.searchText = "";
    this.selectedRecord = undefined;
    this.editContainerOpen = false;
    this.mode = "edit";
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    this.messages = [];
    this.fieldIssues = [];
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  };

  protected readonly handlePresentationStateChange = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationStateChangeDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      await this.refreshPresentationView({ [detail.state]: detail.value });
      this.render();
    });
  };

  protected readonly handlePresentationAction = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationActionDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.create !== undefined) {
      void this.openCreateFromPresentationAction(detail);
      return;
    }

    if (detail.view !== undefined) {
      this.navigateToView(detail.view);
      return;
    }

    if (detail.command === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const result = await this.runtime.executeCommand(
        detail.command ?? "",
        detail.input as Record<string, JsonValue>,
        context,
      );
      this.messages = [
        successMessage(
          `${result.command.label ?? titleCaseIdentifier(result.command.name)} completed.`,
        ),
      ];
      await this.refreshRecords();
      this.render();
    });
  };

  protected readonly handlePresentationCalendarNavigate = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationCalendarNavigateDetail>).detail;
    if (detail === undefined || detail.state.length === 0 || detail.value.length === 0) {
      return;
    }

    void this.runCommand(async () => {
      await this.refreshPresentationView({ [detail.state]: `${detail.value}-01` });
      this.render();
    });
  };

  protected readonly handlePresentationRecordSelect = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationRecordSelectDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const record = await this.runtime.read(detail.objectName, detail.recordId, context);
      if (record === null) {
        return;
      }

      this.setEditTarget(detail.objectName);

      this.mode = "edit";
      this.selectedRecord = record;
      this.editContainerOpen = true;
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshEditSurface();
      this.render();
    });
  };

  private async openCreateFromPresentationAction(detail: PresentationActionDetail): Promise<void> {
    await this.runCommand(async () => {
      const targetView =
        detail.create?.view === undefined ? undefined : this.findView(detail.create.view)?.view;
      const targetObject =
        detail.create?.object === undefined
          ? undefined
          : this._model.objects.find((object) => object.name === detail.create?.object);
      const targetObjectView =
        targetObject === undefined
          ? undefined
          : (targetObject.views.find((view) => view.kind === "list") ?? targetObject.views[0]);

      if (targetView !== undefined) {
        this.viewName = targetView.name;
      } else if (targetObjectView !== undefined && targetObject?.name !== this.activeObject.name) {
        this.viewName = targetObjectView.name;
      }

      this.mode = "create";
      this.selectedRecord = undefined;
      this.editContainerOpen = true;
      this.draftValues = detail.input as Record<string, JsonValue>;
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      this.messages = [];
      if (this.activeView.presentation === undefined) {
        await this.refreshRecords();
      } else {
        await this.refreshPresentationView();
      }
      await this.refreshEditSurface();
      this.render();
    });
  }

  protected readonly handlePresentationMatrixCycle = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationMatrixCellCycleDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      await this.runtime.cyclePresentationMatrixCell({
        objectName: this.activeObject.name,
        viewName: this.activeView.name,
        matrixName: detail.matrix,
        rowKey: detail.rowKey,
        columnKey: detail.columnKey,
        context,
      });
      await this.refreshRecords();
      await this.refreshPresentationView();
      this.render();
    });
  };
}

/**
 * Whether a newly staged child operation supersedes one already staged.
 *
 * Only `reorder` and `updateChild` collapse, and only against the same section,
 * kind and child record: they are absolute statements about one row, so the
 * latest one is the whole truth. `remove`, `unlink` and `linkExisting` are not
 * collapsed here — duplicate links are already refused by the runtime, and
 * silently dropping a second removal would hide a caller mistake rather than
 * fix one.
 */
function collapsesStagedChildOperation(
  existing: RuntimeStagedChildOperation,
  detail: StageChildOperationDetail,
  childIds: (string | undefined)[],
): boolean {
  if (detail.operation !== "reorder" && detail.operation !== "updateChild") {
    return false;
  }

  return (
    existing.section === detail.section &&
    existing.operation === detail.operation &&
    existing.childId !== undefined &&
    childIds.includes(existing.childId)
  );
}
