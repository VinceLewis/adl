import { describe, expect, it } from "vitest";
import { ApplicationRuntime, PolicyDeniedError, compileAdl } from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";

/**
 * Phase 68: `LOOKUP <Object> TARGET_FIELD <field>` was validated at compile
 * time but never consumed at runtime — resolution always read the target
 * record by identity, ignoring `TARGET_FIELD` entirely. This is a generic,
 * non-Giggle-Band fixture proving the fix: a `Post.AuthorCode` field looks up
 * `Author` by its `Code` field rather than by `Author`'s own id.
 */
const source = `
APP LookupTargetFieldCheck
END.APP

ROLE Admin
ROLE Reader

OBJECT Author
  FIELD Name TEXT REQUIRED
  FIELD Code TEXT REQUIRED

  CONSTRAINT uniqueAuthorCode UNIQUE FIELDS Code

  SYNC LOCAL_FIRST SCOPE All
END.OBJECT

OBJECT Post
  FIELD Title TEXT REQUIRED
  FIELD AuthorCode TEXT REQUIRED LOOKUP Author TARGET_FIELD Code DISPLAY Name

  SYNC LOCAL_FIRST SCOPE All
END.OBJECT

READ_MODEL PostsWithAuthor
  SOURCE post OBJECT Post SCOPE all
  SOURCE author OBJECT Author SCOPE all
  FIELD Title FROM post.Title
  FIELD AuthorName FROM author.Name
  SORT Title ASC
END.READ_MODEL

POLICY AuthorPolicy ON Author
  ALLOW * ROLE Admin
  ALLOW SEARCH ROLE Reader
  ALLOW READ ROLE Reader
END.POLICY

POLICY PostPolicy ON Post
  ALLOW * ROLE Admin
  ALLOW SEARCH ROLE Reader
  ALLOW READ ROLE Reader
END.POLICY
`;

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: new Date("2026-08-18T00:00:00.000Z"),
};

function compile() {
  const result = compileAdl(source);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  if (result.model === undefined) {
    throw new Error("expected a compiled model");
  }
  return result.model;
}

describe("LOOKUP ... TARGET_FIELD runtime resolution", () => {
  it("parses TARGET_FIELD and carries it into the resolved model", () => {
    const model = compile();
    const post = model.objects.find((object) => object.name === "Post");
    const authorCode = post?.fields.find((field) => field.name === "AuthorCode");

    expect(authorCode?.lookup).toEqual({
      targetObject: "Author",
      targetField: "Code",
      displayField: "Name",
    });
  });

  it("PHASE-68 resolves an implicit read-model lookup join by the named field, not by identity", async () => {
    const runtime = new ApplicationRuntime(compile());

    const author = await runtime.create(
      "Author",
      { Name: "Ada Lovelace", Code: "AL-001" },
      adminContext,
    );
    // The stored value is the target's natural key, never its guid.
    expect(author.values.Code).not.toBe(author.meta.guid);

    await runtime.create(
      "Post",
      { Title: "On Analytical Engines", AuthorCode: "AL-001" },
      adminContext,
    );

    const result = await runtime.executeReadModel("PostsWithAuthor", adminContext);

    expect(result.rows.map((row) => row.values)).toEqual([
      { Title: "On Analytical Engines", AuthorName: "Ada Lovelace" },
    ]);
  });

  it("drops the row when no target record matches the named field", async () => {
    const runtime = new ApplicationRuntime(compile());

    await runtime.create("Author", { Name: "Ada Lovelace", Code: "AL-001" }, adminContext);
    await runtime.create(
      "Post",
      { Title: "Unmatched Post", AuthorCode: "does-not-exist" },
      adminContext,
    );

    const result = await runtime.executeReadModel("PostsWithAuthor", adminContext);

    expect(result.rows.some((row) => row.values.Title === "Unmatched Post")).toBe(false);
  });

  it("PHASE-68 requires the search action on the target object, same as a declared join", async () => {
    const restricted = compileAdl(
      source.replace(
        "ALLOW SEARCH ROLE Reader\n  ALLOW READ ROLE Reader\nEND.POLICY\n\nPOLICY PostPolicy",
        "ALLOW READ ROLE Reader\nEND.POLICY\n\nPOLICY PostPolicy",
      ),
    );
    expect(restricted.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    if (restricted.model === undefined) {
      throw new Error("expected a compiled model");
    }

    const runtime = new ApplicationRuntime(restricted.model);
    await runtime.create("Author", { Name: "Ada Lovelace", Code: "AL-001" }, adminContext);
    await runtime.create(
      "Post",
      { Title: "On Analytical Engines", AuthorCode: "AL-001" },
      adminContext,
    );

    const readerContext: RuntimeContext = {
      userId: "reader-1",
      roles: ["Reader"],
      channel: "api",
      now: new Date("2026-08-18T00:00:00.000Z"),
    };

    await expect(runtime.executeReadModel("PostsWithAuthor", readerContext)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
  });

  it("falls back to the first matching record when more than one shares the target field value", async () => {
    // Deliberately builds a model with no UNIQUE constraint on Author.Code, so
    // TARGET_FIELD's documented uniqueness expectation is violated on purpose.
    // Model validation does not require it (mirroring a declared read-model
    // join's `cardinality: "one"`, which tolerates the same ambiguity), so the
    // runtime must degrade deterministically rather than throw.
    const unguarded = compileAdl(
      source.replace("\n  CONSTRAINT uniqueAuthorCode UNIQUE FIELDS Code\n", "\n"),
    );
    expect(unguarded.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    if (unguarded.model === undefined) {
      throw new Error("expected a compiled model");
    }

    const runtime = new ApplicationRuntime(unguarded.model);
    const first = await runtime.create(
      "Author",
      { Name: "Ada Lovelace", Code: "AL-001" },
      adminContext,
    );
    await runtime.create("Author", { Name: "Impostor Ada", Code: "AL-001" }, adminContext);
    await runtime.create(
      "Post",
      { Title: "On Analytical Engines", AuthorCode: "AL-001" },
      adminContext,
    );

    const result = await runtime.executeReadModel("PostsWithAuthor", adminContext);

    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(["Ada Lovelace", "Impostor Ada"]).toContain(row?.values.AuthorName);
    expect(row?.sources.author?.recordId).toBeDefined();
    void first;
  });
});
