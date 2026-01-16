/**
 * @module @dreamer/esbuild/cli
 *
 * CLI 工具
 *
 * 提供命令行接口，支持构建、监听、清理等操作
 */

import type { ParsedOptions } from "@dreamer/console";
import { Command, error, info, success, warning } from "@dreamer/console";
import {
  cwd,
  exists,
  exit,
  IS_BUN,
  IS_DENO,
  readTextFile,
  resolve,
} from "@dreamer/runtime-adapter";
import { Builder } from "./builder.ts";
import type { BuilderConfig, BuildMode, BuildOptions } from "./types.ts";
import { logger } from "./utils/logger.ts";

/**
 * 查找配置文件
 */
async function findConfigFile(
  customPath?: string,
): Promise<string | null> {
  if (customPath) {
    const resolved = await resolve(customPath);
    if (await exists(resolved)) {
      return resolved;
    }
    throw new Error(`配置文件不存在: ${customPath}`);
  }

  const projectRoot = cwd();
  const configFiles = [
    "esbuild.config.ts",
    "esbuild.config.js",
    "esbuild.config.json",
    "esbuild.json",
  ];

  for (const file of configFiles) {
    const path = await resolve(`${projectRoot}/${file}`);
    if (await exists(path)) {
      return path;
    }
  }

  return null;
}

/**
 * 加载配置文件
 */
async function loadConfig(
  configPath: string,
): Promise<BuilderConfig> {
  try {
    if (configPath.endsWith(".json")) {
      // JSON 配置文件
      const content = await readTextFile(configPath);
      return JSON.parse(content);
    } else {
      // TypeScript/JavaScript 配置文件
      // 动态导入模块
      const module = await import(`file://${configPath}`);
      // 支持默认导出或命名导出
      return module.default || module.config || module;
    }
  } catch (error) {
    throw new Error(`加载配置文件失败: ${configPath}\n${error}`);
  }
}

/**
 * 执行构建命令
 */
async function executeBuild(
  config: BuilderConfig,
  options: Record<string, unknown>,
): Promise<void> {
  const builder = new Builder(config);

  const buildOptions: BuildOptions = {
    mode: (options.mode as BuildMode) || config.build?.mode || "prod",
    clean: (options.clean as boolean) ?? config.build?.clean ?? false,
    cache: (options.cache as boolean | string) ?? config.build?.cache ?? true,
    silent: (options.silent as boolean) ?? config.build?.silent ?? false,
    logLevel: (options.logLevel as BuildOptions["logLevel"]) ||
      config.build?.logLevel ||
      "info",
    reportHTML: (options.reportHTML as boolean | string) ??
      config.build?.reportHTML ??
      true,
    validateConfig: (options.validateConfig as boolean) ??
      config.validateConfig ??
      false,
  };

  try {
    const result = await builder.build(buildOptions);
    if (!buildOptions.silent) {
      success(`构建完成！`);
      info(`输出文件: ${result.outputFiles.length} 个`);
      info(`耗时: ${(result.duration / 1000).toFixed(2)}s`);
    }
  } catch (err) {
    error(`构建失败: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      logger.error("构建失败", { error: err, stack: err.stack });
    }
    exit(1);
  }
}

/**
 * 执行服务端构建命令
 */
async function executeBuildServer(
  config: BuilderConfig,
  options: Record<string, unknown>,
): Promise<void> {
  const builder = new Builder(config);

  const buildOptions: BuildOptions = {
    mode: (options.mode as BuildMode) || config.build?.mode || "prod",
    clean: (options.clean as boolean) ?? config.build?.clean ?? false,
    cache: (options.cache as boolean | string) ?? config.build?.cache ?? true,
    silent: (options.silent as boolean) ?? config.build?.silent ?? false,
    logLevel: (options.logLevel as BuildOptions["logLevel"]) ||
      config.build?.logLevel ||
      "info",
    reportHTML: (options.reportHTML as boolean | string) ??
      config.build?.reportHTML ??
      false,
    validateConfig: (options.validateConfig as boolean) ??
      config.validateConfig ??
      false,
  };

  try {
    const result = await builder.buildServer(buildOptions);
    if (!buildOptions.silent) {
      success(`服务端构建完成！`);
      info(`输出文件: ${result.outputFiles.length} 个`);
      info(`耗时: ${(result.duration / 1000).toFixed(2)}s`);
    }
  } catch (err) {
    error(
      `服务端构建失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (err instanceof Error && err.stack) {
      logger.error("服务端构建失败", { error: err, stack: err.stack });
    }
    exit(1);
  }
}

/**
 * 执行客户端构建命令
 */
async function executeBuildClient(
  config: BuilderConfig,
  options: Record<string, unknown>,
): Promise<void> {
  const builder = new Builder(config);

  const buildOptions: BuildOptions = {
    mode: (options.mode as BuildMode) || config.build?.mode || "prod",
    clean: (options.clean as boolean) ?? config.build?.clean ?? false,
    cache: (options.cache as boolean | string) ?? config.build?.cache ?? true,
    silent: (options.silent as boolean) ?? config.build?.silent ?? false,
    logLevel: (options.logLevel as BuildOptions["logLevel"]) ||
      config.build?.logLevel ||
      "info",
    reportHTML: (options.reportHTML as boolean | string) ??
      config.build?.reportHTML ??
      true,
    validateConfig: (options.validateConfig as boolean) ??
      config.validateConfig ??
      false,
  };

  try {
    const result = await builder.buildClient(buildOptions);
    if (!buildOptions.silent) {
      success(`客户端构建完成！`);
      info(`输出文件: ${result.outputFiles.length} 个`);
      info(`耗时: ${(result.duration / 1000).toFixed(2)}s`);
    }
  } catch (err) {
    error(
      `客户端构建失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (err instanceof Error && err.stack) {
      logger.error("客户端构建失败", { error: err, stack: err.stack });
    }
    exit(1);
  }
}

/**
 * 执行监听命令
 */
async function executeWatch(
  config: BuilderConfig,
  options: Record<string, unknown>,
): Promise<void> {
  const builder = new Builder(config);

  const buildOptions: BuildOptions = {
    mode: (options.mode as BuildMode) || config.build?.mode || "dev",
    clean: (options.clean as boolean) ?? config.build?.clean ?? false,
    cache: (options.cache as boolean | string) ?? config.build?.cache ?? true,
    silent: (options.silent as boolean) ?? config.build?.silent ?? false,
    logLevel: (options.logLevel as BuildOptions["logLevel"]) ||
      config.build?.logLevel ||
      "info",
    reportHTML: (options.reportHTML as boolean | string) ??
      config.build?.reportHTML ??
      false,
    validateConfig: (options.validateConfig as boolean) ??
      config.validateConfig ??
      false,
    watch: {
      enabled: true,
    },
  };

  try {
    info("开始监听文件变化...");
    info("按 Ctrl+C 停止监听");
    await builder.watch(buildOptions);
  } catch (err) {
    error(`监听失败: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      logger.error("监听失败", { error: err, stack: err.stack });
    }
    exit(1);
  }
}

/**
 * 执行清理命令
 */
async function executeClean(config: BuilderConfig): Promise<void> {
  const builder = new Builder(config);

  try {
    await builder.clean();
    success("清理完成！");
  } catch (err) {
    error(`清理失败: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      logger.error("清理失败", { error: err, stack: err.stack });
    }
    exit(1);
  }
}

/**
 * 创建主命令
 */
function createMainCommand(): Command {
  const mainCommand = new Command("dreamer-esbuild")
    .info("📦 @dreamer/esbuild CLI 工具")
    .setVersion("1.0.0-beta.1")
    .example("dreamer-esbuild build", "构建项目（服务端和客户端）")
    .example("dreamer-esbuild build --mode dev", "开发模式构建")
    .example("dreamer-esbuild build --server", "仅构建服务端代码")
    .example("dreamer-esbuild build --client", "仅构建客户端代码")
    .example("dreamer-esbuild watch", "监听模式")
    .example("dreamer-esbuild clean", "清理输出目录")
    .example(
      "dreamer-esbuild build --config custom.config.ts",
      "使用自定义配置文件",
    );

  // 添加全局选项
  mainCommand
    .option({
      name: "config",
      alias: "c",
      description: "指定配置文件路径",
      requiresValue: true,
      type: "string",
    })
    .option({
      name: "validate-config",
      description: "验证构建配置",
      type: "boolean",
    });

  // 创建 build 子命令
  mainCommand
    .command("build", "构建项目")
    .option({
      name: "mode",
      alias: "m",
      description: "构建模式 (dev | prod)",
      requiresValue: true,
      type: "string",
      choices: ["dev", "prod"],
      defaultValue: "prod",
    })
    .option({
      name: "clean",
      description: "清理输出目录",
      type: "boolean",
    })
    .option({
      name: "no-cache",
      description: "禁用缓存",
      type: "boolean",
    })
    .option({
      name: "cache-dir",
      description: "指定缓存目录",
      requiresValue: true,
      type: "string",
    })
    .option({
      name: "silent",
      alias: "s",
      description: "静默模式（不输出进度信息）",
      type: "boolean",
    })
    .option({
      name: "log-level",
      description: "日志级别 (debug | info | warn | error | silent)",
      requiresValue: true,
      type: "string",
      choices: ["debug", "info", "warn", "error", "silent"],
      defaultValue: "info",
    })
    .option({
      name: "report-html",
      description: "生成 HTML 报告（默认: dist/build-report.html）",
      requiresValue: false,
      type: "string",
    })
    .option({
      name: "no-report-html",
      description: "不生成 HTML 报告",
      type: "boolean",
    })
    .option({
      name: "server",
      description: "仅构建服务端代码",
      type: "boolean",
    })
    .option({
      name: "client",
      description: "仅构建客户端代码",
      type: "boolean",
    })
    .action(async (_args: string[], options: ParsedOptions) => {
      // 查找并加载配置文件
      let config: BuilderConfig = {};
      try {
        const configPath = await findConfigFile(
          options.config as string | undefined,
        );
        if (configPath) {
          info(`使用配置文件: ${configPath}`);
          config = await loadConfig(configPath);
        } else {
          warning("未找到配置文件，使用默认配置");
        }
      } catch (err) {
        error(
          `加载配置文件失败: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        exit(1);
      }

      // 处理缓存选项
      if (options["no-cache"]) {
        options.cache = false;
      } else if (options["cache-dir"]) {
        options.cache = options["cache-dir"];
      }

      // 根据选项决定构建什么
      if (options.server && options.client) {
        error("不能同时指定 --server 和 --client，请只选择其中一个");
        exit(1);
      }

      if (options.server) {
        // 检查服务端配置
        if (!config.server) {
          error("未配置服务端构建，请在配置文件中添加 server 配置");
          exit(1);
        }
        // 服务端构建默认不生成 HTML 报告
        if (options["no-report-html"]) {
          options.reportHTML = false;
        } else {
          options.reportHTML = false;
        }
        await executeBuildServer(config, options);
      } else if (options.client) {
        // 检查客户端配置
        if (!config.client) {
          error("未配置客户端构建，请在配置文件中添加 client 配置");
          exit(1);
        }
        // 处理 HTML 报告选项
        if (options["no-report-html"]) {
          options.reportHTML = false;
        } else if (options["report-html"] === undefined) {
          // 默认生成报告
          options.reportHTML = true;
        }
        await executeBuildClient(config, options);
      } else {
        // 默认构建服务端和客户端
        // 处理 HTML 报告选项
        if (options["no-report-html"]) {
          options.reportHTML = false;
        } else if (options["report-html"] === undefined) {
          // 默认生成报告
          options.reportHTML = true;
        }
        await executeBuild(config, options);
      }
    });

  // 创建 watch 子命令
  mainCommand
    .command("watch", "监听文件变化并自动重新构建")
    .alias("w")
    .keepAlive() // 保持运行，不自动退出
    .option({
      name: "mode",
      alias: "m",
      description: "构建模式 (dev | prod)",
      requiresValue: true,
      type: "string",
      choices: ["dev", "prod"],
      defaultValue: "dev",
    })
    .option({
      name: "clean",
      description: "清理输出目录",
      type: "boolean",
    })
    .option({
      name: "no-cache",
      description: "禁用缓存",
      type: "boolean",
    })
    .option({
      name: "cache-dir",
      description: "指定缓存目录",
      requiresValue: true,
      type: "string",
    })
    .option({
      name: "silent",
      alias: "s",
      description: "静默模式（不输出进度信息）",
      type: "boolean",
    })
    .option({
      name: "log-level",
      description: "日志级别 (debug | info | warn | error | silent)",
      requiresValue: true,
      type: "string",
      choices: ["debug", "info", "warn", "error", "silent"],
      defaultValue: "info",
    })
    .option({
      name: "no-report-html",
      description: "不生成 HTML 报告",
      type: "boolean",
    })
    .action(async (_args: string[], options: ParsedOptions) => {
      // 查找并加载配置文件
      let config: BuilderConfig = {};
      try {
        const configPath = await findConfigFile(
          options.config as string | undefined,
        );
        if (configPath) {
          info(`使用配置文件: ${configPath}`);
          config = await loadConfig(configPath);
        } else {
          warning("未找到配置文件，使用默认配置");
        }
      } catch (err) {
        error(
          `加载配置文件失败: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        exit(1);
      }

      // 处理缓存选项
      if (options["no-cache"]) {
        options.cache = false;
      } else if (options["cache-dir"]) {
        options.cache = options["cache-dir"];
      }

      // Watch 模式默认不生成 HTML 报告
      if (options["no-report-html"]) {
        options.reportHTML = false;
      } else {
        options.reportHTML = false;
      }

      await executeWatch(config, options);
    });

  // 创建 clean 子命令
  mainCommand
    .command("clean", "清理输出目录")
    .action(async (_args: string[], options: ParsedOptions) => {
      // 查找并加载配置文件
      let config: BuilderConfig = {};
      try {
        const configPath = await findConfigFile(
          options.config as string | undefined,
        );
        if (configPath) {
          info(`使用配置文件: ${configPath}`);
          config = await loadConfig(configPath);
        } else {
          warning("未找到配置文件，使用默认配置");
        }
      } catch (err) {
        error(
          `加载配置文件失败: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        exit(1);
      }

      await executeClean(config);
    });

  return mainCommand;
}

/**
 * CLI 主函数
 */
export async function main(): Promise<void> {
  const command = createMainCommand();
  await command.execute();
}

/**
 * 检测当前文件是否作为主入口运行
 * 兼容 Deno 和 Bun 运行时
 *
 * @returns 如果当前文件是主入口则返回 true，否则返回 false
 */
function isMainModule(): boolean {
  if (IS_DENO) {
    // Deno 支持 import.meta.main
    return (import.meta as any).main === true;
  }

  if (IS_BUN) {
    // Bun 中，首先尝试使用 import.meta.main（Bun 1.3.5 可能支持）
    const metaMain = (import.meta as any).main;
    if (metaMain === true) {
      return true;
    }

    // 如果 import.meta.main 不可用，通过检查 process.argv[1] 是否匹配当前文件路径来判断
    const process = (globalThis as any).process;
    if (process && process.argv && process.argv.length > 1) {
      try {
        const currentFileUrl = new URL(import.meta.url);
        const currentFilePath = currentFileUrl.pathname;
        const mainFilePath = process.argv[1];

        // 标准化路径（处理 Windows 和 Unix 路径差异）
        const normalizePath = (path: string): string => {
          return path.replace(/\\/g, "/").replace(/\/+/g, "/");
        };

        const normalizedCurrent = normalizePath(currentFilePath);
        const normalizedMain = normalizePath(mainFilePath);

        // 比较文件路径（支持绝对路径和相对路径）
        return (
          normalizedMain === normalizedCurrent ||
          normalizedMain.endsWith(normalizedCurrent) ||
          normalizedCurrent.endsWith(normalizedMain)
        );
      } catch {
        // 如果路径解析失败，返回 false
        return false;
      }
    }

    // 如果无法确定，默认返回 false（安全起见）
    return false;
  }

  return false;
}

// 如果直接运行此文件，执行 main 函数
if (isMainModule()) {
  main().catch((err) => {
    error(`发生错误: ${err}`);
    exit(1);
  });
}
