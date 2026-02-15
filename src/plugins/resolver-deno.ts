/**
 * @module @dreamer/esbuild/plugins/resolver
 *
 * 统一模块解析插件（Deno）：仅用本项目 deno.json 依赖图 + 本地缓存，不走网络。
 * - 路径别名、bare specifier 从项目 deno.json 解析
 * - jsr:/npm 从预构建 moduleCache 查找（先精确 get，未命中则正则匹配 key）
 * - 相对路径：importer 在 cache 则 base = dirname(pathWithinPackage)，再 cacheLookup 目标
 */

import {
  createCommand,
  cwd,
  dirname,
  existsSync,
  join,
  readTextFile,
  readTextFileSync,
  resolve,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import type { BuildLogger } from "../types.ts";

const PREFIX = "[resolver-deno]";

/** 将 file:// URL 转为本地文件系统路径 */
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

const NOOP_LOGGER: BuildLogger = {
  debug: () => {},
  info: () => {},
};

/** 模块缓存：specifier → 本地绝对路径（仅本项目依赖图内的模块） */
export type ModuleCache = Map<string, string>;

interface DenoInfoModule {
  kind: string;
  specifier: string;
  local?: string;
  dependencies?: Array<
    {
      specifier: string;
      code?: { specifier: string };
      type?: { specifier: string };
    }
  >;
}

interface DenoInfoOutput {
  version: number;
  roots: string[];
  modules: DenoInfoModule[];
}

/**
 * 在项目目录、项目 deno.json 下执行 deno info，仅将本依赖图内的模块写入 cache。
 * 不扫全局缓存；npm 无 local 时仅在此时用子进程 import.meta.resolve 补全。
 */
export async function buildModuleCache(
  entryPoint: string,
  projectDir?: string,
  debug = false,
  logger?: BuildLogger,
): Promise<ModuleCache> {
  const cache: ModuleCache = new Map();
  const workDir = projectDir ?? cwd();
  const log = logger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };
  debugLog(`buildModuleCache 开始: entry=${entryPoint}, workDir=${workDir}`);

  const projectDenoJson = findProjectDenoJson(workDir);
  const configArgs = projectDenoJson ? ["--config", projectDenoJson] : [];

  try {
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
    if (!stdout.trim()) return cache;

    const info = JSON.parse(stdout) as DenoInfoOutput;
    const npmToResolve = new Set<string>();

    for (const mod of info.modules) {
      if (!mod.specifier) continue;
      if (mod.local) cache.set(mod.specifier, mod.local);

      const jsrMatch = mod.specifier.match(
        /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\/(.+)$/,
      );
      if (jsrMatch) {
        const [, scopeAndName, version, path] = jsrMatch;
        const jsrKey = `jsr:${scopeAndName}@${version}/${path}`;
        if (mod.local) {
          cache.set(jsrKey, mod.local);
          debugLog(`buildModuleCache 添加: ${jsrKey} -> ${mod.local}`);
        }
      } else if (mod.specifier.startsWith("npm:")) {
        const spec = mod.specifier.replace(/^npm:\/+/, "npm:");
        npmToResolve.add(spec);
        if (mod.local) cache.set(spec, mod.local);
      }
    }

    for (const spec of npmToResolve) {
      if (cache.has(spec)) continue;
      try {
        const procNpm = createCommand("deno", {
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
        const out = await procNpm.output();
        if (out.success && out.stdout) {
          const line = new TextDecoder().decode(out.stdout).trim();
          if (line.startsWith("file://")) {
            const localPath = fileUrlToPath(line);
            if (existsSync(localPath)) {
              cache.set(spec, localPath);
              debugLog(`buildModuleCache npm: ${spec} -> ${localPath}`);
            }
          }
        }
      } catch {
        debugLog(`buildModuleCache npm resolve 失败: ${spec}`);
      }
    }

    debugLog(`buildModuleCache 完成: ${cache.size} 个模块`);
  } catch (e) {
    debugLog(`buildModuleCache 错误: ${e}`);
  }
  return cache;
}

export interface ResolverOptions {
  enabled?: boolean;
  browserMode?: boolean;
  isServerBuild?: boolean;
  moduleCache?: ModuleCache;
  excludePaths?: string[];
  projectDir?: string;
  debug?: boolean;
  logger?: BuildLogger;
  forceRuntimeExternal?: boolean;
  resolveOverrides?: Record<string, string>;
}

interface DenoConfig {
  imports?: Record<string, string>;
}

const NAMESPACE_DENO_PROTOCOL = "deno-protocol";

/** 是否为 SSR/水合相关的运行时包（客户端必须打包进 bundle，不能 external，否则与 SSR 实例不一致） */
function isClientRuntimeSpec(specifier: string): boolean {
  return (
    /^npm:(preact|react)(@|\/|$)/.test(specifier) ||
    /^(npm|jsr):@dreamer\/view(@|\/|$)/.test(specifier)
  );
}

function getDenoConfig(denoJsonPath: string): DenoConfig | undefined {
  try {
    const content = readTextFileSync(denoJsonPath);
    return JSON.parse(content) as DenoConfig;
  } catch {
    return undefined;
  }
}

/** 根据文件路径或 cache key（含扩展名）确定 esbuild loader */
function getLoaderFromPath(filePathOrKey: string): "ts" | "tsx" | "js" | "jsx" {
  if (filePathOrKey.endsWith(".tsx") || filePathOrKey.endsWith(".jsx")) {
    return "tsx";
  }
  if (filePathOrKey.endsWith(".ts") || filePathOrKey.endsWith(".mts")) {
    return "ts";
  }
  if (filePathOrKey.endsWith(".js") || filePathOrKey.endsWith(".mjs")) {
    return "js";
  }
  return "ts";
}

function findProjectDenoJson(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const p = join(currentDir, "deno.json");
    if (existsSync(p)) return p;
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return undefined;
}

/** 从项目 deno.json 的 imports 解析 bare 包名或带子路径（如 @dreamer/logger、@dreamer/logger/client） */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
  config?: DenoConfig,
): string | undefined {
  const c = config ?? getDenoConfig(projectDenoJsonPath);
  if (!c?.imports) return undefined;
  const val = c.imports[packageName];
  if (typeof val === "string") return val;
  const slashIdx = packageName.indexOf("/", packageName.indexOf("/") + 1);
  if (slashIdx > 0) {
    const base = packageName.slice(0, slashIdx);
    const subpath = packageName.slice(slashIdx + 1);
    const baseVal = c.imports[base];
    if (typeof baseVal === "string") return `${baseVal}/${subpath}`;
  }
  return undefined;
}

function convertSpecifierToBrowserUrl(specifier: string): string | null {
  if (specifier.startsWith("npm:")) {
    return `https://esm.sh/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("jsr:")) {
    return `https://esm.sh/jsr/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("http:") || specifier.startsWith("https:")) {
    return specifier;
  }
  return null;
}

/**
 * 解析 jsr: 协议路径为 packageBase + pathWithinPackage
 */
function parseJsrPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  if (!protocolPath.startsWith("jsr:")) return null;
  const after = protocolPath.slice(4);
  const match = after.match(/^(@[^/]+\/[^/]+\@[^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return {
    packageBase: "jsr:" + match[1],
    pathWithinPackage: match[2] ?? "",
  };
}

/**
 * 解析 npm: 协议路径为 packageBase + pathWithinPackage（如 npm:preact@10.28.3/jsx-runtime）
 * 用于 preact/hooks、preact/jsx-runtime 等子路径中的 ../ 解析到主包，保证单例
 */
function parseNpmPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  if (!protocolPath.startsWith("npm:")) return null;
  const after = protocolPath.slice(4);
  const firstSlash = after.indexOf("/");
  if (firstSlash === -1) {
    return { packageBase: "npm:" + after, pathWithinPackage: "" };
  }
  return {
    packageBase: "npm:" + after.slice(0, firstSlash),
    pathWithinPackage: after.slice(firstSlash + 1),
  };
}

/** 统一解析 jsr: 或 npm: 为 packageBase + pathWithinPackage */
function parseProtocolPackageBaseAndPath(
  protocolPath: string,
): { packageBase: string; pathWithinPackage: string } | null {
  return parseJsrPackageBaseAndPath(protocolPath) ??
    parseNpmPackageBaseAndPath(protocolPath);
}

/** 将 specifier 中用于正则的片段转义 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** cacheLookup 返回：本地路径 + 匹配到的 cache key（用于 loader，因 Deno 缓存路径常无扩展名） */
export type CacheLookupResult = { path: string; key: string };

/**
 * 缓存查找：先精确 get；未命中则对 jsr 用正则匹配 cache key。
 * 子路径允许多段间有额外目录（如 client/preact 匹配 src/client/adapters/preact.ts）。
 */
function cacheLookup(
  specifier: string,
  moduleCache: ModuleCache,
  existsCheck: (p: string) => boolean,
): CacheLookupResult | undefined {
  const exact = moduleCache.get(specifier);
  if (exact && existsCheck(exact)) {
    return { path: exact, key: specifier };
  }

  if (specifier.startsWith("jsr:")) {
    const after = specifier.slice(4);
    const lastAt = after.lastIndexOf("@");
    if (lastAt <= 0) return undefined;
    const scopeAndName = after.slice(0, lastAt);
    const versionAndPath = after.slice(lastAt + 1);
    const slashIdx = versionAndPath.indexOf("/");
    const subpath = slashIdx === -1 ? "" : versionAndPath.slice(slashIdx + 1);
    const scopeEscaped = escapeRegex(scopeAndName);
    const segments = subpath
      ? subpath.split("/").map((s) => escapeRegex(s))
      : [];
    const pathPart = segments.length === 0
      ? "(src/)?(mod)?(\\.tsx?|\\.jsx?)?"
      : segments.length === 1
      ? `(src/)?${segments[0]}(/mod)?(\\.tsx?|\\.jsx?)?`
      : `(src/)?${segments.join("(\\/[^/]+)*\\/")}(\\.tsx?|\\.jsx?)?`;
    const pattern = new RegExp(
      `^jsr:${scopeEscaped}@[^/]+/${pathPart}$`,
    );
    for (const [key, localPath] of moduleCache) {
      if (!key.startsWith("jsr:")) continue;
      if (pattern.test(key) && existsCheck(localPath)) {
        return { path: localPath, key };
      }
    }
  }

  return undefined;
}

/** 从 cache key 取出包内路径，如 jsr:@x@1.0.0/src/client/foo.ts -> src/client/foo.ts */
function pathWithinPackageFromKey(key: string): string {
  const afterAt = key.slice(key.lastIndexOf("@") + 1);
  const slash = afterAt.indexOf("/");
  return slash === -1 ? "" : afterAt.slice(slash + 1);
}

/**
 * 包内相对路径解析：importer 在 cache 则 base 取自 importerResolvedKey 的路径（匹配到的 key）；
 * 否则用请求的 pathWithinPackage。支持 jsr: 与 npm:，保证 preact/jsx-runtime、preact/hooks 的 ../ 解析到主包单例。
 */
function resolveRelative(
  importerProtocolPath: string,
  relativePath: string,
  cacheLookupFn: (s: string) => string | undefined,
  importerResolvedKey?: string,
): string | undefined {
  const parsed = parseProtocolPackageBaseAndPath(importerProtocolPath);
  if (!parsed) return undefined;

  const inCache = !!cacheLookupFn(importerProtocolPath);
  let basePath =
    (importerResolvedKey
      ? pathWithinPackageFromKey(importerResolvedKey)
      : parsed.pathWithinPackage || "").replace(/\/$/, "");
  if (inCache) {
    basePath = basePath.replace(/\/[^/]+$/, "") || basePath;
  } else if (!importerResolvedKey && /\.(tsx?|jsx?|mts|mjs)$/i.test(basePath)) {
    basePath = basePath.replace(/\/[^/]+$/, "");
  } else if (/\/mod$/i.test(basePath)) {
    basePath = basePath.replace(/\/mod$/i, "");
  }

  const baseUrl = "file:///" + basePath + "/";
  let resolvedWithin: string;
  try {
    resolvedWithin = new URL(relativePath, baseUrl).pathname
      .replace(/^\/+/, "")
      .replace(/\/$/, "") ||
      "";
  } catch {
    resolvedWithin = relativePath.replace(/^\.\//, "").replace(/\.\.\//g, "");
  }
  const pathForProtocol = /\.(tsx?|jsx?)$/i.test(resolvedWithin)
    ? resolvedWithin.replace(/\.(tsx?|jsx?)$/i, "")
    : resolvedWithin;
  const baseForProtocol = parsed.packageBase.replace(/@([\^~])([^/]+)/, "@$2");
  const targetSpecifier = pathForProtocol
    ? `${baseForProtocol}/${pathForProtocol}`
    : baseForProtocol;
  return cacheLookupFn(targetSpecifier) ? targetSpecifier : undefined;
}

/**
 * Deno 解析插件：仅用预构建 moduleCache，不走网络、不运行时 subprocess。
 */
export function denoResolverPlugin(
  options: ResolverOptions = {},
): esbuild.Plugin {
  const {
    enabled = true,
    browserMode = false,
    isServerBuild = true,
    moduleCache,
    projectDir,
    debug = false,
    logger: optionsLogger,
    forceRuntimeExternal: _forceRuntimeExternal = false,
    resolveOverrides = {},
  } = options;

  const log = optionsLogger ?? NOOP_LOGGER;
  const debugLog = (msg: string) => {
    if (debug) log.debug(`${PREFIX} ${msg}`);
  };

  const findDenoJson = (startDir: string) => findProjectDenoJson(startDir);
  const getConfig = (path: string) => getDenoConfig(path);

  return {
    name: "resolver",
    setup(build) {
      if (!enabled) return;

      const cacheLookupWithCheck = (specifier: string): string | undefined => {
        if (!moduleCache) return undefined;
        return cacheLookup(specifier, moduleCache, existsSync)?.path;
      };

      // 1. 路径别名 @/、~/
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)/ },
        (args): esbuild.OnResolveResult | undefined => {
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir ?? cwd());
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          if (!config?.imports) return undefined;
          const sortedKeys = Object.keys(config.imports).sort((a, b) =>
            b.length - a.length
          );
          const denoJsonDir = dirname(denoJsonPath);
          for (const alias of sortedKeys) {
            if (!args.path.startsWith(alias)) continue;
            const val = config.imports[alias];
            if (!val) continue;
            const rest = args.path.slice(alias.length);
            const resolved = val.startsWith("./") || val.startsWith("../")
              ? join(denoJsonDir, val, rest)
              : val + rest;
            if (existsSync(resolved)) {
              return { path: resolved, namespace: "file" };
            }
            if (!resolved.includes(".")) {
              for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
                const withExt = resolved + ext;
                if (existsSync(withExt)) {
                  return { path: withExt, namespace: "file" };
                }
              }
            }
          }
          return undefined;
        },
      );

      // 2. 顶层 jsr:、npm:
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        (args): esbuild.OnResolveResult | undefined => {
          if (isServerBuild && !browserMode) {
            debugLog(`服务端构建 external: ${args.path}`);
            return { path: args.path, external: true };
          }
          // 客户端构建时 preact/react/@dreamer/view 等运行时必须打包进 bundle，不能 external，否则与 SSR 水合不一致
          const forceBundle = !isServerBuild && isClientRuntimeSpec(args.path);
          if (browserMode && !forceBundle) {
            const url = convertSpecifierToBrowserUrl(args.path);
            if (url) return { path: url, external: true };
            return undefined;
          }
          const override = resolveOverrides[args.path];
          if (override && existsSync(override)) {
            return { path: override, namespace: "file" };
          }
          if (!moduleCache) {
            debugLog("无 moduleCache，jsr/npm 无法解析");
            return undefined;
          }
          const localPath = cacheLookupWithCheck(args.path);
          if (localPath) {
            debugLog(`cacheLookup 命中: ${args.path} -> ${localPath}`);
            return { path: args.path, namespace: NAMESPACE_DENO_PROTOCOL };
          }
          debugLog(`cacheLookup 未命中: ${args.path}`);
          return undefined;
        },
      );

      // 2.5 bare @scope/name 或 @scope/name/subpath：从 deno.json imports 取 jsr:/npm 地址
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+(\/.*)?$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir ?? projectDir ?? cwd());
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const pkgImport = getPackageImport(denoJsonPath, args.path);
          if (!pkgImport) return undefined;
          if (pkgImport.startsWith("jsr:") || pkgImport.startsWith("npm:")) {
            if (isServerBuild && !browserMode) {
              return { path: pkgImport, external: true };
            }
            if (browserMode) {
              const url = convertSpecifierToBrowserUrl(pkgImport);
              if (url) return { path: url, external: true };
            }
            if (moduleCache && cacheLookupWithCheck(pkgImport)) {
              return { path: pkgImport, namespace: NAMESPACE_DENO_PROTOCOL };
            }
          }
          return undefined;
        },
      );

      // 2.6 裸包名（无 @scope）：preact、react、lodash 等，与 resolver-deno.bak 一致，客户端用 projectDir 查 deno.json
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const packageName = args.path;
          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePkg = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && projectDir);
          const startDir = useProjectDir
            ? (projectDir ?? cwd())
            : (args.resolveDir ??
              (args.importer ? dirname(args.importer) : cwd()));
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          const packageImport = getPackageImport(
            denoJsonPath,
            packageName,
            config,
          );
          if (
            !packageImport ||
            (!packageImport.startsWith("jsr:") &&
              !packageImport.startsWith("npm:"))
          ) {
            return undefined;
          }
          if (isServerBuild && !browserMode) {
            debugLog(`服务端构建 external: ${packageImport}`);
            return { path: packageImport, external: true };
          }
          const forceBundle = !isServerBuild && isRuntimePkg;
          if (browserMode && !forceBundle) {
            const url = convertSpecifierToBrowserUrl(packageImport);
            if (url) return { path: url, external: true };
          }
          if (!moduleCache || !cacheLookupWithCheck(packageImport)) {
            return undefined;
          }
          debugLog(`bare 包解析: ${packageName} -> ${packageImport}`);
          return { path: packageImport, namespace: NAMESPACE_DENO_PROTOCOL };
        },
      );

      // 2.7 裸包子路径：preact/jsx-runtime、react/jsx-runtime 等，与 resolver-deno.bak 一致；优先 resolveOverrides
      build.onResolve(
        { filter: /^[a-zA-Z][a-zA-Z0-9_-]*\/.+$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const path = args.path;
          const override = resolveOverrides[path];
          if (override && existsSync(override)) {
            debugLog(`resolveOverrides: ${path} -> ${override}`);
            return { path: override, namespace: "file" };
          }
          const slashIdx = path.indexOf("/");
          const packageName = path.slice(0, slashIdx);
          const subpath = path.slice(slashIdx + 1);
          const inNodeModules = args.importer?.includes("node_modules") ??
            false;
          const isRuntimePkg = packageName === "preact" ||
            packageName === "react";
          const useProjectDir = inNodeModules ||
            (isServerBuild === false && projectDir);
          const startDir = useProjectDir
            ? (projectDir ?? cwd())
            : (args.resolveDir ??
              (args.importer ? dirname(args.importer) : cwd()));
          const denoJsonPath = findDenoJson(startDir);
          if (!denoJsonPath) return undefined;
          const config = getConfig(denoJsonPath);
          let packageImport = getPackageImport(denoJsonPath, path, config);
          if (!packageImport) {
            const baseImport = getPackageImport(
              denoJsonPath,
              packageName,
              config,
            );
            if (baseImport) packageImport = `${baseImport}/${subpath}`;
          }
          if (
            !packageImport ||
            (!packageImport.startsWith("jsr:") &&
              !packageImport.startsWith("npm:"))
          ) {
            return undefined;
          }
          if (isServerBuild && !browserMode) {
            debugLog(`服务端构建 external: ${packageImport}`);
            return { path: packageImport, external: true };
          }
          const forceBundleSubpath = !isServerBuild && isRuntimePkg;
          if (browserMode && !forceBundleSubpath) {
            const url = convertSpecifierToBrowserUrl(packageImport);
            if (url) return { path: url, external: true };
          }
          if (!moduleCache || !cacheLookupWithCheck(packageImport)) {
            return undefined;
          }
          debugLog(`bare 子路径解析: ${path} -> ${packageImport}`);
          return { path: packageImport, namespace: NAMESPACE_DENO_PROTOCOL };
        },
      );

      // 3. deno-protocol 下的相对路径：用 importer 的 cache key 作 base，返回 target specifier 走 onLoad（支持 jsr: 与 npm:，保证 preact 子路径 ../ 解析到主包单例）
      build.onResolve(
        { filter: /^\.\.?(\/.*)?$/, namespace: NAMESPACE_DENO_PROTOCOL },
        (args): esbuild.OnResolveResult | undefined => {
          let protocolPath = args.importer ?? "";
          const prefix = `${NAMESPACE_DENO_PROTOCOL}:`;
          if (protocolPath.startsWith(prefix)) {
            protocolPath = protocolPath.slice(prefix.length);
          }
          if (
            (!protocolPath.startsWith("jsr:") &&
              !protocolPath.startsWith("npm:")) ||
            !moduleCache
          ) {
            return undefined;
          }
          const importerResult = cacheLookup(
            protocolPath,
            moduleCache,
            existsSync,
          );
          const targetSpecifier = resolveRelative(
            protocolPath,
            args.path,
            cacheLookupWithCheck,
            importerResult?.key,
          );
          if (targetSpecifier) {
            debugLog(
              `resolveRelative: ${protocolPath} + ${args.path} -> ${targetSpecifier}`,
            );
            return {
              path: targetSpecifier,
              namespace: NAMESPACE_DENO_PROTOCOL,
            };
          }
          return undefined;
        },
      );

      // 4. onLoad：仅从 cache 读文件；用匹配到的 cache key 决定 loader（Deno 缓存路径常无扩展名）
      build.onLoad(
        { filter: /.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = args.path;
          debugLog(`onLoad ${protocolPath}`);
          if (!moduleCache) return undefined;
          const result = cacheLookup(protocolPath, moduleCache, existsSync);
          if (!result) return undefined;
          const { path: localPath, key } = result;
          const contents = await readTextFile(localPath);
          const loader = /\.(tsx?|jsx?|mts|mjs)$/i.test(key)
            ? getLoaderFromPath(key)
            : getLoaderFromPath(localPath);
          debugLog(
            `onLoad 从缓存读取 ${protocolPath} -> ${localPath} (${contents.length} chars)`,
          );
          return { contents, loader };
        },
      );
    },
  };
}
