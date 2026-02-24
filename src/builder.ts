/**
 * @module @dreamer/esbuild/builder
 *
 * 主构建器
 *
 * 统一管理服务端和客户端构建
 */

import {
  cwd,
  dirname,
  exists,
  type FileWatcher,
  mkdir,
  readTextFile,
  remove,
  resolve,
  stat,
  watchFs,
} from "@dreamer/runtime-adapter";
import { AssetsProcessor } from "./assets-processor.ts";
import { BuildAnalyzer } from "./build-analyzer.ts";
import { CacheManager } from "./cache-manager.ts";
import { BuilderClient } from "./builder-client.ts";
import { CSSOptimizer } from "./css-optimizer.ts";
import { HTMLGenerator } from "./html-generator.ts";
import { BuilderServer } from "./builder-server.ts";
import type {
  Builder as IBuilder,
  BuilderConfig,
  BuildMode,
  BuildOptions,
  BuildProgressCallback,
  BuildResult,
  ClientConfig,
  ErrorStats,
  LogLevel,
  OptimizationSuggestion,
} from "./types.ts";
import { $tr, setEsbuildLocale } from "./i18n.ts";
import { logger } from "./utils/logger.ts";

/**
 * 构建器类
 */
export class Builder implements IBuilder {
  private config: BuilderConfig;
  private clientBuilder?: BuilderClient;
  private serverBuilder?: BuilderServer;
  /** 延迟初始化：首次 build 时再创建实例（静态导入，无动态加载） */
  private _cacheManager?: CacheManager | null;
  /** 延迟初始化：首次 build 时再创建实例（静态导入，无动态加载） */
  private _buildAnalyzer?: BuildAnalyzer;
  private watcher?: FileWatcher;
  private isWatching: boolean = false;
  /** Watch 模式下防抖重建的定时器 ID，stopWatch 时需清除以防泄漏 */
  private watchRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private logLevel: LogLevel = "info";
  private errorStats: ErrorStats = {
    total: 0,
    warnings: 0,
    errorsByType: {},
    recentErrors: [],
  };

  constructor(config: BuilderConfig) {
    this.config = config;

    // 设置包内 i18n 语言，后续 $tr 不再传 lang
    if (this.config.lang !== undefined) {
      setEsbuildLocale(this.config.lang);
    }

    // 设置日志级别
    this.logLevel = config.build?.logLevel || "info";

    // 验证构建配置（如果启用）- 异步验证，不阻塞构造函数
    if (config.validateConfig || config.build?.validateConfig) {
      this.validateBuilderConfig(config).catch((error) => {
        this.log(
          "error",
          $tr("log.esbuild.builder.configValidationFailed") + ":",
          error,
        );
      });
    }

    // BuildAnalyzer、CacheManager 延迟加载，首次 build() 时再初始化

    // 初始化客户端构建器（透传 lang）
    if (config.client) {
      this.clientBuilder = new BuilderClient({
        ...config.client,
        lang: config.client.lang ?? config.lang,
      });
    }

    // 初始化服务端构建器（透传 lang）
    if (config.server) {
      this.serverBuilder = new BuilderServer({
        ...config.server,
        lang: config.server.lang ?? config.lang,
      });
    }
  }

  /**
   * 延迟获取缓存管理器（首次 build 时再创建，静态导入无动态加载）
   */
  private getCacheManager(): CacheManager | undefined {
    if (this._cacheManager !== undefined) {
      return this._cacheManager ?? undefined;
    }
    const cacheEnabled = this.config.build?.cache !== false &&
      this.config.build?.cache !== undefined;
    if (!cacheEnabled) {
      this._cacheManager = null;
      return undefined;
    }
    const cacheDir = typeof this.config.build?.cache === "string"
      ? this.config.build.cache
      : undefined;
    this._cacheManager = new CacheManager(cacheDir, true);
    return this._cacheManager;
  }

  /**
   * 延迟获取构建分析器（首次 build 时再创建，静态导入无动态加载）
   */
  private getBuildAnalyzer(): BuildAnalyzer {
    if (!this._buildAnalyzer) {
      this._buildAnalyzer = new BuildAnalyzer(this.config.lang);
    }
    return this._buildAnalyzer;
  }

  /**
   * 构建服务端代码
   *
   * 优化：添加性能监控，记录各阶段耗时
   */
  async buildServer(options?: BuildOptions): Promise<BuildResult> {
    if (!this.serverBuilder) {
      throw new Error(
        $tr("log.esbuild.builder.serverNotConfigured"),
      );
    }

    const performance: { stages: Record<string, number>; total: number } = {
      stages: {},
      total: 0,
    };
    const buildStartTime = Date.now();

    // 合并构建选项
    const buildOptions = {
      ...this.config.build,
      ...options,
    };

    // 清理输出目录（如果需要）
    if (buildOptions.clean) {
      this.reportProgress(
        buildOptions,
        $tr("log.esbuild.builder.stageClean"),
        10,
        undefined,
        undefined,
        true,
      );
      const cleanStart = Date.now();
      await this.cleanServer();
      performance.stages.clean = Date.now() - cleanStart;
    }

    // 检查缓存（如果启用了缓存）
    let cacheCheckTime = 0;
    const cacheManager = this.getCacheManager();
    if (cacheManager && buildOptions.cache !== false) {
      this.reportProgress(
        buildOptions,
        $tr("log.esbuild.builder.stageCacheCheck"),
        20,
        undefined,
        undefined,
        true,
      );
      const cacheStart = Date.now();
      const entryFile = await resolve(this.config.server!.entry);
      const cacheKey = await cacheManager.getCacheKey(
        [entryFile],
        buildOptions,
      );
      const cachedResult = await cacheManager.getCachedResult(cacheKey);
      cacheCheckTime = Date.now() - cacheStart;
      performance.stages.cacheCheck = cacheCheckTime;
      if (cachedResult) {
        this.reportProgress(
          buildOptions,
          $tr("log.esbuild.builder.stageComplete"),
          100,
          undefined,
          undefined,
          true,
        );
        performance.total = Date.now() - buildStartTime;
        return {
          ...cachedResult,
          performance: {
            stages: performance.stages,
            total: performance.total,
          },
        };
      }
    }

    // 构建服务端
    this.reportProgress(
      buildOptions,
      $tr("log.esbuild.builder.stageBuild"),
      50,
      undefined,
      undefined,
      true,
    );
    const buildStart = Date.now();
    const result = await this.serverBuilder.build();
    performance.stages.build = Date.now() - buildStart;
    this.reportProgress(
      buildOptions,
      $tr("log.esbuild.builder.stageComplete"),
      100,
      undefined,
      undefined,
      true,
    );

    // 保存缓存（如果启用了缓存）
    if (cacheManager && buildOptions.cache !== false) {
      const entryFile = await resolve(this.config.server!.entry);
      const cacheKey = await cacheManager.getCacheKey(
        [entryFile],
        buildOptions,
      );
      await cacheManager.saveCache(cacheKey, result);
    }

    performance.total = Date.now() - buildStartTime;

    const finalResult = {
      ...result,
      performance: {
        stages: performance.stages,
        total: performance.total,
      },
    };

    // 输出性能报告（仅当无客户端构建时，联合构建由 build() 统一输出）
    if (performance.total > 0 && !this.clientBuilder) {
      logger.info(this.generatePerformanceReport(performance, buildOptions));
    }

    // 构建完成时立即输出产物列表（实时输出，路径从根 outputDir 开始如 server.js）
    if (this.config.server?.output) {
      this.logOutputFiles(finalResult.outputFiles, buildOptions);
    }

    return finalResult;
  }

  /**
   * 构建客户端代码
   *
   * 优化：添加性能监控，记录各阶段耗时
   */
  async buildClient(options?: BuildOptions): Promise<BuildResult> {
    if (!this.clientBuilder) {
      throw new Error(
        $tr("log.esbuild.builder.clientNotConfigured"),
      );
    }

    const performance: { stages: Record<string, number>; total: number } = {
      stages: {},
      total: 0,
    };
    const buildStartTime = Date.now();

    // 合并构建选项
    const buildOptions = {
      ...this.config.build,
      ...options,
    };

    const mode = buildOptions.mode || "prod";

    // 清理输出目录（如果需要）
    if (buildOptions.clean) {
      const cleanStart = Date.now();
      await this.cleanClient();
      performance.stages.clean = Date.now() - cleanStart;
    }

    // 检查缓存（如果启用了缓存）
    const cacheManager = this.getCacheManager();
    if (
      cacheManager && buildOptions.cache !== false &&
      this.config.client!.entry
    ) {
      const cacheStart = Date.now();
      const entryFile = await resolve(this.config.client!.entry);
      // 先尝试使用入口文件生成缓存键（快速检查）
      const cacheKey = await cacheManager.getCacheKey(
        [entryFile],
        buildOptions,
      );
      const cachedResult = await cacheManager.getCachedResult(cacheKey);
      performance.stages.cacheCheck = Date.now() - cacheStart;
      if (cachedResult) {
        performance.total = Date.now() - buildStartTime;
        return {
          ...cachedResult,
          performance: {
            stages: performance.stages,
            total: performance.total,
          },
        };
      }
    }

    // 构建客户端
    // 检查是否是多入口构建
    if (this.config.client!.entries) {
      return await this.buildMultipleEntries(
        buildOptions,
        mode,
        performance,
        buildStartTime,
      );
    }

    this.reportProgress(
      buildOptions,
      $tr("log.esbuild.builder.stageBuild"),
      50,
    );
    const buildStart = Date.now();
    const result = await this.clientBuilder.build(mode);
    performance.stages.build = Date.now() - buildStart;

    // 保存缓存（如果启用了缓存）
    // 优化：使用 metafile 生成包含依赖文件的缓存键
    if (
      cacheManager && buildOptions.cache !== false &&
      this.config.client!.entry
    ) {
      const entryFile = await resolve(this.config.client!.entry);
      const cacheKey = await cacheManager.getCacheKey(
        [entryFile],
        buildOptions,
        result.metafile,
      );
      await cacheManager.saveCache(cacheKey, result);
    }

    // 分析构建结果（如果生成了 metafile）
    if (result.metafile && typeof result.metafile === "object") {
      try {
        const buildAnalyzer = this.getBuildAnalyzer();
        const analysis = buildAnalyzer.analyze(
          result.metafile as any,
        );
        // 可以将分析结果附加到 result 中，或者输出到控制台
        // 这里暂时只分析，不修改 result
        if (mode === "dev") {
          logger.info(buildAnalyzer.generateReport(analysis));

          // 生成优化建议
          const suggestions = buildAnalyzer
            .generateOptimizationSuggestions(
              analysis,
              performance,
            );
          if (suggestions.length > 0) {
            this.logOptimizationSuggestions(suggestions);
          }

          // 生成 HTML 报告（如果配置了）
          if (buildOptions.reportHTML !== false) {
            const reportPath = typeof buildOptions.reportHTML === "string"
              ? buildOptions.reportHTML
              : `${this.config.client!.output}/build-report.html`;
            try {
              await buildAnalyzer.generateHTMLReport(
                analysis,
                reportPath,
                performance,
              );
              this.log(
                "info",
                `📊 ${
                  $tr("log.esbuild.builder.reportGenerated")
                }: ${reportPath}`,
              );
            } catch (error) {
              this.log(
                "warn",
                `${$tr("log.esbuild.builder.reportGenerateFailed")}: ${error}`,
              );
            }
          }
        }
      } catch (error) {
        // 分析失败不影响构建
        logger.warn(
          $tr("log.esbuild.builder.analysisFailed"),
          { error },
        );
      }
    }

    // 生成 HTML 文件
    if (this.config.client?.html) {
      this.reportProgress(
        buildOptions,
        $tr("log.esbuild.builder.stageHtml"),
        70,
      );
      const htmlStart = Date.now();
      const htmlGenerator = new HTMLGenerator(
        this.config.client.html,
        this.config.client.output,
      );

      // 从构建结果中提取 JS 和 CSS 文件
      const jsFiles = result.outputFiles.filter((file) => file.endsWith(".js"));
      const cssFiles = result.outputFiles.filter((file) =>
        file.endsWith(".css")
      );

      // 优化 CSS 文件（如果配置了）- 并行处理
      if (this.config.assets?.css && cssFiles.length > 0) {
        this.reportProgress(
          buildOptions,
          $tr("log.esbuild.builder.stageCss"),
          75,
          undefined,
          cssFiles.length,
        );
        const cssStart = Date.now();
        const cssOptimizer = new CSSOptimizer(this.config.assets.css);
        // 并行优化所有 CSS 文件
        await Promise.all(
          cssFiles.map((cssFile) => cssOptimizer.optimizeCSS(cssFile)),
        );
        performance.stages.css = Date.now() - cssStart;
      }

      await htmlGenerator.generate(jsFiles, cssFiles);
      performance.stages.html = Date.now() - htmlStart;
    }

    // 处理静态资源（如果配置了）
    if (this.config.assets && this.config.client) {
      this.reportProgress(
        buildOptions,
        $tr("log.esbuild.builder.stageAssets"),
        85,
      );
      const assetsStart = Date.now();
      // SSR 时需同时更新 server output 中的路径（服务端渲染的 HTML 含图片引用）
      const pathUpdateDirs = this.config.server?.output
        ? [
          this.config.server.output.endsWith(".js")
            ? dirname(resolve(this.config.server.output))
            : resolve(this.config.server.output),
        ]
        : [];
      const assetsProcessor = new AssetsProcessor(
        this.config.assets,
        this.config.client.output,
        pathUpdateDirs,
      );
      await assetsProcessor.processAssets();
      performance.stages.assets = Date.now() - assetsStart;
    }

    performance.total = Date.now() - buildStartTime;

    const finalResult = {
      ...result,
      performance: {
        stages: performance.stages,
        total: performance.total,
      },
    };

    // 验证构建产物
    this.validateBuildResult(finalResult, buildOptions);

    // 在开发模式下输出性能报告
    if (
      mode === "dev" && performance.total > 0 && !buildOptions.silent
    ) {
      logger.info(this.generatePerformanceReport(performance, buildOptions));
    }

    // 构建完成时立即输出产物列表（实时输出，路径从根 outputDir 开始如 server.js、client/xxx.js）
    if (this.config.client?.output) {
      this.logOutputFiles(finalResult.outputFiles, buildOptions);
    }

    return finalResult;
  }

  /**
   * 同时构建服务端和客户端
   *
   * 优化：并行构建服务端和客户端，减少总构建时间
   */
  async build(options?: BuildOptions): Promise<BuildResult> {
    if (this.config.lang !== undefined) setEsbuildLocale(this.config.lang);
    const buildStartTime = Date.now();
    const promises: Promise<BuildResult>[] = [];

    // 并行构建服务端和客户端，各自在完成时实时输出构建产物（不统一收集后打印）
    if (this.serverBuilder) {
      promises.push(this.buildServer(options));
    }

    if (this.clientBuilder) {
      promises.push(this.buildClient(options));
    }

    // 等待所有构建完成
    const results = await Promise.all(promises);

    // 计算总耗时（从开始到所有构建完成）
    const totalDuration = Date.now() - buildStartTime;
    const allOutputFiles = results.flatMap((result) => result.outputFiles);

    // 合并性能统计
    const combinedPerformance = this.mergePerformance(results);

    // 联合构建时统一输出性能报告
    if (
      this.serverBuilder && this.clientBuilder && combinedPerformance.total > 0
    ) {
      if (!options?.silent && !this.config.build?.silent) {
        const report = this.generatePerformanceReport(
          combinedPerformance,
          options,
        );
        for (const line of report.split("\n")) {
          if (line.trim()) logger.info(line);
        }
      }
    }

    return {
      outputFiles: allOutputFiles,
      duration: totalDuration,
      performance: combinedPerformance,
    };
  }

  /**
   * 合并多个构建结果的性能统计
   */
  private mergePerformance(results: BuildResult[]): {
    stages: Record<string, number>;
    total: number;
  } {
    const merged: { stages: Record<string, number>; total: number } = {
      stages: {},
      total: 0,
    };

    for (const result of results) {
      if (result.performance) {
        // 合并各阶段耗时（取最大值，因为并行执行）
        for (
          const [stage, duration] of Object.entries(
            result.performance.stages,
          )
        ) {
          merged.stages[stage] = Math.max(
            merged.stages[stage] || 0,
            duration,
          );
        }
        // 总耗时取最大值（并行执行的实际耗时）
        merged.total = Math.max(merged.total, result.performance.total);
      }
    }

    return merged;
  }

  /**
   * 生成性能报告
   *
   * @param performance 性能统计信息
   * @param options 构建选项（用于慢构建警告）
   * @returns 格式化的性能报告字符串
   */
  generatePerformanceReport(
    performance: {
      stages: Record<string, number>;
      total: number;
    },
    options?: BuildOptions,
  ): string {
    // 快速构建（<500ms）时仅输出单行
    if (performance.total > 0 && performance.total < 500) {
      return `${$tr("log.esbuild.builder.buildComplete")} (${
        this.formatDuration(performance.total)
      })`;
    }

    const lines: string[] = [];
    lines.push(
      `=== ${$tr("log.esbuild.builder.perfReportTitle")} ===\n`,
    );

    // 总耗时
    lines.push(
      `${$tr("log.esbuild.builder.perfTotal")}: ${
        this.formatDuration(performance.total)
      }\n`,
    );

    // 慢构建警告
    const threshold = options?.slowBuildThreshold ?? 5000; // 默认 5 秒
    if (performance.total > threshold) {
      const duration = this.formatDuration(performance.total);
      const thresholdStr = this.formatDuration(threshold);
      lines.push(
        `⚠️  ${
          $tr("log.esbuild.builder.perfSlowWarning", {
            duration,
            threshold: thresholdStr,
          })
        }`,
      );
      lines.push(
        `   ${$tr("log.esbuild.builder.perfSuggestHint")}`,
      );
      lines.push(
        `   - ${$tr("log.esbuild.builder.perfSuggestCache")}`,
      );
      lines.push(
        `   - ${$tr("log.esbuild.builder.perfSuggestAssets")}`,
      );
      lines.push(
        `   - ${$tr("log.esbuild.builder.perfSuggestParallel")}`,
      );
      lines.push("");
    }

    // 各阶段耗时
    if (Object.keys(performance.stages).length > 0) {
      lines.push($tr("log.esbuild.builder.perfStages") + "");
      const sortedStages = Object.entries(performance.stages)
        .sort(([, a], [, b]) => b - a);

      // 识别构建瓶颈（耗时最长的阶段）
      // 只在总耗时超过 3 秒时才显示瓶颈警告，避免在快速构建时产生误导
      const maxDuration = Math.max(...Object.values(performance.stages));
      const bottleneckThreshold = performance.total * 0.5; // 超过总耗时 50% 的阶段
      const shouldShowBottleneck = performance.total > 3000; // 总耗时超过 3 秒才显示瓶颈警告

      for (const [stage, duration] of sortedStages) {
        const percentage = ((duration / performance.total) * 100).toFixed(1);
        // 只在总耗时较长时才标记瓶颈，避免在快速构建（如测试）时产生误导
        const isBottleneck = shouldShowBottleneck &&
          duration > bottleneckThreshold &&
          duration === maxDuration;
        const bottleneckMarker = isBottleneck
          ? ` ⚠️ (${$tr("log.esbuild.builder.perfBottleneck")})`
          : "";
        lines.push(
          `  ${this.formatStageName(stage)}: ${
            this.formatDuration(duration)
          } (${percentage}%)${bottleneckMarker}`,
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * 格式化阶段名称
   */
  private formatStageName(stage: string): string {
    const stageMap: Record<string, string> = {
      clean: $tr("log.esbuild.builder.stageNameClean"),
      cacheCheck: $tr("log.esbuild.builder.stageNameCacheCheck"),
      build: $tr("log.esbuild.builder.stageNameBuild"),
      assets: $tr("log.esbuild.builder.stageNameAssets"),
      html: $tr("log.esbuild.builder.stageNameHtml"),
      css: $tr("log.esbuild.builder.stageNameCss"),
    };
    return stageMap[stage] || stage;
  }

  /**
   * 格式化耗时
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * 验证构建器配置
   *
   * 检查配置选项的有效性，提供配置建议，验证路径是否存在
   */
  private async validateBuilderConfig(config: BuilderConfig): Promise<void> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 验证服务端配置
    if (config.server) {
      if (!config.server.entry) {
        errors.push(
          $tr("log.esbuild.builder.validateServerMissingEntry"),
        );
      } else {
        try {
          if (!(await exists(config.server.entry))) {
            errors.push(
              `${
                $tr("log.esbuild.builder.validateServerEntryNotExists")
              }: ${config.server.entry}`,
            );
          } else {
            const entryStat = await stat(config.server.entry);
            if (!entryStat.isFile) {
              errors.push(
                `${
                  $tr("log.esbuild.builder.validateServerEntryNotFile")
                }: ${config.server.entry}`,
              );
            }
          }
        } catch (error) {
          warnings.push(
            `${
              $tr("log.esbuild.builder.validateServerEntryError")
            }: ${config.server.entry} (${error})`,
          );
        }
      }
      if (!config.server.output) {
        errors.push(
          $tr("log.esbuild.builder.validateServerMissingOutput"),
        );
      }
    }

    // 验证客户端配置
    if (config.client) {
      if (!config.client.entry) {
        errors.push(
          $tr("log.esbuild.builder.clientMissingEntry"),
        );
      } else {
        try {
          if (!(await exists(config.client.entry))) {
            errors.push(
              `${
                $tr("log.esbuild.builder.validateClientEntryNotExists")
              }: ${config.client.entry}`,
            );
          } else {
            const entryStat = await stat(config.client.entry);
            if (!entryStat.isFile) {
              errors.push(
                `${
                  $tr("log.esbuild.builder.validateClientEntryNotFile")
                }: ${config.client.entry}`,
              );
            }
          }
        } catch (error) {
          warnings.push(
            `${
              $tr("log.esbuild.builder.validateClientEntryError")
            }: ${config.client.entry} (${error})`,
          );
        }
      }
      if (!config.client.output) {
        errors.push(
          $tr("log.esbuild.builder.clientMissingOutput"),
        );
      }
      if (!config.client.engine) {
        warnings.push(
          $tr("log.esbuild.builder.validateClientNoEngine"),
        );
      }
    }

    // 验证构建选项
    if (config.build) {
      if (config.build.cache === false) {
        warnings.push(
          $tr("log.esbuild.builder.validateCacheDisabled"),
        );
      }
    }

    // 验证依赖（如果启用）
    if (config.validateConfig || config.build?.validateConfig) {
      await this.validateDependencies(warnings);
    }

    // 输出警告
    if (warnings.length > 0) {
      this.log(
        "warn",
        $tr("log.esbuild.builder.validateConfigWarnings") +
          ":",
      );
      for (const warning of warnings) {
        this.log("warn", `  ⚠️  ${warning}`);
      }
    }

    // 输出错误
    if (errors.length > 0) {
      this.log(
        "error",
        $tr("log.esbuild.builder.validateConfigErrors") +
          ":",
      );
      for (const error of errors) {
        this.log(
          "error",
          $tr("log.esbuild.builder.validateOutputErrorLine", { error }),
        );
      }
      throw new Error(
        $tr("log.esbuild.builder.configValidationFailed"),
      );
    }
  }

  /**
   * 验证依赖是否满足
   *
   * 检查 package.json 或 deno.json 中的依赖是否满足构建需求
   */
  private async validateDependencies(
    warnings: string[],
  ): Promise<void> {
    try {
      const projectRoot = cwd();

      // 检查 package.json（Node.js/Bun 项目）
      const packageJsonPath = `${projectRoot}/package.json`;
      if (await exists(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(await readTextFile(packageJsonPath));
          const deps = {
            ...packageJson.dependencies || {},
            ...packageJson.devDependencies || {},
          };

          // 检查必需的依赖（esbuild 是必需的）
          if (!deps.esbuild && !deps["npm:esbuild"]) {
            warnings.push(
              $tr("log.esbuild.builder.validateEsbuildMissing"),
            );
          }
        } catch {
          // 忽略解析错误
        }
      }

      // 检查 deno.json（Deno 项目）
      const denoJsonPath = `${projectRoot}/deno.json`;
      if (await exists(denoJsonPath)) {
        try {
          const denoJson = JSON.parse(await readTextFile(denoJsonPath));
          const imports = denoJson.imports || {};

          // 检查 esbuild 导入
          const hasEsbuild = Object.keys(imports).some((key) =>
            imports[key].includes("esbuild") ||
            imports[key].includes("npm:esbuild")
          );

          if (!hasEsbuild) {
            warnings.push(
              $tr("log.esbuild.builder.validateEsbuildDenoMissing"),
            );
          }
        } catch {
          // 忽略解析错误
        }
      }
    } catch {
      // 依赖验证失败不影响构建
    }
  }

  /**
   * 日志输出方法（支持日志级别控制）
   */
  private log(level: LogLevel, ...args: unknown[]): void {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      silent: 4,
    };

    const currentLevel = levels[this.logLevel] ?? 1;
    const messageLevel = levels[level] ?? 1;

    // 统计错误和警告
    if (level === "error") {
      const message = typeof args[0] === "string" ? args[0] : String(args[0]);
      const error = args[1] instanceof Error ? args[1] : undefined;
      this.recordError(message, error);
    } else if (level === "warn") {
      this.errorStats.warnings++;
    }

    if (messageLevel < currentLevel) {
      return; // 日志级别不够，不输出
    }

    switch (level) {
      case "debug":
        logger.debug(args[0] as string, args.slice(1));
        break;
      case "info":
        logger.info(args[0] as string, args.slice(1));
        break;
      case "warn":
        logger.warn(args[0] as string, args.slice(1));
        break;
      case "error":
        logger.error(args[0] as string, args.slice(1));
        break;
      case "silent":
        // 不输出
        break;
    }
  }

  /**
   * 记录错误
   */
  private recordError(message: string, error?: Error): void {
    this.errorStats.total++;

    // 确定错误类型
    const errorType = error?.name || "Unknown";
    this.errorStats.errorsByType[errorType] =
      (this.errorStats.errorsByType[errorType] || 0) + 1;

    // 记录最近错误（最多保留 50 条）
    this.errorStats.recentErrors.push({
      message: message || error?.message ||
        $tr("log.esbuild.builder.unknownError"),
      type: errorType,
      timestamp: Date.now(),
      stack: error?.stack,
    });

    // 只保留最近 50 条错误
    if (this.errorStats.recentErrors.length > 50) {
      this.errorStats.recentErrors.shift();
    }
  }

  /**
   * 获取错误统计信息
   */
  getErrorStats(): ErrorStats {
    return { ...this.errorStats };
  }

  /**
   * 生成错误报告
   */
  generateErrorReport(): string {
    const stats = this.errorStats;
    const lines: string[] = [];

    lines.push(
      `=== ${$tr("log.esbuild.builder.errorReportTitle")} ===\n`,
    );
    lines.push(
      `${$tr("log.esbuild.builder.errorTotal")}: ${stats.total}`,
    );
    lines.push(
      `${$tr("log.esbuild.builder.errorWarnings")}: ${stats.warnings}\n`,
    );

    if (Object.keys(stats.errorsByType).length > 0) {
      lines.push(
        $tr("log.esbuild.builder.errorTypeStats") + ":",
      );
      const sortedTypes = Object.entries(stats.errorsByType)
        .sort(([, a], [, b]) => b - a);
      for (const [type, count] of sortedTypes) {
        lines.push(`  ${type}: ${count} 次`);
      }
      lines.push("");
    }

    if (stats.recentErrors.length > 0) {
      lines.push(
        $tr("log.esbuild.builder.errorRecent") + ":",
      );
      const recent = stats.recentErrors.slice(-10).reverse();
      for (const error of recent) {
        const time = new Date(error.timestamp).toLocaleString();
        lines.push(`  [${time}] ${error.type}: ${error.message}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 清除错误统计
   */
  clearErrorStats(): void {
    this.errorStats = {
      total: 0,
      warnings: 0,
      errorsByType: {},
      recentErrors: [],
    };
  }

  /**
   * 报告构建进度
   */
  private reportProgress(
    options: BuildOptions | undefined,
    stage: string,
    progress: number,
    currentFile?: string,
    totalFiles?: number,
    skipWhenCombined?: boolean,
  ): void {
    if (options?.silent || this.config.build?.silent) {
      return;
    }
    // 服务端+客户端联合构建时，仅由 buildClient 报告进度，避免重复
    if (skipWhenCombined && this.clientBuilder) {
      return;
    }

    if (options?.onProgress) {
      const progressInfo: BuildProgressCallback = {
        stage,
        progress: Math.min(100, Math.max(0, progress)),
        currentFile,
        totalFiles,
      };
      options.onProgress(progressInfo);
    }
    // 不再输出默认进度条，改为在构建结束时输出构建产物列表
  }

  /**
   * 输出构建产物文件列表
   * 路径从根 outputDir 开始，使用相对路径（如 server.js、client/chunk-xxx.js）
   *
   * @param outputFiles 构建产出的文件路径列表（可为绝对路径）
   * @param options 构建选项（用于 silent 判断）
   */
  private logOutputFiles(outputFiles: string[], options?: BuildOptions): void {
    if (
      options?.silent ||
      options?.skipOutputLog ||
      this.config.build?.silent
    ) {
      return;
    }

    const rootPath = cwd();

    if (outputFiles.length === 0) return;
    for (let file of outputFiles) {
      file = file.replace(rootPath + "/", "");
      file = file.startsWith(".") ? file : "./" + file;
      logger.info(file);
    }
  }

  /**
   * 验证构建产物
   *
   * 检查输出文件是否存在、文件大小是否合理、资源路径是否正确、HTML 格式是否正确等
   */
  private async validateBuildResult(
    result: BuildResult,
    options?: BuildOptions,
  ): Promise<void> {
    if (options?.silent || this.config.build?.silent) {
      return;
    }

    const warnings: string[] = [];
    const errors: string[] = [];

    // 验证输出文件（相对路径按 cwd 解析，Windows 下路径格式统一）
    for (const file of result.outputFiles) {
      const filePath = resolve(file);
      try {
        if (!(await exists(filePath))) {
          errors.push(
            `${$tr("log.esbuild.builder.outputFileNotExists")}: ${file}`,
          );
          continue;
        }

        const fileStat = await stat(filePath);
        if (fileStat.isFile) {
          // 检查文件大小（如果文件过大，发出警告）
          const sizeInMB = fileStat.size / (1024 * 1024);
          if (sizeInMB > 5) {
            warnings.push(
              $tr("log.esbuild.builder.fileTooLarge", {
                size: sizeInMB.toFixed(2),
                file,
              }),
            );
          }

          // 验证 HTML 文件格式
          if (filePath.endsWith(".html")) {
            await this.validateHTMLFile(filePath, warnings, errors);
          }

          // 验证资源路径（JS、CSS 文件中的资源引用）
          if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
            await this.validateResourcePaths(filePath, warnings);
          }
        }
      } catch (error) {
        errors.push(
          $tr("log.esbuild.builder.validateFileError", {
            file,
            error: String(error),
          }),
        );
      }
    }

    // 输出警告和错误
    if (warnings.length > 0) {
      logger.warn(
        $tr("log.esbuild.builder.validateOutputWarnings"),
        { warnings },
      );
      for (const warning of warnings) {
        logger.warn(
          $tr("log.esbuild.builder.validateOutputWarningLine", { warning }),
        );
      }
    }

    if (errors.length > 0) {
      logger.error(
        $tr("log.esbuild.builder.validateOutputErrors"),
        { errors },
      );
      for (const error of errors) {
        logger.error(
          $tr("log.esbuild.builder.validateOutputErrorLine", { error }),
        );
      }
      throw new Error(
        $tr("log.esbuild.builder.validateOutputFailed"),
      );
    }
  }

  /**
   * 验证 HTML 文件格式
   */
  private async validateHTMLFile(
    filePath: string,
    warnings: string[],
    errors: string[],
  ): Promise<void> {
    try {
      const content = await readTextFile(filePath);

      // 检查基本 HTML 结构
      if (!content.includes("<!DOCTYPE") && !content.includes("<html")) {
        warnings.push(
          $tr("log.esbuild.builder.validateHtmlMissingDoctype", { filePath }),
        );
      }

      // 简单检查：script 和 link 标签是否有正确的属性
      const scriptTags = content.match(/<script[^>]*>/g) || [];
      for (const tag of scriptTags) {
        if (!tag.includes("src=") && !tag.includes("type=")) {
          warnings.push(
            $tr("log.esbuild.builder.validateHtmlScriptMissingSrc", {
              filePath,
            }),
          );
        }
      }

      const linkTags = content.match(/<link[^>]*>/g) || [];
      for (const tag of linkTags) {
        if (tag.includes('rel="stylesheet"') && !tag.includes("href=")) {
          errors.push(
            $tr("log.esbuild.builder.validateHtmlLinkMissingHref", {
              filePath,
            }),
          );
        }
      }
    } catch (error) {
      warnings.push($tr("log.esbuild.builder.validateHtmlFileError", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * 验证资源路径
   */
  private async validateResourcePaths(
    filePath: string,
    warnings: string[],
  ): Promise<void> {
    try {
      const content = await readTextFile(filePath);

      // 检查 CSS 文件中的 url() 引用
      if (filePath.endsWith(".css")) {
        const urlMatches = content.match(/url\(['"]?([^'")]+)['"]?\)/g) || [];
        for (const match of urlMatches) {
          const pathMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/);
          if (pathMatch && pathMatch[1]) {
            const resourcePath = pathMatch[1];
            // 跳过绝对路径、数据 URI 和网络路径
            if (
              !resourcePath.startsWith("http://") &&
              !resourcePath.startsWith("https://") &&
              !resourcePath.startsWith("data:") &&
              !resourcePath.startsWith("/")
            ) {
              // 检查相对路径是否存在（简化检查）
              const dir = filePath.substring(0, filePath.lastIndexOf("/"));
              const fullPath = dir + "/" + resourcePath;
              if (!(await exists(fullPath))) {
                warnings.push(
                  $tr("log.esbuild.builder.validateCssResourceMissing", {
                    resourcePath,
                    filePath,
                  }),
                );
              }
            }
          }
        }
      }

      // 检查 JS 文件中的 import 路径（简化检查）
      if (filePath.endsWith(".js")) {
        // 这里可以添加更复杂的路径验证逻辑
        // 目前只做基本检查，不进行详细验证
      }
    } catch {
      // 验证失败不影响构建
    }
  }

  /**
   * 清理构建产物
   */
  async clean(): Promise<void> {
    await Promise.all([
      this.cleanServer(),
      this.cleanClient(),
    ]);
  }

  /**
   * 清理服务端构建产物
   */
  private async cleanServer(): Promise<void> {
    if (!this.config.server) {
      return;
    }

    try {
      await remove(this.config.server.output, { recursive: true });
      await mkdir(this.config.server.output, { recursive: true });
    } catch {
      // 忽略错误（目录可能不存在）
    }
  }

  /**
   * 清理客户端构建产物
   */
  private async cleanClient(): Promise<void> {
    if (!this.config.client) {
      return;
    }

    try {
      await remove(this.config.client.output, { recursive: true });
      await mkdir(this.config.client.output, { recursive: true });
    } catch (_error) {
      // 忽略错误（目录可能不存在）
    }
  }

  /**
   * 启动 Watch 模式
   *
   * 监听文件变化，自动重新构建
   */
  async watch(options?: BuildOptions): Promise<void> {
    if (this.isWatching) {
      logger.warn(
        $tr("log.esbuild.builder.watchAlreadyRunning"),
      );
      return;
    }

    const watchOptions = options?.watch || this.config.build?.watch;
    if (!watchOptions || watchOptions.enabled === false) {
      throw new Error(
        $tr("log.esbuild.builder.watchNotEnabled"),
      );
    }

    // 确定监听路径
    const watchPaths = watchOptions.paths || [];
    if (watchPaths.length === 0) {
      // 如果没有指定路径，使用入口文件所在目录
      if (this.config.client?.entry) {
        const entryFile = await resolve(this.config.client.entry);
        watchPaths.push(dirname(entryFile));
      }
      if (this.config.server?.entry) {
        const entryFile = await resolve(this.config.server.entry);
        watchPaths.push(dirname(entryFile));
      }
    }

    if (watchPaths.length === 0) {
      throw new Error(
        $tr("log.esbuild.builder.watchNoPaths"),
      );
    }

    // 创建文件监听器
    this.watcher = watchFs(watchPaths, {
      recursive: watchOptions.recursive ?? true,
      exclude: watchOptions.ignore,
    });

    this.isWatching = true;
    logger.info(
      `${$tr("log.esbuild.builder.watchStart")}: ${watchPaths.join(", ")}`,
    );

    // 首次构建
    await this.build(options);

    // 监听文件变化
    const debounceTime = watchOptions.debounce || 300;

    (async () => {
      for await (const event of this.watcher!) {
        if (!this.isWatching) {
          break;
        }

        // 过滤文件变化事件
        const relevantEvents = event.paths.filter((path) => {
          // 忽略输出目录
          if (
            this.config.client?.output &&
            path.startsWith(this.config.client.output)
          ) {
            return false;
          }
          if (
            this.config.server?.output &&
            path.startsWith(this.config.server.output)
          ) {
            return false;
          }
          return true;
        });

        if (relevantEvents.length === 0) {
          continue;
        }

        // 调用回调函数
        if (watchOptions.onFileChange) {
          for (const path of relevantEvents) {
            try {
              await watchOptions.onFileChange(path, event.kind);
            } catch (error) {
              logger.error(
                $tr("log.esbuild.builder.watchCallbackFailed"),
                { error },
              );
            }
          }
        }

        // 防抖：延迟重新构建
        if (this.watchRebuildTimer !== null) {
          clearTimeout(this.watchRebuildTimer);
          this.watchRebuildTimer = null;
        }

        this.watchRebuildTimer = setTimeout(async () => {
          this.watchRebuildTimer = null;
          try {
            if (!this.isWatching) return;
            logger.info(
              $tr("log.esbuild.builder.watchRebuildStart"),
            );
            await this.build(options);
            logger.info(
              $tr("log.esbuild.builder.watchRebuildComplete"),
            );
          } catch (error) {
            logger.error(
              $tr("log.esbuild.builder.watchRebuildFailed"),
              { error },
            );
          }
        }, debounceTime) as unknown as number;
      }
    })().catch((error) => {
      logger.error($tr("log.esbuild.builder.watchError"), {
        error,
      });
      this.isWatching = false;
    });
  }

  /**
   * 停止 Watch 模式
   */
  stopWatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      this.isWatching = false;
      // 清除待执行的重建定时器，防止内存泄漏
      if (this.watchRebuildTimer !== null) {
        clearTimeout(this.watchRebuildTimer);
        this.watchRebuildTimer = null;
      }
      logger.info(
        $tr("log.esbuild.builder.watchStopped"),
      );
    }
  }

  /**
   * 多入口并行构建
   *
   * 并行处理多个入口，共享依赖提取，减少构建时间
   */
  private async buildMultipleEntries(
    buildOptions: BuildOptions,
    mode: BuildMode,
    performance: { stages: Record<string, number>; total: number },
    buildStartTime: number,
  ): Promise<BuildResult> {
    const entries = this.config.client!.entries!;
    const entryNames = Object.keys(entries);

    this.reportProgress(
      buildOptions,
      $tr("log.esbuild.builder.buildEntries", {
        count: String(entryNames.length),
      }),
      20,
    );

    // 并行构建所有入口
    const buildPromises = entryNames.map(async (name) => {
      const entryConfig = entries[name];
      const entryFile = await resolve(entryConfig.entry);
      const outputDir = entryConfig.output || this.config.client!.output;

      // 为每个入口创建独立的构建器配置
      const entryClientConfig: ClientConfig = {
        ...this.config.client!,
        entry: entryFile,
        output: outputDir,
      };

      const entryBuilder = new BuilderClient(entryClientConfig);
      return {
        name,
        result: await entryBuilder.build(mode),
        entryFile,
        outputDir,
      };
    });

    const buildStart = Date.now();
    const buildResults = await Promise.all(buildPromises);
    performance.stages.build = Date.now() - buildStart;

    // 合并所有构建结果
    const allOutputFiles = buildResults.flatMap((r) => r.result.outputFiles);
    const allMetafiles = buildResults
      .map((r) => r.result.metafile)
      .filter((m): m is NonNullable<typeof m> => m != null);

    // 分析所有构建结果
    if (allMetafiles.length > 0 && mode === "dev") {
      try {
        const buildAnalyzer = this.getBuildAnalyzer();
        // 合并所有 metafile（简化版：只分析第一个）
        const combinedAnalysis = buildAnalyzer.analyze(
          allMetafiles[0] as any,
        );
        logger.info(buildAnalyzer.generateReport(combinedAnalysis));

        const suggestions = buildAnalyzer.generateOptimizationSuggestions(
          combinedAnalysis,
          performance,
        );
        if (suggestions.length > 0) {
          this.logOptimizationSuggestions(suggestions);
        }

        // 生成 HTML 报告（如果配置了）
        if (buildOptions.reportHTML !== false) {
          const reportPath = typeof buildOptions.reportHTML === "string"
            ? buildOptions.reportHTML
            : `${this.config.client!.output}/build-report.html`;
          try {
            await buildAnalyzer.generateHTMLReport(
              combinedAnalysis,
              reportPath,
              performance,
            );
            this.log(
              "info",
              `📊 ${$tr("log.esbuild.builder.reportGenerated")}: ${reportPath}`,
            );
          } catch (error) {
            this.log(
              "warn",
              `${$tr("log.esbuild.builder.reportGenerateFailed")}: ${error}`,
            );
          }
        }
      } catch (error) {
        logger.warn(
          $tr("log.esbuild.builder.analysisFailed"),
          { error },
        );
      }
    }

    // 生成 HTML 文件（如果配置了多入口 HTML）
    if (this.config.client?.html?.entries) {
      this.reportProgress(
        buildOptions,
        $tr("log.esbuild.builder.stageHtml"),
        70,
      );
      const htmlStart = Date.now();
      const htmlGenerator = new HTMLGenerator(
        this.config.client.html,
        this.config.client.output,
      );

      // 为每个入口生成对应的 JS/CSS 文件映射
      const jsFilesMap: { [name: string]: string[] } = {};
      const cssFilesMap: { [name: string]: string[] } = {};

      for (const { name, result } of buildResults) {
        jsFilesMap[name] = result.outputFiles.filter((f) => f.endsWith(".js"));
        cssFilesMap[name] = result.outputFiles.filter((f) =>
          f.endsWith(".css")
        );
      }

      await htmlGenerator.generateMultiple(
        this.config.client.html.entries,
        jsFilesMap,
        cssFilesMap,
      );
      performance.stages.html = Date.now() - htmlStart;
    }

    performance.total = Date.now() - buildStartTime;

    // 输出构建产物列表（路径从根 outputDir 开始）
    this.logOutputFiles(allOutputFiles, buildOptions);

    return {
      outputFiles: allOutputFiles,
      metafile: allMetafiles[0] || undefined,
      duration: performance.total,
      performance: {
        stages: performance.stages,
        total: performance.total,
      },
    };
  }

  /**
   * 输出优化建议
   */
  /**
   * 输出优化建议
   */
  private logOptimizationSuggestions(
    suggestions: OptimizationSuggestion[],
  ): void {
    logger.info(
      `\n=== ${$tr("log.esbuild.builder.optimizationSuggestions")} ===\n`,
    );

    for (const suggestion of suggestions) {
      const icon = suggestion.type === "error"
        ? "❌"
        : suggestion.type === "warning"
        ? "⚠️"
        : "ℹ️";
      logger.info(`${icon} ${suggestion.title}`);
      logger.info(`   ${suggestion.description}`);
      if (suggestion.fix) {
        logger.info(
          `   ${$tr("log.esbuild.builder.suggestionFix")}: ${suggestion.fix}`,
        );
      }
      if (suggestion.files && suggestion.files.length > 0) {
        const fileList = suggestion.files.slice(0, 5).join(", ");
        const more = suggestion.files.length > 5
          ? $tr("log.esbuild.builder.suggestionFilesMore", {
            count: String(suggestion.files.length),
          })
          : "";
        logger.info(
          `   ${
            $tr("log.esbuild.builder.suggestionFiles")
          }: ${fileList}${more}`,
        );
      }
      logger.info("");
    }
  }
}
