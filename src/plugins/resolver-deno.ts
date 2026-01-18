/**
 * @module @dreamer/esbuild/plugins/resolver
 *
 * 统一模块解析插件（支持 Deno 和 Bun）
 *
 * 为 esbuild 提供跨运行时的模块解析，支持：
 * - 读取 deno.json 的 imports 配置（路径别名和包导入映射）
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 支持 jsr: 协议的模块引用（如 jsr:@dreamer/logger@^1.0.0）
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 * - 自动处理 Deno 模块的下载和缓存
 *
 * 注意：Deno 和 Bun 都使用 npm:esbuild 进行构建，因此解析逻辑统一
 */

import {
  cwd,
  dirname,
  existsSync,
  join,
  readTextFile,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";

/**
 * 解析器选项
 */
export interface ResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
}

/**
 * deno.json 配置结构
 */
interface DenoConfig {
  imports?: Record<string, string>;
}

/**
 * 根据文件路径确定 esbuild loader
 *
 * @param filePath - 文件路径
 * @returns esbuild loader 类型
 */
function getLoaderFromPath(filePath: string): "ts" | "tsx" | "js" | "jsx" {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    return "tsx";
  } else if (filePath.endsWith(".ts") || filePath.endsWith(".mts")) {
    return "ts";
  } else if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "js";
  }
  // 默认返回 ts，因为 Deno 主要使用 TypeScript
  return "ts";
}

/**
 * 查找项目的 deno.json 文件
 *
 * @param startDir - 起始目录
 * @returns deno.json 文件路径，如果未找到返回 undefined
 */
function findProjectDenoJson(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const denoJsonPath = join(currentDir, "deno.json");
    if (existsSync(denoJsonPath)) {
      return denoJsonPath;
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
 * 从项目的 deno.json 中获取包的导入映射
 *
 * @param projectDenoJsonPath - 项目的 deno.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:@dreamer/logger@^1.0.0-beta.4），如果未找到返回 undefined
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(projectDenoJsonPath);
    const config: DenoConfig = JSON.parse(content);

    if (!config.imports) {
      return undefined;
    }

    return config.imports[packageName];
  } catch {
    return undefined;
  }
}

/**
 * 解析 Deno 协议路径（jsr: 或 npm:）
 * 通过动态导入让 Deno 下载和缓存模块，然后从缓存中读取
 *
 * @param protocolPath - Deno 协议路径（如 jsr:@dreamer/logger@^1.0.0-beta.4）
 * @returns 解析结果
 */
async function resolveDenoProtocolPath(
  protocolPath: string,
): Promise<esbuild.OnResolveResult | undefined> {
  try {
    // 使用 import.meta.resolve 尝试解析路径
    const resolvedUrl = await import.meta.resolve(protocolPath);

    // 如果返回的是 file:// URL，直接使用文件路径
    if (resolvedUrl.startsWith("file://")) {
      let filePath = resolvedUrl.slice(7);
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 忽略解码错误
      }

      // 确保文件路径不为空
      if (filePath && existsSync(filePath)) {
        return {
          path: filePath,
          namespace: "file",
        };
      } else if (filePath) {
        // 文件路径存在但文件不存在，尝试使用 onLoad 钩子
        return {
          path: protocolPath,
          namespace: "deno-protocol",
        };
      }
    } else if (
      resolvedUrl.startsWith("https://") ||
      resolvedUrl.startsWith("http://")
    ) {
      // 如果返回的是 HTTP URL（如 JSR 的网页 URL），不能直接使用
      // 因为 JSR 的 HTTP URL 返回的是 HTML 页面，不是源代码
      // 应该使用 deno-protocol namespace 让 Deno 通过动态导入来处理
      // 使用 deno-protocol namespace，让 Deno 通过动态导入来下载和缓存模块
      return {
        path: protocolPath,
        namespace: "deno-protocol",
      };
    } else if (
      resolvedUrl.startsWith("jsr:") ||
      resolvedUrl.startsWith("npm:") ||
      resolvedUrl === protocolPath
    ) {
      // 如果返回的还是协议路径，说明 Deno 还没有下载/缓存这个模块
      // 这种情况下，我们需要使用 onLoad 钩子来触发下载并加载模块内容
      return {
        path: protocolPath,
        namespace: "deno-protocol",
      };
    }
  } catch (_error) {
    // 如果 resolve 失败，尝试使用 onLoad 钩子
    return {
      path: protocolPath,
      namespace: "deno-protocol",
    };
  }

  return undefined;
}

/**
 * 创建统一模块解析插件
 *
 * 该插件解决 esbuild 在 Deno/Bun 环境下无法正确解析 JSR 包子路径导出的问题。
 * esbuild 默认读取 package.json，但 Deno/JSR 包使用 deno.json 定义 imports。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { createResolverPlugin } from "@dreamer/esbuild/plugins/resolver";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [createResolverPlugin()],
 * });
 * ```
 */
export function denoResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true } = options;

  return {
    name: "resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 设置插件优先级，确保在其他解析器之前运行
      // 这样可以拦截 JSR 包和路径别名的解析

      // 1. 处理路径别名（通过 deno.json imports 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      // 这些别名需要在 deno.json 的 imports 中配置
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 查找项目的 deno.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中查找路径别名
          try {
            const content = readTextFileSync(projectDenoJsonPath);
            const config: DenoConfig = JSON.parse(content);

            if (!config.imports) {
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
                    const denoJsonDir = dirname(projectDenoJsonPath);
                    resolvedPath = join(denoJsonDir, aliasValue, remainingPath);
                  } else {
                    // 如果别名值是绝对路径或其他格式
                    resolvedPath = aliasValue + remainingPath;
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
          } catch (_error) {
            // 忽略错误，返回 undefined
          }

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@dreamer/logger@^1.0.0-beta.4"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;
          return await resolveDenoProtocolPath(path);
        },
      );

      // 2. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          // 解析包名和子路径
          // @dreamer/logger/client -> packageName: @dreamer/logger, subpath: client
          const parts = path.split("/");
          const packageName = `${parts[0]}/${parts[1]}`;
          const subpathParts = parts.slice(2); // ["client"] 或 ["client", "utils"] 等多级

          // 查找项目的 deno.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findProjectDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
          );

          if (!packageImport) {
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@dreamer/logger@^1.0.0-beta.4 + /client -> jsr:@dreamer/logger@^1.0.0-beta.4/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 使用统一的协议路径解析函数
          return await resolveDenoProtocolPath(fullProtocolPath);
        },
      );

      // 3. 添加 onLoad 钩子来处理 deno-protocol namespace 的模块加载
      // 统一处理 jsr: 和 npm: 协议的模块加载
      build.onLoad(
        { filter: /.*/, namespace: "deno-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;

          try {
            // 步骤 1: 先使用动态导入触发 Deno 下载和缓存模块
            // 这会确保模块被下载到 Deno 缓存中（适用于 jsr: 和 npm:）
            await import(protocolPath);

            // 步骤 2: 等待一小段时间，确保文件系统操作完成
            // 增加延时以确保 Deno 完全缓存模块
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 步骤 3: 再次尝试使用 import.meta.resolve 获取文件路径
            // 动态导入后，Deno 应该已经缓存了模块，resolve 应该能返回文件路径
            let fileUrl: string | undefined;
            try {
              fileUrl = await import.meta.resolve(protocolPath);
            } catch (_resolveError) {
              // 忽略 resolve 错误
            }

            // 步骤 4: 如果 resolve 返回 file:// URL，读取文件内容
            if (fileUrl && fileUrl.startsWith("file://")) {
              let filePath = fileUrl.slice(7);
              try {
                filePath = decodeURIComponent(filePath);
              } catch {
                // 忽略解码错误
              }

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);

                // 根据文件扩展名确定 loader
                const loader = getLoaderFromPath(filePath);

                return {
                  contents,
                  loader,
                };
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("https://") || fileUrl.startsWith("http://"))
            ) {
              // 步骤 5: 如果 resolve 返回 HTTP URL，使用 fetch 获取内容
              // 这种情况可能发生在 Deno 还没有完全缓存模块时
              // 注意：对于 JSR/NPM 的 HTTP URL，通常返回的是 HTML 页面，不是源代码
              // 所以这里应该尽量避免使用
              try {
                const response = await fetch(fileUrl);
                if (response.ok) {
                  const contents = await response.text();
                  const loader = getLoaderFromPath(fileUrl);
                  return {
                    contents,
                    loader,
                  };
                }
              } catch (_fetchError) {
                // 忽略 fetch 错误
              }
            }

            // 如果所有方法都失败，返回 undefined
            return undefined;
          } catch (_error) {
            // 忽略错误，返回 undefined
            return undefined;
          }
        },
      );
    },
  };
}
