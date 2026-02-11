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
 *
 * 与项目内 esbuild.ts 的 createImportReplacerPlugin 对比：
 * - 彼处将 jsr/npm 转为 CDN URL（esm.sh）并 external，浏览器运行时加载已编译产物。
 * - 本插件在 browserMode: false（打进 bundle）时，只用 Deno 在项目目录下 resolve 得到
 *   file://，再读本地文件参与编译；不猜路径（不硬编码 src/）、不 fetch CDN。
 * - 打进 bundle 必须用源码，故不走 esm.sh 等已编译 CDN。
 */

import {
  createCommand,
  cwd,
  dirname,
  existsSync,
  join,
  normalize as pathNormalize,
  readTextFile,
  readTextFileSync,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import type { BuildLogger } from "../types.ts";

const PREFIX = "[resolver-deno]";

/**
 * 将 file:// URL 转为本地文件系统路径
 * Windows: file:///C:/Users/... -> C:/Users/...（去掉开头的 /，否则 existsSync 可能失败）
 */
function fileUrlToPath(fileUrl: string): string {
  let path = fileUrl.slice(7);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* ignore */
  }
  if (path.length >= 3 && /^\/[A-Za-z]:[/\\]/.test(path)) {
    path = path.slice(1);
  }
  return path;
}

/** 未传入 logger 时使用的空实现，避免使用 console */
const NOOP_LOGGER: BuildLogger = {
  debug: () => {},
  info: () => {},
};

/**
 * 模块缓存映射：specifier -> 本地文件路径
 * 由 buildModuleCache 函数预先构建，包含所有依赖模块的本地缓存路径
 */
export type ModuleCache = Map<string, string>;

/**
 * 从 deno info --json 输出的模块信息
 */
interface DenoInfoModule {
  /** 模块类型 */
  kind: string;
  /** 模块的 specifier（如 https://jsr.io/@dreamer/xxx/1.0.0/src/mod.ts） */
  specifier: string;
  /** 本地缓存文件路径 */
  local?: string;
  /** 模块依赖 */
  dependencies?: Array<{
    specifier: string;
    code?: { specifier: string };
    type?: { specifier: string };
  }>;
}

/**
 * deno info --json 的输出结构
 */
interface DenoInfoOutput {
  version: number;
  roots: string[];
  modules: DenoInfoModule[];
}

/**
 * 预构建模块缓存：运行 `deno info --json` 获取所有依赖模块的本地缓存路径
 *
 * 这个函数解决了 esbuild 在解析 JSR 包时每个模块都要启动子进程或发送 HTTP 请求的问题。
 * 通过一次性获取所有依赖，后续的模块解析可以直接使用本地缓存文件。
 *
 * @param entryPoint - 入口文件路径
 * @param projectDir - 项目目录（用于查找 deno.json）
 * @param debug - 是否输出调试日志
 * @param logger - 日志实例，未传时使用空实现，所有输出均通过 logger 不使用 console
 * @returns 模块缓存映射：specifier -> 本地文件路径
 *
 * @example
 * ```typescript
 * const cache = await buildModuleCache("./src/main.ts", "/path/to/project");
 * // cache.get("https://jsr.io/@dreamer/xxx/1.0.0/src/mod.ts")
 * // => "/Users/xxx/Library/Caches/deno/remote/https/jsr.io/xxx..."
 * ```
 */
export async function buildModuleCache(
  entryPoint: string,
  projectDir?: string,
  debug = false,
  logger?: BuildLogger,
): Promise<ModuleCache> {
  const cache: ModuleCache = new Map();
  const workDir = projectDir || cwd();
  const log = logger ?? NOOP_LOGGER;

  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };
  debugLog(
    `buildModuleCache 开始构建模块缓存: entry=${entryPoint}, workDir=${workDir}`,
  );

  try {
    // 查找项目的 deno.json
    const projectDenoJson = findProjectDenoJson(workDir);
    const configArgs = projectDenoJson ? ["--config", projectDenoJson] : [];

    // 运行 deno info --json 获取完整的依赖图
    const proc = createCommand("deno", {
      args: ["info", "--json", ...configArgs, entryPoint],
      cwd: workDir,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await proc.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      debugLog(`buildModuleCache deno info 失败: ${stderr}`);
      return cache;
    }

    const stdout = new TextDecoder().decode(output.stdout);
    if (!stdout.trim()) {
      return cache;
    }

    // 解析 JSON 输出
    const info: DenoInfoOutput = JSON.parse(stdout);

    // 构建 specifier -> local 映射
    const npmSpecifiersToResolve = new Set<string>();
    for (const mod of info.modules) {
      if (mod.local && mod.specifier) {
        // 存储 https:// URL 到本地路径的映射
        cache.set(mod.specifier, mod.local);

        // 同时为 jsr: 协议创建映射
        // https://jsr.io/@scope/name/version/path.ts -> jsr:@scope/name@version/path
        const jsrMatch = mod.specifier.match(
          /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\/(.+)$/,
        );
        if (jsrMatch) {
          const [, scopeAndName, version, path] = jsrMatch;
          // 精确版本映射
          const jsrSpecifier = `jsr:${scopeAndName}@${version}/${path}`;
          cache.set(jsrSpecifier, mod.local);

          // 带 ^ 前缀的版本映射（用于版本范围）
          const jsrSpecifierCaret = `jsr:${scopeAndName}@^${version}/${path}`;
          cache.set(jsrSpecifierCaret, mod.local);

          // 主入口映射（如果 path 是 src/mod.ts）
          if (path === "src/mod.ts" || path === "mod.ts") {
            cache.set(`jsr:${scopeAndName}@${version}`, mod.local);
            cache.set(`jsr:${scopeAndName}@^${version}`, mod.local);
          }

          debugLog(
            `buildModuleCache 添加映射: ${jsrSpecifier} -> ${mod.local}`,
          );
        }
      } else if (mod.specifier?.startsWith("npm:")) {
        // deno info 对 npm 模块常返回 empty local，需子进程 resolve 补全
        // 统一 npm:/preact@x -> npm:preact@x，便于后续缓存查找
        const spec = mod.specifier.replace(/^npm:\/+/, "npm:");
        npmSpecifiersToResolve.add(spec);
      }
    }

    // npm 模块：deno info 不提供 local，用子进程 import.meta.resolve 补全
    for (const spec of npmSpecifiersToResolve) {
      if (cache.has(spec)) continue;
      try {
        const proc = createCommand("deno", {
          args: [
            "eval",
            ...(projectDenoJson ? ["--config", projectDenoJson] : []),
            "const u=await import.meta.resolve(Deno.args[0]);console.log(u);",
            spec,
          ],
          cwd: workDir,
          stdout: "piped",
          stderr: "piped",
        });
        const out = await proc.output();
        if (out.success && out.stdout) {
          const line = new TextDecoder().decode(out.stdout).trim();
          if (line.startsWith("file://")) {
            const localPath = fileUrlToPath(line);
            if (existsSync(localPath)) {
              cache.set(spec, localPath);
              debugLog(`buildModuleCache npm resolve: ${spec} -> ${localPath}`);
            }
          }
        }
      } catch {
        debugLog(`buildModuleCache npm resolve 失败: ${spec}`);
      }
    }

    debugLog(`buildModuleCache 完成: ${cache.size} 个模块`);
  } catch (error) {
    debugLog(`buildModuleCache 错误: ${error}`);
  }

  return cache;
}

/**
 * JSR 请求头：文档要求 Accept 不得含 text/html，否则会返回 HTML 页面。
 * - JSON：拉取 meta.json / _meta.json
 * - 源码：拉取模块 .ts/.js 时用 JSR_ACCEPT_SOURCE，可拿到原始源码
 */
const JSR_ACCEPT_JSON = "application/json";
const JSR_ACCEPT_SOURCE = "application/typescript, text/plain, */*";

/**
 * 解析器选项
 */
export interface ResolverOptions {
  /** 是否启用插件（默认：true） */
  enabled?: boolean;
  /** 浏览器模式：将 jsr: 和 npm: 依赖转换为 CDN URL（如 esm.sh） */
  browserMode?: boolean;
  /**
   * 服务端构建模式（默认：true）
   *
   * 当为 true 时（服务端构建）：
   * - npm: 和 jsr: 协议的依赖直接标记为 external，让 Deno 在运行时解析
   * - 不需要扫描缓存目录，构建速度快
   * - 适用于服务端代码编译
   *
   * 当为 false 时（客户端构建或需要打包依赖）：
   * - 使用 moduleCache 从 Deno 缓存读取依赖
   * - 将依赖打包进 bundle
   */
  isServerBuild?: boolean;
  /**
   * 预构建的模块缓存（由 buildModuleCache 生成）
   * 仅在 isServerBuild: false 时有效
   * 如果提供，将优先使用缓存中的本地文件路径，避免每个模块都启动子进程或发送 HTTP 请求
   */
  moduleCache?: ModuleCache;
  /**
   * 排除的路径模式列表
   * 匹配这些模式的路径会被标记为 external，不会被 esbuild 扫描
   * 默认值包含常见的包管理器缓存目录和测试目录：
   * - node_modules：Node.js 包目录
   * - .bun/install：Bun 包缓存目录（可能包含损坏的测试文件）
   * - .npm：npm 缓存目录
   * - /test/：测试目录（避免扫描测试用的故意损坏文件）
   */
  excludePaths?: string[];
  /**
   * 项目目录（用于查找 deno.json）
   * 当 importer 在 node_modules 内时，bare specifier 解析用此目录查找 deno.json，
   * 否则 cwd() 可能指向错误目录导致 react/scheduler 等无法解析。
   * 建议传入入口文件所在目录（如 dirname(entryPoint)）。
   */
  projectDir?: string;
  /** 是否启用调试日志（默认：false），开启后输出 onLoad / fetchJsrSourceViaMeta / CJS→ESM 重定向等，便于排查 */
  debug?: boolean;
  /** 日志实例（未传时使用空实现），info/debug 均通过 logger 输出，不使用 console */
  logger?: BuildLogger;
  /**
   * 强制将 preact/react 及其子路径标记为 external（默认：false）
   * 用于双构建场景：主包打包 preact，chunk 通过 import map 引用主包
   */
  forceRuntimeExternal?: boolean;
  /**
   * 解析覆盖：指定 specifier -> 本地文件路径的映射，在解析 bare specifier 时优先使用。
   * 例如 { "solid-js/jsx-runtime": "/path/to/solid-jsx-runtime-shim.ts" }，
   * 可让客户端构建使用 shim 而非 npm 包内的 jsx-runtime（避免 npm 包无 jsx/jsxs 导出问题）。
   */
  resolveOverrides?: Record<string, string>;
}

/**
 * deno.json 配置结构
 */
interface DenoConfig {
  imports?: Record<string, string>;
}

/** deno-protocol namespace，用于 onLoad 通过 fetch 取内容并打包 */
const NAMESPACE_DENO_PROTOCOL = "deno-protocol";

/**
 * 读取并解析 deno.json 配置
 *
 * @param denoJsonPath - deno.json 文件路径
 * @returns 解析后的配置，失败或文件不存在返回 undefined
 */
function getDenoConfig(denoJsonPath: string): DenoConfig | undefined {
  try {
    const content = readTextFileSync(denoJsonPath);
    return JSON.parse(content) as DenoConfig;
  } catch {
    return undefined;
  }
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
 * @param config - 可选，已解析的 deno 配置，传入可避免重复读取文件
 * @returns 包的导入路径（如 jsr:@scope/package@^1.0.0-beta.1），如果未找到返回 undefined
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
  config?: DenoConfig,
): string | undefined {
  const c = config ?? getDenoConfig(projectDenoJsonPath);
  if (!c?.imports) {
    return undefined;
  }
  return c.imports[packageName];
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
 * 从 URL 拉取 JSON 并解析（避免拿到 HTML 时误解析）
 *
 * @param url - 请求 URL
 * @returns 解析后的对象，失败或非 JSON 返回 null
 */
async function fetchJsonFromUrl(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { Accept: JSR_ACCEPT_JSON } });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * 从 URL 拉取源码文本（避免拿到 HTML）
 *
 * @param url - 请求 URL
 * @returns 源码内容，失败或疑似 HTML 返回 null
 */
async function fetchSourceFromUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { Accept: JSR_ACCEPT_SOURCE } });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text || text.trimStart().startsWith("<")) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * 用 JSR version_meta.json 的 manifest/exports 解析子路径，再 fetch 源码 URL 取内容。
 * 不猜路径：manifest 里是包内真实路径（如 /src/encryption/encryption-manager.ts），exports 是子路径→文件映射。
 *
 * @param protocolPath - jsr: 协议路径（如 jsr:@dreamer/socket-io@^1.0.0-beta.2/encryption/encryption-manager.ts）
 * @param debug - 是否输出调试日志（默认 false）
 * @param logger - 日志实例，未传时使用空实现，所有输出均通过 logger 不使用 console
 * @returns 源码内容，失败返回 null
 */
async function fetchJsrSourceViaMeta(
  protocolPath: string,
  debug = false,
  logger?: BuildLogger,
): Promise<string | null> {
  const log = logger ?? NOOP_LOGGER;
  if (debug) {
    log.debug(
      `${PREFIX} fetchJsrSourceViaMeta 入参 protocolPath=${protocolPath}`,
    );
  }
  if (!protocolPath.startsWith("jsr:")) {
    if (debug) {
      log.debug(
        `${PREFIX} fetchJsrSourceViaMeta 非 jsr: 协议，返回 null`,
      );
    }
    return null;
  }
  // 格式 jsr:@scope/name@version/path 或 jsr:@scope/name/path（无版本号时从包级 meta 取 latest）
  const after = protocolPath.slice(4);
  const lastAtIdx = after.lastIndexOf("@");
  let scopeAndName: string;
  let version: string;
  let subpath: string;
  if (lastAtIdx === -1) {
    // 无 @：解析为 @scope/name 与可选的 subpath，再从包级 meta.json 取最新非 yanked 版本
    const parts = after.split("/");
    if (parts.length < 2) {
      return null;
    }
    scopeAndName = `${parts[0]}/${parts[1]}`;
    subpath = parts.length > 2 ? parts.slice(2).join("/") : "";
    const pkgMetaUrl = `https://jsr.io/${scopeAndName}/meta.json`;
    const pkgMetaRaw = await fetchJsonFromUrl(pkgMetaUrl);
    if (debug) {
      log.debug(
        `${PREFIX} fetchJsrSourceViaMeta 无版本号分支 pkgMetaUrl=${pkgMetaUrl} pkgMetaRaw=${
          pkgMetaRaw == null ? "null" : "ok"
        }`,
      );
    }
    const pkgMeta = pkgMetaRaw as {
      versions?: Record<string, { yanked?: boolean }>;
    } | null;
    if (!pkgMeta) return null;
    const versions = pkgMeta.versions ?? {};
    const nonYanked = Object.keys(versions).filter((k) => !versions[k]?.yanked)
      .sort();
    if (nonYanked.length === 0) {
      return null;
    }
    version = nonYanked[nonYanked.length - 1];
  } else {
    scopeAndName = after.slice(0, lastAtIdx);
    const versionAndPath = after.slice(lastAtIdx + 1);
    const slashInRest = versionAndPath.indexOf("/");
    version = slashInRest === -1
      ? versionAndPath
      : versionAndPath.slice(0, slashInRest);
    subpath = slashInRest === -1 ? "" : versionAndPath.slice(slashInRest + 1);
  }

  // JSR _meta.json URL 只接受具体版本，不接受 ^ 或 ~ 等范围；去掉前缀后用该版本请求
  const concreteVersion = version.replace(/^[\^~]/, "");
  const base = `https://jsr.io/${scopeAndName}/${concreteVersion}`;
  const metaUrl = `${base}_meta.json`;
  const metaRaw = await fetchJsonFromUrl(metaUrl);
  if (debug) {
    log.debug(
      `${PREFIX} fetchJsrSourceViaMeta scopeAndName=${scopeAndName} version=${version} subpath=${subpath} metaUrl=${metaUrl} metaRaw=${
        metaRaw == null ? "null" : "ok"
      }`,
    );
  }
  const meta = metaRaw as {
    manifest?: Record<string, unknown>;
    exports?: Record<string, string>;
  } | null;
  if (!meta) return null;

  const manifest = meta.manifest ?? {};
  const exports = meta.exports ?? {};
  // 优先 exports："./client" -> "./src/client/mod.ts"，取掉 "./" 得 path
  const exportKey = subpath ? `./${subpath}` : ".";
  let pathFromExport = exports[exportKey];
  if (pathFromExport && typeof pathFromExport === "string") {
    pathFromExport = pathFromExport.replace(/^\.\//, "");
  }
  if (debug) {
    log.debug(
      `${PREFIX} fetchJsrSourceViaMeta exportKey=${exportKey} pathFromExport=${pathFromExport} manifestHasPath=${
        pathFromExport ? typeof manifest[`/${pathFromExport}`] : "n/a"
      }`,
    );
  }
  if (pathFromExport && typeof manifest[`/${pathFromExport}`] === "object") {
    const fileUrl = `${base}/${pathFromExport}`;
    const code = await fetchSourceFromUrl(fileUrl);
    if (debug) {
      log.debug(
        `${PREFIX} fetchJsrSourceViaMeta 第一路径 fileUrl=${fileUrl} code=${
          code != null ? `${code.length} chars` : "null"
        }`,
      );
    }
    if (code != null) return code;
  }
  // 子路径为 xxx.ts 时，若 exports["./xxx.ts"] 不存在，尝试 exports["./xxx"]（JSR 包常用 ./types 而非 ./types.ts）
  if (subpath && subpath.endsWith(".ts")) {
    const subpathNoExt = subpath.slice(0, -3);
    const fallbackExportKey = `./${subpathNoExt}`;
    let fallbackPath = exports[fallbackExportKey];
    if (fallbackPath && typeof fallbackPath === "string") {
      fallbackPath = fallbackPath.replace(/^\.\//, "");
      if (typeof manifest[`/${fallbackPath}`] === "object") {
        const fileUrl = `${base}/${fallbackPath}`;
        const code = await fetchSourceFromUrl(fileUrl);
        if (debug) {
          log.debug(
            `${PREFIX} fetchJsrSourceViaMeta 第一路径 fallback ${fallbackExportKey} fileUrl=${fileUrl} code=${
              code != null ? `${code.length} chars` : "null"
            }`,
          );
        }
        if (code != null) return code;
      }
    }
  }
  // 主入口只认 meta 里的 exports["."]，可能是 mod.ts、index.ts、main.ts 等，不写死
  if (!subpath) {
    return null;
  }
  // 子路径：仅按 meta 里 manifest 的 key 匹配，不假设目录结构；统一去掉 .ts 再比较，避免 import 带不带扩展名不一致
  const subpathNoExt = subpath.endsWith(".ts") ? subpath.slice(0, -3) : subpath;
  const manifestKeys = Object.keys(manifest);
  const pathKey = manifestKeys.find(
    (k) => {
      if (typeof manifest[k] !== "object") return false;
      const kNoExt = k.endsWith(".ts") ? k.slice(0, -3) : k;
      return kNoExt === `/${subpathNoExt}` ||
        kNoExt.endsWith(`/${subpathNoExt}`);
    },
  );
  if (pathKey) {
    const pathSlice = pathKey.slice(1);
    const code = await fetchSourceFromUrl(`${base}/${pathSlice}`);
    if (debug) {
      log.debug(
        `${PREFIX} fetchJsrSourceViaMeta 第二路径 pathKey=${pathKey} url=${base}/${pathSlice} code=${
          code != null ? `${code.length} chars` : "null"
        }`,
      );
    }
    if (code != null) return code;
  }
  if (debug) {
    log.debug(`${PREFIX} fetchJsrSourceViaMeta 未取到源码，返回 null`);
  }
  return null;
}

/**
 * 判断文件是否为 CJS 包装（如 React 的 index.js 仅做 module.exports = require('./cjs/...')）。
 * 此类文件重定向会导致循环依赖，应不重定向。
 */
function isCjsWrapperFile(content: string): boolean {
  const head = content.slice(0, 2048);
  const hasRequire = /\brequire\s*\(/.test(head);
  const hasEsmExport = /\bexport\s+/.test(head) || /\bimport\s+/.test(head);
  return hasRequire && !hasEsmExport;
}

/**
 * 当本地路径指向 npm 包的 CJS 文件时，若包有真正的 ESM 入口则返回其路径。
 * React/React-DOM 的 index.js 是 CJS 包装（require('./cjs/...')），重定向会导致循环依赖和 createElement 报错，故不重定向。
 */
async function getNpmEsmEntryPathIfCjs(
  localPath: string,
): Promise<string | undefined> {
  const normalized = pathNormalize(localPath.replace(/\\/g, "/"));
  const cjsIdx = normalized.indexOf("/cjs/");
  if (cjsIdx === -1) return undefined;

  const pkgRoot = normalized.slice(0, cjsIdx);
  const pkgPath = join(pkgRoot, "package.json");
  if (!existsSync(pkgPath)) return undefined;

  try {
    const raw = await readTextFile(pkgPath);
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    let entry: string | undefined;
    if (typeof pkg.module === "string") {
      entry = pkg.module;
    } else if (
      pkg.exports && typeof pkg.exports === "object" && pkg.exports !== null
    ) {
      const exp = (pkg.exports as Record<string, unknown>)["."];
      if (exp && typeof exp === "object" && exp !== null) {
        const expObj = exp as Record<string, unknown>;
        entry = (expObj.import ?? expObj.default) as string | undefined;
      }
    }
    if (typeof entry !== "string") {
      entry = "index.js";
    }

    const esmPath = pathNormalize(join(pkgRoot, entry));
    if (!existsSync(esmPath)) return undefined;

    // React/React-DOM 的 index.js 是 CJS 包装，重定向会导致循环依赖，不重定向
    const content = await readTextFile(esmPath);
    if (isCjsWrapperFile(content)) return undefined;

    return esmPath;
  } catch {
    // 忽略
  }
  return undefined;
}

/**
 * 解析 jsr: / npm: 协议路径：非浏览器模式一律走 deno-protocol，由 onLoad 用 https fetch 取内容并打包
 *
 * @param protocolPath - 协议路径（如 jsr:@scope/package@^1.0.0-beta.1）
 * @param browserMode - 为 true 时标记为 external，由浏览器从 CDN 加载
 * @returns 解析结果
 */
function resolveDenoProtocolPath(
  protocolPath: string,
  browserMode: boolean,
): esbuild.OnResolveResult | undefined {
  if (browserMode) {
    const browserUrl = convertSpecifierToBrowserUrl(protocolPath);
    if (browserUrl) {
      return { path: browserUrl, external: true };
    }
    return undefined;
  }
  // 服务端或需要打进 bundle 的客户端：统一走 deno-protocol，onLoad 里用 https URL fetch 后返回内容
  return { path: protocolPath, namespace: NAMESPACE_DENO_PROTOCOL };
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
  const {
    enabled = true,
    browserMode = false,
    // 服务端构建模式：默认为 true
    // 当为 true 时，npm:/jsr: 依赖直接标记为 external，让 Deno 在运行时解析
    // 当为 false 时，使用 moduleCache 从 Deno 缓存读取依赖并打包
    isServerBuild = true,
    moduleCache,
    // 排除路径（可选）：服务端构建模式下通常不需要
    excludePaths = [],
    // 项目目录：importer 在 node_modules 内时用此目录查找 deno.json
    projectDir,
    debug = false,
    logger: optionsLogger,
    forceRuntimeExternal = false,
    // 解析覆盖：如 solid-js/jsx-runtime -> shim 路径，在 package/subpath 解析时优先使用
    resolveOverrides,
  } = options;

  const log = optionsLogger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };

  return {
    name: "resolver",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 性能优化：deno.json 查找与解析在单次构建中会重复调用，缓存结果
      const denoJsonCache = new Map<string, string | undefined>();
      const configCache = new Map<string, DenoConfig | undefined>();
      const findDenoJson = (startDir: string): string | undefined => {
        let r = denoJsonCache.get(startDir);
        if (r === undefined) {
          r = findProjectDenoJson(startDir);
          denoJsonCache.set(startDir, r);
        }
        return r;
      };
      const getConfig = (path: string): DenoConfig | undefined => {
        let c = configCache.get(path);
        if (c === undefined) {
          c = getDenoConfig(path);
          configCache.set(path, c);
        }
        return c;
      };

      // 性能优化：CJS→ESM 重定向结果缓存，同一 pkgRoot 多次解析只读一次 package.json
      const cjsToEsmCache = new Map<string, string | undefined>();
      const getEsmIfCjsCached = async (
        localPath: string,
      ): Promise<string | undefined> => {
        const normalized = pathNormalize(localPath.replace(/\\/g, "/"));
        const cjsIdx = normalized.indexOf("/cjs/");
        if (cjsIdx === -1) return undefined;
        const pkgRoot = normalized.slice(0, cjsIdx);
        if (cjsToEsmCache.has(pkgRoot)) {
          return cjsToEsmCache.get(pkgRoot);
        }
        const result = await getNpmEsmEntryPathIfCjs(localPath);
        cjsToEsmCache.set(pkgRoot, result);
        return result;
      };

      // 处理 Node.js 内置模块（node:fs, node:path 等）
      // 使用 platform: "neutral" 时需要显式处理这些模块
      build.onResolve({ filter: /^node:/ }, (args) => {
        // 标记为 external，让运行时解析
        return { path: args.path, external: true };
      });

      // 排除匹配 excludePaths 的模块路径（仅在有配置时启用）
      // 这可以避免 esbuild 扫描测试目录或包管理器缓存中的损坏文件
      // 注意：服务端构建模式下通常不需要，因为 npm:/jsr: 依赖已标记为 external
      if (excludePaths.length > 0) {
        build.onResolve({ filter: /.*/ }, (args) => {
          // 需要检查的路径列表（包括导入路径、解析目录、导入者路径）
          const pathsToCheck = [
            args.path, // 导入路径
            args.resolveDir || "", // 解析目录
            args.importer || "", // 导入者路径
          ];

          // 检查任何路径是否匹配排除模式
          for (const pathToCheck of pathsToCheck) {
            if (!pathToCheck) continue;
            for (const excludePattern of excludePaths) {
              if (pathToCheck.includes(excludePattern)) {
                debugLog(
                  `排除路径匹配: ${pathToCheck} (模式: ${excludePattern})`,
                );
                return { path: args.path, external: true };
              }
            }
          }
          return undefined;
        });
      }

      /**
       * JSR/协议模块的 protocolPath → resolveDir 缓存。
       * 在 onLoad 成功加载 deno-protocol 模块时写入；
       * 在相对路径 onResolve 中优先用此缓存把 ../encryption/... 等解析到磁盘文件，
       * 避免子路径走“协议路径 + onLoad”时返回空内容导致 "has no exports"。
       */
      const protocolResolveDirCache = new Map<string, string>();

      /**
       * 子进程 resolve 结果缓存，避免同模块重复调用 deno eval import.meta.resolve。
       * Deno 工程不用 package.json，子路径（如 preact/jsx-runtime）由 Deno 的 import.meta.resolve 解析。
       */
      const runtimeResolveCache = new Map<string, string>();

      /**
       * 从预构建的模块缓存中查找本地路径
       * @param specifier - 模块 specifier（支持 jsr:、https://jsr.io/ 等格式）
       * @returns 本地文件路径，如果未找到返回 undefined
       */
      /** 路径是否指向 npm 包的 CJS 文件，统一用 / 判断避免漏掉 Windows 反斜杠 */
      function isCjsPath(localPath: string): boolean {
        return localPath.replace(/\\/g, "/").includes("/cjs/");
      }

      function getLocalPathFromCache(specifier: string): string | undefined {
        // 优先命中子进程 resolve 缓存
        const runtimeCached = runtimeResolveCache.get(specifier);
        if (runtimeCached && existsSync(runtimeCached)) {
          return runtimeCached;
        }
        if (!moduleCache) return undefined;

        // 直接查找
        let localPath = moduleCache.get(specifier);
        if (localPath && existsSync(localPath)) {
          return localPath;
        }

        // npm: 协议：deno info 可能存精确版本，用 @版本 再试（如 npm:react-dom@19.2.4）
        if (specifier.startsWith("npm:")) {
          const exactVersion = specifier.replace(/@\^/, "@").replace(/@~/, "@");
          if (exactVersion !== specifier) {
            localPath = moduleCache.get(exactVersion);
            if (localPath && existsSync(localPath)) {
              return localPath;
            }
          }

          // npm 子路径回退：deno info 可能只缓存主包，子路径如 preact/jsx-runtime 需从主包目录解析
          // 避免 onLoad 返回空内容导致 jsx-runtime 成空 stub、(void 0) is not a function
          const slashIdx = specifier.indexOf("/");
          if (slashIdx > 0) {
            const mainSpec = specifier.slice(0, slashIdx);
            const subpath = specifier.slice(slashIdx + 1);
            // 主包路径：deno info 可能用 npm:preact@10.28.3 或 npm:preact@^10.28.3，或 Windows 下其他格式
            let mainPath = moduleCache.get(mainSpec) ??
              moduleCache.get(mainSpec.replace(/@\^/, "@").replace(/@~/, "@"));
            if (!mainPath) {
              // 回退：遍历缓存找到同包任意条目（如 npm:preact@10.28.3 或 deno.land npm 格式）
              const pkgName = mainSpec.replace(/^npm:/, "").split("@")[0];
              for (const [k, v] of moduleCache.entries()) {
                if (
                  (k.startsWith(`npm:${pkgName}@`) ||
                    k.includes(`/${pkgName}@`)) &&
                  existsSync(v)
                ) {
                  mainPath = v;
                  break;
                }
              }
            }
            if (mainPath && existsSync(mainPath)) {
              const pkgRoot = dirname(mainPath);
              const subNorm = subpath.replace(/\\/g, "/");
              // 仅回退常见子路径模式；复杂子路径（如 preact/jsx-runtime）由 onLoad 内子进程 Deno import.meta.resolve 解析
              const candidates = [
                join(pkgRoot, subNorm + ".mjs"),
                join(pkgRoot, subNorm + ".js"),
                join(pkgRoot, subNorm, "index.mjs"),
                join(pkgRoot, subNorm, "index.js"),
              ];
              for (const cand of candidates) {
                if (existsSync(cand)) {
                  debugLog(
                    `getLocalPathFromCache npm 子路径: ${specifier} -> ${cand}`,
                  );
                  return cand;
                }
              }
            }
          }
        }

        // 对于 jsr: 协议，尝试转换为 https:// URL 格式查找
        if (specifier.startsWith("jsr:")) {
          // jsr:@scope/name@version/path -> https://jsr.io/@scope/name/version/path
          const afterJsr = specifier.slice(4);
          const lastAtIdx = afterJsr.lastIndexOf("@");
          if (lastAtIdx > 0) {
            const scopeAndName = afterJsr.slice(0, lastAtIdx);
            const versionAndPath = afterJsr.slice(lastAtIdx + 1);
            const slashIdx = versionAndPath.indexOf("/");
            let version = slashIdx === -1
              ? versionAndPath
              : versionAndPath.slice(0, slashIdx);
            const subpath = slashIdx === -1
              ? ""
              : versionAndPath.slice(slashIdx + 1);
            // 去掉版本号前缀 ^ 或 ~
            version = version.replace(/^[\^~]/, "");

            // 尝试多种路径变体
            const pathVariants: string[] = [];
            if (subpath) {
              // 原始路径
              pathVariants.push(`/${subpath}`);
              // 添加 src/ 前缀
              pathVariants.push(`/src/${subpath}`);
              // 尝试 .ts 扩展名
              if (!subpath.endsWith(".ts")) {
                pathVariants.push(`/${subpath}.ts`);
                pathVariants.push(`/src/${subpath}.ts`);
                // 尝试 /mod.ts 后缀（JSR 包常用模式）
                pathVariants.push(`/${subpath}/mod.ts`);
                pathVariants.push(`/src/${subpath}/mod.ts`);
                // 尝试 adapters 目录（渲染器常用模式）
                pathVariants.push(`/src/client/adapters/${subpath}.ts`);
              }
            } else {
              // 主入口
              pathVariants.push("/src/mod.ts");
              pathVariants.push("/mod.ts");
            }

            // 遍历所有路径变体尝试匹配
            for (const pathVariant of pathVariants) {
              const httpsUrl =
                `https://jsr.io/${scopeAndName}/${version}${pathVariant}`;
              localPath = moduleCache.get(httpsUrl);
              if (localPath && existsSync(localPath)) {
                debugLog(
                  `getLocalPathFromCache 转换 ${specifier} -> ${httpsUrl} -> ${localPath}`,
                );
                return localPath;
              }
            }

            // 如果以上都不匹配，遍历缓存查找包含该路径的条目
            const baseUrl = `https://jsr.io/${scopeAndName}/${version}/`;
            for (const [key, value] of moduleCache.entries()) {
              if (key.startsWith(baseUrl) && subpath) {
                // 检查缓存键是否以子路径结尾（忽略 src/ 前缀和扩展名差异）
                const keyPath = key.slice(baseUrl.length);
                const normalizedKey = keyPath.replace(/^src\//, "").replace(
                  /\.ts$/,
                  "",
                );
                const normalizedSubpath = subpath.replace(/\.ts$/, "");
                if (
                  normalizedKey.endsWith(normalizedSubpath) && existsSync(value)
                ) {
                  debugLog(
                    `getLocalPathFromCache 模糊匹配 ${specifier} -> ${key} -> ${value}`,
                  );
                  return value;
                }
              }
            }
          }
        }

        return undefined;
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
          const projectDenoJsonPath = findDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          // 从项目的 deno.json 的 imports 中查找路径别名
          const config = getConfig(projectDenoJsonPath);
          if (!config?.imports) {
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
                }
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

          return undefined;
        },
      );

      // 2. 处理直接的 jsr: 和 npm: 协议导入
      // 例如：import { x } from "jsr:@scope/package@^1.0.0-beta.1"
      // 例如：import { x } from "npm:esbuild@^0.27.2"
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        (args): esbuild.OnResolveResult | undefined => {
          // 服务端构建且非浏览器模式：直接标记为 external（path 保持 jsr:，Deno 运行时解析）
          if (isServerBuild && !browserMode) {
            debugLog(`服务端构建: 标记为 external: ${args.path}`);
            return { path: args.path, external: true };
          }
          // 浏览器模式：转为 CDN URL 并 external；或客户端打包：走 deno-protocol
          return resolveDenoProtocolPath(args.path, browserMode);
        },
      );

      // 2.5 匹配不带子路径的 @scope/package 模式
      // 例如：@dreamer/config、@dreamer/service
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const packageName = args.path;

          // 查找项目的 deno.json 文件
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir || cwd());
          const projectDenoJsonPath = findDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          const config = getConfig(projectDenoJsonPath);
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
            config,
          );

          if (!packageImport) {
            return undefined;
          }

          // 服务端构建且非浏览器模式：如果是 jsr:/npm: 协议，直接标记为 external
          if (
            isServerBuild &&
            !browserMode &&
            (packageImport.startsWith("jsr:") ||
              packageImport.startsWith("npm:"))
          ) {
            debugLog(`服务端构建: 标记为 external: ${packageImport}`);
            return { path: packageImport, external: true };
          }

          // 浏览器模式或客户端构建：使用原有逻辑（CDN URL 或 deno-protocol）
          return resolveDenoProtocolPath(packageImport, browserMode);
        },
      );

      // 3. 匹配带有子路径的 @scope/package/subpath 模式
      // 例如：@dreamer/logger/client
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
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
          const projectDenoJsonPath = findDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          const config = getConfig(projectDenoJsonPath);
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
            config,
          );

          if (!packageImport) {
            return undefined;
          }

          // 拼接子路径到导入路径
          // 例如：jsr:@scope/package@^1.0.0-beta.1 + /client -> jsr:@scope/package@^1.0.0-beta.1/client
          // 例如：npm:lodash@^4.17.21 + /map -> npm:lodash@^4.17.21/map
          const subpath = subpathParts.join("/");
          const fullProtocolPath = `${packageImport}/${subpath}`;

          // 服务端构建且非浏览器模式：如果是 jsr:/npm: 协议，直接标记为 external
          if (
            isServerBuild &&
            !browserMode &&
            (packageImport.startsWith("jsr:") ||
              packageImport.startsWith("npm:"))
          ) {
            debugLog(`服务端构建: 标记为 external: ${fullProtocolPath}`);
            return { path: fullProtocolPath, external: true };
          }

          // 浏览器模式或客户端构建：使用原有逻辑
          return resolveDenoProtocolPath(fullProtocolPath, browserMode);
        },
      );

      // 3.1 匹配不带子路径的普通包名（非 @scope/ 前缀）
      // 例如：preact、lodash、react、scheduler
      // 这些包需要在 deno.json 的 imports 中配置为 npm:package@version
      // importer 在 node_modules 内时（如 react-dom 内 require('react')）用 projectDir 或 cwd() 查找项目 deno.json
      // 客户端构建时：preact/react 必须始终从 projectDir 解析，避免 JSR 缓存内的包（如 @dreamer/render）使用其自身 deno.json 导致多实例水合错误 _H
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const packageName = args.path;

          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePackage = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && isRuntimePackage && projectDir);
          const startDir = useProjectDir
            ? (projectDir || cwd())
            : (args.resolveDir ||
              (args.importer ? dirname(args.importer) : cwd()));
          const projectDenoJsonPath = findDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          const config = getConfig(projectDenoJsonPath);
          const packageImport = getPackageImport(
            projectDenoJsonPath,
            packageName,
            config,
          );

          if (!packageImport) {
            return undefined;
          }

          // 调试：react/preact 解析路径（便于排查 createElement 互操作问题）
          if (isRuntimePackage) {
            debugLog(
              `[react/preact] resolver: pkg=${packageName} ` +
                `projectDir=${projectDir ?? "null"} startDir=${startDir} ` +
                `denoJson=${projectDenoJsonPath} import=${packageImport} ` +
                `importer=${args.importer?.slice(0, 80) ?? "null"}`,
            );
          }

          // 服务端构建且非浏览器模式：如果是 jsr:/npm: 协议，直接标记为 external
          if (
            isServerBuild &&
            !browserMode &&
            (packageImport.startsWith("jsr:") ||
              packageImport.startsWith("npm:"))
          ) {
            debugLog(`服务端构建: 标记为 external: ${packageImport}`);
            return { path: packageImport, external: true };
          }

          // 双构建场景：chunk 构建时 preact/react 标为 external，由 import map 解析到主包
          if (forceRuntimeExternal && isRuntimePackage) {
            debugLog(`forceRuntimeExternal: 标记为 external: ${args.path}`);
            return { path: args.path, external: true };
          }

          // 客户端构建时 preact/react 必须打包进 bundle，不能 external
          // 根因：SSR 用 Deno 缓存的 npm:preact，若客户端从 esm.sh 加载则构建不一致，水合 __H 未定义
          const effectiveBrowserMode =
            isServerBuild === false && isRuntimePackage ? false : browserMode;
          return resolveDenoProtocolPath(packageImport, effectiveBrowserMode);
        },
      );

      // 3.2 匹配带子路径的普通包名（非 @scope/ 前缀）
      // 例如：preact/jsx-runtime、lodash/map、react/jsx-runtime
      // importer 在 node_modules 内时用 projectDir 或 cwd() 查找项目 deno.json（同 3.1）
      // 客户端构建时：preact/*、react/* 必须始终从 projectDir 解析，避免多实例水合错误 _H
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;

          // 优先使用 resolveOverrides（如 solid-js/jsx-runtime -> shim），避免走 npm 包解析
          if (resolveOverrides && resolveOverrides[path]) {
            const overridePath = resolveOverrides[path];
            debugLog(`resolveOverrides: ${path} -> ${overridePath}`);
            return { path: overridePath, namespace: "file" };
          }

          const slashIndex = path.indexOf("/");
          const packageName = path.slice(0, slashIndex);
          const subpath = path.slice(slashIndex + 1);

          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePackage = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && isRuntimePackage && projectDir);
          const startDir = useProjectDir
            ? (projectDir || cwd())
            : (args.resolveDir ||
              (args.importer ? dirname(args.importer) : cwd()));
          const projectDenoJsonPath = findDenoJson(startDir);

          if (!projectDenoJsonPath) {
            return undefined;
          }

          const config = getConfig(projectDenoJsonPath);
          // 先尝试完整路径匹配（如 preact/jsx-runtime）
          let packageImport = getPackageImport(
            projectDenoJsonPath,
            path,
            config,
          );

          // 如果完整路径没有匹配，尝试主包名
          if (!packageImport) {
            packageImport = getPackageImport(
              projectDenoJsonPath,
              packageName,
              config,
            );
            if (packageImport) {
              // 拼接子路径
              packageImport = `${packageImport}/${subpath}`;
            }
          }

          if (!packageImport) {
            return undefined;
          }

          // 调试：react/preact 子路径解析（便于排查 createElement 互操作问题）
          if (isRuntimePackage) {
            debugLog(
              `[react/preact] subpath resolver: ${path} ` +
                `projectDir=${projectDir ?? "null"} startDir=${startDir} ` +
                `denoJson=${projectDenoJsonPath} import=${packageImport} ` +
                `importer=${args.importer?.slice(0, 80) ?? "null"}`,
            );
          }

          // 服务端构建且非浏览器模式：如果是 jsr:/npm: 协议，直接标记为 external
          if (
            isServerBuild &&
            !browserMode &&
            (packageImport.startsWith("jsr:") ||
              packageImport.startsWith("npm:"))
          ) {
            debugLog(`服务端构建: 标记为 external: ${packageImport}`);
            return { path: packageImport, external: true };
          }

          // 双构建场景：chunk 构建时 preact/*、react/* 标为 external
          if (forceRuntimeExternal && isRuntimePackage) {
            debugLog(`forceRuntimeExternal: 标记为 external: ${args.path}`);
            return { path: args.path, external: true };
          }

          // 客户端构建时 preact/*、react/* 必须打包进 bundle，不能 external
          const effectiveBrowserModeSubpath = isServerBuild === false &&
              isRuntimePackage
            ? false
            : browserMode;
          return resolveDenoProtocolPath(
            packageImport,
            effectiveBrowserModeSubpath,
          );
        },
      );

      // 3.3 处理 deno-protocol namespace 中的相对路径导入
      // 当文件内部有相对路径导入（如 ../encryption/encryption-manager.ts）时，
      // 需要从文件的 resolveDir 解析这些相对路径
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          // 相对路径导入，需要从 importer 的目录解析
          // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@^1.0.0-beta.2/client
          // 需要先提取协议路径（去掉 deno-protocol: 前缀），然后解析为实际文件路径
          const importer = args.importer;
          if (!importer) {
            return undefined;
          }

          try {
            // 提取协议路径（去掉 deno-protocol: 前缀）
            let protocolPath = importer;
            const protocolPrefix = `${NAMESPACE_DENO_PROTOCOL}:`;
            if (importer.startsWith(protocolPrefix)) {
              protocolPath = importer.slice(protocolPrefix.length);
            }

            // 优先用 onLoad 已缓存的 resolveDir 从磁盘解析，避免子路径走 deno-protocol onLoad 返回空内容导致 "has no exports"
            const cachedDir = protocolResolveDirCache.get(protocolPath);
            if (cachedDir) {
              let resolvedPath = join(cachedDir, args.path);
              if (existsSync(resolvedPath)) {
                // 客户端构建：相对路径指向 npm 包内 /cjs/ 时重定向到 ESM，避免 require('react') 导致运行时报错
                if (
                  !isServerBuild &&
                  isCjsPath(resolvedPath)
                ) {
                  const esmPath = await getEsmIfCjsCached(resolvedPath);
                  if (esmPath) {
                    debugLog(
                      `[CJS→ESM] 相对路径解析重定向: ${resolvedPath} -> ${esmPath}`,
                    );
                    resolvedPath = esmPath;
                  }
                }
                return { path: resolvedPath, namespace: "file" };
              }
              // 无扩展名时尝试 .ts
              if (!resolvedPath.includes(".")) {
                const withTs = resolvedPath + ".ts";
                if (existsSync(withTs)) {
                  return { path: withTs, namespace: "file" };
                }
              }
            }

            // 在插件上下文中 import.meta.resolve 用的是 esbuild 的 deno.json，拿不到项目的 file://，只做一次
            let importerUrl: string | undefined;
            try {
              importerUrl = await import.meta.resolve(protocolPath);
            } catch {
              // 忽略
            }

            if (importerUrl && importerUrl.startsWith("file://")) {
              const importerPath = fileUrlToPath(importerUrl);

              if (existsSync(importerPath)) {
                // 从 importer 的目录解析相对路径
                const importerDir = dirname(importerPath);
                let resolvedPath = join(importerDir, args.path);

                if (existsSync(resolvedPath)) {
                  // 客户端构建：解析结果指向 npm 包内 /cjs/ 时重定向到 ESM
                  if (
                    !isServerBuild &&
                    isCjsPath(resolvedPath)
                  ) {
                    const esmPath = await getEsmIfCjsCached(resolvedPath);
                    if (esmPath) {
                      debugLog(
                        `[CJS→ESM] 相对路径解析重定向: ${resolvedPath} -> ${esmPath}`,
                      );
                      resolvedPath = esmPath;
                    }
                  }
                  return {
                    path: resolvedPath,
                    namespace: "file",
                  };
                }
              }
            } else if (
              importerUrl &&
              (importerUrl.startsWith("https://") ||
                importerUrl.startsWith("http://"))
            ) {
              // 如果 importer 是 HTTP URL，从 HTTP URL 解析相对路径
              // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/client/mod.ts
              // + ../encryption/encryption-manager.ts
              // -> https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
              try {
                const importerUrlObj = new URL(importerUrl);
                const importerPathname = importerUrlObj.pathname;
                const importerDir = importerPathname.substring(
                  0,
                  importerPathname.lastIndexOf("/"),
                );
                const resolvedPathname = new URL(
                  args.path,
                  `${importerUrlObj.protocol}//${importerUrlObj.host}${importerDir}/`,
                ).pathname;

                // 返回一个 deno-protocol namespace 的结果，让 onLoad 钩子来处理
                // 但是，我们需要构建一个协议路径，而不是直接使用 HTTP URL
                // 尝试从 HTTP URL 推断协议路径
                // 例如：https://jsr.io/@dreamer/socket-io/1.0.0-beta.2/src/encryption/encryption-manager.ts
                // -> jsr:@dreamer/socket-io@^1.0.0-beta.2/encryption/encryption-manager.ts
                const match = importerPathname.match(
                  /\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/,
                );
                if (match) {
                  const [, packageName, version] = match;
                  // 从 importer 路径推断相对路径的协议路径
                  const relativeMatch = resolvedPathname.match(
                    /\/@dreamer\/([^\/]+)\/([^\/]+)\/(.+)/,
                  );
                  if (relativeMatch) {
                    const [, , , relativePath] = relativeMatch;
                    // 移除 src/ 前缀（如果存在）
                    const normalizedPath = relativePath.replace(/^src\//, "");
                    const fullProtocolPath =
                      `jsr:@dreamer/${packageName}@${version}/${normalizedPath}`;
                    // 返回 deno-protocol namespace，让 onLoad 钩子来处理
                    return {
                      path: fullProtocolPath,
                      namespace: NAMESPACE_DENO_PROTOCOL,
                    };
                  }
                }
              } catch {
                // 忽略错误
              }
            }

            // 如果无法通过文件路径解析，尝试构建完整的协议路径
            // 例如：jsr:@dreamer/socket-io@^1.0.0-beta.2/client + ./socket.ts -> .../client/socket.ts
            // 例如：jsr:@dreamer/socket-io@^1.0.0-beta.2/client + ../encryption/encryption-manager.ts -> .../encryption/encryption-manager.ts
            try {
              // 从 importer 路径构建相对路径的协议路径
              // importer 可能是 deno-protocol:jsr:@dreamer/socket-io@^1.0.0-beta.2/client（子路径即“目录”）
              let importerProtocolPath = importer;
              const prefix = `${NAMESPACE_DENO_PROTOCOL}:`;
              if (importerProtocolPath.startsWith(prefix)) {
                importerProtocolPath = importerProtocolPath.slice(
                  prefix.length,
                );
              }
              // 基准路径：若 importer 为文件（最后一段含扩展名如 .ts），则用其所在目录；否则用完整路径（子路径如 client 对应 mod 所在目录）
              const lastSegment = importerProtocolPath.replace(/.*\//, "");
              const isFile = lastSegment.includes(".");
              let currentBasePath = isFile
                ? importerProtocolPath.replace(/\/[^/]+$/, "")
                : importerProtocolPath;
              const relativePath = args.path;

              // 规范化相对路径（处理 ../ 和 ./）
              let normalizedPath = relativePath;
              let depth = 0;
              while (normalizedPath.startsWith("../")) {
                normalizedPath = normalizedPath.slice(3);
                depth++;
              }
              if (normalizedPath.startsWith("./")) {
                normalizedPath = normalizedPath.slice(2);
              }

              // 仅对 ../ 向上回退：每层 ../ 从 currentBasePath 去掉最后一段
              // 例如 jsr:.../client，depth=1 -> jsr:...@1.0.0-beta.2
              for (let i = 0; i < depth; i++) {
                currentBasePath = currentBasePath.replace(/\/[^/]+$/, "");
              }

              const fullProtocolPath = `${currentBasePath}/${normalizedPath}`;

              // 在插件上下文中只做一次 resolve，拿不到 file:// 就返回 deno-protocol 交给 onLoad（含 fetchJsrSourceViaMeta）
              try {
                let resolvedProtocolUrl: string | undefined;
                try {
                  resolvedProtocolUrl = await import.meta.resolve(
                    fullProtocolPath,
                  );
                } catch {
                  // 忽略
                }

                if (
                  resolvedProtocolUrl &&
                  resolvedProtocolUrl.startsWith("file://")
                ) {
                  const resolvedProtocolPath = fileUrlToPath(
                    resolvedProtocolUrl,
                  );

                  if (existsSync(resolvedProtocolPath)) {
                    let pathToReturn = resolvedProtocolPath;
                    if (
                      !isServerBuild &&
                      isCjsPath(resolvedProtocolPath)
                    ) {
                      const esmPath = await getEsmIfCjsCached(
                        resolvedProtocolPath,
                      );
                      if (esmPath) {
                        debugLog(
                          `[CJS→ESM] 相对路径解析重定向: ${resolvedProtocolPath} -> ${esmPath}`,
                        );
                        pathToReturn = esmPath;
                      }
                    }
                    return {
                      path: pathToReturn,
                      namespace: "file",
                    };
                  }
                }
                // 未得到 file:// 或本地文件不存在时，一律返回 deno-protocol，由 onLoad 用 fetchJsrSourceViaMeta 等拉取
                return {
                  path: fullProtocolPath,
                  namespace: NAMESPACE_DENO_PROTOCOL,
                };
              } catch {
                // 若上述流程抛错，仍返回 deno-protocol，让 onLoad 尝试拉取
                return {
                  path: fullProtocolPath,
                  namespace: NAMESPACE_DENO_PROTOCOL,
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

      // 3.4 file namespace 下相对路径指向 /cjs/ 时重定向到 ESM（路径先规范化，避免 ./ 堆积导致重复解析）
      build.onResolve(
        { filter: /^\.\.?\/.*/, namespace: "file" },
        async (args): Promise<esbuild.OnResolveResult | undefined> => {
          if (isServerBuild) return undefined;
          const importer = args.importer;
          if (!importer) return undefined;
          const resolvedPath = pathNormalize(
            join(dirname(importer), args.path),
          );
          if (!existsSync(resolvedPath)) return undefined;
          if (!isCjsPath(resolvedPath)) return undefined;
          const esmPath = await getEsmIfCjsCached(resolvedPath);
          if (!esmPath) return undefined;
          debugLog(
            `[CJS→ESM] file 相对路径重定向: ${resolvedPath} -> ${esmPath}`,
          );
          return { path: esmPath, namespace: "file" };
        },
      );

      // 3.5 兜底的 onResolve 钩子：阻止 esbuild 使用默认的模块解析算法
      // 当所有其他 onResolve 钩子都无法处理模块时，这个钩子会拦截并标记为 external
      // 这可以防止 esbuild 向上遍历目录查找 node_modules（可能扫描到 .bun/install 等全局缓存）
      // 注意：这个钩子只处理 file namespace（默认 namespace）中未被处理的模块
      build.onResolve({ filter: /.*/ }, (args) => {
        // 跳过已经被处理的 namespace（如 deno-protocol）
        if (args.namespace && args.namespace !== "file") {
          return undefined;
        }

        // 跳过入口文件
        if (args.kind === "entry-point") {
          return undefined;
        }

        // 跳过相对路径导入（./xxx 或 ../xxx），这些应该由 esbuild 正常解析
        if (args.path.startsWith("./") || args.path.startsWith("../")) {
          return undefined;
        }

        // 跳过绝对路径
        if (args.path.startsWith("/")) {
          return undefined;
        }

        // 对于其他未被处理的模块（如 node_modules 中的包），标记为 external
        // 这可以防止 esbuild 尝试解析它们，避免扫描全局缓存目录
        debugLog(
          `兜底 onResolve: 将未知模块标记为 external: ${args.path} (kind=${args.kind}, importer=${args.importer})`,
        );
        return { path: args.path, external: true };
      });

      // 4. 添加 onLoad 钩子来处理 deno-protocol namespace 的模块加载
      // 统一处理 jsr: 和 npm: 协议的模块加载
      build.onLoad(
        { filter: /.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;
          debugLog(`onLoad 入参 protocolPath=${protocolPath}`);

          try {
            // 步骤 0: 优先从预构建的模块缓存中查找本地路径
            // 如果 moduleCache 存在，直接使用缓存中的本地文件路径，避免启动子进程或发送 HTTP 请求
            let cachedLocalPath = getLocalPathFromCache(protocolPath);
            if (cachedLocalPath) {
              // 客户端构建且为 npm 包时，若解析到 CJS 入口则改用 ESM，避免 "Dynamic require is not supported"
              if (
                protocolPath.startsWith("npm:") &&
                !isServerBuild &&
                isCjsPath(cachedLocalPath)
              ) {
                const esmPath = await getEsmIfCjsCached(cachedLocalPath);
                if (esmPath) {
                  debugLog(
                    `[CJS→ESM] ${protocolPath} 重定向: ${cachedLocalPath} -> ${esmPath}`,
                  );
                  cachedLocalPath = esmPath;
                }
              }
              const contents = await readTextFile(cachedLocalPath);
              const resolveDir = dirname(cachedLocalPath);
              protocolResolveDirCache.set(protocolPath, resolveDir);
              const loader = getLoaderFromPath(cachedLocalPath);
              debugLog(
                `onLoad 从预构建缓存获取 ${protocolPath} -> ${cachedLocalPath} (${contents.length} chars)`,
              );
              return { contents, loader, resolveDir };
            }

            // 步骤 1: 先使用动态导入触发 Deno 下载和缓存模块
            // 这会确保模块被下载到 Deno 缓存中（适用于 jsr: 和 npm:）
            try {
              await import(protocolPath);
            } catch {
              // 忽略导入错误，可能模块已经加载
            }

            // 步骤 2～3: 在插件上下文中 import.meta.resolve 用的是 esbuild 的 deno.json，拿不到项目的 file://，
            // 只做一次 resolve，拿不到就交给步骤 3.5 子进程在项目目录下解析
            let fileUrl: string | undefined;
            try {
              fileUrl = await import.meta.resolve(protocolPath);
              debugLog(
                `onLoad import.meta.resolve 结果 fileUrl=${
                  fileUrl ?? "undefined"
                }`,
              );
            } catch {
              // 忽略
            }

            // 步骤 3.5: 插件里 import.meta.resolve 用的是 esbuild 的上下文，拿不到项目的 deno.json；
            // 若未得到 file://，在项目目录下起子进程做 resolve，用项目的 deno.json 得到真实 file://
            if (!fileUrl || !fileUrl.startsWith("file://")) {
              debugLog("onLoad 未得到 file://，尝试子进程 resolve");
              try {
                const projectDir =
                  (build.initialOptions.absWorkingDir as string | undefined) ||
                  cwd();
                const projectDenoJson = findProjectDenoJson(projectDir);
                const proc = createCommand("deno", {
                  args: [
                    "eval",
                    ...(projectDenoJson ? ["--config", projectDenoJson] : []),
                    "const u=await import.meta.resolve(Deno.args[0]);console.log(u);",
                    protocolPath,
                  ],
                  cwd: projectDir,
                  stdout: "piped",
                  stderr: "piped",
                });
                const out = await proc.output();
                if (out.success && out.stdout && out.stdout.length > 0) {
                  const line = new TextDecoder().decode(out.stdout).trim();
                  if (line.startsWith("file://")) {
                    fileUrl = line;
                    debugLog(`onLoad 子进程 resolve 得到 fileUrl=${fileUrl}`);
                  }
                }
              } catch {
                // 忽略
              }
            }

            // 步骤 4: 如果 resolve 返回 file:// URL，读取文件内容
            if (fileUrl && fileUrl.startsWith("file://")) {
              let filePath = fileUrlToPath(fileUrl);
              runtimeResolveCache.set(protocolPath, filePath);

              // 客户端构建且为 npm 包时，若解析到 CJS 文件则改用 ESM 入口
              if (
                protocolPath.startsWith("npm:") &&
                !isServerBuild &&
                isCjsPath(filePath)
              ) {
                const esmPath = await getEsmIfCjsCached(filePath);
                if (esmPath) {
                  debugLog(
                    `[CJS→ESM] ${protocolPath} 重定向: ${filePath} -> ${esmPath}`,
                  );
                  filePath = esmPath;
                }
              }

              // 设置 resolveDir 为文件所在目录，以便 esbuild 能解析文件内部的相对路径导入
              // 即使文件不存在，也要设置 resolveDir，这样 esbuild 才能正确解析相对路径
              const resolveDir = dirname(filePath);
              protocolResolveDirCache.set(protocolPath, resolveDir);

              if (existsSync(filePath)) {
                const contents = await readTextFile(filePath);
                debugLog(
                  `onLoad 分支 file:// 文件存在 path=${filePath} contentsLen=${contents.length}`,
                );
                // 根据文件扩展名确定 loader
                const loader = getLoaderFromPath(filePath);
                return {
                  contents,
                  loader,
                  resolveDir,
                };
              }
              debugLog(
                `onLoad 分支 file:// 文件不存在 path=${filePath}，对 jsr: 尝试 fetchJsrSourceViaMeta`,
              );
              // 文件不存在（如 Windows 缓存路径与当前解析不一致、跨机器、缓存已清理）
              if (protocolPath.startsWith("jsr:")) {
                // 对 jsr: 回退到 fetchJsrSourceViaMeta
                const contents = await fetchJsrSourceViaMeta(
                  protocolPath,
                  debug,
                  log,
                );
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  return { contents, loader, resolveDir };
                }
              } else if (protocolPath.startsWith("npm:")) {
                // 对 npm: 尝试子进程在项目目录下 resolve，可拿到项目/工作区正确的缓存路径（如 Windows monorepo 下示例与根目录缓存不一致）
                try {
                  const projectDir = (build.initialOptions.absWorkingDir as
                    | string
                    | undefined) ||
                    cwd();
                  const projectDenoJson = findProjectDenoJson(projectDir);
                  const proc = createCommand("deno", {
                    args: [
                      "eval",
                      ...(projectDenoJson ? ["--config", projectDenoJson] : []),
                      "const u=await import.meta.resolve(Deno.args[0]);console.log(u);",
                      protocolPath,
                    ],
                    cwd: projectDir,
                    stdout: "piped",
                    stderr: "piped",
                  });
                  const out = await proc.output();
                  if (out.success && out.stdout && out.stdout.length > 0) {
                    const line = new TextDecoder().decode(out.stdout).trim();
                    if (line.startsWith("file://")) {
                      const altPath = fileUrlToPath(line);
                      if (existsSync(altPath)) {
                        const contents = await readTextFile(altPath);
                        const altResolveDir = dirname(altPath);
                        debugLog(
                          `onLoad npm: 子进程 resolve 回退成功 path=${altPath} contentsLen=${contents.length}`,
                        );
                        const loader = getLoaderFromPath(altPath);
                        return { contents, loader, resolveDir: altResolveDir };
                      }
                    }
                  }
                } catch {
                  /* ignore */
                }
                debugLog(
                  `onLoad npm: 子进程 resolve 回退失败，返回空内容 protocolPath=${protocolPath}`,
                );
              }
              // 最终回退：返回空内容（可能导致构建失败）
              const loader = getLoaderFromPath(filePath);
              return {
                contents: "",
                loader,
                resolveDir,
              };
            } else if (
              fileUrl &&
              (fileUrl.startsWith("https://") || fileUrl.startsWith("http://"))
            ) {
              debugLog(`onLoad 分支 https fileUrl=${fileUrl}`);
              // 步骤 5: 如果 resolve 返回 HTTP URL
              // 对 jsr: 优先用 fetchJsrSourceViaMeta（内部带 Accept: JSR_ACCEPT_SOURCE），避免运行时自动加 Sec-Fetch-Dest: document 导致 JSR 仍回 HTML
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(
                  protocolPath,
                  debug,
                  log,
                );
                debugLog(
                  `onLoad 步骤5(https+jsr) fetchJsrSourceViaMeta 结果 contents=${
                    contents != null ? `${contents.length} chars` : "null"
                  }`,
                );
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  // 不设 resolveDir：否则 esbuild 会把模块内 "./socket" 等解析为 cwd()/socket，加载到项目文件导致 "No matching export"
                  return { contents, loader };
                }
              }
              // 非 jsr: 或 fetchJsr 失败时：直接 fetch，带 Accept 避免 JSR 回 HTML
              try {
                const response = await fetch(fileUrl, {
                  headers: { Accept: JSR_ACCEPT_SOURCE },
                });
                if (response.ok) {
                  const contents = await response.text();
                  if (!contents.trimStart().startsWith("<")) {
                    const loader = getLoaderFromPath(fileUrl);
                    const resolveDir = cwd();
                    return {
                      contents,
                      loader,
                      resolveDir,
                    };
                  }
                }
              } catch {
                // 忽略 fetch 错误
              }
            } else if (
              fileUrl &&
              (fileUrl.startsWith("jsr:") || fileUrl.startsWith("npm:"))
            ) {
              debugLog(`onLoad 分支 fileUrl=jsr/npm fileUrl=${fileUrl}`);
              // 步骤 6: 子进程也未得到 file:// 时，用 JSR _meta.json 的 manifest/exports 解析真实路径再 fetch 源码（非 CDN）
              if (protocolPath.startsWith("jsr:")) {
                const contents = await fetchJsrSourceViaMeta(
                  protocolPath,
                  debug,
                  log,
                );
                debugLog(
                  `onLoad 步骤6 fetchJsrSourceViaMeta 结果 contents=${
                    contents != null ? `${contents.length} chars` : "null"
                  }`,
                );
                if (contents != null) {
                  const loader = getLoaderFromPath(protocolPath);
                  // 不设 resolveDir，相对导入走 deno-protocol onResolve
                  return { contents, loader };
                }
              }
              debugLog(
                "onLoad 步骤6 返回空内容 (fileUrl=jsr/npm 且 fetchJsr 为 null)",
              );
              const loader = getLoaderFromPath(protocolPath);
              return { contents: "", loader };
            }

            // 如果所有方法都失败，至少设置 resolveDir
            debugLog(
              `onLoad 落入最终分支 返回空内容 fileUrl=${
                fileUrl ?? "undefined"
              }`,
            );
            // 这样 esbuild 才能正确解析文件内部的相对路径导入
            const resolveDir = cwd();
            protocolResolveDirCache.set(protocolPath, resolveDir);
            const loader = getLoaderFromPath(protocolPath);
            return {
              contents: "",
              loader,
              resolveDir,
            };
          } catch {
            return undefined;
          }
        },
      );
    },
  };
}
