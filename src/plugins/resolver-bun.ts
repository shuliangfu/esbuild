/**
 * @module @dreamer/esbuild/plugins/resolver-bun
 *
 * Bun 环境下的模块解析插件（用于 bun + esbuild）
 *
 * 为 esbuild 在 Bun 环境下提供模块解析，支持：
 * - 读取 package.json 的 imports 配置（路径别名和包导入映射）
 * - 读取 tsconfig.json 的 paths 配置（路径别名，作为后备）
 * - 解析 JSR 包的子路径导出（如 @dreamer/logger/client）
 *   - 注意：Bun 不支持直接使用 jsr: 协议，需要通过 package.json imports 映射
 *   - 例如：package.json 中配置 "@dreamer/logger": "jsr:@scope/package@^1.0.0-beta.1"
 *   - 然后代码中使用：import { x } from "@dreamer/logger/client"
 * - 支持 npm: 协议的模块引用（如 npm:esbuild@^0.27.2）
 *
 * 重要：Bun 不支持直接使用 jsr: 协议导入，必须通过 package.json 的 imports 字段映射
 */

import {
  cwd,
  dirname,
  existsSync,
  join,
  readdirSync,
  readTextFile,
  readTextFileSync,
  resolve,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import type { BuildLogger } from "../types.ts";

const PREFIX = "[resolver-bun]";

const NOOP_LOGGER: BuildLogger = {
  debug: () => {},
  info: () => {},
};

/**
 * 解析器选项
 */
export interface ResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 浏览器模式：将 jsr: 和 npm: 依赖转换为 CDN URL（如 esm.sh） */
  browserMode?: boolean;
  /** 是否输出 debug 日志（默认：false） */
  debug?: boolean;
  /** 构建日志器，debug 时通过 logger.debug 输出 */
  logger?: BuildLogger;
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
 * 支持 imports（子路径映射）、dependencies、devDependencies（Bun 下 JSR 常写成 npm:@jsr/...）
 */
interface PackageJsonConfig {
  imports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
 * 向上查找第一个包含指定包名的 package.json（检查 imports / dependencies / devDependencies）
 * 用于 monorepo 或 NODE_PATH 场景下从子目录解析到根目录的依赖
 *
 * @param startDir - 起始目录
 * @param packageName - 包名（如 @dreamer/router）
 * @returns 包含该包的 package.json 路径，未找到返回 undefined
 */
function findPackageJsonWithPackage(
  startDir: string,
  packageName: string,
): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const importVal = getPackageImport(packageJsonPath, packageName);
      if (importVal !== undefined) {
        return packageJsonPath;
      }
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
 * 优先读 imports，若无则读 dependencies、devDependencies（Bun 下 JSR 已转为 npm:@jsr/...）
 *
 * @param projectPackageJsonPath - 项目的 package.json 路径
 * @param packageName - 包名（如 @dreamer/logger）
 * @returns 包的导入路径（如 jsr:... 或 npm:@jsr/...），未找到返回 undefined
 */
function getPackageImport(
  projectPackageJsonPath: string,
  packageName: string,
): string | undefined {
  try {
    const content = readTextFileSync(projectPackageJsonPath);
    const config: PackageJsonConfig = JSON.parse(content);

    if (config.imports && config.imports[packageName]) {
      return config.imports[packageName];
    }
    if (config.dependencies && config.dependencies[packageName]) {
      return config.dependencies[packageName];
    }
    if (config.devDependencies && config.devDependencies[packageName]) {
      return config.devDependencies[packageName];
    }
    return undefined;
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

/** 脚本扩展名，与 resolver-deno 一致，用于无扩展名路径的解析 */
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];

/** 匹配脚本扩展名的正则（.ts/.tsx/.js/.jsx/.mts/.mjs） */
const SCRIPT_EXT_REGEX = /\.(tsx?|jsx?|mts|mjs)$/i;

/**
 * 将无扩展名或带扩展名的 base 路径解析为实际存在的脚本文件路径
 * 先检查 base 本身，再依次尝试 SCRIPT_EXTENSIONS
 *
 * @param basePath - 包内相对路径（可能无扩展名，如 ./src/client/mod）
 * @returns 存在的文件路径，或 null
 */
function resolveScriptPath(basePath: string): string | null {
  if (existsSync(basePath)) return basePath;
  if (SCRIPT_EXT_REGEX.test(basePath)) return null; // 已有脚本扩展名但文件不存在，不再尝试加后缀
  for (const ext of SCRIPT_EXTENSIONS) {
    const p = basePath + ext;
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 根据协议路径（如 npm:@jsr/pkg@v/client）解析出该模块所在目录
 * 用于 bun-protocol 内相对导入（./client.js、../types.js）时得到 resolveDir
 * 与 onLoad 子路径解析共用同一套 node_modules + exports 逻辑
 *
 * @param protocolPath - 协议路径
 * @returns 解析到的目录，未找到则 null
 */
function getProtocolPathResolveDir(protocolPath: string): string | null {
  if (!protocolPath.startsWith("npm:") || !protocolPath.includes("/")) {
    return null;
  }
  const parts = protocolPath.split("/");
  if (parts.length < 3 || parts[2]!.startsWith(".")) {
    return null;
  }
  const base = parts[0] + "/" + parts[1];
  const subpath = parts.slice(2).join("/");
  if (!subpath || subpath.includes("..")) {
    return null;
  }
  const baseParts = base.split("/");
  const scope = baseParts[0]!.startsWith("npm:")
    ? baseParts[0].slice(4)
    : baseParts[0]!;
  const nameWithVer = baseParts[1] ?? "";
  const namePrefix = nameWithVer.includes("@")
    ? nameWithVer.split("@")[0]!
    : nameWithVer;
  if (!scope || !namePrefix) {
    return null;
  }
  let dir = cwd();
  for (let up = 0; up < 20 && dir; up++) {
    const scopeDir = join(dir, "node_modules", scope);
    if (existsSync(scopeDir)) {
      try {
        const entries = readdirSync(scopeDir);
        const pkgDir = entries.find(
          (e: { isFile: boolean; name: string }) =>
            !e.isFile && e.name.startsWith(namePrefix),
        );
        if (pkgDir) {
          const pkgRoot = join(scopeDir, pkgDir.name);
          const pkgJsonPath = join(pkgRoot, "package.json");
          if (existsSync(pkgJsonPath)) {
            const raw = readTextFileSync(pkgJsonPath);
            const pkg = JSON.parse(raw) as {
              exports?: Record<
                string,
                string | { import?: string; default?: string }
              >;
            };
            const exportEntry = pkg.exports?.["./" + subpath];
            let target: string | undefined;
            if (typeof exportEntry === "string") {
              target = exportEntry;
            } else if (
              exportEntry &&
              typeof exportEntry === "object"
            ) {
              target =
                (exportEntry as { import?: string; default?: string }).import ??
                  (exportEntry as { import?: string; default?: string })
                    .default;
            }
            if (target != null && typeof target === "string") {
              const res = join(pkgRoot, target);
              const pathToUse = resolveScriptPath(res);
              if (pathToUse) {
                return dirname(pathToUse);
              }
            }
          }
        }
      } catch {
        /* 当前层读取失败，继续向上 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
  // 默认返回 ts
  return "ts";
}

/**
 * 判断协议路径是否包含子路径（如 npm:pkg@v/client）。
 * 子路径必须通过 package.json exports 解析，不能信任 import.meta.resolve，
 * 否则 Bun 可能返回包主入口导致整包被打进 bundle、体积暴增。
 *
 * @param protocolPath - 协议路径
 * @returns 是否包含子路径
 */
function hasProtocolSubpath(protocolPath: string): boolean {
  if (!protocolPath.startsWith("npm:") || !protocolPath.includes("/")) {
    return false;
  }
  const afterNpm = protocolPath.slice(5);
  const slashIdx = afterNpm.indexOf("/");
  if (slashIdx <= 0) return false;
  const afterSlash = afterNpm.slice(slashIdx + 1).trim();
  // 子路径如 client、map、client/preact，不含版本号形态
  return afterSlash.length > 0 && !/^\d/.test(afterSlash);
}

/**
 * 解析 Bun 协议路径（仅支持 npm:）
 * Bun 原生支持 npm: 协议，可以直接使用 import.meta.resolve
 * 注意：Bun 不支持 jsr: 协议，此函数不应被用于 jsr: 协议
 * 带子路径的路径（如 npm:@jsr/pkg@v/client）不信任 resolve 结果，统一走
 * bun-protocol 由 onLoad 按 node_modules + exports 解析，避免打进整包。
 *
 * @param protocolPath - 协议路径（如 npm:esbuild@^0.27.2）
 * @returns 解析结果
 */
async function resolveBunProtocolPath(
  protocolPath: string,
): Promise<esbuild.OnResolveResult | undefined> {
  try {
    // 子路径必须按 exports 解析，否则 Bun 可能返回主入口导致 bundle 体积过大
    if (hasProtocolSubpath(protocolPath)) {
      return {
        path: protocolPath,
        namespace: "bun-protocol",
      };
    }

    // Bun 原生支持 npm: 协议，可以直接解析
    // 注意：Bun 不支持 jsr: 协议，如果传入 jsr: 协议，resolve 会失败
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
        return {
          path: filePath,
          namespace: "file",
        };
      } else if (filePath) {
        // 文件路径存在但文件不存在，使用 bun-protocol namespace
        return {
          path: protocolPath,
          namespace: "bun-protocol",
        };
      }
    }

    // 如果返回的是其他格式（如协议路径本身），使用 bun-protocol namespace
    return {
      path: protocolPath,
      namespace: "bun-protocol",
    };
  } catch {
    // 如果 resolve 失败，使用 bun-protocol namespace
    return {
      path: protocolPath,
      namespace: "bun-protocol",
    };
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
  const {
    enabled = true,
    browserMode = false,
    debug = false,
    logger: optionsLogger,
  } = options;

  const log = optionsLogger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };

  return {
    name: "bun-resolver",
    setup(build) {
      if (!enabled) {
        return;
      }
      // 插件加载时打一条 debug，便于确认 debug 与 logger 已正确传入（Bun 下很多解析走默认，可能不会命中后续 onResolve）
      debugLog("plugin loaded (debug enabled)");

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
            debugLog(`路径别名: ${path} -> ${resolvedPath}`);
            return {
              path: resolvedPath,
              namespace: "file",
            };
          }

          return undefined;
        },
      );

      // 2. 处理直接的 npm: 协议导入
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      // 注意：Bun 原生支持 npm: 协议，但 esbuild 可能无法直接解析，所以需要插件帮助
      // 重要：Bun 不支持直接使用 jsr: 协议，必须通过 package.json imports 映射
      build.onResolve(
        { filter: /^npm:/ },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          const path = args.path;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(path);
            if (browserUrl) {
              debugLog(`npm 浏览器 external: ${path} -> ${browserUrl}`);
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          const result = await resolveBunProtocolPath(path);
          if (result?.path) {
            debugLog(`npm 协议解析: ${path} -> ${result.path}`);
            if (result.namespace === "file") {
              debugLog(`缓存路径: ${path} -> ${result.path}`);
            }
            // 必须只返回 protocolPath 作为 path，否则同一逻辑模块会因 importer 不同被 esbuild 视为不同模块，导致重复打包、chunk/路由体积暴增
            if (result.namespace === "bun-protocol") {
              return {
                path: result.path,
                namespace: "bun-protocol",
              };
            }
          }
          return result;
        },
      );

      // 2.5. 处理直接的 jsr: 协议导入（Bun 不支持，但为了兼容性，转换为错误提示或跳过）
      // 注意：Bun 不支持直接使用 jsr: 协议，应该通过 package.json imports 映射
      // 这里返回 undefined，让 esbuild 使用默认解析（会失败，但至少不会崩溃）
      build.onResolve(
        { filter: /^jsr:/ },
        (args): esbuild.OnResolveResult | undefined => {
          debugLog(`jsr 协议跳过（Bun 不支持）: ${args.path}`);
          // Bun 不支持直接使用 jsr: 协议
          // 建议用户通过 package.json imports 映射来使用 JSR 包
          // 然后代码中使用：import { x } from "@dreamer/logger/client"
          console.warn(
            `[bun-resolver] Bun 不支持直接使用 jsr: 协议导入 "${args.path}"。` +
              `请通过 package.json 的 imports 字段映射 JSR 包，然后使用不带 jsr: 前缀的导入。`,
          );
          // 返回 undefined，让 esbuild 使用默认解析（会失败，但至少不会崩溃）
          return undefined;
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
          // 查找包含该包的 package.json（先向上找有该依赖的根，再回退到最近 package.json）
          const projectPackageJsonPath = findPackageJsonWithPackage(
            startDir,
            packageName,
          ) ?? findProjectPackageJson(startDir);

          let packageImport: string | undefined;

          if (projectPackageJsonPath) {
            packageImport = getPackageImport(
              projectPackageJsonPath,
              packageName,
            );
            // 裸版本（如 ^1.0.2）规范为 npm: 形式：@scope/name -> npm:@jsr/scope__name，@jsr/xxx 保持
            if (
              packageImport && !packageImport.startsWith("npm:") &&
              !packageImport.startsWith("jsr:")
            ) {
              if (packageName.startsWith("@jsr/")) {
                packageImport = `npm:${packageName}@${packageImport}`;
              } else if (
                packageName.startsWith("@") && packageName.includes("/")
              ) {
                const match = packageName.match(/^@([^/]+)\/(.+)$/);
                if (match) {
                  const scope = match[1]!;
                  const name = match[2]!.replace(/-/g, "_");
                  packageImport = `npm:@jsr/${scope}__${name}@${packageImport}`;
                }
              }
            }
          }

          // 如果没有找到 package.json 或导入映射，尝试从 Bun 缓存读取
          // Bun 可以从缓存读取之前安装过的依赖，即使没有 package.json
          if (!packageImport) {
            try {
              // 尝试直接解析包路径（Bun 可能从缓存解析）
              const resolvedUrl = await import.meta.resolve(path);

              if (resolvedUrl && resolvedUrl.startsWith("file://")) {
                let filePath = resolvedUrl.slice(7);
                try {
                  filePath = decodeURIComponent(filePath);
                } catch {
                  // 忽略解码错误
                }

                if (filePath && existsSync(filePath)) {
                  debugLog(`bare 子路径(缓存): ${path} -> ${filePath}`);
                  debugLog(`缓存路径: ${path} -> ${filePath}`);
                  return {
                    path: filePath,
                    namespace: "file",
                  };
                }
              }
            } catch {
              // 如果 resolve 失败，说明缓存中也没有，继续后续处理
            }

            // 如果无法从缓存读取，让 esbuild 使用默认解析
            // 注意：对于 JSR 包，如果没有 package.json 的映射，Bun 无法解析
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@scope/package@^1.0.0-beta.1 + /client -> jsr:@scope/package@^1.0.0-beta.1/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 浏览器模式：将依赖标记为 external，让浏览器从 CDN 加载
          if (browserMode) {
            const browserUrl = convertSpecifierToBrowserUrl(fullProtocolPath);
            if (browserUrl) {
              debugLog(`子路径浏览器 external: ${path} -> ${browserUrl}`);
              return {
                path: browserUrl,
                external: true,
              };
            }
          }

          // 使用统一的协议路径解析（Bun 支持 npm:，含 npm:@jsr/... 子路径）
          const result = await resolveBunProtocolPath(fullProtocolPath);
          if (result?.path) {
            const fromCache = result.path.includes("node_modules/.bun");
            debugLog(
              fromCache
                ? `bare 子路径(缓存): ${path} -> ${result.path}`
                : `bare 子路径: ${path} -> ${fullProtocolPath} -> ${result.path}`,
            );
            if (result.namespace === "file") {
              debugLog(`缓存路径: ${path} -> ${result.path}`);
            }
            // 必须只返回 protocolPath，否则同一子路径会因 importer 不同被 esbuild 重复打包
            if (result.namespace === "bun-protocol") {
              return {
                path: result.path,
                namespace: "bun-protocol",
              };
            }
          }
          return result;
        },
      );

      // 4. 处理 bun-protocol namespace 中的相对路径导入
      // 当 npm 包内部有相对路径导入时，需要从文件的 resolveDir 解析这些相对路径
      // 注意：Bun 不支持 jsr: 协议，所以这里主要处理 npm: 包的内部相对路径
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: "bun-protocol" },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          // 相对路径导入，需要从 importer 的目录解析
          // importer 是协议路径（如 npm:@jsr/pkg@v/client）
          const importer = args.importer;
          if (!importer) {
            return undefined;
          }

          try {
            // 优先：根据 importer 协议路径解析出包内目录，再解析相对路径（./client.js、../types.js 等）
            // 这样包内未在 exports 中声明的文件也能正确解析，避免 "No matching export" / "has no exports"
            if (importer.startsWith("npm:") && importer.includes("/")) {
              const importerDir = getProtocolPathResolveDir(importer);
              if (importerDir) {
                const absolutePath = resolve(importerDir, args.path);
                const pathToUse = resolveScriptPath(absolutePath) ??
                  (existsSync(absolutePath) ? absolutePath : null);
                if (pathToUse) {
                  debugLog(
                    `bun-protocol 相对路径(按 importer 目录): ${importer} + ${args.path} -> ${pathToUse}`,
                  );
                  return {
                    path: pathToUse,
                    namespace: "file",
                  };
                }
              }
            }

            // 先尝试直接解析 importer 为实际文件路径
            let importerUrl: string | undefined;
            try {
              importerUrl = await import.meta.resolve(importer);
            } catch {
              // 如果 resolve 失败，尝试通过动态导入触发模块下载和缓存
              try {
                await import(importer);
                // 等待一小段时间，确保文件系统操作完成
                await new Promise((resolve) => setTimeout(resolve, 100));
                // 再次尝试 resolve
                importerUrl = await import.meta.resolve(importer);
              } catch {
                // 忽略错误
              }
            }

            if (importerUrl && importerUrl.startsWith("file://")) {
              let importerPath = importerUrl.slice(7);
              try {
                importerPath = decodeURIComponent(importerPath);
              } catch {
                // 忽略解码错误
              }

              if (existsSync(importerPath)) {
                // 从 importer 的目录解析相对路径
                const importerDir = dirname(importerPath);
                const resolvedPath = join(importerDir, args.path);

                if (existsSync(resolvedPath)) {
                  debugLog(
                    `bun-protocol 相对路径: ${importer} + ${args.path} -> ${resolvedPath}`,
                  );
                  return {
                    path: resolvedPath,
                    namespace: "file",
                  };
                }
              }
            }

            // 如果无法通过文件路径解析，尝试构建完整的协议路径
            // 例如：npm:lodash@^4.17.21/map + ../utils.ts
            // -> npm:lodash@^4.17.21/utils.ts
            // 注意：Bun 不支持 jsr: 协议，这里主要处理 npm: 包
            try {
              const importerProtocolPath = importer;
              // 移除最后一个路径段（如 /client）
              const baseProtocolPath = importerProtocolPath.replace(
                /\/[^/]+$/,
                "",
              );
              const relativePath = args.path;

              // 规范化相对路径（处理 ../ 和 ./）
              let normalizedPath = relativePath;
              if (normalizedPath.startsWith("../")) {
                normalizedPath = normalizedPath.slice(3);
              } else if (normalizedPath.startsWith("./")) {
                normalizedPath = normalizedPath.slice(2);
              }

              const fullProtocolPath = `${baseProtocolPath}/${normalizedPath}`;

              // 尝试解析这个协议路径
              try {
                const resolvedProtocolUrl = await import.meta.resolve(
                  fullProtocolPath,
                );
                if (resolvedProtocolUrl.startsWith("file://")) {
                  let resolvedProtocolPath = resolvedProtocolUrl.slice(7);
                  try {
                    resolvedProtocolPath = decodeURIComponent(
                      resolvedProtocolPath,
                    );
                  } catch {
                    // 忽略解码错误
                  }

                  if (existsSync(resolvedProtocolPath)) {
                    debugLog(
                      `bun-protocol 协议相对: ${importer} + ${args.path} -> ${resolvedProtocolPath}`,
                    );
                    return {
                      path: resolvedProtocolPath,
                      namespace: "file",
                    };
                  }
                }
              } catch {
                // 如果解析失败，返回一个 bun-protocol namespace 的结果
                return {
                  path: fullProtocolPath,
                  namespace: "bun-protocol",
                };
              }
            } catch {
              // 忽略错误
            }
          } catch {
            // 忽略错误
          }

          return undefined;
        },
      );

      // 5. 添加 onLoad 钩子来处理 bun-protocol namespace 的模块加载
      // 注意：Bun 不支持 jsr: 协议，这里主要处理 npm: 包的加载
      build.onLoad(
        { filter: /.*/, namespace: "bun-protocol" },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          // path 仅为 protocolPath（不包含 importer），保证同一逻辑模块只对应一个 key，避免重复打包
          const protocolPath = args.path;
          debugLog(`onLoad bun-protocol: ${protocolPath}`);

          // 如果协议路径是 jsr:，Bun 不支持，返回 undefined
          if (protocolPath.startsWith("jsr:")) {
            console.warn(
              `[bun-resolver] Bun 不支持直接使用 jsr: 协议 "${protocolPath}"。` +
                `请通过 package.json 的 imports 字段映射 JSR 包。`,
            );
            return undefined;
          }

          try {
            // 子路径（如 npm:@jsr/pkg@v/client 或 .../client/preact）：按包 exports 解析，base 为包根，subpath 为多段
            if (protocolPath.startsWith("npm:") && protocolPath.includes("/")) {
              const parts = protocolPath.split("/");
              // npm:@scope/name@version 为前两段，其余为 subpath（如 client 或 client/preact）
              if (parts.length >= 3 && !parts[2]!.startsWith(".")) {
                const base = parts[0] + "/" + parts[1];
                const subpath = parts.slice(2).join("/");
                if (subpath && !subpath.includes("..")) {
                  try {
                    debugLog(
                      `onLoad 子路径尝试: ${protocolPath} (base=${base}, subpath=${subpath})`,
                    );
                    // 不依赖 Bun.resolveSync，从 importer 向上在 node_modules 里按包名查找（npm:@jsr/name@v -> node_modules/@jsr/name@*）
                    const baseParts = base.split("/");
                    const scope = baseParts[0]!.startsWith("npm:")
                      ? baseParts[0].slice(4)
                      : baseParts[0]!;
                    const nameWithVer = baseParts[1] ?? "";
                    const namePrefix = nameWithVer.includes("@")
                      ? nameWithVer.split("@")[0]!
                      : nameWithVer;
                    if (!scope || !namePrefix) {
                      debugLog(`onLoad 子路径: 无法解析 base=${base}`);
                    } else {
                      // 从 cwd() 向上找 node_modules（不再用 importer，避免 path 含 importer 导致 esbuild 重复打包）
                      let dir = cwd();
                      for (let up = 0; up < 20 && dir; up++) {
                        const scopeDir = join(dir, "node_modules", scope);
                        if (existsSync(scopeDir)) {
                          try {
                            const entries = readdirSync(scopeDir);
                            const pkgDir = entries.find(
                              (e: { isFile: boolean; name: string }) =>
                                !e.isFile &&
                                e.name.startsWith(namePrefix),
                            );
                            if (pkgDir) {
                              const pkgRoot = join(scopeDir, pkgDir.name);
                              const pkgJsonPath = join(pkgRoot, "package.json");
                              if (existsSync(pkgJsonPath)) {
                                const raw = readTextFileSync(pkgJsonPath);
                                const pkg = JSON.parse(raw) as {
                                  exports?: Record<
                                    string,
                                    string | {
                                      import?: string;
                                      default?: string;
                                    }
                                  >;
                                };
                                const exportEntry = pkg.exports
                                  ?.["./" + subpath];
                                let target: string | undefined;
                                if (typeof exportEntry === "string") {
                                  target = exportEntry;
                                } else if (
                                  exportEntry &&
                                  typeof exportEntry === "object"
                                ) {
                                  target = (exportEntry as {
                                    import?: string;
                                    default?: string;
                                  }).import ??
                                    (exportEntry as {
                                      import?: string;
                                      default?: string;
                                    }).default;
                                }
                                if (
                                  target != null &&
                                  typeof target === "string"
                                ) {
                                  const res = join(pkgRoot, target);
                                  const pathToUse = resolveScriptPath(res);
                                  if (pathToUse) {
                                    const contents = await readTextFile(
                                      pathToUse,
                                    );
                                    const loader = getLoaderFromPath(pathToUse);
                                    debugLog(
                                      `onLoad 子路径(按 exports): ${protocolPath} -> ${pathToUse} (${contents.length} chars)`,
                                    );
                                    return {
                                      contents,
                                      loader,
                                      resolveDir: dirname(pathToUse),
                                    };
                                  }
                                }
                              }
                            }
                          } catch {
                            /* 当前层 readdir 失败，继续向上 */
                          }
                        }
                        const parent = dirname(dir);
                        if (parent === dir) break; // 已到根目录
                        dir = parent;
                      }
                      debugLog(
                        `onLoad 子路径: 未在 node_modules 中找到包 base=${base}`,
                      );
                    }
                  } catch (e) {
                    debugLog(
                      `onLoad 子路径异常: ${protocolPath} -> ${
                        e instanceof Error ? e.message : String(e)
                      }`,
                    );
                  }
                }
              }
            }

            // 步骤 1: 先使用动态导入触发 Bun 下载和缓存模块（仅支持 npm: 协议）
            try {
              await import(protocolPath);
            } catch (_importError) {
              // 忽略导入错误，可能模块已经加载
            }

            // 步骤 2: 等待一小段时间，确保文件系统操作完成
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 步骤 3: 多次尝试使用 import.meta.resolve 获取文件路径
            let fileUrl: string | undefined;
            let retries = 3;
            while (retries > 0 && !fileUrl) {
              try {
                fileUrl = await import.meta.resolve(protocolPath);
                // 如果返回的是 file:// URL，说明成功
                if (fileUrl && fileUrl.startsWith("file://")) {
                  break;
                }
              } catch (_resolveError) {
                // 忽略 resolve 错误
              }
              // 如果 resolve 失败或返回协议路径，等待后重试
              if (!fileUrl || fileUrl.startsWith("npm:")) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                retries--;
              } else {
                break;
              }
            }

            // 步骤 4: 如果 resolve 返回 file:// URL，读取文件内容
            if (fileUrl && fileUrl.startsWith("file://")) {
              let filePath = fileUrl.slice(7);
              try {
                filePath = decodeURIComponent(filePath);
              } catch {
                // 忽略解码错误
              }

              const pathToUse = filePath;
              debugLog(`缓存路径: ${protocolPath} -> ${pathToUse}`);

              // 设置 resolveDir 为文件所在目录，以便 esbuild 能解析文件内部的相对路径导入
              const resolveDir = dirname(pathToUse);

              if (existsSync(pathToUse)) {
                const contents = await readTextFile(pathToUse);
                const loader = getLoaderFromPath(pathToUse);
                debugLog(
                  `onLoad 从文件读取: ${protocolPath} -> ${pathToUse} (${contents.length} chars)`,
                );
                return {
                  contents,
                  loader,
                  resolveDir,
                };
              } else {
                // 文件不存在，但仍然需要设置 resolveDir
                const loader = getLoaderFromPath(pathToUse);
                return {
                  contents: "",
                  loader,
                  resolveDir,
                };
              }
            }

            // 如果所有方法都失败，至少设置 resolveDir
            const resolveDir = cwd();
            const loader = getLoaderFromPath(protocolPath);
            return {
              contents: "",
              loader,
              resolveDir,
            };
          } catch (_error) {
            // 忽略错误，返回 undefined
            return undefined;
          }
        },
      );

      // 6. debug 时对每次解析请求打日志（透传、不处理），便于与 Deno 的编译日志对齐
      if (debug) {
        build.onResolve(
          { filter: /.*/ },
          (args): undefined => {
            debugLog(`resolving: ${args.path}`);
            return undefined;
          },
        );
        // debug 时对 preact / preact/* 等走默认解析的 bare 包做一次 resolve 并打印缓存路径
        build.onResolve(
          { filter: /^(preact|preact\/.*)$/ },
          async (args): Promise<undefined> => {
            const path = args.path;
            try {
              const resolvedUrl = await import.meta.resolve(path);
              if (resolvedUrl?.startsWith("file://")) {
                let filePath = resolvedUrl.slice(7);
                try {
                  filePath = decodeURIComponent(filePath);
                } catch {
                  // ignore
                }
                const pathToUse = filePath;
                debugLog(`缓存路径: ${path} -> ${pathToUse}`);
              }
            } catch {
              // 解析失败不报错，仅跳过打印
            }
            return undefined;
          },
        );
      }
    },
  };
}
