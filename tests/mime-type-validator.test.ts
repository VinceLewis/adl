import { describe, expect, it } from "vitest";
import { ApplicationRuntime, compileAdl, parseAdl } from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";

/**
 * Phase 68: the parser could only ever produce a single literal for a
 * `MIME_TYPE` validator, while model validation required a non-empty list, so
 * every `MIME_TYPE` declaration failed `ADL_FIELD_VALIDATOR_VALUE_INVALID` at
 * compile time. The fix is `MIME_TYPE` accepting the same parenthesised,
 * comma-separated list `IN` already does.
 */
const source = `
APP MimeTypeCheck
END.APP

ROLE Admin

OBJECT Doc
  FIELD Name TEXT REQUIRED
  FIELD Attachment ATTACHMENT MIME_TYPE ('image/png', 'image/jpeg')

  SYNC LOCAL_FIRST SCOPE All
END.OBJECT

POLICY DocPolicy ON Doc
  ALLOW * ROLE Admin
END.POLICY
`;

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: new Date("2026-08-18T00:00:00.000Z"),
};

describe("MIME_TYPE field validator", () => {
  it("parses a comma-separated MIME_TYPE list, the same shape IN already uses", () => {
    const ast = parseAdl(source);
    const doc = ast.objects.find((object) => object.name === "Doc");

    expect(doc?.fields.find((field) => field.name === "Attachment")?.validators).toEqual([
      expect.objectContaining({
        validatorKind: "mimeType",
        value: ["image/png", "image/jpeg"],
      }),
    ]);
  });

  it("compiles with zero diagnostics and resolves the validator to a list", () => {
    const result = compileAdl(source);

    expect(result.diagnostics).toEqual([]);

    const doc = result.model?.objects.find((object) => object.name === "Doc");
    const attachment = doc?.fields.find((field) => field.name === "Attachment");

    expect(attachment?.validators).toEqual([
      { kind: "mimeType", value: ["image/png", "image/jpeg"] },
    ]);
  });

  it("rejects a create whose attachment MIME type is not in the declared list", async () => {
    const result = compileAdl(source);
    if (result.model === undefined) {
      throw new Error("expected a compiled model");
    }

    const runtime = new ApplicationRuntime(result.model);

    await expect(
      runtime.create(
        "Doc",
        { Name: "Bad Doc", Attachment: { mimeType: "application/pdf" } },
        adminContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({ code: "ADL_RUNTIME_FIELD_VALIDATOR", field: "Attachment" }),
      ],
    });
  });

  it("accepts a create whose attachment MIME type is in the declared list", async () => {
    const result = compileAdl(source);
    if (result.model === undefined) {
      throw new Error("expected a compiled model");
    }

    const runtime = new ApplicationRuntime(result.model);

    const record = await runtime.create(
      "Doc",
      { Name: "Good Doc", Attachment: { mimeType: "image/png" } },
      adminContext,
    );

    expect(record.values.Attachment).toEqual({ mimeType: "image/png" });
  });
});
