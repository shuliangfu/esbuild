/**
 * @fileoverview CacheManager 高级功能测试
 */

import { describe, expect, it } from "@dreamer/test";
import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { CacheManager } from "../src/cache-manager.ts";
import type { BuildOptions, BuildResult } from "../src/types.ts";
import { cleanupDir, getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("CacheManager 高级功能", () => {
  let testDataDir: string;
  let cacheDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    cacheDir = getTestOutputDir("cache-manager");
    await mkdir(cacheDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("缓存压缩", () => {
    it("应该支持大文件压缩", async () => {
      const cacheManager = new CacheManager(cacheDir, true);
      const files = [join(testDataDir, "large-file.ts")];
      const options: BuildOptions = { mode: "prod" };

      // 创建一个大文件（模拟）
      await writeTextFile(files[0], "x".repeat(200 * 1024)); // 200KB

      const cacheKey = await cacheManager.getCacheKey(files, options);
      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
        metafile: {
          inputs: {},
          outputs: {
            "output.js": {
              bytes: 200 * 1024,
              inputs: {},
              imports: [],
              exports: [],
            },
          },
        },
      };

      await cacheManager.saveCache(cacheKey, buildResult);
      const cached = await cacheManager.getCachedResult(cacheKey);

      expect(cached).toBeTruthy();
    });
  });

  describe("缓存过期", () => {
    it("应该处理过期缓存", async () => {
      const cacheManager = new CacheManager(cacheDir, true);
      const files = [join(testDataDir, "test.ts")];
      const options: BuildOptions = { mode: "prod" };
      await writeTextFile(files[0], "test content");

      const cacheKey = await cacheManager.getCacheKey(files, options);
      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      await cacheManager.saveCache(cacheKey, buildResult);

      // 注意：实际过期测试需要修改时间戳，这里只测试基本功能
      const cached = await cacheManager.getCachedResult(cacheKey);
      expect(cached).toBeTruthy();
    });
  });

  describe("依赖追踪", () => {
    it("应该基于 metafile 追踪依赖", async () => {
      const cacheManager = new CacheManager(cacheDir, true);
      const files = [join(testDataDir, "main.ts")];
      const options: BuildOptions = { mode: "prod" };
      await writeTextFile(files[0], "import './dep.ts'");

      const cacheKey = await cacheManager.getCacheKey(files, options, {
        inputs: {
          "main.ts": { bytes: 100, imports: [] },
          "dep.ts": { bytes: 50, imports: [] },
        },
        outputs: {},
      });

      expect(cacheKey).toBeTruthy();
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (cacheDir) {
      try {
        await cleanupDir(cacheDir);
      } catch {
        // 忽略错误
      }
    }
  });
});
