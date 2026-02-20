/**
 * @module @dreamer/esbuild/builder-client
 *
 * 客户端构建器
 *
 * 使用 esbuild 进行客户端代码打包
 */

import { dirname, IS_BUN, mkdir, resolve } from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import { PluginManager } from "./plugin.ts";
import { createConditionalCompilePlugin } from "./plugins/conditional-compile.ts";
import { createCSSImportHandlerPlugin } from "./plugins/css-import-handler.ts";
import { bunResolverPlugin } from "./plugins/resolver-bun.ts";
import {
  buildModuleCache,
  denoResolverPlugin,
} from "./plugins/resolver-deno.ts";
import { createServerModuleDetectorPlugin } from "./plugins/server-module-detector.ts";
import type {
  BuildMode,
  BuildResult,
  ClientBundleOptions,
  ClientConfig,
  OutputFileContent,
  SplittingStrategy,
} from "./types.ts";
import { $tr, setEsbuildLocale } from "./i18n.ts";
import { logger } from "./utils/logger.ts";

/**
 * 客户端构建选项
 */
export interface ClientBuildOptions {
  /** 构建模式（默认：prod） */
  mode?: BuildMode;
  /**
   * 是否写入文件（默认：true）
   * 设置为 false 时，不写入文件，而是在 BuildResult.outputContents 中返回编译后的代码
   * 适用于服务端渲染等需要直接使用代码内容的场景
   */
  write?: boolean;
}

/**
 * 客户端构建器类
 */
export class BuilderClient {
  private config: ClientConfig;
  private buildContext?: esbuild.BuildContext;
  /** 创建 context 时传入的 write 选项，rebuild 时用于判断是否返回 outputContents */
  private contextWrite?: boolean;
  private pluginManager: PluginManager;

  constructor(config: ClientConfig) {
    this.config = config;
    this.pluginManager = new PluginManager();

    // 注意：denoResolverPlugin 在 build 方法中动态注册，以支持模块缓存

    // 方案一：自动注册服务端模块检测插件
    this.pluginManager.register(createServerModuleDetectorPlugin());

    // 方案二：自动注册条件编译插件
    this.pluginManager.register(createConditionalCompilePlugin());

    // 方案三：自动注册 CSS 导入处理插件
    // 默认内联模式：将 import "./xxx.css" 打包进 JS，模块加载时自动注入 <style>
    const cssImportOpts = this.config.cssImport ?? {};
    const cssImportEnabled = cssImportOpts.enabled !== false;
    if (cssImportEnabled) {
      this.pluginManager.register(
        createCSSImportHandlerPlugin({
          enabled: true,
          extract: cssImportOpts.extract ?? false,
          cssOnly: cssImportOpts.cssOnly ?? true,
        }),
      );
    }

    // 注册配置中的插件（用户自定义插件）
    if (config.plugins) {
      this.pluginManager.registerAll(config.plugins);
    }
  }

  /**
   * 构建客户端代码
   *
   * @param options - 构建选项，可以是 BuildMode 字符串或 ClientBuildOptions 对象
   * @returns 构建结果，当 write 为 false 时，outputContents 包含编译后的代码
   *
   * @example
   * ```typescript
   * // 写入文件（默认行为）
   * const result = await builder.build("prod");
   *
   * // 不写入文件，返回代码内容
   * const result = await builder.build({ mode: "prod", write: false });
   * console.log(result.outputContents?.[0]?.text); // 编译后的代码
   * ```
   */
  async build(
    options: BuildMode | ClientBuildOptions = "prod",
  ): Promise<BuildResult> {
    const startTime = Date.now();

    // 设置包内 i18n 语言，后续 $tr 不再传 lang
    if (this.config.lang !== undefined) {
      setEsbuildLocale(this.config.lang);
    }

    // 解析选项
    const mode: BuildMode = typeof options === "string"
      ? options
      : (options.mode || "prod");
    // write 默认为 true，表示写入文件
    const write = typeof options === "string"
      ? true
      : (options.write !== false);

    // 解析入口文件路径（支持单入口）
    if (!this.config.entry) {
      throw new Error($tr("log.esbuild.builder.clientMissingEntry"));
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

    // 写入文件或代码分割时都需要 output（代码分割时 outdir 用于路径解析，write: false 时不写盘）
    if (write || splittingEnabled) {
      if (!this.config.output || this.config.output.trim() === "") {
        throw new Error($tr("log.esbuild.builder.clientMissingOutput"));
      }
      if (write) {
        await mkdir(this.config.output, { recursive: true });
      }
    }

    // 生成 chunk 名称模式：优先使用 bundleOptions.chunkNames，否则根据分割策略生成
    const chunkNames = bundleOptions.chunkNames ??
      this.getChunkNames(bundleOptions.splitting);

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

    // 当 external 包含 preact/react 时，强制 resolver 将其标为 external（双构建：chunk 通过 import map 引用主包）
    const hasRuntimeExternal = (externalModules as string[]).some(
      (ext) =>
        ext === "preact" ||
        ext.startsWith("preact/") ||
        ext === "react" ||
        ext.startsWith("react/") ||
        ext === "react-dom" ||
        ext.startsWith("react-dom/"),
    );

    // 根据渲染引擎配置 JSX（Preact/React/View 使用自动模式）
    const jsxConfig: Partial<esbuild.BuildOptions> = {};
    if (this.config.engine === "preact") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "preact";
    } else if (this.config.engine === "react") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "react";
    } else if (this.config.engine === "view") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "@dreamer/view";
    }

    // esbuild 构建选项
    const buildOptions: esbuild.BuildOptions = {
      entryPoints: [entryPoint],
      bundle: true,
      format: bundleOptions.format || "esm",
      platform: "browser",
      target: "es2020",
      minify: bundleOptions.minify,
      sourcemap: sourcemapOption,
      splitting: splittingEnabled, // write: false 时也支持代码分割，产出在 result.outputContents
      external: externalModules,
      alias: bundleOptions.alias,
      treeShaking: true,
      metafile: true,
      // 根据 write 选项决定是否写入文件
      write,
      // JSX 配置（根据渲染引擎）
      ...jsxConfig,
      // 禁用 node_modules 自动查找，防止扫描到系统目录
      nodePaths: [],
      // 只显示错误，忽略所有警告
      logLevel: "error",
    };

    // 始终设置 outdir，否则 splitting: false 时 esbuild 无产出、result.outputFiles 为空，dev 时 /main.js 会回退到 index.html
    if (this.config.output) {
      buildOptions.outdir = this.config.output;
      if (splittingEnabled) buildOptions.chunkNames = chunkNames;
    }

    // 添加插件：Bun 环境使用 bunResolverPlugin，Deno 环境使用 denoResolverPlugin
    const log = this.config.logger ?? logger;
    const plugins = this.pluginManager.toEsbuildPlugins(
      esbuild,
      buildOptions,
    );

    if (IS_BUN) {
      // Bun 环境：使用 bunResolverPlugin 解析 tsconfig 和 package.json
      plugins.unshift(
        bunResolverPlugin({
          debug: this.config.debug,
          logger: log,
        }),
      );
    } else {
      // Deno 环境：构建模块缓存 + denoResolverPlugin
      const moduleCache = await buildModuleCache(
        entryPoint,
        dirname(entryPoint),
        this.config.debug,
        log,
      );
      plugins.unshift(denoResolverPlugin({
        isServerBuild: false,
        moduleCache,
        projectDir: dirname(entryPoint),
        debug: this.config.debug,
        logger: log,
        forceRuntimeExternal: hasRuntimeExternal,
        // 将 bundle alias（如 preact/jsx-runtime -> shim）传给 resolver，在解析时优先使用
        resolveOverrides: bundleOptions.alias,
      }));
    }
    buildOptions.plugins = plugins;

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

    // 如果不写入文件，返回编译后的代码内容
    if (!write && result.outputFiles) {
      const outputContents: OutputFileContent[] = result.outputFiles.map(
        (file) => ({
          path: file.path,
          text: file.text,
          contents: file.contents,
        }),
      );

      return {
        outputFiles: outputContents.map((f) => f.path),
        outputContents,
        metafile: result.metafile,
        duration,
      };
    }

    return {
      outputFiles,
      metafile: result.metafile,
      duration,
    };
  }

  /**
   * 创建增量构建上下文
   *
   * 使用 context + rebuild 可实现增量编译，复用上次构建的缓存（文件、AST），加快 HMR 重建速度。
   *
   * @param mode - 构建模式，影响 minify 和 sourcemap 的默认值
   * @param options - 可选，write: false 时 rebuild 返回 outputContents（内存输出，不写盘）
   */
  async createContext(
    mode: BuildMode = "dev",
    options?: { write?: boolean },
  ): Promise<esbuild.BuildContext> {
    if (this.config.lang !== undefined) setEsbuildLocale(this.config.lang);
    // 验证输出目录配置
    if (!this.config.output || this.config.output.trim() === "") {
      throw new Error($tr("log.esbuild.builder.clientMissingOutput"));
    }

    // 确保输出目录存在
    await mkdir(this.config.output, { recursive: true });

    // 解析入口文件路径（支持单入口）
    if (!this.config.entry) {
      throw new Error($tr("log.esbuild.builder.clientMissingEntry"));
    }
    const entryPoint = await resolve(this.config.entry);

    // 根据模式设置默认值：dev 模式禁用压缩启用 sourcemap，prod 模式反之
    const isProd = mode === "prod";

    // 构建选项
    const bundleOptions: ClientBundleOptions = {
      minify: isProd,
      sourcemap: !isProd,
      splitting: true,
      format: "esm",
      ...this.config.bundle,
    };

    // 处理代码分割配置
    const splittingEnabled = typeof bundleOptions.splitting === "boolean"
      ? bundleOptions.splitting
      : bundleOptions.splitting?.enabled !== false;

    // 生成 chunk 名称模式：优先使用 bundleOptions.chunkNames，否则根据分割策略生成
    const chunkNames = bundleOptions.chunkNames ??
      this.getChunkNames(bundleOptions.splitting);

    // 方案一：自动检测并排除服务端模块（通过插件实现）
    // 注意：服务端模块检测已通过插件实现，这里只处理用户手动配置的 external
    const externalModules = bundleOptions.external || [];

    const hasRuntimeExternalCtx = (externalModules as string[]).some(
      (ext) =>
        ext === "preact" ||
        ext.startsWith("preact/") ||
        ext === "react" ||
        ext.startsWith("react/") ||
        ext === "react-dom" ||
        ext.startsWith("react-dom/"),
    );

    // 根据渲染引擎配置 JSX
    const jsxConfig: Partial<esbuild.BuildOptions> = {};
    if (this.config.engine === "preact") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "preact";
    } else if (this.config.engine === "react") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "react";
    } else if (this.config.engine === "view") {
      jsxConfig.jsx = "automatic";
      jsxConfig.jsxImportSource = "@dreamer/view";
    }

    const writeToDisk = options?.write !== false;

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
      alias: bundleOptions.alias,
      chunkNames,
      treeShaking: true,
      metafile: true,
      write: writeToDisk,
      // JSX 配置（根据渲染引擎）
      ...jsxConfig,
      // 禁用 node_modules 自动查找，防止扫描到系统目录
      nodePaths: [],
      // 只显示错误，忽略所有警告
      logLevel: "error",
      // 注意：incremental 选项已废弃，使用 context() API 即可实现增量编译
    };

    // 添加插件：Bun 环境使用 bunResolverPlugin，Deno 环境使用 denoResolverPlugin
    const log = this.config.logger ?? logger;
    const plugins = this.pluginManager.toEsbuildPlugins(
      esbuild,
      buildOptions,
    );

    if (IS_BUN) {
      plugins.unshift(
        bunResolverPlugin({
          debug: this.config.debug,
          logger: log,
        }),
      );
    } else {
      const moduleCache = await buildModuleCache(
        entryPoint,
        dirname(entryPoint),
        this.config.debug,
        log,
      );
      plugins.unshift(denoResolverPlugin({
        isServerBuild: false,
        moduleCache,
        projectDir: dirname(entryPoint),
        debug: this.config.debug,
        logger: log,
        forceRuntimeExternal: hasRuntimeExternalCtx,
        // 将 bundle alias（如 preact/jsx-runtime -> shim）传给 resolver，在解析时优先使用
        resolveOverrides: bundleOptions.alias,
      }));
    }
    buildOptions.plugins = plugins;

    // 创建构建上下文
    this.contextWrite = writeToDisk;
    this.buildContext = await esbuild.context(buildOptions);

    return this.buildContext;
  }

  /**
   * 增量重新构建
   *
   * 复用上次构建的缓存（文件、AST），比全量 build 更快，适用于 HMR 场景。
   */
  async rebuild(): Promise<BuildResult> {
    if (!this.buildContext) {
      throw new Error($tr("log.esbuild.builder.contextNotCreated"));
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

    // 当 createContext 时 write: false，result.outputFiles 包含内存中的输出
    if (
      this.contextWrite === false && result.outputFiles &&
      result.outputFiles.length > 0
    ) {
      const outputContents: OutputFileContent[] = result.outputFiles.map(
        (file) => ({
          path: file.path,
          text: file.text,
          contents: file.contents,
        }),
      );
      return {
        outputFiles: outputContents.map((f) => f.path),
        outputContents,
        metafile: result.metafile,
        duration,
      };
    }

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
      this.contextWrite = undefined;
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
