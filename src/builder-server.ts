/**
 * @module @dreamer/esbuild/builder-server
 *
 * 服务端构建器
 *
 * 使用不同的编译方式进行服务端代码编译，输出 JavaScript 文件
 * - Deno 环境：使用 esbuild + Deno 解析器插件（支持 deno.json exports）
 * - Bun 环境：使用 bun build 原生打包（更快）
 */

import {
  basename,
  createCommand,
  dirname,
  existsSync,
  IS_BUN,
  join,
  makeTempDir,
  mkdir,
  readFile,
  relative,
  remove,
  resolve,
} from "@dreamer/runtime-adapter";
import * as esbuild from "esbuild";
import { bunResolverPlugin } from "./plugins/resolver-bun.ts";
import {
  buildModuleCache,
  denoResolverPlugin,
} from "./plugins/resolver-deno.ts";
import type {
  BuildMode,
  BuildResult,
  OutputFileContent,
  ServerConfig,
} from "./types.ts";

const DEBUG = true; // 调试开关

/**
 * 服务端构建选项
 */
export interface ServerBuildOptions {
  /**
   * 构建模式（默认：prod）
   * - prod: 生产模式，启用压缩优化
   * - dev: 开发模式，保留源码可读性
   */
  mode?: BuildMode;
  /**
   * 是否写入文件（默认：true）
   * 设置为 false 时，不写入文件，而是在 BuildResult.outputContents 中返回编译后的代码
   */
  write?: boolean;
}

/**
 * 服务端构建器类
 *
 * 根据运行时环境自动选择最佳编译方式：
 * - Deno 环境：使用 esbuild + Deno 解析器插件
 * - Bun 环境：使用 bun build 原生打包（更快）
 *
 * 输出 JavaScript 文件，保留相对路径的灵活性，适合需要动态加载资源的场景
 */
export class BuilderServer {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * 构建服务端代码
   *
   * @param options - 构建选项，可以是 BuildMode 字符串或 ServerBuildOptions 对象
   * @returns 构建结果，当 write 为 false 时，outputContents 包含编译后的代码
   *
   * @example
   * ```typescript
   * // 写入文件（默认行为）
   * const result = await builder.build();
   * const result = await builder.build("prod");
   *
   * // 不写入文件，返回代码内容
   * const result = await builder.build({ mode: "prod", write: false });
   * console.log(result.outputContents?.[0]?.text); // 编译后的代码
   * ```
   */
  build(
    options: BuildMode | ServerBuildOptions = "prod",
  ): Promise<BuildResult> {
    // 如果启用原生编译，使用 deno compile / bun build --compile
    if (this.config.useNativeCompile) {
      return this.buildWithNativeCompile(options);
    }

    // 根据运行时环境选择编译方式
    if (IS_BUN) {
      return this.buildWithBun(options);
    }
    return this.buildWithEsbuild(options);
  }

  /**
   * 使用原生编译器构建（生成独立可执行文件）
   *
   * - Deno: 使用 `deno compile`
   * - Bun: 使用 `bun build --compile`
   *
   * @param options - 构建选项
   * @returns 构建结果
   */
  private async buildWithNativeCompile(
    options: BuildMode | ServerBuildOptions = "prod",
  ): Promise<BuildResult> {
    const startTime = Date.now();

    // 解析选项
    const mode: BuildMode = typeof options === "string"
      ? options
      : (options.mode || "prod");
    const isProd = mode === "prod";

    // 验证输出路径
    if (!this.config.output || this.config.output.trim() === "") {
      throw new Error("服务端配置缺少输出路径 (output)");
    }

    // 解析路径
    const entryPoint = await resolve(this.config.entry);
    const outputPath = await resolve(this.config.output);
    const outputDir = dirname(outputPath);

    // 确保输出目录存在
    await mkdir(outputDir, { recursive: true });

    // 处理外部依赖配置
    const externalModules = this.config.external || [];

    if (IS_BUN) {
      // Bun: 使用 bun build --compile
      const args: string[] = [
        "build",
        "--compile",
        "--target",
        "bun",
      ];

      // 压缩选项
      if (isProd) {
        args.push("--minify");
      }

      // 外部依赖（Bun 支持 --external 参数）
      for (const ext of externalModules) {
        args.push("--external", ext);
      }

      // 输出文件
      args.push("--outfile", outputPath);

      // 入口文件
      args.push(entryPoint);

      const command = createCommand("bun", {
        args,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await command.output();

      if (!output.success) {
        const stderr = output.stderr
          ? new TextDecoder().decode(output.stderr)
          : "未知错误";
        throw new Error(`Bun 编译失败: ${stderr}`);
      }
    } else {
      // Deno: 使用 deno compile
      // 注意：deno compile 不支持 --external 参数
      // 如果配置了 external，需要提示用户
      if (externalModules.length > 0) {
        console.warn(
          `警告: deno compile 不支持 external 配置，以下模块将被打包: ${
            externalModules.join(", ")
          }`,
        );
      }

      const args: string[] = [
        "compile",
        "--allow-all", // 生产环境通常需要所有权限
        "--output",
        outputPath,
      ];

      // 入口文件
      args.push(entryPoint);

      const command = createCommand("deno", {
        args,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await command.output();

      if (!output.success) {
        const stderr = output.stderr
          ? new TextDecoder().decode(output.stderr)
          : "未知错误";
        throw new Error(`Deno 编译失败: ${stderr}`);
      }
    }

    const duration = Date.now() - startTime;

    return {
      outputFiles: [outputPath],
      duration,
    };
  }

  /**
   * 使用 esbuild 进行服务端代码编译（Deno 环境）
   *
   * @param options - 构建选项
   * @returns 构建结果
   */
  private async buildWithEsbuild(
    options: BuildMode | ServerBuildOptions = "prod",
  ): Promise<BuildResult> {
    const startTime = Date.now();

    if (DEBUG) console.log("[esbuild] 开始构建...");

    // 解析选项
    const mode: BuildMode = typeof options === "string"
      ? options
      : (options.mode || "prod");
    // write 默认为 true，表示写入文件
    const write = typeof options === "string"
      ? true
      : (options.write !== false);

    // 只有在需要写入文件时才验证输出目录配置
    let outputDir: string;
    if (write) {
      if (!this.config.output || this.config.output.trim() === "") {
        throw new Error("服务端配置缺少输出目录 (output)");
      }
      outputDir = await resolve(this.config.output);
    } else {
      // 内存模式不需要输出目录，使用临时目录
      outputDir = await resolve(this.config.output || "./");
    }

    // 根据 mode 设置编译选项
    const isProd = mode === "prod";

    // 确保输出目录存在（仅在写入文件时）
    if (write) {
      await mkdir(outputDir, { recursive: true });
    }

    // 解析入口文件路径
    const entryPoint = await resolve(this.config.entry);

    // 合并配置选项和模式选项
    const compileOptions = {
      ...this.config.compile,
      // 生产模式默认启用 minify（如果配置中未显式禁用）
      minify: this.config.compile?.minify ?? isProd,
    };

    if (DEBUG) console.log("[esbuild] 入口文件:", entryPoint);
    if (DEBUG) console.log("[esbuild] 输出目录:", outputDir);
    if (DEBUG) console.log("[esbuild] 工作目录:", dirname(entryPoint));

    // 构建插件列表
    const plugins: esbuild.Plugin[] = [];

    // 如果启用 externalNpm，添加插件将所有 npm 包标记为 external
    if (this.config.externalNpm) {
      if (DEBUG) console.log("[esbuild] 启用 externalNpm");
      plugins.push({
        name: "external-npm",
        setup(build) {
          // 匹配 npm: 协议的导入
          build.onResolve({ filter: /^npm:/ }, (args) => {
            if (DEBUG) console.log("[esbuild] external npm:", args.path);
            return { path: args.path, external: true };
          });
        },
      });
    }

    if (IS_BUN) {
      // 在 Bun 环境下自动启用解析器插件
      // 用于解析 package.json 的 imports 配置（如 @dreamer/logger/client）
      plugins.push(bunResolverPlugin());
    } else {
      // 在 Deno 环境下自动启用解析器插件
      // 用于解析 deno.json 的 exports 配置（如 @dreamer/logger/client）
      if (DEBUG) console.log("[esbuild] 使用 denoResolverPlugin");

      // 构建模块缓存：一次性获取所有依赖的本地缓存路径
      // 这避免了在解析每个模块时都启动子进程或发送 HTTP 请求
      if (DEBUG) console.log("[esbuild] 构建模块缓存...");
      const moduleCache = await buildModuleCache(
        entryPoint,
        dirname(entryPoint),
      );
      if (DEBUG) {
        console.log(`[esbuild] 模块缓存完成: ${moduleCache.size} 个模块`);
      }

      plugins.push(denoResolverPlugin({ moduleCache }));
    }

    // 输出文件名
    const outfile = join(outputDir, "server.js");

    // 处理外部依赖配置
    const externalModules = this.config.external || [];

    // 获取入口文件所在目录作为工作目录，限制 esbuild 的扫描范围
    const absWorkingDir = dirname(entryPoint);

    // esbuild 构建选项
    const buildOptions: esbuild.BuildOptions = {
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      platform: "node", // 服务端使用 node 平台
      target: "es2022", // 现代 Node.js/Deno/Bun 都支持 ES2022
      minify: compileOptions.minify,
      sourcemap: !isProd, // 开发模式生成 sourcemap
      treeShaking: true,
      metafile: true,
      write,
      plugins: plugins.length > 0 ? plugins : undefined,
      // 外部依赖不打包
      external: externalModules.length > 0 ? externalModules : undefined,
      // 限制工作目录，防止扫描到项目之外的文件
      absWorkingDir,
    };

    // 如果写入文件，设置输出文件路径
    if (write) {
      buildOptions.outfile = outfile;
    }

    if (DEBUG) console.log("[esbuild] 开始执行 esbuild.build()...");
    if (DEBUG) console.log("[esbuild] external:", externalModules);

    // 执行构建
    const result = await esbuild.build(buildOptions);

    if (DEBUG) console.log("[esbuild] esbuild.build() 完成");

    const duration = Date.now() - startTime;

    // 获取输出文件列表
    const outputFiles: string[] = [];
    if (result.metafile) {
      for (const file in result.metafile.outputs) {
        outputFiles.push(file);
      }
    }

    // 如果不写入文件，返回编译后的代码内容
    if (!write && result.outputFiles) {
      const outputContents: OutputFileContent[] = result.outputFiles.map(
        (file) => ({
          path: file.path,
          text: file.text,
          contents: file.contents,
        }),
      );

      return {
        outputFiles: outputContents.map((f) => f.path),
        outputContents,
        metafile: result.metafile,
        duration,
      };
    }

    return {
      outputFiles: write ? [outfile] : outputFiles,
      metafile: result.metafile,
      duration,
    };
  }

  /**
   * 使用 bun build 进行服务端代码编译（Bun 环境）
   *
   * bun build 会自动读取 package.json 的依赖配置，
   * 比 esbuild 更快，且原生支持 TypeScript
   *
   * @param options - 构建选项
   * @returns 构建结果
   */
  private async buildWithBun(
    options: BuildMode | ServerBuildOptions = "prod",
  ): Promise<BuildResult> {
    const startTime = Date.now();

    // 解析选项
    const mode: BuildMode = typeof options === "string"
      ? options
      : (options.mode || "prod");
    // write 默认为 true，表示写入文件
    const write = typeof options === "string"
      ? true
      : (options.write !== false);

    // 只有在需要写入文件时才验证输出目录配置
    let outputDir: string;
    if (write) {
      if (!this.config.output || this.config.output.trim() === "") {
        throw new Error("服务端配置缺少输出目录 (output)");
      }
      outputDir = await resolve(this.config.output);
      // 确保输出目录存在
      await mkdir(outputDir, { recursive: true });
    } else {
      // 内存模式不需要输出目录，使用临时目录
      outputDir = await resolve(this.config.output || "./");
    }

    // 根据 mode 设置编译选项
    const isProd = mode === "prod";

    // 解析入口文件路径
    const entryPoint = await resolve(this.config.entry);
    const entryDir = dirname(entryPoint);

    // 合并配置选项和模式选项
    const compileOptions = {
      ...this.config.compile,
      // 生产模式默认启用 minify（如果配置中未显式禁用）
      minify: this.config.compile?.minify ?? isProd,
    };

    // 输出文件名和路径
    const outputFileName = "server.js";
    const outfile = join(outputDir, outputFileName);

    // 在 Bun 环境下，bun build 的行为：
    // 1. 对于相对路径导入，不需要 package.json，可以直接工作
    // 2. 对于 npm 包，可以从缓存读取，不需要 package.json
    // 3. 对于路径别名（@/, ~/），需要 package.json 的 imports 或 tsconfig.json 的 paths
    //
    // 优化策略：
    // - 优先使用入口文件所在目录（如果存在 package.json 或 tsconfig.json）
    // - 如果没有配置文件，也可以工作（Bun 可以从缓存读取 npm 包）
    // - 对于输出目录，如果是内存模式使用临时目录，否则使用配置的输出目录
    const entryPackageJson = join(entryDir, "package.json");
    const entryTsconfig = join(entryDir, "tsconfig.json");
    const hasConfig = existsSync(entryPackageJson) || existsSync(entryTsconfig);

    // 如果是内存模式，使用临时目录
    const tempDir = write
      ? null
      : await makeTempDir({ prefix: "esbuild-server-" });
    const actualOutputDir = write ? outputDir : tempDir!;
    const actualOutfile = join(actualOutputDir, outputFileName);

    // 确定工作目录：如果有配置文件，在入口文件目录执行；否则使用输出目录
    // 注意：即使没有配置文件，Bun 也能从缓存读取 npm 包，所以也可以工作
    const workDir = hasConfig ? entryDir : actualOutputDir;

    try {
      // 构建 bun build 命令参数
      // 如果有配置文件，使用相对路径；否则使用绝对路径
      const buildEntryPoint = hasConfig ? basename(entryPoint) : entryPoint;
      const args: string[] = ["build", buildEntryPoint];

      // 设置目标平台为 node（服务端）
      args.push("--target", "node");

      // 设置输出格式为 ESM
      args.push("--format", "esm");

      // 设置输出文件（使用相对路径，配合 cwd 使用）
      // 如果工作目录是入口文件目录，输出文件路径需要相对于工作目录
      // 如果工作目录是输出目录，输出文件就在当前目录
      const outputRelativePath = hasConfig
        ? join(relative(entryDir, actualOutputDir), outputFileName)
        : outputFileName;
      args.push("--outfile", outputRelativePath);

      // 压缩选项
      if (compileOptions.minify) {
        args.push("--minify");
      }

      // sourcemap 选项（开发模式生成）
      if (!isProd) {
        args.push("--sourcemap=inline");
      }

      // 外部依赖（Bun 支持 --external 参数）
      const externalModules = this.config.external || [];
      for (const ext of externalModules) {
        args.push("--external", ext);
      }

      // 执行 bun build 命令
      // 在包含 package.json 或 tsconfig.json 的目录下执行，这样 bun build 才能正确解析路径别名
      const command = createCommand("bun", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: workDir,
      });

      const output = await command.output();

      if (!output.success) {
        const stderr = output.stderr || "未知错误";
        throw new Error(
          `Bun 服务端编译失败: ${stderr}。入口文件: ${this.config.entry}`,
        );
      }

      const duration = Date.now() - startTime;

      // 如果是内存模式，读取输出文件内容并返回
      if (!write && tempDir) {
        const codeBuffer = await readFile(actualOutfile);
        const code = new TextDecoder().decode(codeBuffer);

        const outputContents: OutputFileContent[] = [{
          path: outfile, // 使用原始输出路径
          text: code,
          contents: codeBuffer,
        }];

        return {
          outputFiles: [outfile],
          outputContents,
          duration,
        };
      }

      return {
        outputFiles: [outfile],
        duration,
      };
    } finally {
      // 清理临时目录
      if (tempDir) {
        try {
          await remove(tempDir, { recursive: true });
        } catch {
          // 忽略清理错误
        }
      }
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ServerConfig {
    return this.config;
  }
}
