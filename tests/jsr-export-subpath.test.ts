/**
 * 回归：JSR 导出子路径（如 `@dreamer/ui-view/charts` → `src/desktop/charts/mod.ts`）
 * 必须写入 moduleCache，且 `deno info` 彩色 `local:` 文本也能解析。
 */
import { describe, expect, it } from "@dreamer/test";
import {
  cacheLookupForTests,
  localPathFromDenoInfoJsonForTests,
  mergeDenoInfoModulesForTests,
  type ModuleCache,
  parseDenoInfoLocalPathForTests,
} from "../src/plugins/resolver-deno.ts";

describe("JSR 导出子路径与 deno info 回落", () => {
  it("应去掉 ANSI 后再解析 deno info 的 local: 路径", () => {
    const colored =
      "\x1b[0m\x1b[1mlocal:\x1b[0m /tmp/jsr-cache/charts-mod.ts\n\x1b[0m\x1b[1mtype:\x1b[0m TypeScript\n";
    expect(parseDenoInfoLocalPathForTests(colored)).toBe(
      "/tmp/jsr-cache/charts-mod.ts",
    );
    expect(parseDenoInfoLocalPathForTests("local: /tmp/plain.ts\n")).toBe(
      "/tmp/plain.ts",
    );
  });

  it("deno info --json 应跟随 redirects 找到 charts 导出文件", () => {
    const localPath = "/tmp/ui-view/src/desktop/charts/mod.ts";
    const info = {
      version: 1,
      roots: ["jsr:@dreamer/ui-view@^1.3.12/charts"],
      modules: [{
        kind: "esm",
        specifier:
          "https://jsr.io/@dreamer/ui-view/1.3.12/src/desktop/charts/mod.ts",
        local: localPath,
      }],
      redirects: {
        "jsr:@dreamer/ui-view@^1.3.12/charts":
          "https://jsr.io/@dreamer/ui-view/1.3.12/src/desktop/charts/mod.ts",
      },
    };
    expect(
      localPathFromDenoInfoJsonForTests(
        info,
        "jsr:@dreamer/ui-view@^1.3.12/charts",
      ),
    ).toBe(localPath);
  });

  it("merge 后 cacheLookup 应命中 @dreamer/ui-view/charts 导出", () => {
    const localPath = "/fake/desktop-charts-mod.ts";
    const cache: ModuleCache = new Map();
    mergeDenoInfoModulesForTests({
      version: 1,
      roots: ["jsr:@dreamer/ui-view@^1.3.12/charts"],
      modules: [{
        kind: "esm",
        specifier:
          "https://jsr.io/@dreamer/ui-view/1.3.12/src/desktop/charts/mod.ts",
        local: localPath,
      }],
      redirects: {
        "jsr:@dreamer/ui-view@^1.3.12/charts":
          "https://jsr.io/@dreamer/ui-view/1.3.12/src/desktop/charts/mod.ts",
      },
    }, cache);

    const exists = (p: string) => p === localPath;
    const ranged = cacheLookupForTests(
      "jsr:@dreamer/ui-view@^1.3.12/charts",
      cache,
      exists,
    );
    expect(ranged).toBeDefined();
    expect(ranged!.path).toBe(localPath);
    expect(ranged!.key).toBe(
      "jsr:@dreamer/ui-view@1.3.12/src/desktop/charts/mod.ts",
    );

    const pinned = cacheLookupForTests(
      "jsr:@dreamer/ui-view@1.3.12/charts",
      cache,
      exists,
    );
    expect(pinned).toBeDefined();
    expect(pinned!.path).toBe(localPath);
    expect(pinned!.key).toBe(
      "jsr:@dreamer/ui-view@1.3.12/src/desktop/charts/mod.ts",
    );
  });

  it("merge 后 jsx-runtime 别名应回落到 src/jsx-runtime.ts，避免相对导入走错", () => {
    const localPath = "/fake/view-jsx-runtime.ts";
    const cache: ModuleCache = new Map();
    mergeDenoInfoModulesForTests({
      version: 1,
      roots: ["jsr:@dreamer/view@^3.1.0/jsx-runtime"],
      modules: [{
        kind: "esm",
        specifier: "https://jsr.io/@dreamer/view/3.1.0/src/jsx-runtime.ts",
        local: localPath,
      }],
      redirects: {
        "jsr:@dreamer/view@^3.1.0/jsx-runtime":
          "https://jsr.io/@dreamer/view/3.1.0/src/jsx-runtime.ts",
      },
    }, cache);

    const hit = cacheLookupForTests(
      "jsr:@dreamer/view@^3.1.0/jsx-runtime",
      cache,
      (p) => p === localPath,
    );
    expect(hit).toBeDefined();
    expect(hit!.path).toBe(localPath);
    expect(hit!.key).toBe("jsr:@dreamer/view@3.1.0/src/jsx-runtime.ts");
  });

  it("jsx-runtime 在仅有 jsr:/@ 别名和短导出键时，lookup 仍回到 src/jsx-runtime.ts", () => {
    const localPath = "/fake/view-jsx-runtime.ts";
    const cache: ModuleCache = new Map([
      ["jsr:/@dreamer/view@^3.1.0/jsx-runtime", localPath],
      ["jsr:@dreamer/view@3.1.0/jsx-runtime", localPath],
      ["jsr:@dreamer/view@3.1.0/src/jsx-runtime.ts", localPath],
    ]);
    const hit = cacheLookupForTests(
      "jsr:@dreamer/view@^3.1.0/jsx-runtime",
      cache,
      (p) => p === localPath,
    );
    expect(hit).toBeDefined();
    expect(hit!.path).toBe(localPath);
    expect(hit!.key).toBe("jsr:@dreamer/view@3.1.0/src/jsx-runtime.ts");
  });

  it("charts 在仅有 jsr:/@ 别名时，lookup 仍回到 src/desktop/charts/mod.ts", () => {
    const localPath = "/fake/desktop-charts-mod.ts";
    const cache: ModuleCache = new Map([
      ["jsr:/@dreamer/ui-view@^1.3.12/charts", localPath],
      ["jsr:@dreamer/ui-view@1.3.12/src/desktop/charts/mod.ts", localPath],
    ]);
    const hit = cacheLookupForTests(
      "jsr:@dreamer/ui-view@^1.3.12/charts",
      cache,
      (p) => p === localPath,
    );
    expect(hit).toBeDefined();
    expect(hit!.path).toBe(localPath);
    expect(hit!.key).toBe(
      "jsr:@dreamer/ui-view@1.3.12/src/desktop/charts/mod.ts",
    );
  });
});
