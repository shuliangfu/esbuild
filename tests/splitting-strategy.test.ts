/**
 * @fileoverview Real SplittingStrategy → extra entryPoints tests
 */

import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { afterAll, beforeAll, describe, expect, it } from "@dreamer/test";
import { BuilderClient } from "../src/builder-client.ts";
import {
  collectSplitEntryPoints,
  globToRegExp,
  isComponentSplitPath,
  isRouteSplitPath,
  matchSplitGlobs,
  resolveClientEntryPoints,
} from "../src/splitting-strategy.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("SplittingStrategy real entry promotion", () => {
  let root: string;
  let entryFile: string;
  let routeFile: string;
  let componentFile: string;
  let bigFile: string;
  let sharedFile: string;
  let outputDir: string;

  beforeAll(async () => {
    root = join(getTestDataDir(), "splitting-strategy-fixture");
    await remove(root).catch(() => {});
    await mkdir(join(root, "routes"), { recursive: true });
    await mkdir(join(root, "components"), { recursive: true });
    sharedFile = join(root, "shared.ts");
    routeFile = join(root, "routes", "home.ts");
    componentFile = join(root, "components", "Widget.ts");
    bigFile = join(root, "big.ts");
    entryFile = join(root, "index.ts");
    outputDir = getTestOutputDir("splitting-strategy");

    await writeTextFile(
      sharedFile,
      `export const shared = "SHARED_" + "s".repeat(80);\n`,
    );
    await writeTextFile(
      routeFile,
      `import { shared } from "../shared.ts";\nexport const home = "HOME_" + shared;\n`,
    );
    await writeTextFile(
      componentFile,
      `export const Widget = "WIDGET_" + "w".repeat(80);\n`,
    );
    // Source must be large on disk — bySize uses file byte size, not runtime value.
    await writeTextFile(
      bigFile,
      `export const big = "${"B".repeat(4000)}";\n`,
    );
    await writeTextFile(
      entryFile,
      `import { home } from "./routes/home.ts";\n` +
        `import { Widget } from "./components/Widget.ts";\n` +
        `import { big } from "./big.ts";\n` +
        `console.log(home, Widget, big);\n`,
    );
  });

  afterAll(async () => {
    await cleanupDir(outputDir);
  });

  it("classifies route and component paths", () => {
    expect(isRouteSplitPath(routeFile)).toBe(true);
    expect(isRouteSplitPath(entryFile)).toBe(false);
    expect(isComponentSplitPath(componentFile)).toBe(true);
    expect(isComponentSplitPath(routeFile)).toBe(false);
  });

  it("globToRegExp matches ** and * segments", () => {
    const re = globToRegExp("**/routes/**/*.ts");
    expect(re.test("/app/src/routes/home.ts")).toBe(true);
    expect(re.test("/app/src/components/Widget.ts")).toBe(false);
    expect(matchSplitGlobs("/x/lib/heavy.ts", ["**/lib/**"])).toBe(true);
    expect(matchSplitGlobs("/x/lib/heavy.ts", ["**/other/**"])).toBe(false);
  });

  it("collectSplitEntryPoints promotes byRoute modules", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      byRoute: true,
    });
    expect(
      entries.some((p) => p.replace(/\\/g, "/").endsWith("/routes/home.ts")),
    )
      .toBe(true);
    expect(
      entries.some((p) =>
        p.replace(/\\/g, "/").endsWith("/components/Widget.ts")
      ),
    )
      .toBe(false);
  });

  it("collectSplitEntryPoints promotes byComponent modules", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      byComponent: true,
    });
    expect(
      entries.some((p) =>
        p.replace(/\\/g, "/").endsWith("/components/Widget.ts")
      ),
    )
      .toBe(true);
    expect(
      entries.some((p) => p.replace(/\\/g, "/").endsWith("/routes/home.ts")),
    )
      .toBe(false);
  });

  it("collectSplitEntryPoints promotes bySize modules", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      bySize: 500, // big.ts ~4KB payload
    });
    expect(entries.some((p) => p.replace(/\\/g, "/").endsWith("/big.ts")))
      .toBe(true);
  });

  it("collectSplitEntryPoints promotes custom matches", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      custom: (p) => p.replace(/\\/g, "/").endsWith("/shared.ts"),
    });
    expect(entries.some((p) => p.replace(/\\/g, "/").endsWith("/shared.ts")))
      .toBe(true);
  });

  it("resolveClientEntryPoints keeps boolean splitting as single entry", async () => {
    const points = await resolveClientEntryPoints(entryFile, true, true);
    expect(points.length).toBe(1);
  });

  it(
    "BuilderClient byRoute emits more JS chunks than boolean splitting",
    async () => {
      const outBool = join(outputDir, "bool");
      const outRoute = join(outputDir, "route");
      await mkdir(outBool, { recursive: true });
      await mkdir(outRoute, { recursive: true });

      const boolResult = await new BuilderClient({
        entry: entryFile,
        output: outBool,
        engine: "react",
        bundle: { splitting: true, minify: false },
      }).build("dev");

      const routeResult = await new BuilderClient({
        entry: entryFile,
        output: outRoute,
        engine: "react",
        bundle: {
          splitting: { enabled: true, byRoute: true },
          minify: false,
        },
      }).build("dev");

      const countJs = (files: string[]) =>
        files.filter((f) => f.endsWith(".js")).length;

      expect(countJs(boolResult.outputFiles)).toBe(1);
      expect(countJs(routeResult.outputFiles)).toBeGreaterThan(
        countJs(boolResult.outputFiles),
      );
    },
    { sanitizeOps: false, sanitizeResources: false },
  );

  it(
    "BuilderClient byComponent emits more JS chunks than boolean splitting",
    async () => {
      const out = join(outputDir, "component");
      await mkdir(out, { recursive: true });

      const result = await new BuilderClient({
        entry: entryFile,
        output: out,
        engine: "react",
        bundle: {
          splitting: { enabled: true, byComponent: true },
          minify: false,
        },
      }).build("dev");

      expect(result.outputFiles.filter((f) => f.endsWith(".js")).length)
        .toBeGreaterThan(1);
    },
    { sanitizeOps: false, sanitizeResources: false },
  );

  it(
    "BuilderClient bySize emits more JS chunks for large modules",
    async () => {
      const out = join(outputDir, "size");
      await mkdir(out, { recursive: true });

      const result = await new BuilderClient({
        entry: entryFile,
        output: out,
        engine: "react",
        bundle: {
          splitting: { enabled: true, bySize: 500 },
          minify: false,
        },
      }).build("dev");

      expect(result.outputFiles.filter((f) => f.endsWith(".js")).length)
        .toBeGreaterThan(1);
    },
    { sanitizeOps: false, sanitizeResources: false },
  );
});

describe("SplittingStrategy aliases + include/exclude globs", () => {
  let root: string;
  let entryFile: string;
  let aliasedRoute: string;
  let aliasedLib: string;
  let outputDir: string;

  beforeAll(async () => {
    root = join(getTestDataDir(), "splitting-alias-glob-fixture");
    await remove(root).catch(() => {});
    await mkdir(join(root, "src", "routes"), { recursive: true });
    await mkdir(join(root, "src", "lib"), { recursive: true });
    aliasedRoute = join(root, "src", "routes", "about.ts");
    aliasedLib = join(root, "src", "lib", "heavy.ts");
    entryFile = join(root, "src", "index.ts");
    outputDir = getTestOutputDir("splitting-alias-glob");

    await writeTextFile(
      aliasedRoute,
      `export const about = "ABOUT_" + "a".repeat(40);\n`,
    );
    await writeTextFile(
      aliasedLib,
      `export const heavy = "HEAVY_" + "h".repeat(40);\n`,
    );
    // Only reachable via `@/` alias — no relative import edge.
    await writeTextFile(
      entryFile,
      `import { about } from "@/routes/about.ts";\n` +
        `import { heavy } from "@/lib/heavy.ts";\n` +
        `console.log(about, heavy);\n`,
    );
  });

  afterAll(async () => {
    await cleanupDir(outputDir);
  });

  it("without aliases, @/ imports are not walked (compat)", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      byRoute: true,
    });
    expect(entries.length).toBe(0);
  });

  it("with aliases, byRoute follows @/ and promotes route module", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      byRoute: true,
      root,
      aliases: { "@/": "./src/" },
    });
    expect(
      entries.some((p) =>
        p.replace(/\\/g, "/").endsWith("/src/routes/about.ts")
      ),
    ).toBe(true);
    expect(
      entries.some((p) => p.replace(/\\/g, "/").endsWith("/src/lib/heavy.ts")),
    ).toBe(false);
  });

  it("include glob alone promotes matching modules via aliases", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      root,
      aliases: { "@/": "./src/" },
      include: ["**/lib/**"],
    });
    expect(
      entries.some((p) => p.replace(/\\/g, "/").endsWith("/src/lib/heavy.ts")),
    ).toBe(true);
    expect(
      entries.some((p) =>
        p.replace(/\\/g, "/").endsWith("/src/routes/about.ts")
      ),
    ).toBe(false);
  });

  it("exclude filters otherwise matching modules", async () => {
    const entries = await collectSplitEntryPoints(entryFile, {
      enabled: true,
      root,
      aliases: { "@/": "./src/" },
      byRoute: true,
      include: ["**/lib/**"],
      exclude: ["**/lib/**"],
    });
    expect(
      entries.some((p) =>
        p.replace(/\\/g, "/").endsWith("/src/routes/about.ts")
      ),
    ).toBe(true);
    expect(
      entries.some((p) => p.replace(/\\/g, "/").endsWith("/src/lib/heavy.ts")),
    ).toBe(false);
  });

  it("resolveClientEntryPoints merges alias-promoted extras", async () => {
    const points = await resolveClientEntryPoints(
      entryFile,
      {
        enabled: true,
        byRoute: true,
        root,
        aliases: { "@/": "./src/" },
      },
      true,
    );
    expect(points.length).toBeGreaterThan(1);
    expect(
      points.some((p) =>
        p.replace(/\\/g, "/").endsWith("/src/routes/about.ts")
      ),
    ).toBe(true);
  });

  it(
    "BuilderClient include glob emits more JS chunks (relative imports)",
    async () => {
      // esbuild native `alias` rejects `@/`-style prefixes; real builds still
      // resolve via plugins / relative paths. Here we lock include→chunks with
      // a relative-import entry (alias walk is covered by collect* tests).
      const relRoot = join(getTestDataDir(), "splitting-include-build-fixture");
      await remove(relRoot).catch(() => {});
      await mkdir(join(relRoot, "lib"), { recursive: true });
      const libFile = join(relRoot, "lib", "heavy.ts");
      const relEntry = join(relRoot, "index.ts");
      await writeTextFile(
        libFile,
        `export const heavy = "HEAVY_" + "h".repeat(40);
`,
      );
      await writeTextFile(
        relEntry,
        `import { heavy } from "./lib/heavy.ts";
console.log(heavy);
`,
      );

      const out = join(outputDir, "include-glob");
      await mkdir(out, { recursive: true });

      const result = await new BuilderClient({
        entry: relEntry,
        output: out,
        engine: "react",
        bundle: {
          minify: false,
          splitting: {
            enabled: true,
            include: ["**/lib/**"],
          },
        },
      }).build("dev");

      expect(result.outputFiles.filter((f) => f.endsWith(".js")).length)
        .toBeGreaterThan(1);
    },
    { sanitizeOps: false, sanitizeResources: false },
  );
});
