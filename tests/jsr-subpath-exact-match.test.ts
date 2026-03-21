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
});
