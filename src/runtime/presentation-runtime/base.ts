/**
 * Chain root. Holds the constructor and the three collaborators every area
 * reads: the data source, the model index, and the logger.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type { ResolvedApplicationModel } from "../../model/resolved-model.js";
import { RuntimeModelIndex } from "../model-helpers.js";
import { noopRuntimeLogger } from "../runtime-types.js";
import type { RuntimeLogger } from "../runtime-types.js";
import type { RuntimePresentationDataSource } from "./types.js";

export class PresentationRuntimeBase {
  constructor(
    model: ResolvedApplicationModel,
    protected readonly dataSource: RuntimePresentationDataSource,
    protected readonly index = new RuntimeModelIndex(model),
    protected readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}
}
