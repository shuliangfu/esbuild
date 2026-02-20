/**
 * @module @dreamer/esbuild/builder-bundle
 *
 * 简单打包器
 *
 * 提供快速将代码打包为浏览器可用格式的功能，适用于浏览器测试、服务端渲染等场景
 *
 * - Deno 环境：使用 esbuild + Deno 解析器插件
 * - Bun 环境：使用 bun build 原生打包（更快）
 */

import {
  basename,
  createCommand,
  dirname,
  existsSync,
  IS_BUN,
  IS_DENO,
  join,
  makeTempDir,
  readFile,
  remove,
  resolve,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import { bunResolverPlugin } from "./plugins/resolver-bun.ts";
import {
  buildModuleCache,
  denoResolverPlugin,
} from "./plugins/resolver-deno.ts";
import { logger } from "./utils/logger.ts";
import type { BuildLogger } from "./types.ts";

/**
 * 简单打包选项
 * 用于快速将代码打包为浏览器可用格式
 */
export interface BundleOptions {
  /** 入口文件路径 */
  entryPoint: string;
  /** 全局变量名（IIFE 格式时使用） */
  globalName?: string;
  /** 目标平台（默认：browser） */
  platform?: "browser" | "node" | "neutral";
  /** 目标 ES 版本（默认：es2020） */
  target?: string | string[];
  /** 是否压缩（默认：false） */
  minify?: boolean;
  /** 输出格式（默认：iife） */
  format?: "iife" | "esm" | "cjs";
  /** 是否生成 sourcemap（默认：false） */
  sourcemap?: boolean;
  /** 外部依赖（不打包） */
  external?: string[];
  /** 自定义 esbuild 插件（仅 Deno 环境有效） */
  plugins?: esbuild.Plugin[];
  /** 定义替换（define） */
  define?: Record<string, string>;
  /** 是否打包依赖（默认：true） */
  bundle?: boolean;
  /**
   * 是否将 JSR/npm 依赖标为 external 并用 CDN 加载（仅 browser 平台有效）。
   * 默认 true：保持兼容，IIFE + external 在浏览器中会生成 require() 导致失败。
   * 设为 false 时，会把 JSR 等依赖打进去，适合「在浏览器里真正执行」的测试。
   */
  browserMode?: boolean;
  /**
   * JSX 模式
   * - "transform": 转换为函数调用（需要配合 jsxFactory/jsxFragment）
   * - "automatic": 自动导入 JSX 运行时（需要配合 jsxImportSource）
   * - "preserve": 保持原样
   */
  jsx?: "transform" | "automatic" | "preserve";
  /**
   * JSX 导入源（用于 "automatic" 模式）
   * 如 "preact"、"react" 等
   */
  jsxImportSource?: string;
  /**
   * JSX 工厂函数（用于 "transform" 模式）
   * 如 "h"（Preact）、"React.createElement"（React）
   */
  jsxFactory?: string;
  /**
   * JSX Fragment 工厂（用于 "transform" 模式）
   * 如 "Fragment"（Preact）、"React.Fragment"（React）
   */
  jsxFragment?: string;
  /**
   * 是否启用调试日志（默认：false），开启后输出 resolver/build 等详细调试信息，便于排查
   */
  debug?: boolean;
  /**
   * 日志实例（未传时使用库内默认 logger），info/debug 等均通过 logger 输出，不使用 console
   */
  logger?: BuildLogger;
}

/**
 * 打包结果
 */
export interface BundleResult {
  /** 打包后的代码 */
  code: string;
  /** Source Map（如果启用） */
  map?: string;
}

/**
 * 简单打包器类
 *
 * 提供快速将 TypeScript/JavaScript 代码打包为浏览器可用格式的功能
 *
 * 根据运行时环境自动选择最佳打包方式：
 * - Deno 环境：使用 esbuild + Deno 解析器插件（支持 deno.json exports）
 * - Bun 环境：使用 bun build 原生打包（更快，自动读取 package.json）
 *
 * @example
 * ```typescript
 * import { BuilderBundle } from "@dreamer/esbuild";
 *
 * const bundler = new BuilderBundle();
 *
 * // 基础用法：打包为 IIFE
 * const result = await bundler.build({
 *   entryPoint: "./src/client/mod.ts",
 *   globalName: "MyClient",
 * });
 * console.log(result.code);
 *
 * // 高级用法：打包为 ESM 并压缩
 * const result = await bundler.build({
 *   entryPoint: "./src/lib/index.ts",
 *   format: "esm",
 *   minify: true,
 *   sourcemap: true,
 * });
 * ```
 */
export class BuilderBundle {
  /**
   * 将代码打包为指定格式
   *
   * @param options - 打包选项
   * @returns 打包结果，包含代码和可选的 Source Map
   */
  build(options: BundleOptions): Promise<BundleResult> {
    // 根据运行时环境选择打包方式
    // 注意：在浏览器模式下，Bun 也使用 esbuild + bunResolverPlugin
    // 因为 bun build 无法解析 JSR 包的子路径导入（如 @dreamer/socket-io/client）
    const isBrowserPlatform = (options.platform || "browser") === "browser";

    if (IS_BUN && !isBrowserPlatform) {
      // Bun 环境且非浏览器平台，使用 bun build（更快）
      return this.buildWithBun(options);
    } else {
      // Deno 环境或浏览器模式使用 esbuild + resolver plugin
      return this.buildWithEsbuild(options);
    }
  }

  /**
   * 使用 esbuild 打包（Deno 环境）
   *
   * @param options - 打包选项
   * @returns 打包结果
   */
  private async buildWithEsbuild(
    options: BundleOptions,
  ): Promise<BundleResult> {
    // 构建插件列表
    const plugins: esbuild.Plugin[] = [];

    // 在 Deno 或 Bun 环境下自动启用解析器插件
    // 用于解析 deno.json/package.json 的 exports 配置（如 @dreamer/logger/client）
    // 浏览器平台：默认启用 browserMode（JSR 标为 external）；若传 browserMode: false 则把 JSR 打进去
    const isBrowserPlatform = (options.platform || "browser") === "browser";
    const format = options.format || (options.globalName ? "iife" : "esm");
    // 显式传 browserMode 时优先使用；否则在浏览器平台默认 true（external），避免破坏现有行为
    const useBrowserMode = options.browserMode ?? isBrowserPlatform;
    // Node 平台或 browserMode: false 时需要把 JSR 打进 bundle，必须 isServerBuild: false + moduleCache
    const needBundleJsr = !useBrowserMode;

    const debug = options.debug ?? false;
    const log = options.logger ?? logger;
    if (IS_DENO) {
      if (needBundleJsr) {
        const entryPointAbs = resolve(options.entryPoint);
        const workDir = dirname(entryPointAbs);
        const moduleCache = await buildModuleCache(
          entryPointAbs,
          workDir,
          debug,
          log,
        );
        plugins.push(denoResolverPlugin({
          browserMode: false,
          isServerBuild: false,
          moduleCache,
          projectDir: workDir,
          debug,
          logger: log,
        }));
      } else {
        plugins.push(denoResolverPlugin({
          browserMode: useBrowserMode,
          debug,
          logger: log,
        }));
      }
    } else if (IS_BUN) {
      // Bun 环境下使用 bunResolverPlugin
      plugins.push(bunResolverPlugin({
        enabled: true,
        browserMode: useBrowserMode,
        debug,
        logger: log,
      }));
    }

    // 添加用户自定义插件
    if (options.plugins) {
      plugins.push(...options.plugins);
    }

    // 如果指定了 globalName 且格式为 iife，使用 IIFE 格式
    // 否则默认使用 ESM 格式（更现代，更简单）
    // 注意：format 已在上面计算过，这里直接使用

    // 构建 JSX 配置
    const jsxConfig: Partial<esbuild.BuildOptions> = {};
    if (options.jsx) {
      jsxConfig.jsx = options.jsx;
    }
    if (options.jsxImportSource) {
      jsxConfig.jsxImportSource = options.jsxImportSource;
    }
    if (options.jsxFactory) {
      jsxConfig.jsxFactory = options.jsxFactory;
    }
    if (options.jsxFragment) {
      jsxConfig.jsxFragment = options.jsxFragment;
    }

    const buildResult = await esbuild.build({
      entryPoints: [options.entryPoint],
      bundle: options.bundle !== false,
      format,
      platform: options.platform || "browser",
      target: options.target || "es2020",
      globalName: format === "iife" ? options.globalName : undefined,
      minify: options.minify || false,
      sourcemap: options.sourcemap ? "inline" : false,
      external: options.external,
      plugins: plugins.length > 0 ? plugins : undefined,
      define: options.define,
      write: false,
      // JSX 配置
      ...jsxConfig,
    });

    // 获取打包后的代码
    if (!buildResult.outputFiles || buildResult.outputFiles.length === 0) {
      throw new Error(
        `esbuild 打包失败：没有生成输出文件。入口文件: ${options.entryPoint}`,
      );
    }

    const outputFile = buildResult.outputFiles[0];
    if (!outputFile) {
      throw new Error(
        `esbuild 打包失败：输出文件为空。入口文件: ${options.entryPoint}`,
      );
    }

    let code = new TextDecoder().decode(outputFile.contents);

    // 如果使用 IIFE 格式且有 globalName，esbuild 会创建 var globalName = ...
    // 但我们需要根据 platform 将其赋值给正确的全局对象（window/global/globalThis）
    if (format === "iife" && options.globalName) {
      const platform = options.platform || "browser";
      let globalVar = "";

      if (platform === "browser") {
        globalVar = "window";
      } else if (platform === "node") {
        globalVar = "global";
      } else {
        globalVar = "globalThis";
      }

      // esbuild 的 IIFE 格式已经创建了 var globalName = ...
      // 我们需要在代码末尾添加全局对象赋值
      code +=
        `\nif (typeof ${globalVar} !== 'undefined') {\n  ${globalVar}.${options.globalName} = ${options.globalName};\n}`;
    }

    // 如果有多个输出文件（代码 + sourcemap），提取 sourcemap
    let map: string | undefined;
    if (buildResult.outputFiles.length > 1) {
      const mapFile = buildResult.outputFiles[1];
      if (mapFile) {
        map = new TextDecoder().decode(mapFile.contents);
      }
    }

    return { code, map };
  }

  /**
   * 使用 Bun 原生打包（Bun 环境）
   *
   * bun build 会自动读取 package.json 的依赖配置，
   * 比 esbuild 更快，且原生支持 TypeScript
   *
   * @param options - 打包选项
   * @returns 打包结果
   */
  private async buildWithBun(options: BundleOptions): Promise<BundleResult> {
    // 解析入口文件路径
    const entryPoint = await resolve(options.entryPoint);
    const entryDir = dirname(entryPoint);

    // 在 Bun 环境下，bun build 的行为：
    // 1. 对于相对路径导入，不需要 package.json，可以直接工作
    // 2. 对于 npm 包，可以从缓存读取，不需要 package.json
    // 3. 对于路径别名（@/, ~/），需要 package.json 的 imports 或 tsconfig.json 的 paths
    //
    // 优化策略：
    // - 优先使用入口文件所在目录（如果存在 package.json 或 tsconfig.json）
    // - 如果没有配置文件，也可以工作（Bun 可以从缓存读取 npm 包）
    // - 使用临时目录作为后备方案
    const entryPackageJson = join(entryDir, "package.json");
    const entryTsconfig = join(entryDir, "tsconfig.json");
    const hasConfig = existsSync(entryPackageJson) || existsSync(entryTsconfig);

    // 如果有配置文件，在入口文件目录执行；否则使用临时目录
    // 注意：即使没有配置文件，Bun 也能从缓存读取 npm 包，所以也可以工作
    const workDir = hasConfig ? entryDir : await makeTempDir({
      prefix: "esbuild-bundle-",
    });

    try {
      // 构建 bun build 命令参数
      // 如果有配置文件，使用相对路径；否则使用绝对路径
      const buildEntryPoint = hasConfig ? basename(entryPoint) : entryPoint;
      const args: string[] = ["build", buildEntryPoint];

      // 设置目标平台
      const platform = options.platform || "browser";
      if (platform === "browser") {
        args.push("--target", "browser");
      } else if (platform === "node") {
        args.push("--target", "node");
      }
      // neutral 不需要特别指定

      // 设置输出格式
      // 如果指定了 globalName 且格式为 iife，使用 IIFE 格式
      // 否则默认使用 ESM 格式（更现代，更简单）
      const format = options.format || (options.globalName ? "iife" : "esm");
      if (format === "esm") {
        args.push("--format", "esm");
      } else if (format === "cjs") {
        args.push("--format", "cjs");
      } else {
        // iife 格式
        args.push("--format", "iife");
      }

      // 设置输出文件
      const outputFileName = "bundle.js";
      const outputPath = join(workDir, outputFileName);
      args.push("--outfile", outputFileName);

      // 压缩选项
      if (options.minify) {
        args.push("--minify");
      }

      // sourcemap 选项
      if (options.sourcemap) {
        args.push("--sourcemap=inline");
      }

      // 外部依赖
      if (options.external && options.external.length > 0) {
        for (const ext of options.external) {
          args.push("--external", ext);
        }
      }

      // define 替换
      if (options.define) {
        for (const [key, value] of Object.entries(options.define)) {
          args.push("--define", `${key}=${value}`);
        }
      }

      // JSX 配置（Bun 使用 --jsx-* 参数）
      // 注意：Bun 的 JSX 参数格式与 esbuild 略有不同
      if (options.jsx) {
        // Bun 的 jsx 参数值需要转换
        const jsxValue = options.jsx === "automatic"
          ? "automatic"
          : options.jsx === "preserve"
          ? "preserve"
          : "transform";
        args.push("--jsx", jsxValue);
      }
      if (options.jsxImportSource) {
        args.push("--jsx-import-source", options.jsxImportSource);
      }
      if (options.jsxFactory) {
        args.push("--jsx-factory", options.jsxFactory);
      }
      if (options.jsxFragment) {
        args.push("--jsx-fragment", options.jsxFragment);
      }

      // 全局变量名（IIFE 格式）
      // 注意：bun build 的 IIFE 格式不支持 globalName 参数
      // 如果需要 globalName，需要在输出代码中包装
      const needsGlobalNameWrapper = format === "iife" && options.globalName;

      // 执行 bun build 命令
      // 在包含 package.json 的目录下执行，这样 bun build 才能正确解析路径别名
      const command = createCommand("bun", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: workDir,
      });

      const output = await command.output();

      if (!output.success) {
        const stderr = output.stderr || "未知错误";
        throw new Error(
          `Bun 打包失败: ${stderr}。入口文件: ${options.entryPoint}`,
        );
      }

      // 读取输出文件
      const codeBuffer = await readFile(outputPath);
      let code = new TextDecoder().decode(codeBuffer);

      // 如果需要 globalName 包装（IIFE 格式）
      if (needsGlobalNameWrapper) {
        // Bun 的 IIFE 输出中，exports 对象名称是基于文件名的（如 exports_test_entry）
        // 我们需要从 IIFE 中提取 exports 对象并赋值给全局变量
        const platform = options.platform || "browser";
        let globalVar = "";

        if (platform === "browser") {
          globalVar = "window";
        } else if (platform === "node") {
          globalVar = "global";
        } else {
          globalVar = "globalThis";
        }

        // 查找 Bun IIFE 中的 exports 对象（通常是 exports_xxx 格式）
        const exportsMatch = code.match(/var\s+(exports_\w+)\s*=/);
        if (exportsMatch) {
          const exportsVar = exportsMatch[1];
          // 在 IIFE 末尾（})(); 之前）添加 return 语句，使 IIFE 返回 exports 对象
          const iifeWithReturn = code.replace(
            /}\s*\)\s*\(\)\s*;?\s*$/,
            `\n  return ${exportsVar};\n})();`,
          );
          // 将 IIFE 的返回值赋给全局变量
          // 使用临时变量保存 IIFE 的返回值，避免重复执行
          const tempVarName = `__${options.globalName}_result`;
          code =
            `const ${tempVarName} = ${iifeWithReturn}\nif (typeof ${globalVar} !== 'undefined') {\n  ${globalVar}.${options.globalName} = ${tempVarName};\n}`;
        } else {
          // 如果没有找到 exports 对象，简单包装整个 IIFE
          code = code.replace(
            /}\s*\)\s*\(\)\s*;?\s*$/,
            `})();\nif (typeof ${globalVar} !== 'undefined') {\n  ${globalVar}.${options.globalName} = {};\n}`,
          );
        }
      } else if (format === "esm" && options.globalName) {
        // ESM 格式 + globalName：将模块导出赋值给全局变量
        // 在 ESM 中，需要通过 import 然后赋值
        const platform = options.platform || "browser";
        let globalVar = "";

        if (platform === "browser") {
          globalVar = "window";
        } else if (platform === "node") {
          globalVar = "global";
        } else {
          globalVar = "globalThis";
        }

        // 在 ESM 代码末尾添加全局变量赋值
        // 注意：ESM 模块的导出需要通过 import 访问，这里我们假设代码中已经有导出
        code +=
          `\nif (typeof ${globalVar} !== 'undefined') {\n  ${globalVar}.${options.globalName} = typeof exports !== 'undefined' ? exports : {};\n}`;
      }

      return { code };
    } finally {
      // 清理临时目录（如果使用了临时目录）
      if (!hasConfig) {
        try {
          await remove(workDir, { recursive: true });
        } catch {
          // 忽略清理错误
        }
      } else {
        // 如果使用入口文件目录，清理生成的 bundle.js
        try {
          const outputPath = join(workDir, "bundle.js");
          if (existsSync(outputPath)) {
            await remove(outputPath);
          }
        } catch {
          // 忽略清理错误
        }
      }
    }
  }
}

/**
 * 将代码打包为浏览器可用格式（函数形式）
 *
 * 这是一个简化的打包函数，适用于需要快速将 TypeScript/JavaScript 代码
 * 打包为 IIFE 或其他格式的场景，如浏览器测试、服务端渲染等。
 *
 * 根据运行时环境自动选择最佳打包方式：
 * - Deno 环境：使用 esbuild + Deno 解析器插件
 * - Bun 环境：使用 bun build 原生打包（更快）
 *
 * @param options - 打包选项
 * @returns 打包结果，包含代码和可选的 Source Map
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 *
 * // 基础用法：打包为 IIFE
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   globalName: "MyClient",
 * });
 * console.log(result.code);
 *
 * // 高级用法：打包为 ESM 并压缩
 * const result = await buildBundle({
 *   entryPoint: "./src/lib/index.ts",
 *   format: "esm",
 *   minify: true,
 *   sourcemap: true,
 * });
 * ```
 */
export function buildBundle(
  options: BundleOptions,
): Promise<BundleResult> {
  const bundler = new BuilderBundle();
  return bundler.build(options);
}

// 重新导出 esbuild 模块，供需要底层 esbuild API 的场景使用
export { esbuild };
