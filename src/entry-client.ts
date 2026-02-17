/**
 * @module @dreamer/esbuild/client
 *
 * 客户端构建器子路径导出
 * 按需导入：import { BuilderClient } from "jsr:@dreamer/esbuild/client"
 */

import { initEsbuildI18n } from "./i18n.ts";

initEsbuildI18n();

export { BuilderClient } from "./builder-client.ts";
export type { ClientBuildOptions } from "./builder-client.ts";
