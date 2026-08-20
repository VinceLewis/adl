import type { FieldType } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";
import type { PartialViewContextModel, ResolvedSort, ResolvedViewContext } from "./view.js";

export type ReadModelSourceScope =
  | "all"
  | "currentContext"
  | "allAvailableContexts"
  | "currentUser";
export type ReadModelStrategy = "join" | "union";
export type ReadModelJoinCardinality = "one" | "many";
export interface ResolvedReadModel {
  name: string;
  context?: ResolvedViewContext;
  strategy: ReadModelStrategy;
  sources: ResolvedReadModelSource[];
  fields: ResolvedReadModelField[];
  sort: ResolvedSort[];
}
export interface ResolvedReadModelSource {
  name: string;
  object: string;
  scope: ReadModelSourceScope;
  /**
   * How this source reaches an earlier one.
   *
   * Undeclared keeps the original behaviour: the runtime follows whatever
   * lookup field an already-loaded record declares toward this source's object,
   * and reads exactly one record by id. That only ever walks a foreign key
   * forwards, so it cannot express "the records that point *at* what I already
   * have" — the shape every projection through a junction object needs.
   */
  join?: ResolvedReadModelSourceJoin;
}
/**
 * An explicit equality join between two read-model sources.
 *
 * Naming both sides makes the hop sayable when no lookup field connects the two
 * objects directly, which is what a junction object always looks like: two
 * records that share a third object's id rather than referencing each other.
 * `many` additionally lets one upstream row produce several rows, which the
 * id-based lookup join structurally could not.
 */
export interface ResolvedReadModelSourceJoin {
  /** An earlier source in the same read model. */
  source: string;
  /** The field on this source's object. {@link RECORD_ID_JOIN_FIELD} means the record id. */
  localField: string;
  /** The field on the joined source's object. {@link RECORD_ID_JOIN_FIELD} means the record id. */
  sourceField: string;
  cardinality: ReadModelJoinCardinality;
}
/**
 * The join-field name that means "this record's own id" rather than a declared
 * field, so a join can key on identity without an object having to carry a
 * duplicate of its own id as a business field.
 */
export const RECORD_ID_JOIN_FIELD = "id";
export interface ResolvedReadModelField {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
  expression?: ResolvedExpression;
}
export interface PartialReadModelModel {
  name: string;
  context?: PartialViewContextModel;
  strategy?: ReadModelStrategy;
  sources: PartialReadModelSourceModel[];
  fields: PartialReadModelFieldModel[];
  sort?: ResolvedSort[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialReadModelSourceModel {
  name?: string;
  object: string;
  scope?: ReadModelSourceScope;
  join?: PartialReadModelSourceJoinModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialReadModelSourceJoinModel {
  source: string;
  localField: string;
  sourceField: string;
  cardinality?: ReadModelJoinCardinality;
}
export interface PartialReadModelFieldModel {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
  expression?: PartialPolicyConditionModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
