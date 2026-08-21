import { expect, test } from "./support/evidence.js";
import { type Page } from "@playwright/test";

/**
 * Phase 47 acceptance proof for the offline application shell.
 *
 * This spec runs against a production build served by `vite preview`
 * (the `offline-shell` Playwright project), because
 * `registerAdlServiceWorker` is gated on `import.meta.env.PROD` and therefore
 * never activates on the Vite dev server the Giggle visual projects use.
 *
 * It proves two things that only a real browser can prove:
 *
 * 1. With the network disabled, a full page reload still boots the application
 *    shell and renders the app's own content from local (IndexedDB) data.
 * 2. Nothing that could carry a session or a record body is present in any
 *    `adl-shell-*` cache — asserted by reading the caches from inside the page.
 */

/** Cache name prefix owned by the ADL offline shell (`service-worker-policy.ts`). */
const SHELL_CACHE_PREFIX = "adl-shell-";

/** Every authority endpoint lives under this path prefix and must never be cached. */
const AUTHORITY_PATH_PREFIX = "/v1/";

/** JSON keys that would indicate a persisted record body reached a cache. */
const RECORD_SHAPE_KEYS = ["meta", "values"] as const;

/** JSON keys that would indicate session or credential material reached a cache. */
const TOKEN_LIKE_KEY_PATTERN =
  /(token|session|secret|password|credential|authorization|cookie|jwt|bearer)/i;

interface CachedEntry {
  readonly cacheName: string;
  readonly url: string;
  readonly pathname: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly setCookie: string | null;
  readonly body: string;
}

test.describe("offline application shell", () => {
  test("reloads with the network disabled and caches no session or record material", async ({
    page,
    context,
  }, testInfo) => {
    // (a) First load of the built application against the preview server.
    await openGiggleApp(page);

    // (b) Wait for the worker to activate and to actually control this page.
    const activeState = await page.evaluate(() =>
      navigator.serviceWorker.ready.then((registration) => registration.active?.state ?? "none"),
    );
    expect(activeState, "service worker should reach the activated state").toBe("activated");

    if (!(await hasController(page, 5_000))) {
      // `clients.claim()` runs during activation, but the very first navigation
      // was made before any worker existed, so a reload may be needed before a
      // controller is present. Handle that explicitly rather than hoping.
      await page.reload();
      await expectShellReady(page);
    }
    expect(
      await hasController(page, 20_000),
      "the page should be controlled by the ADL service worker",
    ).toBe(true);

    // (c) The registered script URL carries the resolved model version.
    const scriptUrl = await page.evaluate(() =>
      navigator.serviceWorker.ready.then((registration) => registration.active?.scriptURL ?? ""),
    );
    expect(scriptUrl).toContain("/sw.js?v=");
    const modelVersion = new URL(scriptUrl).searchParams.get("v");
    expect(modelVersion, "worker URL should carry a non-empty model version").toBeTruthy();

    // A controlled online visit is what populates the shell cache: the first,
    // uncontrolled navigation was never seen by the worker. This is the "prior
    // visit" the acceptance criterion assumes, not a relaxation of it.
    await page.reload();
    await expectShellReady(page);
    await waitForShellCached(page);

    // (d) The core proof: network off, full reload, shell still renders.
    await context.setOffline(true);
    await page.reload();
    await expectShellReady(page);

    // ...and still operates against local data: the Band context selector is
    // populated from IndexedDB, and a navigation renders seeded records.
    await selectBandContext(page);
    await navigateTo(page, "BandEventList");
    await expect(page.locator(".adl-workspace, .adl-composed-workspace")).toContainText(
      "Canal Street headline",
    );

    // (e) The cache boundary, read from inside the offline page.
    const cacheNames = await page.evaluate(() => caches.keys());
    const shellCaches = cacheNames.filter((name) => name.startsWith(SHELL_CACHE_PREFIX));
    expect(shellCaches.length, "expected at least one ADL shell cache").toBeGreaterThan(0);
    for (const name of shellCaches) {
      expect(name).toMatch(/^adl-shell-.+$/);
    }
    expect(
      shellCaches,
      "every ADL cache should be the current model version's shell cache",
    ).toEqual([`${SHELL_CACHE_PREFIX}${modelVersion}`]);

    const entries = await readShellCacheEntries(page, SHELL_CACHE_PREFIX);
    expect(entries.length, "expected the shell cache to hold entries").toBeGreaterThan(0);
    // The observed cache contents are the evidence this spec exists to produce.
    console.log(
      "offline shell cache contents:\n" +
        entries.map((entry) => `  ${entry.cacheName}  ${entry.url}`).join("\n"),
    );

    for (const entry of entries) {
      expect(entry.setCookie, `${entry.url} carried a set-cookie header`).toBeNull();
      expect(
        entry.pathname.startsWith(AUTHORITY_PATH_PREFIX),
        `${entry.url} is an authority response and must never be cached`,
      ).toBe(false);
      expectNoSessionOrRecordMaterial(entry);
    }

    // (f) Screenshot of the offline-reloaded page for inspection.
    await page.screenshot({
      path: testInfo.outputPath(`offline-${testInfo.project.name}-shell-reload.png`),
      fullPage: true,
    });

    await context.setOffline(false);
  });
});

async function openGiggleApp(page: Page): Promise<void> {
  await page.goto("/?demo=giggle-band");
  await expectShellReady(page);
}

/** The same readiness check the Giggle visual suite uses for a booted app. */
async function expectShellReady(page: Page): Promise<void> {
  const app = page.locator("adl-app");
  await app.waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Giggle Band ADL Example" })).toBeVisible();
  await expect(app).toBeVisible();
  await expect(app).not.toContainText("Loading");
}

/** Mirrors the Giggle visual suite's context selection, so the same app path is exercised. */
async function selectBandContext(page: Page): Promise<void> {
  const bandSelector = page.locator("select[data-context-select='Band']");
  await bandSelector.waitFor({ state: "attached" });
  const selected = await bandSelector.evaluate((select) => {
    const htmlSelect = select as HTMLSelectElement;
    const option = [...htmlSelect.options].find((candidate) => candidate.label === "The Alphas");
    if (option === undefined) {
      return "";
    }
    htmlSelect.value = option.value;
    htmlSelect.dispatchEvent(new Event("change", { bubbles: true }));
    return htmlSelect.value;
  });
  expect(selected, "Band context should be populated from local data while offline").not.toBe("");
}

async function navigateTo(page: Page, navItem: string): Promise<void> {
  const menuButton = page.locator("button[data-shell-menu='true']");
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const target = page.locator(`button[data-nav-item='${navItem}']`);
  await expect(target).toBeVisible();
  await target.click();

  await expect(page.locator(".adl-nav-drawer")).not.toHaveClass(/active/);
}

async function hasController(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stale-while-revalidate writes happen after the response is handed to the
 * page, so wait for the cache to actually hold the shell document and at least
 * one script before cutting the network.
 */
async function waitForShellCached(page: Page): Promise<void> {
  await page.waitForFunction(
    async (prefix: string) => {
      const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
      const urls: string[] = [];

      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          urls.push(new URL(request.url).pathname);
        }
      }

      return urls.includes("/") && urls.some((pathname) => pathname.endsWith(".js"));
    },
    SHELL_CACHE_PREFIX,
    { timeout: 20_000 },
  );
}

async function readShellCacheEntries(page: Page, prefix: string): Promise<CachedEntry[]> {
  return page.evaluate(async (cachePrefix: string) => {
    const collected: CachedEntry[] = [];
    const names = (await caches.keys()).filter((name) => name.startsWith(cachePrefix));

    for (const cacheName of names) {
      const cache = await caches.open(cacheName);

      for (const request of await cache.keys()) {
        const response = await cache.match(request);

        if (response === undefined) {
          continue;
        }

        collected.push({
          cacheName,
          url: request.url,
          pathname: new URL(request.url).pathname,
          status: response.status,
          contentType: response.headers.get("content-type"),
          setCookie: response.headers.get("set-cookie"),
          body: await response.text(),
        });
      }
    }

    return collected;
  }, prefix);
}

/**
 * A cached body may not be a record payload or carry credential material.
 *
 * The structural check applies to bodies that genuinely parse as JSON: the
 * application's own script bundles are source text, not data, and must not be
 * scanned for substrings that legitimately appear in code.
 */
function expectNoSessionOrRecordMaterial(entry: CachedEntry): void {
  const parsed = tryParseJson(entry.body);

  if (parsed === undefined) {
    return;
  }

  for (const value of collectObjects(parsed)) {
    const keys = Object.keys(value);
    const looksLikeRecord = RECORD_SHAPE_KEYS.every((key) => keys.includes(key));
    expect(looksLikeRecord, `${entry.url} contains a record-shaped JSON object`).toBe(false);

    for (const key of keys) {
      expect(
        TOKEN_LIKE_KEY_PATTERN.test(key),
        `${entry.url} contains a token-like JSON field '${key}'`,
      ).toBe(false);
    }
  }
}

function tryParseJson(body: string): unknown {
  const trimmed = body.trim();

  if (trimmed === "" || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function collectObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectObjects(item));
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return [record, ...Object.values(record).flatMap((item) => collectObjects(item))];
  }

  return [];
}
