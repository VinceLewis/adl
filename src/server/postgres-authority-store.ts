import type { AuthorityOutcome, AuthorityOutcomeStore } from "./authority-types.js";

/** Minimal structural pg contract; applications can pass a `pg` Pool without coupling ADL to it. */
export interface PostgresQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/** Durable idempotency/outcome projection. All values are parameterised; never interpolate intent data. */
export class PostgresAuthorityOutcomeStore implements AuthorityOutcomeStore {
  constructor(private readonly database: PostgresQueryable) {}

  async get(operationId: string): Promise<AuthorityOutcome | null> {
    const result = await this.database.query<{ outcome: AuthorityOutcome }>(
      "select outcome from adl_authority_operation_outcomes where operation_id = $1",
      [operationId],
    );
    return result.rows[0]?.outcome ?? null;
  }

  async put(outcome: AuthorityOutcome): Promise<void> {
    await this.database.query(
      "insert into adl_authority_operation_outcomes (operation_id, outcome) values ($1, $2::jsonb) on conflict (operation_id) do nothing",
      [outcome.operationId, JSON.stringify(outcome)],
    );
  }
}
