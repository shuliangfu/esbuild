/**
 * @fileoverview PluginManager 高级功能测试
 */

import { describe, expect, it } from "@dreamer/test";
import { PluginManager } from "../src/plugin.ts";
import type {
  BuildPlugin,
  OnLoadResult,
  OnResolveResult,
} from "../src/plugin.ts";

describe("PluginManager 高级功能", () => {
  describe("插件转换", () => {
    it("应该转换为 esbuild 插件", async () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "test-plugin",
        setup: (build) => {
          build.onResolve({ filter: /\.custom$/ }, (args) => {
            return {
              path: args.path.replace(".custom", ".js"),
            };
          });
        },
      };

      manager.register(plugin);

      // 测试转换为 esbuild 插件
      const esbuildPlugins = manager.toEsbuildPlugins(
        await import("esbuild"),
        {},
      );

      expect(esbuildPlugins).toBeTruthy();
      expect(esbuildPlugins.length).toBeGreaterThan(0);
    });
  });

  describe("复杂插件场景", () => {
    it("应该支持多个插件链式处理", () => {
      const manager = new PluginManager();

      const plugin1: BuildPlugin = {
        name: "plugin1",
        setup: (build) => {
          build.onResolve({ filter: /\.ts$/ }, (args) => {
            return {
              path: args.path,
              pluginData: { processedBy: "plugin1" },
            };
          });
        },
      };

      const plugin2: BuildPlugin = {
        name: "plugin2",
        setup: (build) => {
          build.onLoad({ filter: /\.ts$/ }, (args) => {
            return {
              contents: "// processed by plugin2",
              loader: "ts",
            };
          });
        },
      };

      manager.registerAll([plugin1, plugin2]);

      const plugins = manager.getPlugins();
      expect(plugins).toHaveLength(2);
    });

    it("应该支持插件数据传递", () => {
      const manager = new PluginManager();

      const plugin: BuildPlugin = {
        name: "data-plugin",
        setup: (build) => {
          build.onResolve({ filter: /\.test$/ }, (args) => {
            return {
              path: args.path,
              pluginData: { custom: "data" },
            };
          });

          build.onLoad({ filter: /\.test$/ }, (args) => {
            // 可以使用 args.pluginData
            const data = args.pluginData as { custom?: string };
            return {
              contents: JSON.stringify(data),
              loader: "json",
            };
          });
        },
      };

      manager.register(plugin);
      expect(manager.getPlugins()).toHaveLength(1);
    });
  });

  describe("插件错误处理", () => {
    it("应该处理插件中的异步错误", () => {
      const manager = new PluginManager();

      const plugin: BuildPlugin = {
        name: "async-error-plugin",
        setup: async (build) => {
          build.onResolve({ filter: /\.async$/ }, async (args) => {
            throw new Error("Async error");
          });
        },
      };

      // 注册时不应该立即抛出错误
      expect(() => manager.register(plugin)).not.toThrow();
    });
  });

  // 清理测试数据
  it("应该清理测试数据", async () => {
    const { cleanupTestData } = await import("./test-utils.ts");
    await cleanupTestData();
  });
});
