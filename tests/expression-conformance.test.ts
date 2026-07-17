import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../src/index.js";
import type { JsonValue, ResolvedExpression, RuntimeContext } from "../src/index.js";

interface ExpressionConformanceCase {
  name: string;
  expression: ResolvedExpression;
  values: Record<string, JsonValue>;
  context: {
    userId: string;
    now: string;
  };
  expected: { ok: true; kind: string; value: JsonValue } | { ok: false; code: string };
}

const cases = JSON.parse(
  readFileSync(new URL("../conformance/expressions/basic.json", import.meta.url), "utf8"),
) as ExpressionConformanceCase[];

describe("expression conformance corpus", () => {
  for (const conformanceCase of cases) {
    it(conformanceCase.name, () => {
      const context: RuntimeContext = {
        userId: conformanceCase.context.userId,
        roles: [],
        channel: "test",
        now: new Date(conformanceCase.context.now),
      };
      const result = evaluateExpression(conformanceCase.expression, {
        values: conformanceCase.values,
        context,
      });

      if (conformanceCase.expected.ok) {
        expect(result).toEqual({
          ok: true,
          value: {
            kind: conformanceCase.expected.kind,
            value: conformanceCase.expected.value,
          },
        });
        return;
      }

      expect(result).toMatchObject({
        ok: false,
        error: { code: conformanceCase.expected.code },
      });
    });
  }
});
