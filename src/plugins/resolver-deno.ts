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
  relative,
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

/** 路径转为正斜杠，便于在 Windows 下传给 deno 子进程时避免反斜杠转义问题 */
function toForwardSlash(path: string): string {
  return path.replace(/\\/g, "/");
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
  const configArgs = projectDenoJson
    ? ["--config", toForwardSlash(projectDenoJson)]
    : [];
  // 使用相对于 workDir 的入口路径，避免 Windows 上绝对路径格式导致 deno info 解析失败
  const entryRelative = relative(workDir, entryPoint);
  const entryForDeno = entryRelative.startsWith("..")
    ? toForwardSlash(entryPoint)
    : toForwardSlash(entryRelative);

  try {
    const proc = createCommand("deno", {
      args: ["info", "--json", ...configArgs, entryForDeno],
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
      // 统一转为本地文件系统路径（Windows 上 deno info 可能返回 file:// URL）
      const localPath = mod.local
        ? (mod.local.startsWith("file://")
          ? fileUrlToPath(mod.local)
          : mod.local)
        : undefined;
      if (localPath) cache.set(mod.specifier, localPath);

      const jsrMatch = mod.specifier.match(
        /^https:\/\/jsr\.io\/(@[^/]+\/[^/]+)\/([^/]+)\/(.+)$/,
      );
      if (jsrMatch) {
        const [, scopeAndName, version, path] = jsrMatch;
        const jsrKey = `jsr:${scopeAndName}@${version}/${path}`;
        if (localPath) {
          cache.set(jsrKey, localPath);
          debugLog(`buildModuleCache 添加: ${jsrKey} -> ${localPath}`);
        }
      } else if (mod.specifier.startsWith("npm:")) {
        const spec = mod.specifier.replace(/^npm:\/+/, "npm:");
        npmToResolve.add(spec);
        if (localPath) cache.set(spec, localPath);
      }
    }

    for (const spec of npmToResolve) {
      if (cache.has(spec)) continue;
      try {
        const procNpm = createCommand("deno", {
          args: [
            "eval",
            ...(projectDenoJson
              ? ["--config", toForwardSlash(projectDenoJson)]
              : []),
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

/** 根据文件路径或 cache key（含扩展名）确定 esbuild loader。.tsx 用 tsx，.jsx 用 jsx，以便视图文件正确解析。 */
function getLoaderFromPath(filePathOrKey: string): "ts" | "tsx" | "js" | "jsx" {
  if (filePathOrKey.endsWith(".tsx")) return "tsx";
  if (filePathOrKey.endsWith(".jsx")) return "jsx";
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

/**
 * 从项目 deno.json 的 imports 解析 bare 包名或带子路径。
 * 子路径从右往左一层一层试：先试 @dreamer/render/client/react 整键，再试 base=@dreamer/render/client/subpath=react，
 * 再试 base=@dreamer/render、subpath=client/react，命中 base 即拼成 jsr:.../subpath。
 */
function getPackageImport(
  projectDenoJsonPath: string,
  packageName: string,
  config?: DenoConfig,
): string | undefined {
  const c = config ?? getDenoConfig(projectDenoJsonPath);
  if (!c?.imports) return undefined;
  const val = c.imports[packageName];
  if (typeof val === "string") return normalizeProtocolSpecifier(val);
  for (let i = packageName.length - 1; i >= 0; i--) {
    if (packageName[i] !== "/") continue;
    const base = packageName.slice(0, i);
    const subpath = packageName.slice(i + 1);
    const baseVal = c.imports[base];
    if (typeof baseVal === "string") {
      return normalizeProtocolSpecifier(`${baseVal}/${subpath}`);
    }
  }
  return undefined;
}

/** 规范 jsr:/npm: 后的多余前导斜杠，避免出现 npm:/react-dom@x/client 这种非法格式 */
function normalizeProtocolSpecifier(s: string): string {
  return s.replace(/^(npm|jsr):\/+(?!\/)/, "$1:");
}

function convertSpecifierToBrowserUrl(specifier: string): string | null {
  if (specifier.startsWith("npm:")) {
    return `https://esm.sh/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("jsr:")) {
    return `https://esm.sh/jsr/${specifier.slice(4)}`;
  }
  if (specifier.startsWith("http:")) {
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

/**
 * 从 jsr: 或 npm: 的完整 specifier 解析出 deno.json imports 的 key 与子路径。
 * 用于「以项目版本为准」：用 project 的 imports 覆盖依赖包内声明的版本。
 * 例：jsr:@dreamer/view@^1.0.2/jsx-runtime -> { packageKey: "@dreamer/view", pathWithinPackage: "jsx-runtime" }
 *     npm:react@18.0.0/jsx-runtime -> { packageKey: "react", pathWithinPackage: "jsx-runtime" }
 */
function getPackageKeyAndSubpathFromSpecifier(
  specifier: string,
): { packageKey: string; pathWithinPackage: string } | null {
  const jsr = parseJsrPackageBaseAndPath(specifier);
  if (jsr) {
    const after = specifier.slice(4);
    const match = after.match(/^(@[^/]+\/[^/]+)\@/);
    if (!match) return null;
    return { packageKey: match[1], pathWithinPackage: jsr.pathWithinPackage };
  }
  const npm = parseNpmPackageBaseAndPath(specifier);
  if (npm) {
    const after = specifier.slice(4);
    const match = after.match(/^([^@/]+)/);
    if (!match) return null;
    return { packageKey: match[1], pathWithinPackage: npm.pathWithinPackage };
  }
  return null;
}

/** 将 specifier 中用于正则的片段转义 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** cacheLookup 返回：本地路径 + 匹配到的 cache key（用于 loader，因 Deno 缓存路径常无扩展名） */
export type CacheLookupResult = { path: string; key: string };

/**
 * 缓存查找：先精确 get；未命中则对 jsr 用正则匹配 cache key；对 npm 支持子路径回退（如 npm:react-dom@x/client）。
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

  // 无扩展名的 jsr specifier（如 .../src/route-page）先尝试 cache 中的 .ts/.tsx/.jsx/.js key，避免相对路径解析出的路径与 deno info 缓存 key 不一致。
  // 返回的 key 必须带扩展名，否则 onLoad 用 key 选 loader 时会误用 ts，导致 .tsx/.jsx 视图被当 TS/JS 解析（JSX 报错）。
  if (
    specifier.startsWith("jsr:") &&
    !/\.(tsx?|jsx?|mts|mjs)$/i.test(specifier)
  ) {
    const withTs = moduleCache.get(specifier + ".ts");
    if (withTs && existsCheck(withTs)) {
      return { path: withTs, key: specifier + ".ts" };
    }
    const withTsx = moduleCache.get(specifier + ".tsx");
    if (withTsx && existsCheck(withTsx)) {
      return { path: withTsx, key: specifier + ".tsx" };
    }
    const withJsx = moduleCache.get(specifier + ".jsx");
    if (withJsx && existsCheck(withJsx)) {
      return { path: withJsx, key: specifier + ".jsx" };
    }
    const withJs = moduleCache.get(specifier + ".js");
    if (withJs && existsCheck(withJs)) {
      return { path: withJs, key: specifier + ".js" };
    }
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

    // JSR 子路径通用回退：用 scopeAndName 匹配 cache 中的主包，再按子路径一层一层拼候选（不写死 adapters 等目录）
    if (subpath) {
      const baseKeyPrefix = `jsr:${scopeAndName}@`;
      const parts = subpath.split("/");
      const buildCandidates = (root: string) => {
        return [
          join(root, subpath),
          join(root, subpath + ".ts"),
          join(root, subpath + ".tsx"),
          join(root, subpath + ".jsx"),
          join(root, subpath + ".js"),
          join(root, ...parts, "mod.ts"),
          join(root, ...parts, "index.ts"),
          join(root, ...parts, "index.js"),
          join(root, "src", subpath, "mod.ts"),
          join(root, "src", subpath + ".ts"),
          join(root, "src", subpath + ".tsx"),
          join(root, "src", subpath + ".jsx"),
          join(root, "src", subpath + ".js"),
        ];
      };
      const keyWithExtForPath = (p: string) =>
        p.endsWith(".tsx")
          ? specifier + ".tsx"
          : p.endsWith(".jsx")
          ? specifier + ".jsx"
          : p.endsWith(".ts")
          ? specifier + ".ts"
          : p.endsWith(".js")
          ? specifier + ".js"
          : specifier;
      for (const [key, baseLocal] of moduleCache) {
        if (
          !key.startsWith("jsr:") ||
          !key.startsWith(baseKeyPrefix) ||
          key.slice(baseKeyPrefix.length).includes("/")
        ) continue;
        if (!existsCheck(baseLocal)) continue;
        const baseDir = dirname(baseLocal);
        for (const p of buildCandidates(baseDir)) {
          if (existsCheck(p)) {
            return { path: p, key: keyWithExtForPath(p) };
          }
        }
        const baseDirParent = dirname(baseDir);
        if (baseDirParent !== baseDir) {
          for (const p of buildCandidates(baseDirParent)) {
            if (existsCheck(p)) {
              return { path: p, key: keyWithExtForPath(p) };
            }
          }
        }
      }
    }
  }

  // npm 子路径通用回退：用 baseSpec 或包名匹配 cache 中的主包，再拼接子路径（不写死包名、不起子进程）
  if (specifier.startsWith("npm:") && specifier.includes("/")) {
    const after = specifier.slice(4).replace(/^\/+/, "");
    const slashIdx = after.indexOf("/");
    if (slashIdx > 0) {
      const baseSpec = "npm:" + after.slice(0, slashIdx);
      const subpath = after.slice(slashIdx + 1);
      let baseLocal = moduleCache.get(baseSpec);
      if (!baseLocal) {
        const pkgName = after.slice(0, slashIdx).split("@")[0];
        const npmPrefix = `npm:${pkgName}@`;
        for (const [key, local] of moduleCache) {
          if (
            key.startsWith("npm:") &&
            key.startsWith(npmPrefix) &&
            !key.slice(npmPrefix.length).includes("/")
          ) {
            if (existsCheck(local)) {
              baseLocal = local;
              break;
            }
          }
        }
      }
      if (baseLocal && existsCheck(baseLocal)) {
        const baseDir = dirname(baseLocal);
        const candidates = [
          join(baseDir, subpath),
          join(baseDir, subpath + ".js"),
          join(baseDir, subpath + ".mjs"),
          join(baseDir, subpath, "index.js"),
          join(baseDir, "build", subpath + ".js"),
          join(baseDir, "build", subpath + ".mjs"),
        ];
        for (const p of candidates) {
          if (existsCheck(p)) {
            return { path: p, key: specifier };
          }
        }
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

      // 0. CDN 样式：仅 import "https://xxx.com/xxx.css" 这种以 .css 结尾的 URL 标为 external，由浏览器运行时加载
      build.onResolve(
        { filter: /^https?:\/\/.*\.css$/ },
        (args): esbuild.OnResolveResult | undefined => {
          debugLog(`CDN CSS external: ${args.path}`);
          return { path: args.path, external: true };
        },
      );

      // 1. 路径别名 @/、~/ 与 file 命名空间下的相对路径（./、../，含 .css 等）写在一起
      build.onResolve(
        { filter: /^(@\/|~\/|@[^/]+\/|~[^/]+\/)|^\.\.?\/.*/ },
        (args): esbuild.OnResolveResult | undefined => {
          const startDir = args.importer
            ? dirname(args.importer)
            : (args.resolveDir ?? cwd());

          // file 命名空间下的相对路径：显式按 importer 目录解析，支持 .css 等（deno-protocol 的 ./ ../ 由后面单独 onResolve 处理）
          const isFileNs = !args.namespace || args.namespace === "file";
          if (isFileNs && /^\.\.?\/.*/.test(args.path)) {
            const resolved = resolve(join(startDir, args.path));
            if (existsSync(resolved)) {
              debugLog(`file 相对路径: ${args.path} -> ${resolved}`);
              return { path: resolved, namespace: "file" };
            }
            if (!/\.[a-z0-9]+$/i.test(args.path)) {
              const withCss = resolve(join(startDir, args.path + ".css"));
              if (existsSync(withCss)) {
                debugLog(`file 相对路径(+.css): ${args.path} -> ${withCss}`);
                return { path: withCss, namespace: "file" };
              }
            }
            return undefined;
          }

          // 路径别名 @/、~/
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
              for (const ext of [".ts", ".tsx", ".js", ".jsx", ".css"]) {
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
      // 以项目 deno.json 的 imports 为准：若项目声明了某包版本，则优先用该版本解析，避免依赖包（如 render）内锁定的旧版本覆盖项目版本
      build.onResolve(
        { filter: /^(jsr|npm):/ },
        (args): esbuild.OnResolveResult | undefined => {
          const specifier = normalizeProtocolSpecifier(args.path);
          if (isServerBuild && !browserMode) {
            debugLog(`服务端构建 external: ${specifier}`);
            return { path: specifier, external: true };
          }
          // 客户端构建时 preact/react/@dreamer/view 等运行时必须打包进 bundle，不能 external，否则与 SSR 水合不一致
          const forceBundle = !isServerBuild && isClientRuntimeSpec(specifier);
          if (browserMode && !forceBundle) {
            const url = convertSpecifierToBrowserUrl(specifier);
            if (url) return { path: url, external: true };
            return undefined;
          }
          const override = resolveOverrides[args.path] ??
            resolveOverrides[specifier];
          if (override && existsSync(override)) {
            return { path: override, namespace: "file" };
          }
          if (!moduleCache) {
            debugLog("无 moduleCache，jsr/npm 无法解析");
            return undefined;
          }
          let tryPath = specifier;
          if (projectDir) {
            const denoJsonPath = findDenoJson(projectDir);
            const parsed = getPackageKeyAndSubpathFromSpecifier(specifier);
            if (denoJsonPath && parsed) {
              const projectImport = getPackageImport(
                denoJsonPath,
                parsed.packageKey,
              );
              const sameProtocol = (specifier.startsWith("jsr:") &&
                projectImport?.startsWith("jsr:")) ||
                (specifier.startsWith("npm:") &&
                  projectImport?.startsWith("npm:"));
              if (projectImport && sameProtocol) {
                if (parsed.pathWithinPackage) {
                  tryPath = `${projectImport}/${parsed.pathWithinPackage}`;
                } else {
                  tryPath = projectImport;
                }
                if (tryPath !== specifier) {
                  debugLog(`使用项目版本: ${specifier} -> ${tryPath}`);
                }
              }
            }
          }
          const localPath = cacheLookupWithCheck(tryPath);
          if (localPath) {
            debugLog(`cacheLookup 命中: ${tryPath} -> ${localPath}`);
            return { path: tryPath, namespace: NAMESPACE_DENO_PROTOCOL };
          }
          if (tryPath !== specifier) {
            const fallback = cacheLookupWithCheck(specifier);
            if (fallback) {
              debugLog(
                `cacheLookup 命中(原 specifier): ${specifier} -> ${fallback}`,
              );
              return { path: specifier, namespace: NAMESPACE_DENO_PROTOCOL };
            }
          }
          debugLog(`cacheLookup 未命中: ${tryPath}`);
          return undefined;
        },
      );

      // 2.5 bare @scope/name 或 @scope/name/subpath：从 deno.json imports 取 jsr:/npm 地址
      // 优先用 projectDir 查 deno.json，保证 @dreamer/router/client、@dreamer/render/client/react 等子路径能命中项目 imports
      build.onResolve(
        { filter: /^@[^/]+\/[^/]+(\/.*)?$/ },
        (args): esbuild.OnResolveResult | undefined => {
          const startDir = projectDir ??
            (args.importer
              ? dirname(args.importer)
              : (args.resolveDir ?? cwd()));
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

      // 4. onLoad：仅从 cache 读文件；用匹配到的 cache key 决定 loader；必须返回 resolveDir 以便包内相对路径（如 ./cjs/react.production.js）可被解析
      build.onLoad(
        { filter: /.*/, namespace: NAMESPACE_DENO_PROTOCOL },
        async (args): Promise<esbuild.OnLoadResult | undefined> => {
          const protocolPath = normalizeProtocolSpecifier(args.path);
          debugLog(`onLoad ${protocolPath}`);
          if (!moduleCache) return undefined;
          const result = cacheLookup(protocolPath, moduleCache, existsSync);
          if (!result) return undefined;
          const { path: localPath, key } = result;
          const contents = await readTextFile(localPath);
          const loader = /\.(tsx?|jsx?|mts|mjs)$/i.test(key)
            ? getLoaderFromPath(key)
            : getLoaderFromPath(localPath);
          const resolveDir = dirname(localPath);
          debugLog(
            `onLoad 从缓存读取 ${protocolPath} -> ${localPath} (${contents.length} chars)`,
          );
          return { contents, loader, resolveDir };
        },
      );
    },
  };
}
