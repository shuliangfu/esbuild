/**
 * @module @dreamer/esbuild/plugins/vue-runtime-alias
 *
 * Vue 客户端构建时，将 "vue" 解析为运行时构建（vue.runtime.esm-bundler.js），
 * 避免打包完整构建（vue.cjs.js）导致浏览器中 "Dynamic require of @vue/compiler-dom is not supported"。
 *
 * 注意：deno info 对 npm 包的 local 可能为空，故需备用方案：从 entryPoint 向上查找 node_modules。
 */

import {
  dirname,
  existsSync,
  join,
  readdirSync,
} from "@dreamer/runtime-adapter";
import type * as esbuild from "esbuild";
import type { ModuleCache } from "./resolver-deno.ts";

const VUE_RUNTIME_FILE = "dist/vue.runtime.esm-bundler.js";

/** 匹配 npm:vue@ 或 npm:/vue@（Deno 可能输出后者） */
const VUE_SPECIFIER_RE = /^npm:\/?vue@/;

/**
 * 从模块缓存中查找 vue 运行时构建文件路径
 *
 * @param moduleCache 预构建的模块缓存（deno info 产出）
 * @returns vue.runtime.esm-bundler.js 的绝对路径，未找到返回 undefined
 */
function findVueRuntimePathFromCache(
  moduleCache: ModuleCache,
): string | undefined {
  for (const [specifier, localPath] of moduleCache.entries()) {
    if (!VUE_SPECIFIER_RE.test(specifier) || !localPath) continue;
    if (!existsSync(localPath)) continue;
    const isDir = !localPath.endsWith(".js") && !localPath.endsWith(".mjs");
    const root = isDir ? localPath : dirname(localPath);
    const runtimePath = join(root, VUE_RUNTIME_FILE);
    if (existsSync(runtimePath)) return runtimePath;
  }
  return undefined;
}

/**
 * 从 entryPoint 所在目录向上查找 node_modules 中的 vue 包
 * 支持 node_modules/vue 与 node_modules/.deno/vue@版本号/node_modules/vue
 *
 * @param startDir - 起始目录（通常为 entryPoint 的 dirname）
 * @returns vue.runtime.esm-bundler.js 的绝对路径，未找到返回 undefined
 */
function findVueRuntimePathInNodeModules(startDir: string): string | undefined {
  let currentDir = startDir;
  const maxDepth = 10;
  for (let depth = 0; depth < maxDepth; depth++) {
    const nm = join(currentDir, "node_modules");
    if (!existsSync(nm)) {
      const parent = dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
      continue;
    }
    const vueDir = join(nm, "vue");
    const runtimePath = join(vueDir, VUE_RUNTIME_FILE);
    if (existsSync(runtimePath)) return runtimePath;
    const denoDir = join(nm, ".deno");
    if (existsSync(denoDir)) {
      try {
        const entries = readdirSync(denoDir);
        for (const e of entries) {
          const name = e.name ?? (typeof e === "string" ? e : "");
          if (name.startsWith("vue@")) {
            const p = join(
              denoDir,
              name,
              "node_modules",
              "vue",
              VUE_RUNTIME_FILE,
            );
            if (existsSync(p)) return p;
          }
        }
      } catch {
        // 忽略
      }
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return undefined;
}

/**
 * 创建 Vue 运行时别名插件（客户端构建 engine=vue3 时使用）
 *
 * 在解析 "vue" 时返回 vue.runtime.esm-bundler.js 的绝对路径，确保打包的是运行时构建，
 * 避免包含 @vue/compiler-dom 的完整构建在浏览器中触发 Dynamic require 报错。
 *
 * 优先从 moduleCache 查找；若 deno info 对 npm 包未返回 local（常为空），
 * 则从 entryPoint 所在目录向上查找 node_modules。
 *
 * @param moduleCache 预构建的模块缓存
 * @param entryPoint 客户端入口文件绝对路径（用于 fallback 查找 node_modules）
 * @returns esbuild 原生插件，需在插件列表中排在 denoResolverPlugin 之前
 */
export function createVueRuntimeAliasPlugin(
  moduleCache: ModuleCache,
  entryPoint: string,
): esbuild.Plugin {
  const startDir = dirname(entryPoint);
  return {
    name: "vue-runtime-alias",
    setup(build) {
      build.onResolve(
        { filter: /^vue$/ },
        (): esbuild.OnResolveResult | undefined => {
          const runtimePath = findVueRuntimePathFromCache(moduleCache) ??
            findVueRuntimePathInNodeModules(startDir);
          if (!runtimePath) return undefined;
          return {
            path: runtimePath,
            namespace: "file",
          };
        },
      );
    },
  };
}
