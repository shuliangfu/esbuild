/**
 * @module @dreamer/esbuild/client-builder
 *
 * 客户端构建器
 *
 * 使用 esbuild 进行客户端代码打包
 */

import { mkdir, resolve } from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import { PluginManager } from "./plugin.ts";
import { createConditionalCompilePlugin } from "./plugins/conditional-compile.ts";
import { createServerModuleDetectorPlugin } from "./plugins/server-module-detector.ts";
import type {
  BuildMode,
  BuildResult,
  ClientBundleOptions,
  ClientConfig,
  SplittingStrategy,
} from "./types.ts";

/**
 * 客户端构建器类
 */
export class ClientBuilder {
  private config: ClientConfig;
  private buildContext?: esbuild.BuildContext;
  private pluginManager: PluginManager;

  constructor(config: ClientConfig) {
    this.config = config;
    this.pluginManager = new PluginManager();

    // 方案一：自动注册服务端模块检测插件（优先级最高，最先执行）
    this.pluginManager.register(createServerModuleDetectorPlugin());

    // 方案二：自动注册条件编译插件
    this.pluginManager.register(createConditionalCompilePlugin());

    // 注册配置中的插件（用户自定义插件）
    if (config.plugins) {
      this.pluginManager.registerAll(config.plugins);
    }
  }

  /**
   * 构建客户端代码
   */
  async build(mode: BuildMode = "prod"): Promise<BuildResult> {
    const startTime = Date.now();

    // 确保输出目录存在
    await mkdir(this.config.output, { recursive: true });

    // 解析入口文件路径（支持单入口）
    if (!this.config.entry) {
      throw new Error("客户端配置缺少入口文件 (entry)");
    }
    const entryPoint = await resolve(this.config.entry);

    // 构建选项
    const bundleOptions: ClientBundleOptions = {
      minify: mode === "prod",
      sourcemap: mode === "dev",
      splitting: true,
      format: "esm",
      ...this.config.bundle,
    };

    // 处理代码分割配置
    const splittingEnabled = typeof bundleOptions.splitting === "boolean"
      ? bundleOptions.splitting
      : bundleOptions.splitting?.enabled !== false;

    // 生成 chunk 名称模式（根据分割策略）
    const chunkNames = this.getChunkNames(bundleOptions.splitting);

    // 处理 Source Map 配置
    let sourcemapOption: boolean | "inline" | "external" | "both" = false;
    if (this.config.sourcemap) {
      if (typeof this.config.sourcemap === "boolean") {
        sourcemapOption = this.config.sourcemap;
      } else {
        const sourcemapConfig = this.config.sourcemap;
        if (sourcemapConfig.enabled !== false) {
          // 根据模式设置 sourcemap
          if (sourcemapConfig.mode === "inline") {
            sourcemapOption = "inline";
          } else if (sourcemapConfig.mode === "external") {
            sourcemapOption = true; // esbuild 默认生成外部文件
          } else if (sourcemapConfig.mode === "both") {
            sourcemapOption = true; // 先生成外部文件，后续可以处理内联
          } else {
            // 默认：开发环境内联，生产环境外部
            sourcemapOption = mode === "dev" ? "inline" : true;
          }
        }
      }
    } else {
      // 使用 bundleOptions 中的 sourcemap
      sourcemapOption = bundleOptions.sourcemap || false;
    }

    // 方案一：自动检测并排除服务端模块（通过插件实现）
    // 注意：服务端模块检测已通过插件实现，这里只处理用户手动配置的 external
    const externalModules = bundleOptions.external || [];

    // esbuild 构建选项
    const buildOptions: esbuild.BuildOptions = {
      entryPoints: [entryPoint],
      bundle: true,
      outdir: this.config.output,
      format: bundleOptions.format || "esm",
      platform: "browser",
      target: "es2020",
      minify: bundleOptions.minify,
      sourcemap: sourcemapOption,
      splitting: splittingEnabled,
      external: externalModules,
      chunkNames,
      treeShaking: true,
      metafile: true,
    };

    // 添加插件
    buildOptions.plugins = this.pluginManager.toEsbuildPlugins(
      esbuild,
      buildOptions,
    );

    // 执行构建
    const result = await esbuild.build(buildOptions);

    // 获取输出文件列表
    const outputFiles: string[] = [];
    if (result.metafile) {
      for (const file in result.metafile.outputs) {
        outputFiles.push(file);
      }
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles,
      metafile: result.metafile,
      duration,
    };
  }

  /**
   * 创建增量构建上下文
   */
  async createContext(
    mode: BuildMode = "dev",
  ): Promise<esbuild.BuildContext> {
    // 确保输出目录存在
    await mkdir(this.config.output, { recursive: true });

    // 解析入口文件路径（支持单入口）
    if (!this.config.entry) {
      throw new Error("客户端配置缺少入口文件 (entry)");
    }
    const entryPoint = await resolve(this.config.entry);

    // 构建选项
    const bundleOptions: ClientBundleOptions = {
      minify: false,
      sourcemap: true,
      splitting: true,
      format: "esm",
      ...this.config.bundle,
    };

    // 处理代码分割配置
    const splittingEnabled = typeof bundleOptions.splitting === "boolean"
      ? bundleOptions.splitting
      : bundleOptions.splitting?.enabled !== false;

    // 生成 chunk 名称模式（根据分割策略）
    const chunkNames = this.getChunkNames(bundleOptions.splitting);

    // 方案一：自动检测并排除服务端模块（通过插件实现）
    // 注意：服务端模块检测已通过插件实现，这里只处理用户手动配置的 external
    const externalModules = bundleOptions.external || [];

    // esbuild 构建上下文选项
    const buildOptions: esbuild.BuildOptions = {
      entryPoints: [entryPoint],
      bundle: true,
      outdir: this.config.output,
      format: bundleOptions.format || "esm",
      platform: "browser",
      target: "es2020",
      minify: bundleOptions.minify,
      sourcemap: bundleOptions.sourcemap,
      splitting: splittingEnabled,
      external: externalModules,
      chunkNames,
      treeShaking: true,
      metafile: true,
      // 注意：incremental 选项已废弃，使用 context() API 即可实现增量编译
    };

    // 添加插件
    buildOptions.plugins = this.pluginManager.toEsbuildPlugins(
      esbuild,
      buildOptions,
    );

    // 创建构建上下文
    this.buildContext = await esbuild.context(buildOptions);

    return this.buildContext;
  }

  /**
   * 增量重新构建
   */
  async rebuild(): Promise<BuildResult> {
    if (!this.buildContext) {
      throw new Error("构建上下文未创建，请先调用 createContext()");
    }

    const startTime = Date.now();

    // 增量重新构建
    const result = await this.buildContext.rebuild();

    // 获取输出文件列表
    const outputFiles: string[] = [];
    if (result.metafile) {
      for (const file in result.metafile.outputs) {
        outputFiles.push(file);
      }
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles,
      metafile: result.metafile,
      duration,
    };
  }

  /**
   * 清理构建上下文
   */
  async dispose(): Promise<void> {
    if (this.buildContext) {
      await this.buildContext.dispose();
      this.buildContext = undefined;
    }
  }

  /**
   * 获取 chunk 名称模式
   * 根据代码分割策略生成不同的 chunk 名称模式
   */
  private getChunkNames(
    splitting?: boolean | SplittingStrategy,
  ): string {
    if (typeof splitting === "boolean") {
      return "[name]-[hash]";
    }

    if (!splitting || splitting.enabled === false) {
      return "[name]-[hash]";
    }

    // 根据不同的分割策略生成不同的命名模式
    if (splitting.byRoute) {
      return "[name]-route-[hash]";
    }

    if (splitting.byComponent) {
      return "[name]-component-[hash]";
    }

    if (splitting.bySize) {
      return "[name]-chunk-[hash]";
    }

    // 默认模式
    return "[name]-[hash]";
  }

  /**
   * 获取配置
   */
  getConfig(): ClientConfig {
    return this.config;
  }

  /**
   * 注册插件
   */
  registerPlugin(plugin: import("./plugin.ts").BuildPlugin): void {
    this.pluginManager.register(plugin);
  }

  /**
   * 获取插件管理器
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }
}
