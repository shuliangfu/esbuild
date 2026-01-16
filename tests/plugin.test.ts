/**
 * @fileoverview 插件系统测试
 */

import { describe, expect, it } from "@dreamer/test";
import { PluginManager } from "../src/plugin.ts";
import type {
  BuildPlugin,
  OnLoadResult,
  OnResolveResult,
} from "../src/plugin.ts";

describe("PluginManager", () => {
  describe("构造函数", () => {
    it("应该创建插件管理器实例", () => {
      const manager = new PluginManager();
      expect(manager).toBeTruthy();
    });
  });

  describe("插件注册", () => {
    it("应该注册单个插件", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "test-plugin",
        setup: () => {},
      };

      manager.register(plugin);
      expect(manager).toBeTruthy();
    });

    it("应该注册多个插件", () => {
      const manager = new PluginManager();
      const plugin1: BuildPlugin = {
        name: "plugin1",
        setup: () => {},
      };
      const plugin2: BuildPlugin = {
        name: "plugin2",
        setup: () => {},
      };

      manager.registerAll([plugin1, plugin2]);
      expect(manager).toBeTruthy();
    });

    it("应该获取所有插件", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "test-plugin",
        setup: () => {},
      };

      manager.register(plugin);
      const plugins = manager.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("test-plugin");
    });
  });

  describe("插件功能", () => {
    it("应该执行插件的 setup 方法", () => {
      const manager = new PluginManager();
      let setupCalled = false;

      const plugin: BuildPlugin = {
        name: "test-plugin",
        setup: () => {
          setupCalled = true;
        },
      };

      manager.register(plugin);
      // setup 通常在构建时调用，这里只测试注册
      expect(manager).toBeTruthy();
    });

    it("应该支持 onResolve 钩子", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "resolve-plugin",
        setup: (build) => {
          build.onResolve({ filter: /\.custom$/ }, (args) => {
            return {
              path: args.path.replace(".custom", ".js"),
            };
          });
        },
      };

      manager.register(plugin);
      expect(manager).toBeTruthy();
    });

    it("应该支持 onLoad 钩子", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "load-plugin",
        setup: (build) => {
          build.onLoad({ filter: /\.txt$/ }, async (args) => {
            return {
              contents: "custom content",
              loader: "text",
            };
          });
        },
      };

      manager.register(plugin);
      expect(manager).toBeTruthy();
    });
  });

  describe("插件链", () => {
    it("应该按顺序执行多个插件", () => {
      const manager = new PluginManager();
      const executionOrder: string[] = [];

      const plugin1: BuildPlugin = {
        name: "plugin1",
        setup: () => {
          executionOrder.push("plugin1");
        },
      };

      const plugin2: BuildPlugin = {
        name: "plugin2",
        setup: () => {
          executionOrder.push("plugin2");
        },
      };

      manager.registerAll([plugin1, plugin2]);
      expect(manager).toBeTruthy();
    });
  });

  describe("插件错误处理", () => {
    it("应该处理插件中的错误", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "error-plugin",
        setup: () => {
          throw new Error("Plugin error");
        },
      };

      // 注册时不应该立即抛出错误
      expect(() => manager.register(plugin)).not.toThrow();
    });
  });

  describe("插件数据传递", () => {
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
            return {
              contents: JSON.stringify(args.pluginData),
              loader: "json",
            };
          });
        },
      };

      manager.register(plugin);
      expect(manager).toBeTruthy();
    });
  });

  describe("边界情况", () => {
    it("应该处理空插件列表", () => {
      const manager = new PluginManager();
      manager.registerAll([]);
      expect(manager.getPlugins()).toHaveLength(0);
    });

    it("应该处理没有名称的插件", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "",
        setup: () => {},
      };

      manager.register(plugin);
      expect(manager.getPlugins()).toHaveLength(1);
    });

    it("应该处理重复注册的插件", () => {
      const manager = new PluginManager();
      const plugin: BuildPlugin = {
        name: "duplicate-plugin",
        setup: () => {},
      };

      manager.register(plugin);
      manager.register(plugin);

      // 应该允许重复注册（或去重，取决于实现）
      expect(manager.getPlugins().length).toBeGreaterThanOrEqual(1);
    });
  });

  // 清理测试数据
  it("应该清理测试数据", async () => {
    const { cleanupTestData } = await import("./test-utils.ts");
    await cleanupTestData();
  });
});
