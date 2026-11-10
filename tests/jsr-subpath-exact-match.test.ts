/**
 * 回归：JSR 子路径 `.../router` 不得匹配到 `router-mount.ts`（前缀误判会导致 esbuild 报无 createRouter 等导出）
 */
import { existsSync } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import {
  cacheLookupForTests,
  type ModuleCache,
} from "../src/plugins/resolver-deno.ts";

describe("JSR 子路径 cacheLookup 精确匹配", () => {
  it("子路径 router 命中 router.ts，不命中 router-mount.ts", () => {
    const routerKey = "jsr:@dreamer/view@1.3.0/src/router.ts";
    const mountKey = "jsr:@dreamer/view@1.3.0/src/router-mount.ts";
    const routerPath = "/fake/router.ts";
    const mountPath = "/fake/router-mount.ts";
    const cache: ModuleCache = new Map([
      [routerKey, routerPath],
      [mountKey, mountPath],
    ]);
    const exists = (p: string) =>
      p === routerPath || p === mountPath || existsSync(p);

    const spec = "jsr:@dreamer/view@1.3.0/router";
    const hit = cacheLookupForTests(spec, cache, exists);
    expect(hit).toBeDefined();
    expect(hit!.key).toBe(routerKey);
    expect(hit!.path).toBe(routerPath);
  });
  it("版本范围剥 ^ 后不得把 desktop/mod 误判为 icons/mod（lock 已升到更高补丁版本）", () => {
    const desktopKey = "jsr:@dreamer/ui-view@1.2.9/src/desktop/mod.ts";
    const iconsKey =
      "jsr:@dreamer/ui-view@1.2.9/src/desktop/basic/icons/mod.ts";
    const rootKey = "jsr:@dreamer/ui-view@1.2.9/src/mod.ts";
    const desktopPath = "/fake/desktop-mod.ts";
    const iconsPath = "/fake/icons-mod.ts";
    const rootPath = "/fake/root-mod.ts";
    // icons 故意放在 Map 前面，复现「第一处宽松命中」的旧行为
    const cache: ModuleCache = new Map([
      [iconsKey, iconsPath],
      [desktopKey, desktopPath],
      [rootKey, rootPath],
    ]);
    const exists = (p: string) =>
      p === desktopPath || p === iconsPath || p === rootPath || existsSync(p);

    const desktopHit = cacheLookupForTests(
      "jsr:@dreamer/ui-view@1.2.8/src/desktop/mod",
      cache,
      exists,
    );
    expect(desktopHit).toBeDefined();
    expect(desktopHit!.key).toBe(desktopKey);
    expect(desktopHit!.path).toBe(desktopPath);

    const rootHit = cacheLookupForTests(
      "jsr:@dreamer/ui-view@^1.2.8",
      cache,
      exists,
    );
    expect(rootHit).toBeDefined();
    expect(rootHit!.key).toBe(rootKey);
    expect(rootHit!.path).toBe(rootPath);
  });
});
