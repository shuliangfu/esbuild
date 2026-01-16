/**
 * @fileoverview Logger 工具
 *
 * 创建并导出 logger 实例，供整个 esbuild 库使用
 */

import { createLogger, type Logger } from "@dreamer/logger";

/**
 * 默认 logger 实例
 *
 * 用于整个 esbuild 库的日志输出
 */
export const logger: Logger = createLogger({
  level: "info",
  format: "text",
  output: {
    console: true,
  },
});
