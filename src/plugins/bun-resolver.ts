/**
 * @module @dreamer/esbuild/plugins/bun-resolver
 *
 * Bun 模块解析插件
 *
 * 为 Bun 环境提供模块解析支持，主要处理：
 * - 读取 package.json 的 imports 配置
 * - 解析路径别名（如 @/, ~/）
 * - 预处理文件，将路径别名转换为相对路径（因为 bun build 可能不完全支持所有别名格式）
 *
 * 注意：Bun 使用 bun build 命令，不直接使用 esbuild 插件
 * 此插件主要用于预处理或在需要时使用 esbuild API
 */

import {
  cwd,
  dirname,
  existsSync,
  join,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/**
 * Bun 解析器选项
 */
export interface BunResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 是否启用调试日志（默认：false） */
  debug?: boolean;
}

/**
 * package.json 配置结构
 */
interface PackageJsonConfig {
  name?: string;
  version?: string;
  imports?: Record<string, string>;
}

/**
 * 查找项目的 package.json 文件
 *
 * @param startDir - 起始目录
 * @returns package.json 文件路径，如果未找到返回 undefined
 */
function findProjectPackageJson(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  return undefined;
}

/**
 * 从项目的 package.json 中获取包的导入映射
 *
 * @param packageJsonPath - 项目的 package.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径，如果未找到返回 undefined
 */
function getPackageImport(
  packageJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(packageJsonPath);
    const config: PackageJsonConfig = JSON.parse(content);

    if (!config.imports) {
      return undefined;
    }

    return config.imports[packageName];
  } catch {
    return undefined;
  }
}

/**
 * 创建 Bun 模块解析插件
 *
 * 该插件为 Bun 环境提供模块解析支持，主要处理路径别名和 package.json imports 配置。
 * 注意：Bun 使用 bun build 命令时，会原生支持 package.json 的 imports 字段，
 * 但此插件可以在需要时提供额外的解析支持。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { createBunResolverPlugin } from "@dreamer/esbuild/plugins/bun-resolver";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [createBunResolverPlugin()],
 * });
 * ```
 */
export function createBunResolverPlugin(
  options: BunResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, debug = false } = options;

  return {
    name: "bun-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 1. 处理路径别名（通过 package.json imports 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      // 这些别名需要在 package.json 的 imports 中配置
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          if (debug) {
            console.log(`[bun-resolver] 检测到路径别名: ${path}`);
          }

          // 查找项目的 package.json 文件
          const resolveDir = args.resolveDir || cwd();
          const packageJsonPath = findProjectPackageJson(resolveDir);

          if (!packageJsonPath) {
            if (debug) {
              console.log(`[bun-resolver] 未找到项目的 package.json`);
            }
            return undefined;
          }

          // 从项目的 package.json 的 imports 中查找路径别名
          try {
            const content = readTextFileSync(packageJsonPath);
            const config: PackageJsonConfig = JSON.parse(content);

            if (!config.imports) {
              if (debug) {
                console.log(`[bun-resolver] package.json 中没有 imports 配置`);
              }
              return undefined;
            }

            // 查找匹配的别名
            // 优先匹配最长的前缀（如 @/lib/ 优先于 @/）
            const sortedKeys = Object.keys(config.imports).sort((a, b) =>
              b.length - a.length
            );

            for (const alias of sortedKeys) {
              if (path.startsWith(alias)) {
                const aliasValue = config.imports[alias];
                if (aliasValue) {
                  // 替换别名前缀
                  const remainingPath = path.slice(alias.length);
                  let resolvedPath: string;

                  // 如果别名值以 ./ 或 ../ 开头，是相对路径
                  if (
                    aliasValue.startsWith("./") || aliasValue.startsWith("../")
                  ) {
                    const packageJsonDir = dirname(packageJsonPath);
                    resolvedPath = join(
                      packageJsonDir,
                      aliasValue,
                      remainingPath,
                    );
                  } else {
                    // 如果别名值是绝对路径或其他格式
                    resolvedPath = aliasValue + remainingPath;
                  }

                  if (debug) {
                    console.log(
                      `[bun-resolver] 路径别名解析: ${path} -> ${resolvedPath} (别名: ${alias} -> ${aliasValue})`,
                    );
                  }

                  // 检查文件是否存在
                  if (existsSync(resolvedPath)) {
                    return {
                      path: resolvedPath,
                      namespace: "file",
                    };
                  } else {
                    // 尝试添加 .ts 扩展名
                    const withExt = resolvedPath + ".ts";
                    if (existsSync(withExt)) {
                      return {
                        path: withExt,
                        namespace: "file",
                      };
                    }
                  }
                }
              }
            }

            if (debug) {
              console.log(`[bun-resolver] 未找到匹配的路径别名: ${path}`);
            }
          } catch (error) {
            if (debug) {
              console.log(`[bun-resolver] 解析路径别名失败:`, error);
            }
          }

          return undefined;
        },
      );

      // 2. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      // 注意：Bun 原生支持 npm 包，但可能需要处理子路径导出
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          if (debug) {
            console.log(`[bun-resolver] 尝试解析: ${path}`);
          }

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpathParts = parts.slice(2); // ["client"] 或 ["client", "utils"] 等多级

          // 查找项目的 package.json 文件
          const resolveDir = args.resolveDir || cwd();
          const packageJsonPath = findProjectPackageJson(resolveDir);

          if (!packageJsonPath) {
            if (debug) {
              console.log(`[bun-resolver] 未找到项目的 package.json`);
            }
            return undefined;
          }

          // 从项目的 package.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            packageJsonPath,
            packageName,
          );

          if (!packageImport) {
            if (debug) {
              console.log(
                `[bun-resolver] 未在 package.json 的 imports 中找到: ${packageName}`,
              );
            }
            return undefined;
          }

          if (debug) {
            console.log(
              `[bun-resolver] 找到导入映射: ${packageName} -> ${packageImport}`,
            );
          }

          // 拼接子路径到导入路径
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullPath = `${packageImport}/${subpath}`;

          if (debug) {
            console.log(
              `[bun-resolver] 拼接后的路径: ${fullPath}`,
            );
          }

          // Bun 原生支持 npm 包，直接返回路径让 Bun 处理
          // 注意：这里返回 undefined 让 Bun 的原生解析器处理
          // 或者可以尝试解析为文件路径
          return undefined;
        },
      );
    },
  };
}
