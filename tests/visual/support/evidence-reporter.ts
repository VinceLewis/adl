/**
 * The sole writer of the run index.
 *
 * The fixture only calls `testInfo.attach`; this reads the attachments back and
 * writes one Markdown page. Centralising the write keeps it race-free under
 * parallel workers, and it is the answer to "evidence nobody reads is not
 * evidence": a directory to go rummaging in is not a review, a page with a
 * "Review" section on top is.
 */

import type { FullConfig, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import {
  renderIndex,
  reviewReasons,
  type EvidenceVerdict,
  type IndexRow,
} from "./evidence-core.js";

export default class EvidenceReporter implements Reporter {
  private root = "test-results/visual";
  private startedAt = new Date().toISOString();
  private readonly rows: IndexRow[] = [];

  onBegin(config: FullConfig): void {
    const baseDir = config.configFile ? dirname(config.configFile) : config.rootDir;
    this.root = resolve(baseDir, "test-results", "visual");
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((entry) => entry.name === "evidence-verdict");
    let verdict: EvidenceVerdict | undefined;
    if (attachment?.body) {
      try {
        verdict = JSON.parse(attachment.body.toString("utf8")) as EvidenceVerdict;
      } catch {
        verdict = undefined;
      }
    }
    // Every attachment lands in the test's own output directory, so any one of
    // them identifies the folder without duplicating Playwright's naming rules.
    const anyPath = result.attachments.find((entry) => entry.path !== undefined)?.path;
    // Playwright copies attachments into an `attachments/` subdirectory of the
    // test's output directory; the evidence itself sits one level up, so a link
    // to the attachment's own folder would point past it.
    let folder = anyPath === undefined ? "" : relative(this.root, dirname(anyPath));
    if (folder.endsWith(`${sep}attachments`)) folder = folder.slice(0, -"/attachments".length);
    this.rows.push({
      project: test.parent.project()?.name ?? "",
      title: test.title,
      file: test.location.file,
      status: result.status,
      expected: test.outcome() !== "unexpected",
      folder,
      verdict,
    });
  }

  onEnd(): void {
    if (this.rows.length === 0) return;
    mkdirSync(this.root, { recursive: true });
    const indexPath = resolve(this.root, "EVIDENCE.md");
    writeFileSync(indexPath, renderIndex(this.rows, this.startedAt));
    writeFileSync(
      resolve(this.root, "evidence-index.json"),
      JSON.stringify({ startedAt: this.startedAt, rows: this.rows }, null, 2),
    );
    const needsReview = this.rows.filter((row) => reviewReasons(row).length > 0).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n  Evidence: ${indexPath} — ${this.rows.length} test${this.rows.length === 1 ? "" : "s"}, ${needsReview} need review`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
