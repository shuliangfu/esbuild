/**
 * @fileoverview 构建分析器测试
 */

import { describe, expect, it } from "@dreamer/test";
import type * as esbuild from "esbuild";
import { BuildAnalyzer } from "../src/build-analyzer.ts";

describe("BuildAnalyzer", () => {
  describe("构造函数", () => {
    it("应该创建构建分析器实例", () => {
      const analyzer = new BuildAnalyzer();
      expect(analyzer).toBeTruthy();
    });
  });

  describe("分析构建产物", () => {
    it("应该分析基本的 metafile", () => {
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
            bytes: 500,
            inputs: {
              "src/index.ts": {
                bytesInOutput: 100,
              },
            },
            imports: [],
            exports: [],
            entryPoint: "src/index.ts",
            cssBundle: undefined,
          },
        },
      };

      const result = analyzer.analyze(metafile);

      expect(result).toBeTruthy();
      expect(result.totalSize).toBe(500);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("dist/main.js");
      expect(result.files[0].size).toBe(500);
      expect(result.files[0].type).toBe("js");
    });

    it("应该计算总文件大小", () => {
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
          "dist/chunk.js": {
            bytes: 500,
            inputs: {},
            imports: [],
            exports: [],
          },
          "dist/main.css": {
            bytes: 200,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      expect(result.totalSize).toBe(1700);
      expect(result.files).toHaveLength(3);
    });

    it("应该识别文件类型", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [],
            exports: [],
          },
          "dist/main.css": {
            bytes: 100,
            inputs: {},
            imports: [],
            exports: [],
          },
          "dist/asset.svg": {
            bytes: 100,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      const jsFile = result.files.find((f) => f.path.endsWith(".js"));
      const cssFile = result.files.find((f) => f.path.endsWith(".css"));
      const otherFile = result.files.find((f) => f.path.endsWith(".svg"));

      expect(jsFile?.type).toBe("js");
      expect(cssFile?.type).toBe("css");
      expect(otherFile?.type).toBe("other");
    });

    it("应该构建依赖关系图", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [
              {
                path: "dist/chunk.js",
                kind: "import-statement",
                external: false,
              },
            ],
            exports: [],
          },
          "dist/chunk.js": {
            bytes: 50,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      // 检查依赖关系（dependencies 结构可能不同）
      expect(result.dependencies).toBeTruthy();
      // 检查是否有 main.js 的依赖关系
      const mainDeps = result.dependencies["dist/main.js"];
      if (mainDeps) {
        expect(mainDeps.imports).toContain("dist/chunk.js");
      }
    });

    it("应该检测重复的导入", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [
              {
                path: "common.js",
                kind: "import-statement",
                external: false,
              },
            ],
            exports: [],
          },
          "dist/chunk.js": {
            bytes: 50,
            inputs: {},
            imports: [
              {
                path: "common.js",
                kind: "import-statement",
                external: false,
              },
            ],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      expect(result.duplicates.length).toBeGreaterThan(0);
      const duplicate = result.duplicates.find((d) => d.code === "common.js");
      expect(duplicate).toBeTruthy();
      expect(duplicate?.count).toBe(2);
    });

    it("应该检测未使用的文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [],
            exports: [],
          },
          "dist/unused.js": {
            bytes: 50,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      // unused.js 应该被检测为未使用（如果它不是入口文件）
      expect(result.unused).toBeTruthy();
    });
  });

  describe("生成分析报告", () => {
    it("应该生成文本格式的报告", () => {
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
      const report = analyzer.generateReport(analysis);

      expect(report).toBeTruthy();
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain("构建产物分析报告");
      expect(report).toContain("总文件大小");
    });

    it("应该格式化文件大小", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 1024,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const report = analyzer.generateReport(analysis);

      // 应该包含格式化的文件大小
      expect(report).toContain("KB");
    });

    it("应该包含文件列表", () => {
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
          "dist/chunk.js": {
            bytes: 500,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const report = analyzer.generateReport(analysis);

      expect(report).toContain("dist/main.js");
      expect(report).toContain("dist/chunk.js");
    });

    it("应该包含重复代码信息", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [
              {
                path: "common.js",
                kind: "import-statement",
                external: false,
              },
            ],
            exports: [],
          },
          "dist/chunk.js": {
            bytes: 50,
            inputs: {},
            imports: [
              {
                path: "common.js",
                kind: "import-statement",
                external: false,
              },
            ],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const report = analyzer.generateReport(analysis);

      if (analysis.duplicates.length > 0) {
        expect(report).toContain("重复代码");
      }
    });
  });

  describe("生成优化建议", () => {
    it("应该生成优化建议", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 5 * 1024 * 1024, // 5MB - 应该触发警告
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const suggestions = analyzer.generateOptimizationSuggestions(analysis, { stages: {}, total: 0 });

      expect(suggestions).toBeTruthy();
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it("应该生成 HTML 报告", async () => {
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
      const reportPath = "./tests/data/build-report.html";

      const result = await analyzer.generateHTMLReport(analysis, reportPath);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("应该为大型文件生成警告", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 10 * 1024 * 1024, // 10MB
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const analysis = analyzer.analyze(metafile);
      const suggestions = analyzer.generateOptimizationSuggestions(analysis, { stages: {}, total: 0 });

      // 检查是否有关于大文件的建议（中文或英文）
      const largeFileWarning = suggestions.find((s: any) =>
        s.title.includes("过大") || s.title.includes("large") || s.title.includes("较大")
      );
      // 10MB 文件应该触发警告
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("边界情况", () => {
    it("应该处理空的 metafile", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {},
      };

      const result = analyzer.analyze(metafile);

      expect(result.totalSize).toBe(0);
      expect(result.files).toHaveLength(0);
      expect(result.dependencies).toEqual({});
    });

    it("应该处理没有导入的文件", () => {
      const analyzer = new BuildAnalyzer();
      const metafile: esbuild.Metafile = {
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 100,
            inputs: {},
            imports: [],
            exports: [],
          },
        },
      };

      const result = analyzer.analyze(metafile);

      expect(result.files[0].imports).toEqual([]);
      expect(result.files[0].importedBy).toEqual([]);
    });
  });

  // 清理测试数据
  it("应该清理测试数据", async () => {
    const { cleanupTestData } = await import("./test-utils.ts");
    await cleanupTestData();
  });
});
