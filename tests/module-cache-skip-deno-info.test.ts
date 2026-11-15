/**
 * 磁盘模块缓存命中时，buildModuleCache 必须跳过 deno info。
 */
import {
  basename,
  getEnv,
  join,
  makeTempDir,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import {
  buildModuleCache,
  type BuildModuleCacheStats,
} from "../src/plugins/resolver-deno.ts";

describe("磁盘缓存命中时跳过 deno info", () => {
  it("第二次构建应 skippedDenoInfo=true，且不必再扫源码", async () => {
    const root = await makeTempDir({ prefix: "esbuild-skip-deno-info-" });
    const cacheDir = join(
      getEnv("HOME") ?? "",
      ".dreamer",
      basename(root),
      "esbuild-deno-cache",
    );
    try {
      await writeTextFile(join(root, "deno.json"), `{}\n`);
      const entry = join(root, "main.ts");
      await writeTextFile(entry, `export const n = 1;\n`);

      const first: BuildModuleCacheStats = {
        skippedDenoInfo: false,
        diskEntries: 0,
        cacheEntries: 0,
      };
      const cache1 = await buildModuleCache(
        entry,
        root,
        false,
        undefined,
        first,
      );
      expect(first.skippedDenoInfo).toBe(false);
      expect(cache1.size).toBeGreaterThan(0);

      const second: BuildModuleCacheStats = {
        skippedDenoInfo: false,
        diskEntries: 0,
        cacheEntries: 0,
      };
      const t0 = performance.now();
      const cache2 = await buildModuleCache(
        entry,
        root,
        false,
        undefined,
        second,
      );
      const ms = performance.now() - t0;
      expect(second.skippedDenoInfo).toBe(true);
      expect(second.diskEntries).toBeGreaterThan(0);
      expect(cache2.size).toBe(cache1.size);
      // 跳过 deno info 后应明显快于一次子进程（通常 < 100ms）
      expect(ms).toBeLessThan(500);
    } finally {
      await remove(root, { recursive: true });
      try {
        await remove(cacheDir, { recursive: true });
      } catch {
        /* 清理失败不挡测试 */
      }
    }
  });
});
