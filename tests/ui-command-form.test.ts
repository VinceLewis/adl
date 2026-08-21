// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { resolveApplicationModel } from "../src/index.js";
import type { ResolvedCommand } from "../src/index.js";
import {
  ADL_COMMAND_FORM_CANCEL_EVENT,
  ADL_COMMAND_FORM_SUBMIT_EVENT,
  AdlCommandFormElement,
  defineAdlCommandForm,
} from "../src/ui/components/adl-command-form.js";
import type { CommandFormSubmitDetail } from "../src/ui/components/adl-command-form.js";

/**
 * The construct Phase 99 was missing: a form for a **command's own declared
 * inputs**, as opposed to a presentation `ACTION`, whose `input` is a set of
 * expressions evaluated against a row and so can only restate values that
 * already exist.
 *
 * Everything asserted here is derived from the command, never from a name the
 * test recognises — the fixture below is deliberately not `CreateBand`.
 */

const model = resolveApplicationModel({
  app: { name: "CommandFormFixture", startView: "ThingList" },
  objects: [
    {
      name: "Thing",
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "Notes", type: "text" },
        { name: "Count", type: "number" },
        { name: "DueOn", type: "date" },
        { name: "Urgent", type: "boolean" },
      ],
      views: [{ name: "ThingList", kind: "list", fields: ["Title"] }],
    },
  ],
  commands: [
    {
      name: "RecordThing",
      label: "Record a thing",
      // `required` defaults to **true** for a command input, so every optional
      // one says so explicitly. (A field on an object defaults the other way;
      // that asymmetry is pre-existing and is not this phase's to change.)
      inputs: [
        { name: "Title", type: "text", required: true },
        { name: "Notes", type: "text", required: false },
        { name: "Count", type: "number", required: false },
        { name: "DueOn", type: "date", required: false },
        { name: "Urgent", type: "boolean", required: false },
      ],
      steps: [
        {
          name: "recordThing",
          action: "create",
          object: "Thing",
          values: {
            Title: { kind: "input", name: "Title" },
            Notes: { kind: "input", name: "Notes" },
            Count: { kind: "input", name: "Count" },
            DueOn: { kind: "input", name: "DueOn" },
            Urgent: { kind: "input", name: "Urgent" },
          },
        },
      ],
    },
  ],
});

function command(): ResolvedCommand {
  const found = model.commands?.find((entry) => entry.name === "RecordThing");
  if (found === undefined) throw new Error("The fixture lost its command.");
  return found;
}

describe("adl-command-form", () => {
  beforeEach(() => {
    defineAdlCommandForm();
    document.body.innerHTML = "";
  });

  it("renders one control per declared input, typed from the input's own field type", () => {
    const form = mount(command());

    expect(
      [...form.querySelectorAll<HTMLInputElement>("[data-command-input]")].map((input) => [
        input.dataset.commandInput,
        input.type,
      ]),
    ).toEqual([
      ["Title", "text"],
      ["Notes", "text"],
      ["Count", "number"],
      ["DueOn", "date"],
      ["Urgent", "checkbox"],
    ]);
    // Required is declared, not styled: the browser and the runtime both see it.
    expect(inputFor(form, "Title").required).toBe(true);
    expect(inputFor(form, "Notes").required).toBe(false);
    expect(form.textContent).toContain("Record a thing");
    expect(form.textContent).toContain("Notes (optional)");
  });

  it("carries the typed values out as the command's input, coerced by declared type", () => {
    const events = capture();
    const form = mount(command());
    inputFor(form, "Title").value = "Neon Map";
    inputFor(form, "Count").value = "3";
    inputFor(form, "DueOn").value = "2026-09-01";
    inputFor(form, "Urgent").checked = true;

    submit(form);

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({
      commandName: "RecordThing",
      // `Notes` is absent rather than empty: an optional input left blank must
      // let the command's or the object's own default fill it in.
      input: { Title: "Neon Map", Count: 3, DueOn: "2026-09-01", Urgent: true },
    });
  });

  it("refuses a missing required input, says which, and keeps what was typed", () => {
    const events = capture();
    const form = mount(command());
    inputFor(form, "Notes").value = "typed before the mistake";

    submit(form);

    expect(events).toHaveLength(0);
    const error = form.querySelector("[data-command-form-error='true']");
    expect(error?.textContent).toContain("Title");
    // Re-rendering the form must not throw away the other answers.
    expect(inputFor(form, "Notes").value).toBe("typed before the mistake");
  });

  it("disables every control while an attempt is in flight and dispatches nothing", () => {
    const events = capture();
    const form = mount(command());
    inputFor(form, "Title").value = "Neon Map";
    form.busy = true;

    expect(inputFor(form, "Title").disabled).toBe(true);
    // The value survives the re-render `busy` triggers.
    expect(inputFor(form, "Title").value).toBe("Neon Map");
    submit(form);
    expect(events).toHaveLength(0);
  });

  it("shows a refusal from the runtime beside the values that produced it", () => {
    const form = mount(command());
    inputFor(form, "Title").value = "Neon Map";
    form.error = "You may not create that.";

    expect(form.querySelector("[data-command-form-error='true']")?.textContent).toContain(
      "You may not create that.",
    );
    expect(inputFor(form, "Title").value).toBe("Neon Map");
  });

  it("dispatches a cancel intent and decides nothing itself", () => {
    const cancelled: Event[] = [];
    document.addEventListener(ADL_COMMAND_FORM_CANCEL_EVENT, (event) => cancelled.push(event));
    const form = mount(command());

    form.querySelector<HTMLButtonElement>("[data-command-form-cancel='true']")?.click();

    expect(cancelled).toHaveLength(1);
    // The form is still there: closing it is the shell's decision, not its own.
    expect(form.querySelector("[data-command-form]")).not.toBeNull();
  });

  it("renders nothing at all when it names no command", () => {
    const form = mount(undefined);
    expect(form.innerHTML.trim()).toBe("");
  });
});

function mount(target: ResolvedCommand | undefined): AdlCommandFormElement {
  const form = document.createElement("adl-command-form") as AdlCommandFormElement;
  document.body.append(form);
  form.command = target;
  return form;
}

function inputFor(form: AdlCommandFormElement, name: string): HTMLInputElement {
  const input = form.querySelector<HTMLInputElement>(`[data-command-input='${name}']`);
  if (input === null) throw new Error(`Expected an input for '${name}'.`);
  return input;
}

function submit(form: AdlCommandFormElement): void {
  form
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function capture(): CustomEvent<CommandFormSubmitDetail>[] {
  const events: CustomEvent<CommandFormSubmitDetail>[] = [];
  document.addEventListener(ADL_COMMAND_FORM_SUBMIT_EVENT, (event) => {
    events.push(event as CustomEvent<CommandFormSubmitDetail>);
  });
  return events;
}
