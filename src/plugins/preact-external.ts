/**
 * @module @dreamer/esbuild/plugins/preact-external
 *
 * Preact 外部化插件
 *
 * 在 resolver 之前运行，将 preact、preact/hooks、preact/jsx-runtime 等
 * 直接标记为 external，避免 denoResolverPlugin 解析为 npm: 路径后
 * 与 build.external 列表匹配失败导致仍被打包。
 *
 * 配合 HTML 中的 import map 使用，浏览器从 CDN 加载 Preact，
 * 确保主包与 chunk 共享同一实例，避免 HMR 无感刷新时的 _H 报错。
 */

import type * as esbuild from "esbuild";

/** 匹配 preact 及子路径（preact、preact/hooks、preact/jsx-runtime 等） */
const PREACT_FILTER = /^preact(\/.*)?$/;

/**
 * 创建 Preact 外部化插件
 *
 * 必须在 denoResolverPlugin 之前运行，否则 resolver 会先解析为 npm: 路径。
 *
 * @returns esbuild 插件
 */
export function createPreactExternalPlugin(): esbuild.Plugin {
  return {
    name: "preact-external",
    setup(build) {
      build.onResolve({ filter: PREACT_FILTER }, (args) => {
        return { path: args.path, external: true };
      });
    },
  };
}
