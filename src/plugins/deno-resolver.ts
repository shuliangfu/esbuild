/**
 * @module @dreamer/esbuild/plugins/deno-resolver
 *
 * Deno 模块解析插件
 *
 * 为 esbuild 提供 Deno 兼容的模块解析，支持：
 * - 读取 deno.json 的 exports 配置
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 支持 jsr: 协议的模块引用
 */

import {
  dirname,
  existsSync,
  join,
  readTextFileSync,
  resolve,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/**
 * Deno 解析器选项
 */
export interface DenoResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 是否启用调试日志（默认：false） */
  debug?: boolean;
  /** node_modules 目录路径（默认：自动检测） */
  nodeModulesDir?: string;
}

/**
 * deno.json 配置结构
 */
interface DenoConfig {
  name?: string;
  version?: string;
  exports?: Record<string, string> | string;
}

/**
 * 解析 deno.json 的 exports 配置
 *
 * @param denoJsonPath - deno.json 文件路径
 * @param subpath - 子路径（如 "./client"）
 * @returns 解析后的文件路径，如果未找到返回 undefined
 */
function resolveDenoExport(
  denoJsonPath: string,
  subpath: string,
): string | undefined {
  try {
    const content = readTextFileSync(denoJsonPath);
    const config: DenoConfig = JSON.parse(content);

    if (!config.exports) {
      return undefined;
    }

    // 如果 exports 是字符串，只能匹配 "."
    if (typeof config.exports === "string") {
      if (subpath === ".") {
        return config.exports;
      }
      return undefined;
    }

    // exports 是对象，查找对应的子路径
    const exportPath = config.exports[subpath];
    if (exportPath) {
      return exportPath;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 查找 node_modules 目录
 *
 * @param startDir - 起始目录
 * @returns node_modules 目录路径，如果未找到返回 undefined
 */
function findNodeModulesDir(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10; // 防止无限循环
  let depth = 0;

  while (depth < maxDepth) {
    const nodeModulesPath = join(currentDir, "node_modules");
    if (existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // 已到达根目录
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * 将包名转换为 JSR 目录名
 * 例如：@dreamer/logger -> @dreamer/logger
 *
 * @param packageName - 包名
 * @returns 目录名
 */
function packageNameToDir(packageName: string): string {
  return packageName;
}

/**
 * 创建 Deno 模块解析插件
 *
 * 该插件解决 esbuild 在 Deno 环境下无法正确解析 JSR 包子路径导出的问题。
 * esbuild 默认读取 package.json，但 Deno/JSR 包使用 deno.json 定义 exports。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { createDenoResolverPlugin } from "@dreamer/esbuild/plugins/deno-resolver";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [createDenoResolverPlugin()],
 * });
 * ```
 */
export function createDenoResolverPlugin(
  options: DenoResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, debug = false } = options;

  return {
    name: "deno-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          if (debug) {
            console.log(`[deno-resolver] 尝试解析: ${path}`);
          }

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: ./client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpath = "./" + parts.slice(2).join("/");

          // 查找 node_modules 目录
          const resolveDir = args.resolveDir || Deno.cwd();
          const nodeModulesDir = options.nodeModulesDir ||
            findNodeModulesDir(resolveDir);

          if (!nodeModulesDir) {
            if (debug) {
              console.log(`[deno-resolver] 未找到 node_modules 目录`);
            }
            return undefined;
          }

          // 构建包目录路径
          const packageDir = join(
            nodeModulesDir,
            packageNameToDir(packageName),
          );
          const denoJsonPath = join(packageDir, "deno.json");

          if (!existsSync(denoJsonPath)) {
            if (debug) {
              console.log(`[deno-resolver] deno.json 不存在: ${denoJsonPath}`);
            }
            return undefined;
          }

          // 解析 deno.json 的 exports
          const exportPath = resolveDenoExport(denoJsonPath, subpath);

          if (!exportPath) {
            if (debug) {
              console.log(
                `[deno-resolver] 未在 deno.json 中找到导出: ${subpath}`,
              );
            }
            return undefined;
          }

          // 构建完整的文件路径
          // 注意：exportPath 可能是 ./src/client/mod.ts
          // 需要将 .ts 替换为 .js（因为 node_modules 中是编译后的文件）
          let resolvedPath = exportPath;

          // 如果是 .ts 文件，尝试查找对应的 .js 文件
          if (resolvedPath.endsWith(".ts")) {
            const jsPath = resolvedPath.replace(/\.ts$/, ".js");
            const fullJsPath = resolve(packageDir, jsPath);
            if (existsSync(fullJsPath)) {
              resolvedPath = jsPath;
            }
          }

          const fullPath = resolve(packageDir, resolvedPath);

          if (!existsSync(fullPath)) {
            if (debug) {
              console.log(`[deno-resolver] 解析后的文件不存在: ${fullPath}`);
            }
            return undefined;
          }

          if (debug) {
            console.log(`[deno-resolver] 成功解析: ${path} -> ${fullPath}`);
          }

          return {
            path: fullPath,
            namespace: "file",
          };
        },
      );
    },
  };
}
