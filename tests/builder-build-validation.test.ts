/**
 * @fileoverview Builder 构建产物验证测试
 */

import {
  exists,
  join,
  mkdir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import { describe, expect, it } from "@dreamer/test";
import { Builder } from "../src/builder.ts";
import type { BuilderConfig } from "../src/types.ts";
import { getTestDataDir, getTestOutputDir } from "./test-utils.ts";

describe("Builder 构建产物验证", () => {
  let entryFile: string;
  let outputDir: string;
  let testDataDir: string;

  // 测试前创建测试目录和测试文件
  it("应该创建测试目录和测试文件", async () => {
    testDataDir = getTestDataDir();
    outputDir = getTestOutputDir("builder-validation");
    entryFile = join(testDataDir, "src", "index.ts");

    // 确保目录存在
    await mkdir(join(testDataDir, "src"), { recursive: true });

    // 创建入口文件
    await writeTextFile(
      entryFile,
      `console.log('Validation Test');`,
    );

    expect(testDataDir).toBeTruthy();
  });

  describe("构建产物验证", () => {
    it("应该验证输出文件存在", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 验证输出文件存在
      for (const file of result.outputFiles) {
        const fileExists = await exists(file);
        expect(fileExists).toBe(true);
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证文件大小", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 验证文件大小
      for (const file of result.outputFiles) {
        if (await exists(file)) {
          const fileStat = await stat(file);
          expect(fileStat.size).toBeGreaterThan(0);
        }
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证 HTML 文件格式", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
          html: {
            title: "Test App",
          },
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 查找 HTML 文件
      const htmlFiles = result.outputFiles.filter((f) => f.endsWith(".html"));
      if (htmlFiles.length > 0) {
        for (const htmlFile of htmlFiles) {
          const content = await readTextFile(htmlFile);
          expect(content).toContain("<html");
          expect(content).toContain("</html>");
        }
      }
    }, { sanitizeOps: false, sanitizeResources: false });

    it("应该验证 JS 文件包含内容", async () => {
      const config: BuilderConfig = {
        client: {
          entry: entryFile,
          output: outputDir,
          engine: "react",
        },
      };
      const builder = new Builder(config);

      const result = await builder.buildClient();

      // 查找 JS 文件
      const jsFiles = result.outputFiles.filter((f) => f.endsWith(".js"));
      if (jsFiles.length > 0) {
        for (const jsFile of jsFiles) {
          const content = await readTextFile(jsFile);
          expect(content.length).toBeGreaterThan(0);
        }
      }
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
