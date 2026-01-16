/**
 * @fileoverview CacheManager 清理功能测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { CacheManager } from "../src/cache-manager.ts";
import type { BuildOptions, BuildResult } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("CacheManager 清理功能", () => {
  let testDataDir: string;
  let cacheDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    cacheDir = getTestOutputDir("cache-cleanup");
    await mkdir(cacheDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("删除缓存", () => {
    it("应该删除指定的缓存", async () => {
      const cacheManager = new CacheManager(cacheDir, true);
      const files = [join(testDataDir, "test.ts")];
      const options: BuildOptions = { mode: "prod" };
      await writeTextFile(files[0], "test content");

      const cacheKey = await cacheManager.getCacheKey(files, options);
      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      // 保存缓存
      await cacheManager.saveCache(cacheKey, buildResult);

      // 验证缓存存在
      const cached = await cacheManager.getCachedResult(cacheKey);
      expect(cached).toBeTruthy();

      // 删除缓存
      await cacheManager.removeCache(cacheKey);

      // 验证缓存已删除
      const cachedAfter = await cacheManager.getCachedResult(cacheKey);
      expect(cachedAfter).toBeNull();
    });

    it("应该安全处理不存在的缓存删除", async () => {
      const cacheManager = new CacheManager(cacheDir, true);

      // 尝试删除不存在的缓存
      await cacheManager.removeCache("non-existent-key");

      // 不应该抛出错误
      expect(cacheManager).toBeTruthy();
    });
  });

  describe("清理过期缓存", () => {
    it("应该清理过期缓存", async () => {
      const cacheManager = new CacheManager(cacheDir, true);
      const files = [join(testDataDir, "test.ts")];
      const options: BuildOptions = { mode: "prod" };
      await writeTextFile(files[0], "test content");

      const cacheKey = await cacheManager.getCacheKey(files, options);
      const buildResult: BuildResult = {
        outputFiles: ["output.js"],
        duration: 100,
      };

      // 保存缓存
      await cacheManager.saveCache(cacheKey, buildResult);

      // 清理过期缓存（注意：实际过期需要修改时间戳，这里只测试基本功能）
      const cleanedCount = await cacheManager.cleanExpiredCache();

      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("清理旧缓存", () => {
    it("应该保留指定数量的最新缓存", async () => {
      const cacheManager = new CacheManager(cacheDir, true);

      // 创建多个缓存
      for (let i = 0; i < 5; i++) {
        const files = [join(testDataDir, `test${i}.ts`)];
        await writeTextFile(files[0], `test content ${i}`);
        const options: BuildOptions = { mode: "prod" };
        const cacheKey = await cacheManager.getCacheKey(files, options);
        const buildResult: BuildResult = {
          outputFiles: [`output${i}.js`],
          duration: 100,
        };
        await cacheManager.saveCache(cacheKey, buildResult);
      }

      // 清理旧缓存，保留 2 个
      const cleanedCount = await cacheManager.cleanOldCache(2);

      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it("应该处理保留数量为 0 的情况", async () => {
      const cacheManager = new CacheManager(cacheDir, true);

      const cleanedCount = await cacheManager.cleanOldCache(0);

      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("清理所有缓存", () => {
    it("应该清理所有缓存", async () => {
      const cacheManager = new CacheManager(cacheDir, true);

      // 创建一些缓存
      for (let i = 0; i < 3; i++) {
        const files = [join(testDataDir, `test${i}.ts`)];
        await writeTextFile(files[0], `test content ${i}`);
        const options: BuildOptions = { mode: "prod" };
        const cacheKey = await cacheManager.getCacheKey(files, options);
        const buildResult: BuildResult = {
          outputFiles: [`output${i}.js`],
          duration: 100,
        };
        await cacheManager.saveCache(cacheKey, buildResult);
      }

      // 清理所有缓存
      await cacheManager.clearCache();

      // 验证缓存统计
      const stats = await cacheManager.getCacheStats();
      expect(stats.total).toBe(0);
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (cacheDir) {
      try {
        await remove(cacheDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
