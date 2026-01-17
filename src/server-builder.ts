/**
 * @module @dreamer/esbuild/server-builder
 *
 * 服务端构建器
 *
 * 使用 @dreamer/runtime-adapter 进行服务端代码编译
 */

import {
  createCommand,
  IS_DENO,
  join,
  mkdir,
  resolve,
  stat,
} from "@dreamer/runtime-adapter";
import type { BuildResult, Platform, ServerConfig } from "./types.ts";

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
    // 确保输出目录存在
    // 使用 resolve 确保输出路径是绝对路径，避免在根目录生成临时文件
    const outputDir = await resolve(this.config.output);
    await mkdir(outputDir, { recursive: true });

    // 解析入口文件路径
    const entryPoint = await resolve(this.config.entry);

    // 根据目标运行时选择编译方式
    const target = this.config.target || (IS_DENO ? "deno" : "bun");

    // 临时更新 config.output 为绝对路径，确保所有文件生成在正确位置
    const originalOutput = this.config.output;
    this.config.output = outputDir;

    try {
      if (target === "deno") {
        return await this.buildWithDeno(entryPoint);
      } else if (target === "bun") {
        return await this.buildWithBun(entryPoint);
      } else {
        throw new Error(`不支持的目标运行时: ${target}`);
      }
    } finally {
      // 恢复原始配置
      this.config.output = originalOutput;
    }
  }

  /**
   * 使用 Deno 编译
   */
  private async buildWithDeno(entryPoint: string): Promise<BuildResult> {
    const startTime = Date.now();
    const compileOptions = this.config.compile || {};

    // 确保输出路径是绝对路径，避免 Deno 在根目录生成临时文件
    const outputDir = await resolve(this.config.output);

    // 确保输出目录存在
    await mkdir(outputDir, { recursive: true });

    // 构建 deno compile 命令
    const args: string[] = ["compile"];

    // 添加输出路径
    // 关键：使用相对于输出目录的路径，这样临时文件会生成在输出目录
    // 如果使用绝对路径，deno compile 可能会在根目录生成临时文件
    const relativeOutputPath = "server";
    args.push("--output", relativeOutputPath);

    // 添加平台选项
    if (compileOptions.platform && compileOptions.platform.length > 0) {
      for (const platform of compileOptions.platform) {
        args.push("--target", this.mapPlatformToDeno(platform));
      }
    }

    // 添加入口文件（使用绝对路径）
    const absoluteEntryPoint = await resolve(entryPoint);
    args.push(absoluteEntryPoint);

    // 执行编译命令
    // 注意：deno compile 会在当前工作目录生成临时文件
    // 因此必须设置 cwd 为输出目录，确保临时文件生成在输出目录而不是根目录
    const command = createCommand("deno", {
      args,
      stdout: "piped",
      stderr: "piped",
      cwd: outputDir, // 关键：设置工作目录为输出目录，临时文件会生成在这里
    });

    const output = await command.output();

    if (!output.success) {
      throw new Error(`Deno 编译失败: ${output.stderr || "未知错误"}`);
    }

    // 检查输出文件是否存在（使用相对于输出目录的路径）
    const finalOutputPath = join(outputDir, relativeOutputPath);
    try {
      await stat(finalOutputPath);
    } catch {
      throw new Error(`编译输出文件不存在: ${finalOutputPath}`);
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles: [finalOutputPath],
      duration,
    };
  }

  /**
   * 使用 Bun 打包
   */
  private async buildWithBun(entryPoint: string): Promise<BuildResult> {
    const startTime = Date.now();
    const compileOptions = this.config.compile || {};

    // 确保输出路径是绝对路径
    const outputDir = resolve(this.config.output);

    // 确保输出目录存在
    await mkdir(outputDir, { recursive: true });

    // 构建 bun build 命令
    // 使用绝对路径确保文件生成在正确位置
    const absoluteEntryPoint = resolve(entryPoint);
    const args: string[] = ["build", absoluteEntryPoint];

    // 添加输出路径
    // 关键：使用相对于输出目录的路径，这样临时文件会生成在输出目录
    const relativeOutputPath = "server.js";
    args.push("--outfile", relativeOutputPath);

    // 添加压缩选项
    if (compileOptions.minify) {
      args.push("--minify");
    }

    // 执行打包命令
    // 注意：使用 "piped" 而不是 "inherit"，因为 output() 方法需要捕获输出
    // 设置工作目录为输出目录，确保临时文件生成在正确位置
    const command = createCommand("bun", {
      args,
      stdout: "piped",
      stderr: "piped",
      cwd: outputDir, // 关键：设置工作目录为输出目录，临时文件会生成在这里
    });

    const output = await command.output();

    if (!output.success) {
      throw new Error(`Bun 打包失败: ${output.stderr || "未知错误"}`);
    }

    // 检查输出文件是否存在（使用相对于输出目录的路径）
    const finalOutputPath = join(outputDir, relativeOutputPath);
    try {
      await stat(finalOutputPath);
    } catch {
      throw new Error(`打包输出文件不存在: ${finalOutputPath}`);
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles: [finalOutputPath],
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
