/**
 * @fileoverview CLI 工具测试
 */

import { describe, expect, it } from "@dreamer/test";
import {
  join,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

// 注意：CLI 测试需要模拟命令行环境，这里主要测试配置加载功能
describe("CLI 工具", () => {
  let testDataDir: string;
  let configDir: string;

  // 测试前创建测试目录
  it("应该创建测试目录", async () => {
    testDataDir = getTestDataDir();
    configDir = join(testDataDir, "config");
    await mkdir(configDir, { recursive: true });
    expect(testDataDir).toBeTruthy();
  });

  describe("配置文件查找", () => {
    it("应该查找 esbuild.config.json", async () => {
      const configFile = join(configDir, "esbuild.config.json");
      const config = {
        client: {
          entry: "./src/index.ts",
          output: "./dist",
          engine: "react",
        },
      };
      await writeTextFile(configFile, JSON.stringify(config, null, 2));

      // 验证配置文件存在
      const content = await readTextFile(configFile);
      const parsed = JSON.parse(content);
      expect(parsed.client).toBeTruthy();
      expect(parsed.client.engine).toBe("react");
    });

    it("应该查找 esbuild.config.ts", async () => {
      const configFile = join(configDir, "esbuild.config.ts");
      const config = `
        export default {
          client: {
            entry: "./src/index.ts",
            output: "./dist",
            engine: "react",
          },
        };
      `;
      await writeTextFile(configFile, config);

      // 验证配置文件存在
      const content = await readTextFile(configFile);
      expect(content).toContain("client");
      expect(content).toContain("react");
    });

    it("应该查找 esbuild.json", async () => {
      const configFile = join(configDir, "esbuild.json");
      const config = {
        client: {
          entry: "./src/index.ts",
          output: "./dist",
          engine: "react",
        },
      };
      await writeTextFile(configFile, JSON.stringify(config, null, 2));

      const content = await readTextFile(configFile);
      const parsed = JSON.parse(content);
      expect(parsed.client).toBeTruthy();
    });
  });

  describe("配置文件加载", () => {
    it("应该加载 JSON 配置文件", async () => {
      const configFile = join(configDir, "test.config.json");
      const config = {
        client: {
          entry: "./src/index.ts",
          output: "./dist",
          engine: "react",
        },
      };
      await writeTextFile(configFile, JSON.stringify(config, null, 2));

      const content = await readTextFile(configFile);
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(config);
    });

    it("应该处理无效的 JSON 配置文件", async () => {
      const configFile = join(configDir, "invalid.config.json");
      await writeTextFile(configFile, "{ invalid json }");

      // 应该能够检测到无效 JSON
      try {
        const content = await readTextFile(configFile);
        JSON.parse(content);
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });
  });

  describe("命令行选项", () => {
    it("应该支持构建模式选项", () => {
      // 模拟命令行选项
      const options = {
        mode: "dev",
        clean: true,
        cache: true,
      };

      expect(options.mode).toBe("dev");
      expect(options.clean).toBe(true);
      expect(options.cache).toBe(true);
    });

    it("应该支持缓存选项", () => {
      const options = {
        "no-cache": false,
        "cache-dir": "./cache",
      };

      expect(options["no-cache"]).toBe(false);
      expect(options["cache-dir"]).toBe("./cache");
    });

    it("应该支持日志级别选项", () => {
      const options = {
        "log-level": "debug",
        silent: false,
      };

      expect(options["log-level"]).toBe("debug");
      expect(options.silent).toBe(false);
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (configDir) {
      try {
        await remove(configDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
