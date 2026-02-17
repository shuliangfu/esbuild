/**
 * @module @dreamer/esbuild/server
 *
 * 服务端构建器子路径导出
 * 按需导入：import { BuilderServer } from "jsr:@dreamer/esbuild/server"
 */

import { initEsbuildI18n } from "./i18n.ts";

initEsbuildI18n();

export { BuilderServer } from "./builder-server.ts";
export type { ServerBuildOptions } from "./builder-server.ts";
