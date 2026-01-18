/**
 * @module @dreamer/esbuild/plugins/resolver-bun
 *
 * Bun 环境下的模块解析插件（用于 bun + esbuild）
 *
 * 为 esbuild 在 Bun 环境下提供模块解析，支持：
 * - 读取 package.json 的 imports 配置（路径别名和包导入映射）
 * - 读取 tsconfig.json 的 paths 配置（路径别名，作为后备）
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 * - 支持 jsr: 协议的模块引用（如 jsr:@dreamer/logger@^1.0.0）
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 *
 * 注意：Bun 原生支持 jsr: 和 npm: 协议，可以直接解析
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
 * 解析器选项
 */
export interface ResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 浏览器模式：将 jsr: 和 npm: 依赖转换为 CDN URL（如 esm.sh） */
  browserMode?: boolean;
}

/**
 * 将 npm: 或 jsr: specifier 转换为浏览器可用的 URL (esm.sh)
 * @param specifier npm: 或 jsr: specifier
 * @returns 浏览器可用的 URL
 */
function convertSpecifierToBrowserUrl(specifier: string): string | null {
  // 处理 npm: 前缀
  if (specifier.startsWith("npm:")) {
    const pkg = specifier.slice(4);
    return `https://esm.sh/${pkg}`;
  }

  // 处理 jsr: 前缀
  if (specifier.startsWith("jsr:")) {
    // jsr:@scope/pkg -> https://esm.sh/jsr/@scope/pkg
    const pkg = specifier.slice(4);
    return `https://esm.sh/jsr/${pkg}`;
  }

  // 如果已经是 http/https URL，直接返回
  if (specifier.startsWith("http:") || specifier.startsWith("https:")) {
    return specifier;
  }

  return null;
}

/**
 * package.json 配置结构
 */
interface PackageJsonConfig {
  imports?: Record<string, string>;
}

/**
 * tsconfig.json 配置结构
 */
interface TsconfigConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
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
 * 查找项目的 tsconfig.json 文件
 *
 * @param startDir - 起始目录
 * @returns tsconfig.json 文件路径，如果未找到返回 undefined
 */
function findProjectTsconfig(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const tsconfigPath = join(currentDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
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
 * @param projectPackageJsonPath - 项目的 package.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:@dreamer/logger@1.0.0-beta.4），如果未找到返回 undefined
 */
function getPackageImport(
  projectPackageJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(projectPackageJsonPath);
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
 * 解析路径别名（从 package.json imports 或 tsconfig.json paths）
 *
 * @param path - 路径别名（如 @/utils.ts 或 ~/config.ts）
 * @param startDir - 起始目录
 * @returns 解析后的文件路径，如果未找到返回 undefined
 */
function resolvePathAlias(
  path: string,
  startDir: string,
): string | undefined {
  // 1. 优先尝试 package.json 的 imports
  const packageJsonPath = findProjectPackageJson(startDir);
  if (packageJsonPath) {
    try {
      const content = readTextFileSync(packageJsonPath);
      const config: PackageJsonConfig = JSON.parse(content);

      if (config.imports) {
        // 查找匹配的别名，优先匹配最长的前缀
        const sortedKeys = Object.keys(config.imports).sort((a, b) =>
          b.length - a.length
        );

        for (const alias of sortedKeys) {
          if (path.startsWith(alias)) {
            const aliasValue = config.imports[alias];
            if (aliasValue) {
              const remainingPath = path.slice(alias.length);
              let resolvedPath: string;

              // 如果别名值以 ./ 或 ../ 开头，是相对路径
              if (
                aliasValue.startsWith("./") || aliasValue.startsWith("../")
              ) {
                const packageJsonDir = dirname(packageJsonPath);
                resolvedPath = join(packageJsonDir, aliasValue, remainingPath);
              } else {
                // 如果别名值是绝对路径或其他格式
                resolvedPath = aliasValue + remainingPath;
              }

              // 检查文件是否存在
              if (existsSync(resolvedPath)) {
                return resolvedPath;
              } else {
                // 尝试添加 .ts 扩展名
                const withExt = resolvedPath + ".ts";
                if (existsSync(withExt)) {
                  return withExt;
                }
              }
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }
  }

  // 2. 后备：尝试 tsconfig.json 的 paths
  const tsconfigPath = findProjectTsconfig(startDir);
  if (tsconfigPath) {
    try {
      const content = readTextFileSync(tsconfigPath);
      const config: TsconfigConfig = JSON.parse(content);

      if (config.compilerOptions?.paths) {
        const baseUrl = config.compilerOptions.baseUrl
          ? join(dirname(tsconfigPath), config.compilerOptions.baseUrl)
          : dirname(tsconfigPath);

        // 查找匹配的路径别名
        for (
          const [pattern, paths] of Object.entries(
            config.compilerOptions.paths,
          )
        ) {
          // 处理通配符模式，如 "@/*" -> ["src/*"]
          if (pattern.endsWith("/*")) {
            const prefix = pattern.slice(0, -2);
            if (path.startsWith(prefix + "/")) {
              const remainingPath = path.slice(prefix.length + 1);
              for (const mappedPath of paths) {
                if (mappedPath.endsWith("/*")) {
                  const mappedPrefix = mappedPath.slice(0, -2);
                  const resolvedPath = join(
                    baseUrl,
                    mappedPrefix,
                    remainingPath,
                  );
                  if (existsSync(resolvedPath)) {
                    return resolvedPath;
                  } else {
                    // 尝试添加 .ts 扩展名
                    const withExt = resolvedPath + ".ts";
                    if (existsSync(withExt)) {
                      return withExt;
                    }
                  }
                }
              }
            }
          } else if (path === pattern || path.startsWith(pattern + "/")) {
            // 精确匹配或前缀匹配
            for (const mappedPath of paths) {
              const remainingPath = path.slice(pattern.length);
              const resolvedPath = join(baseUrl, mappedPath, remainingPath);
              if (existsSync(resolvedPath)) {
                return resolvedPath;
              } else {
                // 尝试添加 .ts 扩展名
                const withExt = resolvedPath + ".ts";
                if (existsSync(withExt)) {
                  return withExt;
                }
              }
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }
  }

  return undefined;
}

/**
 * 解析 Bun 协议路径（jsr: 或 npm:）
 * Bun 原生支持这些协议，可以直接使用 import.meta.resolve
 *
 * @param protocolPath - 协议路径（如 jsr:@dreamer/logger@1.0.0-beta.4）
 * @returns 解析结果
 */
async function resolveBunProtocolPath(
  protocolPath: string,
): Promise<esbuild.OnResolveResult | undefined> {
  try {
    // Bun 原生支持 jsr: 和 npm: 协议，可以直接解析
    const resolvedUrl = await import.meta.resolve(protocolPath);

    // 如果返回的是 file:// URL，直接使用文件路径
    if (resolvedUrl.startsWith("file://")) {
      let filePath = resolvedUrl.slice(7);
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // 忽略解码错误
      }

      if (filePath && existsSync(filePath)) {
        // 返回文件路径，esbuild 会自动从文件路径推断 resolveDir
        return {
          path: filePath,
          namespace: "file",
        };
      }
    }

    // 如果返回的是其他格式（如协议路径本身），让 esbuild 使用默认解析
    return undefined;
  } catch {
    // 如果 resolve 失败，让 esbuild 使用默认解析
    return undefined;
  }
}

/**
 * 创建 Bun 模块解析插件
 *
 * 该插件解决 esbuild 在 Bun 环境下无法正确解析路径别名和 JSR 包子路径导出的问题。
 * 使用 package.json 的 imports 和 tsconfig.json 的 paths 来处理路径别名。
 *
 * @param options - 插件选项
 * @returns esbuild 插件
 *
 * @example
 * ```typescript
 * import { buildBundle } from "@dreamer/esbuild";
 * import { bunResolverPlugin } from "@dreamer/esbuild/plugins/resolver-bun";
 *
 * const result = await buildBundle({
 *   entryPoint: "./src/client/mod.ts",
 *   plugins: [bunResolverPlugin()],
 * });
 * ```
 */
export function bunResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const { enabled = true, browserMode = false } = options;

  return {
    name: "bun-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 1. 处理路径别名（通过 package.json imports 或 tsconfig.json paths 配置）
      // 例如：import { x } from "@/utils.ts"
      // 例如：import { x } from "~/config.ts"
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());

          const resolvedPath = resolvePathAlias(path, startDir);
          if (resolvedPath) {
            return {
              path: resolvedPath,
              namespace: "file",
            };
          }

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@dreamer/logger@1.0.0-beta.4"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      // 注意：Bun 原生支持这些协议，但 esbuild 可能无法直接解析，所以需要插件帮助
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(path);
            if (browserUrl) {
              // 返回 external，让 esbuild 不打包这个依赖
              // 浏览器会在运行时从 CDN 加载
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          return await resolveBunProtocolPath(path);
        },
      );

      // 3. 匹配带有子路径的 @scope/package/subpath 模式
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

          // 查找项目的 package.json 文件
          // 优先使用 importer 的目录，如果没有则使用 resolveDir，最后使用 cwd()
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectPackageJsonPath = findProjectPackageJson(startDir);

          if (!projectPackageJsonPath) {
            // 如果没有 package.json，让 esbuild 使用默认解析
            return undefined;
          }

          // 从项目的 package.json 的 imports 中获取包的导入映射
          const packageImport = getPackageImport(
            projectPackageJsonPath,
            packageName,
          );

          if (!packageImport) {
            // 如果没有找到导入映射，让 esbuild 使用默认解析
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@dreamer/logger@1.0.0-beta.4 + /client -> jsr:@dreamer/logger@1.0.0-beta.4/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(fullProtocolPath);
            if (browserUrl) {
              // 返回 external，让 esbuild 不打包这个依赖
              // 浏览器会在运行时从 CDN 加载
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          // 使用统一的协议路径解析函数
          return await resolveBunProtocolPath(fullProtocolPath);
        },
      );
    },
  };
}
