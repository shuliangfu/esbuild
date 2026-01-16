/**
 * @module @dreamer/esbuild/plugins/server-module-detector
 *
 * 服务端模块自动检测插件（方案一增强版）
 *
 * 自动检测并排除服务端模块，支持正则表达式匹配
 */

import type { BuildPlugin, OnResolveArgs, OnResolveResult } from "../plugin.ts";

/**
 * 服务端模块检测插件选项
 */
export interface ServerModuleDetectorOptions {
  /** 是否启用自动检测（默认：true） */
  enabled?: boolean;
  /** 额外的服务端模块模式（正则表达式或字符串） */
  additionalPatterns?: (string | RegExp)[];
}

/**
 * 创建服务端模块检测插件
 * 
 * 自动检测并标记服务端模块为 external，防止被打包进客户端 bundle
 * 
 * @param options 插件选项
 * @returns 服务端模块检测插件
 */
export function createServerModuleDetectorPlugin(
  options: ServerModuleDetectorOptions = {},
): BuildPlugin {
  const { enabled = true, additionalPatterns = [] } = options;

  // 服务端模块模式列表
  const serverModulePatterns: (string | RegExp)[] = [
    // Node.js 内置模块
    "fs",
    "path",
    "os",
    "crypto",
    "http",
    "https",
    "net",
    "dgram",
    "dns",
    "child_process",
    "cluster",
    "readline",
    "repl",
    "stream",
    "util",
    "url",
    "querystring",
    "buffer",
    "events",
    "tls",
    "zlib",
    "vm",
    "assert",
    "console",
    "process",
    "perf_hooks",
    "worker_threads",

    // Deno 特定模块
    "deno",
    /^deno:/,
    /^@deno/,

    // 常见的服务端库（通过包名前缀匹配）
    /^@dreamer\/(database|server|queue)/,
    /^@prisma/,
    /^express/,
    /^koa/,
    /^fastify/,
    /^hapi/,
    /^nest/,
    /^@nestjs/,
    /^mongoose/,
    /^sequelize/,
    /^typeorm/,
    /^pg/,
    /^mysql/,
    /^sqlite/,
    /^redis/,
    /^ioredis/,
    /^@aws-sdk/,
    /^@google-cloud/,
    /^@azure/,

    // 文件路径模式（匹配包含 .server. 的文件）
    /\.server\./,
    /\/server\//,
    /\/server\./,

    // 用户自定义模式
    ...additionalPatterns,
  ];

  /**
   * 检查模块是否是服务端模块
   */
  function isServerModule(path: string): boolean {
    for (const pattern of serverModulePatterns) {
      if (typeof pattern === "string") {
        // 字符串匹配：完全匹配或作为前缀
        if (path === pattern || path.startsWith(pattern + "/")) {
          return true;
        }
      } else if (pattern instanceof RegExp) {
        // 正则表达式匹配
        if (pattern.test(path)) {
          return true;
        }
      }
    }
    return false;
  }

  return {
    name: "server-module-detector",
    setup(build) {
      if (!enabled) {
        return;
      }

      // 在解析阶段拦截服务端模块
      build.onResolve(
        {
          filter: /.*/,
        },
        (args: OnResolveArgs): OnResolveResult | undefined => {
          const modulePath = args.path;

          // 检查是否是服务端模块
          if (isServerModule(modulePath)) {
            // 标记为 external，不打包进客户端 bundle
            return {
              external: true,
            };
          }

          // 不是服务端模块，返回 undefined 让其他插件处理
          return undefined;
        },
      );
    },
  };
}
