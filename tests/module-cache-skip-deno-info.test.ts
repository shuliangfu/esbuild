/**
 * 磁盘模块缓存命中时，buildModuleCache 必须跳过 deno info。
 * 预写缓存文件，不依赖本机是否安装 Deno（CI 的 Node 任务没有 Deno）。
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
  computeDenoLockFingerprint,
  saveDenoModuleCacheToDisk,
} from "../src/plugins/deno-module-cache-disk.ts";
import {
  buildModuleCache,
  type BuildModuleCacheStats,
} from "../src/plugins/resolver-deno.ts";

describe("磁盘缓存命中时跳过 deno info", () => {
  it("预写磁盘缓存后应 skippedDenoInfo=true，且不必再扫源码", async () => {
    const root = await makeTempDir({ prefix: "esbuild-skip-deno-info-" });
    const home = getEnv("HOME") ?? getEnv("USERPROFILE") ??
      getEnv("LOCALAPPDATA") ?? "";
    const cacheDir = join(
      home,
      ".dreamer",
      basename(root),
      "esbuild-deno-cache",
    );
    try {
      const denoJson = join(root, "deno.json");
      await writeTextFile(denoJson, `{}\n`);
      const entry = join(root, "main.ts");
      await writeTextFile(entry, `export const n = 1;\n`);

      const fingerprint = await computeDenoLockFingerprint(denoJson);
      const seed = new Map<string, string>([[entry, entry]]);
      await saveDenoModuleCacheToDisk(root, fingerprint, seed);

      const stats: BuildModuleCacheStats = {
        skippedDenoInfo: false,
        diskEntries: 0,
        cacheEntries: 0,
      };
      const t0 = performance.now();
      const cache = await buildModuleCache(
        entry,
        root,
        false,
        undefined,
        stats,
      );
      const ms = performance.now() - t0;
      expect(stats.skippedDenoInfo).toBe(true);
      expect(stats.diskEntries).toBe(1);
      expect(cache.size).toBe(1);
      expect(cache.get(entry)).toBe(entry);
      expect(ms).toBeLessThan(500);
    } finally {
      await remove(root, { recursive: true });
      if (home) {
        try {
          await remove(cacheDir, { recursive: true });
        } catch {
          /* 清理失败不挡测试 */
        }
      }
    }
  });
});
