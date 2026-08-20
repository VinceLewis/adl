import type {
  AppDeclarationAst,
  RoleDeclarationAst,
  MigrationDeclarationAst,
  MigrationObjectDeclarationAst,
  MigrationStepAst,
} from "../ast.js";
import { ShellParser } from "./shell.js";

/**
 * `APP` declarations, model migrations and `ROLE`.
 */
export class AppParser extends ShellParser {
  protected parseApp(): AppDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("APP", "APP declaration");
    const name = this.consumeName("application name");
    let theme: string | undefined;
    let startView: string | undefined;
    let offlineGraceDays: number | undefined;
    let modelVersion: string | undefined;
    this.consumeLineEnd("APP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.APP", this.current());
      }

      if (this.checkEnd("APP")) {
        const end = this.parseEnd("APP");
        return {
          kind: "AppDeclaration",
          name,
          ...(theme === undefined ? {} : { theme }),
          ...(startView === undefined ? {} : { startView }),
          ...(offlineGraceDays === undefined ? {} : { offlineGraceDays }),
          ...(modelVersion === undefined ? {} : { modelVersion }),
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("THEME")) {
        theme = this.consumeName("application theme name");
        this.consumeLineEnd("APP THEME directive");
      } else if (this.matchWord("START_VIEW")) {
        startView = this.consumeName("application start view name");
        this.consumeLineEnd("APP START_VIEW directive");
      } else if (this.matchWord("OFFLINE_GRACE")) {
        // The unit word is required, so a bare number can never be read as the
        // wrong unit if a second unit is ever added.
        offlineGraceDays = this.consumeNumber("APP OFFLINE_GRACE day count");
        this.expectWord("DAYS", "APP OFFLINE_GRACE unit");
        this.consumeLineEnd("APP OFFLINE_GRACE directive");
      } else if (
        this.matchUnderscoreOrDottedWord("APP MODEL_VERSION", "MODEL_VERSION", "MODEL", "VERSION")
      ) {
        // Quoted, and read as text rather than a number, so `1.1.0` survives:
        // a bare dotted literal is not a number the lexer can carry intact.
        modelVersion = this.consumeName("APP MODEL_VERSION value");
        this.consumeLineEnd("APP MODEL_VERSION directive");
      } else {
        this.failUnexpected(
          "APP directive THEME, START_VIEW, OFFLINE_GRACE, MODEL_VERSION, or END.APP",
        );
      }
    }
  }

  /**
   * ```text
   * MIGRATION FROM "1.0.0" TO "1.1.0"
   *   OBJECT Gig
   *     SCHEMA_VERSION 2
   *     RENAME FIELD Venue TO VenueName
   *     ADD FIELD PayoutCents DEFAULT(0)
   *     DROP FIELD LegacyNote
   *   END.OBJECT
   * END.MIGRATION
   * ```
   *
   * A migration declares how persisted records reach this model from an earlier
   * one. It never mentions storage engines, tables or SQL: the projection's own
   * tables migrate out of band through ordered SQL files, and this block is only
   * about the shape of a record.
   */
  protected parseMigration(): MigrationDeclarationAst {
    const startToken = this.expectWord("MIGRATION", "MIGRATION declaration");
    this.expectWord("FROM", "MIGRATION FROM version");
    const from = this.consumeName("MIGRATION FROM version");
    this.expectWord("TO", "MIGRATION TO version");
    const to = this.consumeName("MIGRATION TO version");
    this.consumeLineEnd("MIGRATION declaration");
    const objects: MigrationObjectDeclarationAst[] = [];

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.MIGRATION", this.current());
      }

      if (this.checkEnd("MIGRATION")) {
        const end = this.parseEnd("MIGRATION");
        return {
          kind: "MigrationDeclaration",
          from,
          to,
          objects,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.checkWord("OBJECT")) {
        objects.push(this.parseMigrationObject());
      } else {
        this.failUnexpected("MIGRATION directive OBJECT or END.MIGRATION");
      }
    }
  }

  private parseMigrationObject(): MigrationObjectDeclarationAst {
    const startToken = this.expectWord("OBJECT", "MIGRATION OBJECT declaration");
    const object = this.consumeName("MIGRATION OBJECT name");
    this.consumeLineEnd("MIGRATION OBJECT declaration");
    const steps: MigrationStepAst[] = [];
    let schemaVersion: number | undefined;

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.OBJECT", this.current());
      }

      if (this.checkEnd("OBJECT")) {
        const end = this.parseEnd("OBJECT");
        return {
          kind: "MigrationObjectDeclaration",
          object,
          ...(schemaVersion === undefined ? {} : { schemaVersion }),
          steps,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      const stepToken = this.current();

      if (
        this.matchUnderscoreOrDottedWord(
          "MIGRATION OBJECT SCHEMA_VERSION",
          "SCHEMA_VERSION",
          "SCHEMA",
          "VERSION",
        )
      ) {
        schemaVersion = this.consumeNumber("MIGRATION OBJECT SCHEMA_VERSION value");
        this.consumeLineEnd("MIGRATION OBJECT SCHEMA_VERSION directive");
      } else if (this.matchWord("RENAME")) {
        this.expectWord("FIELD", "MIGRATION RENAME FIELD directive");
        const from = this.consumeName("MIGRATION RENAME source field");
        this.expectWord("TO", "MIGRATION RENAME target field");
        const to = this.consumeName("MIGRATION RENAME target field");
        this.consumeLineEnd("MIGRATION RENAME FIELD directive");
        steps.push({
          kind: "renameField",
          from,
          to,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else if (this.matchWord("ADD")) {
        this.expectWord("FIELD", "MIGRATION ADD FIELD directive");
        const field = this.consumeName("MIGRATION ADD FIELD name");
        // Required, not optional: a record that silently gains `null` where the
        // model says the field is required would fail validation on next write.
        this.expectWord("DEFAULT", "MIGRATION ADD FIELD DEFAULT value");
        const defaultValue = this.consumeModifierValue("MIGRATION ADD FIELD DEFAULT value");
        this.consumeLineEnd("MIGRATION ADD FIELD directive");
        steps.push({
          kind: "addField",
          field,
          defaultValue,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else if (this.matchWord("DROP")) {
        this.expectWord("FIELD", "MIGRATION DROP FIELD directive");
        const field = this.consumeName("MIGRATION DROP FIELD name");
        this.consumeLineEnd("MIGRATION DROP FIELD directive");
        steps.push({
          kind: "dropField",
          field,
          range: { start: stepToken.range.start, end: this.previous().range.end },
        });
      } else {
        this.failUnexpected(
          "MIGRATION OBJECT directive SCHEMA_VERSION, RENAME FIELD, ADD FIELD, DROP FIELD, or END.OBJECT",
        );
      }
    }
  }

  protected parseRole(): RoleDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("ROLE", "ROLE declaration");
    const name = this.consumeName("role name");
    let inherits: string[] = [];
    let description: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("INHERITS")) {
        inherits = this.consumeNameListUntilLine("role inheritance list");
      } else if (this.matchWord("DESCRIPTION")) {
        description = this.consumeName("role description");
      } else {
        this.failUnexpected("ROLE directive INHERITS, DESCRIPTION, or end of line");
      }
    }

    this.consumeLineEnd("ROLE declaration");
    return {
      kind: "RoleDeclaration",
      name,
      inherits,
      ...(description === undefined ? {} : { description }),
      ...(leadingComment === undefined ? {} : { leadingComment }),
      range: this.rangeFrom(startToken),
    };
  }
}
