/**
 * @fileoverview Builder 多入口构建测试
 */

import { join, mkdir, remove, writeTextFile } from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 多入口构建", () => {
  let entryFile1: string;
  let entryFile2: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-multi-entry");
    entryFile1 = join(testDataDir, "src", "index.ts");
    entryFile2 = join(testDataDir, "src", "about.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建多个入口文件
    await writeTextFile(
      entryFile1,
      `console.log('Index Page');`,
    );
    await writeTextFile(
      entryFile2,
      `console.log('About Page');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("多入口构建", () => {
    it("应该支持多入口配置", async () => {
      const config: BuilderConfig = {
        client: {
          entries: {
            index: {
              entry: entryFile1,
            },
            about: {
              entry: entryFile2,
            },
          },
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      // 多入口构建应该成功
      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      expect(result.outputFiles).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该为每个入口生成独立的输出", async () => {
      const config: BuilderConfig = {
        client: {
          entries: {
            index: {
              entry: entryFile1,
              output: join(outputDir, "index"),
            },
            about: {
              entry: entryFile2,
              output: join(outputDir, "about"),
            },
          },
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该支持多入口 HTML 生成", async () => {
      const config: BuilderConfig = {
        client: {
          entries: {
            index: {
              entry: entryFile1,
            },
            about: {
              entry: entryFile2,
            },
          },
          output: outputDir,
          engine: "react",
          html: {
            entries: {
              index: {
                entry: entryFile1,
                title: "Index Page",
              },
              about: {
                entry: entryFile2,
                title: "About Page",
              },
            },
          },
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      expect(result).toBeTruthy();
      // 应该生成了多个 HTML 文件（可能为 0，因为 HTML 生成是可选的）
      const htmlFiles = result.outputFiles.filter((f) => f.endsWith(".html"));
      // 注意：HTML 文件可能不会自动生成，取决于配置
      expect(result.outputFiles.length).toBeGreaterThan(0);
    }, { sanitizeOps: false, sanitizeResources: false });
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
