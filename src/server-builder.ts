/**
 * @module @dreamer/esbuild/server-builder
 *
 * 服务端构建器
 *
 * 使用 @dreamer/runtime-adapter 进行服务端代码编译
 */

import type {
  ServerConfig,
  ServerCompileOptions,
  BuildResult,
  TargetRuntime,
  Platform,
} from "./types.ts";
import { resolve, dirname, join } from "@dreamer/runtime-adapter";
import {
  mkdir,
  readTextFile,
  writeTextFile,
  stat,
  createCommand,
  IS_DENO,
  IS_BUN,
} from "@dreamer/runtime-adapter";

/**
 * 服务端构建器类
 */
export class ServerBuilder {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * 构建服务端代码
   */
  async build(): Promise<BuildResult> {
    const startTime = Date.now();

    // 确保输出目录存在
    await mkdir(this.config.output, { recursive: true });

    // 解析入口文件路径
    const entryPoint = await resolve(this.config.entry);

    // 根据目标运行时选择编译方式
    const target = this.config.target || (IS_DENO ? "deno" : "bun");

    if (target === "deno") {
      return await this.buildWithDeno(entryPoint);
    } else if (target === "bun") {
      return await this.buildWithBun(entryPoint);
    } else {
      throw new Error(`不支持的目标运行时: ${target}`);
    }
  }

  /**
   * 使用 Deno 编译
   */
  private async buildWithDeno(entryPoint: string): Promise<BuildResult> {
    const startTime = Date.now();
    const compileOptions = this.config.compile || {};
    const outputPath = join(this.config.output, "server");

    // 构建 deno compile 命令
    const args: string[] = ["compile"];

    // 添加输出路径
    args.push("--output", outputPath);

    // 添加平台选项
    if (compileOptions.platform && compileOptions.platform.length > 0) {
      for (const platform of compileOptions.platform) {
        args.push("--target", this.mapPlatformToDeno(platform));
      }
    }

    // 添加入口文件
    args.push(entryPoint);

    // 执行编译命令
    const command = createCommand("deno", {
      args,
      stdout: "inherit",
      stderr: "inherit",
    });

    const output = await command.output();

    if (!output.success) {
      throw new Error(`Deno 编译失败: ${output.stderr || "未知错误"}`);
    }

    // 检查输出文件是否存在
    try {
      await stat(outputPath);
    } catch {
      throw new Error(`编译输出文件不存在: ${outputPath}`);
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles: [outputPath],
      duration,
    };
  }

  /**
   * 使用 Bun 打包
   */
  private async buildWithBun(entryPoint: string): Promise<BuildResult> {
    const startTime = Date.now();
    const compileOptions = this.config.compile || {};
    const outputPath = join(this.config.output, "server.js");

    // 构建 bun build 命令
    const args: string[] = ["build", entryPoint];

    // 添加输出路径
    args.push("--outfile", outputPath);

    // 添加压缩选项
    if (compileOptions.minify) {
      args.push("--minify");
    }

    // 执行打包命令
    const command = createCommand("bun", {
      args,
      stdout: "inherit",
      stderr: "inherit",
    });

    const output = await command.output();

    if (!output.success) {
      throw new Error(`Bun 打包失败: ${output.stderr || "未知错误"}`);
    }

    // 检查输出文件是否存在
    try {
      await stat(outputPath);
    } catch {
      throw new Error(`打包输出文件不存在: ${outputPath}`);
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles: [outputPath],
      duration,
    };
  }

  /**
   * 映射平台名称到 Deno 目标格式
   */
  private mapPlatformToDeno(platform: Platform): string {
    const platformMap: Record<Platform, string> = {
      linux: "x86_64-unknown-linux-gnu",
      darwin: "x86_64-apple-darwin",
      windows: "x86_64-pc-windows-msvc",
    };
    return platformMap[platform] || platformMap.linux;
  }

  /**
   * 获取配置
   */
  getConfig(): ServerConfig {
    return this.config;
  }
}
