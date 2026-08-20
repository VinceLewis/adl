import type {
  AdlDocumentAst,
  BusinessContextDeclarationAst,
  CommandDeclarationAst,
  ContextGrantDeclarationAst,
  DecisionTableDeclarationAst,
  ObjectDeclarationAst,
  PolicyDeclarationAst,
  ReadModelDeclarationAst,
  RoleDeclarationAst,
  ShellDeclarationAst,
  SyncDeclarationAst,
  MigrationDeclarationAst,
  ThemeDeclarationAst,
} from "../ast.js";
import { AppParser } from "./app.js";

/**
 * The document orchestrator, and the concrete `AdlParser` every grammar area
 * composes into.
 */
export class AdlParser extends AppParser {
  parseDocument(): AdlDocumentAst {
    this.skipNewlines();
    const start = this.current().range.start;
    const app = this.parseApp();
    let shell: ShellDeclarationAst | undefined;
    const roles: RoleDeclarationAst[] = [];
    const contexts: BusinessContextDeclarationAst[] = [];
    const contextGrants: ContextGrantDeclarationAst[] = [];
    const objects: ObjectDeclarationAst[] = [];
    const readModels: ReadModelDeclarationAst[] = [];
    const decisionTables: DecisionTableDeclarationAst[] = [];
    const commands: CommandDeclarationAst[] = [];
    const policies: PolicyDeclarationAst[] = [];
    const themes: ThemeDeclarationAst[] = [];
    const sync: SyncDeclarationAst[] = [];
    const migrations: MigrationDeclarationAst[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        break;
      }

      if (this.checkWord("SHELL")) {
        shell = this.parseShell();
      } else if (this.checkWord("ROLE")) {
        roles.push(this.parseRole());
      } else if (this.checkWord("CONTEXT_GRANT") || this.checkDottedWord("CONTEXT", "GRANT")) {
        contextGrants.push(this.parseContextGrant());
      } else if (this.checkWord("CONTEXT")) {
        contexts.push(this.parseBusinessContext());
      } else if (this.checkWord("OBJECT")) {
        objects.push(this.parseObject());
      } else if (this.checkWord("READ_MODEL") || this.checkDottedWord("READ", "MODEL")) {
        readModels.push(this.parseReadModel());
      } else if (this.checkWord("DECISION_TABLE") || this.checkDottedWord("DECISION", "TABLE")) {
        decisionTables.push(this.parseDecisionTable());
      } else if (this.checkWord("COMMAND")) {
        commands.push(this.parseCommand());
      } else if (this.checkWord("POLICY")) {
        policies.push(this.parsePolicy());
      } else if (this.checkWord("THEME")) {
        themes.push(this.parseTheme());
      } else if (this.checkWord("SYNC")) {
        sync.push(this.parseSync(false));
      } else if (this.checkWord("MIGRATION")) {
        migrations.push(this.parseMigration());
      } else {
        // `APP` is deliberately absent: it is consumed before this loop starts,
        // and a second one is not a top-level declaration this grammar accepts.
        this.failUnexpected(
          "a top-level SHELL, ROLE, CONTEXT, CONTEXT_GRANT, OBJECT, READ_MODEL, DECISION_TABLE, COMMAND, POLICY, THEME, SYNC, MIGRATION, or end of file",
        );
      }
    }

    this.requireDeclaredContextsForGrants(contexts, contextGrants);

    return {
      kind: "AdlDocument",
      app,
      ...(shell === undefined ? {} : { shell }),
      roles,
      contexts,
      contextGrants,
      objects,
      readModels,
      decisionTables,
      commands,
      policies,
      themes,
      sync,
      migrations,
      styleWarnings: this.styleWarnings,
      range: { start, end: this.previous().range.end },
    };
  }
}
