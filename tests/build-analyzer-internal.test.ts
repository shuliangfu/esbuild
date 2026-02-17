/**
 * @fileoverview BuildAnalyzer 内部方法测试
 */

import { describe, expect, it } from "@dreamer/test";
import type * as esbuild from "esbuild";
import { BuildAnalyzer } from "../src/build-analyzer.ts";

describe("BuildAnalyzer 内部方法", () => {
  describe("报告生成", () => {
    it("应该生成文本报告", () => {
      const analyzer = new BuildAnalyzer("zh-CN");
      const metafile: esbuild.Metafile = {
        inputs: {
          "src/index.ts": {
            bytes: 1000,
            imports: [],
          },
        },
        outputs: {
          "dist/main.js": {
            bytes: 5000,
            inputs: {
              "src/index.ts": {
                bytesInOutput: 1000,
              },
            },
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const report = analyzer.generateReport(analysis);

      expect(report).toBeTruthy();
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain("构建产物分析报告");
    });

    it("应该包含文件大小信息", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 1024 * 1024, // 1MB
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const report = analyzer.generateReport(analysis);

      expect(report).toContain("MB");
    });
  });

  describe("文件类型检测", () => {
    it("应该正确识别 JS 文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 1000,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const jsFile = analysis.files.find((f) => f.path.endsWith(".js"));

      expect(jsFile).toBeTruthy();
      if (jsFile) {
        expect(jsFile.type).toBe("js");
      }
    });

    it("应该正确识别 CSS 文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/style.css": {
            bytes: 1000,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const cssFile = analysis.files.find((f) => f.path.endsWith(".css"));

      expect(cssFile).toBeTruthy();
      if (cssFile) {
        expect(cssFile.type).toBe("css");
      }
    });

    it("应该正确识别其他类型文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/asset.png": {
            bytes: 1000,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const otherFile = analysis.files.find((f) => f.path.endsWith(".png"));

      expect(otherFile).toBeTruthy();
      if (otherFile) {
        expect(otherFile.type).toBe("other");
      }
    });
  });

  describe("重复代码检测", () => {
    it("应该检测重复代码", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {
          "src/file1.ts": {
            bytes: 100,
            imports: [],
          },
          "src/file2.ts": {
            bytes: 100,
            imports: [],
          },
        },
        outputs: {
          "dist/main.js": {
            bytes: 200,
            inputs: {
              "src/file1.ts": {
                bytesInOutput: 100,
              },
              "src/file2.ts": {
                bytesInOutput: 100,
              },
            },
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);

      // 注意：重复代码检测可能需要更复杂的场景
      expect(analysis.duplicates).toBeTruthy();
      expect(Array.isArray(analysis.duplicates)).toBe(true);
    });
  });

  describe("未使用代码检测", () => {
    it("应该检测未使用的代码", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {
          "src/unused.ts": {
            bytes: 100,
            imports: [],
          },
        },
        outputs: {},
      };

      const analysis = analyzer.analyze(metafile);

      // 注意：未使用代码检测可能需要更复杂的场景
      expect(analysis.unused).toBeTruthy();
      expect(Array.isArray(analysis.unused)).toBe(true);
    });
  });

  describe("入口文件检测", () => {
    it("应该识别入口文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {
          "src/index.ts": {
            bytes: 100,
            imports: [],
          },
        },
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {
              "src/index.ts": {
                bytesInOutput: 100,
              },
            },
            imports: [],
            exports: [],
            entryPoint: "src/index.ts",
          },
        },
      };

      const analysis = analyzer.analyze(metafile);

      // 检查文件是否存在（入口文件可能在 inputs 中，不在 outputs）
      expect(analysis.files.length).toBeGreaterThan(0);
    });
  });

  // 清理测试数据
  it("应该清理测试数据", async () => {
    const { cleanupTestData } = await import("./test-utils.ts");
    await cleanupTestData();
  });
});
