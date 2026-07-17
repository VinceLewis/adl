import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedDecisionTable,
} from "../model/resolved-model.js";
import { evaluateExpression, evaluateExpressionAsBoolean } from "./expression-evaluator.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { DecisionTableError, cloneJson, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface DecisionTableEvaluationResult {
  table: ResolvedDecisionTable;
  rowName: string;
  outputs: Record<string, JsonValue>;
  inputValues: Record<string, JsonValue>;
}

export class DecisionTableService {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  evaluate(
    tableName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): DecisionTableEvaluationResult {
    this.logger.debug("ENTER DecisionTableService.evaluate", { tableName });
    const table = this.index.getDecisionTable(tableName);
    const inputValues = this.evaluateInputs(table, values, context);
    const matchingRows = table.rows.filter((row) => {
      const result = evaluateExpressionAsBoolean(row.condition, { values: inputValues, context });
      if (!result.ok) {
        throw new DecisionTableError(
          `Decision table '${table.name}' row '${row.name}' condition could not be evaluated: ${result.error.message}`,
          { tableName: table.name, rowName: row.name },
        );
      }
      return result.value.value === true;
    });

    if (table.match === "single" && matchingRows.length > 1) {
      throw new DecisionTableError(
        `Decision table '${table.name}' matched multiple rows under single-match semantics.`,
        { tableName: table.name, rows: matchingRows.map((row) => row.name) },
      );
    }

    const selected = matchingRows[0];
    if (selected !== undefined) {
      return {
        table,
        rowName: selected.name,
        outputs: cloneJson(selected.outputs),
        inputValues,
      };
    }

    if (table.defaultOutputs !== undefined) {
      return {
        table,
        rowName: "default",
        outputs: cloneJson(table.defaultOutputs),
        inputValues,
      };
    }

    throw new DecisionTableError(`Decision table '${table.name}' did not match any row.`, {
      tableName: table.name,
    });
  }

  private evaluateInputs(
    table: ResolvedDecisionTable,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Record<string, JsonValue> {
    const inputValues: Record<string, JsonValue> = {};

    for (const input of table.inputs) {
      const result = evaluateExpression(input.expression, { values, context });
      if (!result.ok) {
        throw new DecisionTableError(
          `Decision table '${table.name}' input '${input.name}' could not be evaluated: ${result.error.message}`,
          { tableName: table.name, inputName: input.name },
        );
      }
      inputValues[input.name] = result.value.value;
    }

    return inputValues;
  }
}
