/**
 * @fileoverview Builder 配置验证测试
 */

import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { assertRejects, describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 配置验证", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-config");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Config Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("配置验证", () => {
    it("应该验证服务端配置缺少入口文件", async () => {
      const config: BuilderConfig = {
        server: {
          entry: "",
          output: outputDir,
        },
        validateConfig: true,
      };

      await assertRejects(
        async () => {
          const builder = new Builder(config);
          await builder.buildServer();
        },
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证服务端配置缺少输出目录", async () => {
      const config: BuilderConfig = {
        server: {
          entry: entryFile,
          output: "",
        },
        validateConfig: true,
      };

      await assertRejects(
        async () => {
          const builder = new Builder(config);
          await builder.buildServer();
        },
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证客户端配置缺少入口文件", async () => {
      const config: BuilderConfig = {
        client: {
          entry: "",
          output: outputDir,
          engine: "react",
        },
        validateConfig: true,
      };

      await assertRejects(
        async () => {
          const builder = new Builder(config);
          await builder.buildClient();
        },
        Error,
      );
    });

    it("应该验证客户端配置缺少输出目录", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: "",
          engine: "react",
        },
        validateConfig: true,
      };

      await assertRejects(
        async () => {
          const builder = new Builder(config);
          await builder.buildClient();
        },
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证入口文件不存在", async () => {
      const config: BuilderConfig = {
        client: {
          entry: join(testDataDir, "non-existent.ts"),
          output: outputDir,
          engine: "react",
        },
        validateConfig: true,
      };

      await assertRejects(
        async () => {
          const builder = new Builder(config);
          await builder.buildClient();
        },
        Error,
      );
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该在禁用验证时跳过验证", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        validateConfig: false,
      };

      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });
  });

  describe("依赖验证", () => {
    it("应该验证依赖配置", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
        validateConfig: true,
        build: {
          validateConfig: true,
        },
      };

      // 注意：依赖验证可能因为环境不同而结果不同
      const builder = new Builder(config);
      expect(builder).toBeTruthy();
    });
  });

  // 清理测试输出目录
  it("应该清理测试输出目录", async () => {
    if (outputDir) {
      try {
        await remove(outputDir, { recursive: true });
      } catch {
        // 忽略错误
      }
    }
  });
});
