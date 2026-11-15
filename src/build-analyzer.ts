/**
 * @module @dreamer/esbuild/build-analyzer
 *
 * 构建产物分析器
 *
 * 分析构建产物，提供文件大小、依赖关系等信息
 */

import { dirname, mkdir, writeTextFile } from "@dreamer/runtime-adapter";
import type * as esbuild from "esbuild";
import { $tr, type Locale, setEsbuildLocale } from "./i18n.ts";
import type { OptimizationSuggestion } from "./types.ts";

/**
 * 分析结果
 */
export interface AnalysisResult {
  /** 总文件大小（字节） */
  totalSize: number;
  /** 文件列表 */
  files: FileInfo[];
  /** 依赖关系图 */
  dependencies: DependencyGraph;
  /** 重复代码检测 */
  duplicates: DuplicateInfo[];
  /** 未使用的代码 */
  unused: string[];
}

/**
 * 文件信息
 */
export interface FileInfo {
  /** 文件路径 */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件类型 */
  type: "js" | "css" | "other";
  /** 依赖的文件 */
  imports: string[];
  /** 被哪些文件依赖 */
  importedBy: string[];
}

/**
 * 依赖关系图
 */
export interface DependencyGraph {
  [file: string]: {
    imports: string[];
    importedBy: string[];
  };
}

/**
 * 重复代码信息
 */
export interface DuplicateInfo {
  /** 重复的代码片段 */
  code: string;
  /** 出现的文件列表 */
  files: string[];
  /** 重复次数 */
  count: number;
}

/**
 * 构建产物分析器
 */
export class BuildAnalyzer {
  private lang?: Locale;

  constructor(lang?: Locale) {
    this.lang = lang;
  }

  /**
   * 分析构建产物
   */
  analyze(metafile: esbuild.Metafile): AnalysisResult {
    if (this.lang !== undefined) {
      setEsbuildLocale(this.lang);
    }
    const files: FileInfo[] = [];
    const dependencies: DependencyGraph = {};
    let totalSize = 0;

    // 分析输出文件
    for (const [outputPath, output] of Object.entries(metafile.outputs)) {
      const size = output.bytes;
      totalSize += size;

      const fileType = this.getFileType(outputPath);
      const imports = output.imports?.map((imp) => imp.path) || [];
      const importedBy: string[] = [];

      // 构建依赖关系
      dependencies[outputPath] = {
        imports,
        importedBy,
      };

      files.push({
        path: outputPath,
        size,
        type: fileType,
        imports,
        importedBy,
      });
    }

    // 构建反向依赖关系（importedBy）
    for (const file of files) {
      for (const importPath of file.imports) {
        const importedFile = files.find((f) => f.path === importPath);
        if (importedFile) {
          importedFile.importedBy.push(file.path);
          dependencies[importPath].importedBy.push(file.path);
        }
      }
    }

    // 检测重复代码（简化版：检测重复的导入）
    const duplicates = this.detectDuplicates(files);

    // 检测未使用的代码（简化版：检测未被导入的文件）
    const unused = this.detectUnused(files);

    return {
      totalSize,
      files,
      dependencies,
      duplicates,
      unused,
    };
  }

  /**
   * 获取文件类型
   */
  private getFileType(path: string): "js" | "css" | "other" {
    if (path.endsWith(".js")) {
      return "js";
    }
    if (path.endsWith(".css")) {
      return "css";
    }
    return "other";
  }

  /**
   * 检测重复代码
   *
   * 简化版：检测重复的导入路径
   */
  private detectDuplicates(files: FileInfo[]): DuplicateInfo[] {
    const importCounts: Map<string, string[]> = new Map();

    // 统计每个导入路径出现的文件
    for (const file of files) {
      for (const importPath of file.imports) {
        if (!importCounts.has(importPath)) {
          importCounts.set(importPath, []);
        }
        importCounts.get(importPath)!.push(file.path);
      }
    }

    // 找出重复的导入（出现在多个文件中）
    const duplicates: DuplicateInfo[] = [];
    for (const [importPath, fileList] of importCounts.entries()) {
      if (fileList.length > 1) {
        duplicates.push({
          code: importPath,
          files: fileList,
          count: fileList.length,
        });
      }
    }

    return duplicates;
  }

  /**
   * 检测未使用的代码
   *
   * 简化版：检测未被任何文件导入的文件
   */
  private detectUnused(files: FileInfo[]): string[] {
    const unused: string[] = [];

    for (const file of files) {
      // 如果文件没有被任何其他文件导入，且不是入口文件，则认为是未使用的
      if (file.importedBy.length === 0 && !this.isEntryFile(file.path)) {
        unused.push(file.path);
      }
    }

    return unused;
  }

  /**
   * 判断是否为入口文件
   */
  private isEntryFile(path: string): boolean {
    // 简化判断：包含 "main" 或 "index" 的文件可能是入口文件
    return path.includes("main") || path.includes("index");
  }

  /**
   * 生成分析报告（文本格式）
   */
  generateReport(result: AnalysisResult): string {
    const lines: string[] = [];

    lines.push(
      `=== ${$tr("log.esbuild.analyzer.reportTitle")} ===\n`,
    );

    // 总文件大小
    lines.push(
      `${$tr("log.esbuild.analyzer.totalSize")}: ${
        this.formatSize(result.totalSize)
      }\n`,
    );

    // 文件列表
    lines.push($tr("log.esbuild.analyzer.fileList") + ":");
    for (const file of result.files.sort((a, b) => b.size - a.size)) {
      lines.push(
        `  ${file.path}: ${this.formatSize(file.size)} (${file.type})`,
      );
    }

    // 重复代码
    if (result.duplicates.length > 0) {
      lines.push(
        `\n${$tr("log.esbuild.analyzer.duplicates")}:`,
      );
      for (const dup of result.duplicates) {
        lines.push(
          `  ${dup.code} ${
            $tr("log.esbuild.analyzer.dupInFiles", { count: String(dup.count) })
          }: ${dup.files.join(", ")}`,
        );
      }
    }

    // 未使用的代码
    if (result.unused.length > 0) {
      lines.push(
        `\n${$tr("log.esbuild.analyzer.unused")}:`,
      );
      for (const unused of result.unused) {
        lines.push(`  ${unused}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * 生成构建优化建议
   *
   * 基于分析结果，提供具体的优化建议
   */
  generateOptimizationSuggestions(
    analysis: AnalysisResult,
    performance?: { stages: Record<string, number>; total: number },
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 1. 检查过大的文件
    const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
    const largeFiles = analysis.files.filter((f) =>
      f.size > LARGE_FILE_THRESHOLD
    );
    if (largeFiles.length > 0) {
      suggestions.push({
        type: "warning",
        title: $tr("log.esbuild.analyzer.largeFilesTitle"),
        description: $tr("log.esbuild.analyzer.largeFilesDesc", {
          count: String(largeFiles.length),
        }),
        fix: $tr("log.esbuild.analyzer.largeFilesFix"),
        files: largeFiles.map((f) => f.path),
      });
    }

    // 2. 检查重复代码
    if (analysis.duplicates.length > 0) {
      const duplicateCount = analysis.duplicates.reduce(
        (sum, dup) => sum + dup.count,
        0,
      );
      suggestions.push({
        type: "info",
        title: $tr("log.esbuild.analyzer.dupCodeTitle"),
        description: $tr("log.esbuild.analyzer.dupCodeDesc", {
          places: String(analysis.duplicates.length),
          count: String(duplicateCount),
        }),
        fix: $tr("log.esbuild.analyzer.dupCodeFix"),
        files: analysis.duplicates.flatMap((dup) => dup.files),
      });
    }

    // 3. 检查未使用的代码
    if (analysis.unused.length > 0) {
      suggestions.push({
        type: "info",
        title: $tr("log.esbuild.analyzer.unusedTitle"),
        description: $tr("log.esbuild.analyzer.unusedDesc", {
          count: String(analysis.unused.length),
        }),
        fix: $tr("log.esbuild.analyzer.unusedFix"),
        files: analysis.unused,
      });
    }

    // 4. 检查构建性能
    if (performance) {
      const buildTime = performance.stages.build || 0;
      const totalTime = performance.total;
      if (buildTime > totalTime * 0.7) {
        suggestions.push({
          type: "warning",
          title: $tr("log.esbuild.analyzer.buildSlowTitle"),
          description: $tr("log.esbuild.analyzer.buildSlowDesc", {
            time: (buildTime / 1000).toFixed(2),
            pct: ((buildTime / totalTime) * 100).toFixed(1),
          }),
          fix: $tr("log.esbuild.analyzer.buildSlowFix"),
        });
      }

      // 检查是否有慢构建
      if (totalTime > 10000) {
        suggestions.push({
          type: "warning",
          title: $tr("log.esbuild.analyzer.totalSlowTitle"),
          description: $tr("log.esbuild.analyzer.totalSlowDesc", {
            time: (totalTime / 1000).toFixed(2),
          }),
          fix: $tr("log.esbuild.analyzer.totalSlowFix"),
        });
      }
    }

    // 5. 检查文件数量
    if (analysis.files.length > 50) {
      suggestions.push({
        type: "info",
        title: $tr("log.esbuild.analyzer.manyFilesTitle"),
        description: $tr("log.esbuild.analyzer.manyFilesDesc", {
          count: String(analysis.files.length),
        }),
        fix: $tr("log.esbuild.analyzer.manyFilesFix"),
      });
    }

    // 6. 检查总文件大小
    const totalSizeMB = analysis.totalSize / (1024 * 1024);
    if (totalSizeMB > 10) {
      suggestions.push({
        type: "warning",
        title: $tr("log.esbuild.analyzer.totalSizeTitle"),
        description: $tr("log.esbuild.analyzer.totalSizeDesc", {
          size: totalSizeMB.toFixed(2),
        }),
        fix: $tr("log.esbuild.analyzer.totalSizeFix"),
      });
    }

    return suggestions;
  }

  /**
   * 生成 HTML 格式的构建报告
   *
   * 包含可视化依赖图、文件大小统计、优化建议等
   */
  async generateHTMLReport(
    result: AnalysisResult,
    outputPath: string,
    performance?: { stages: Record<string, number>; total: number },
  ): Promise<string> {
    // 确保输出目录存在
    await mkdir(dirname(outputPath), { recursive: true });

    // 生成依赖图的 JSON 数据（用于可视化）
    const dependencyGraphData = this.generateDependencyGraphData(result);

    // 生成优化建议
    const suggestions = this.generateOptimizationSuggestions(
      result,
      performance,
    );

    // 生成 HTML 内容
    const html = this.generateHTMLContent(
      result,
      dependencyGraphData,
      suggestions,
      performance,
    );

    // 写入文件
    await writeTextFile(outputPath, html);

    return outputPath;
  }

  /**
   * 生成依赖图数据（用于可视化）
   */
  private generateDependencyGraphData(result: AnalysisResult): {
    nodes: Array<{ id: string; label: string; size: number; type: string }>;
    edges: Array<{ from: string; to: string }>;
  } {
    const nodes: Array<
      { id: string; label: string; size: number; type: string }
    > = [];
    const edges: Array<{ from: string; to: string }> = [];
    const nodeMap = new Map<string, number>();

    // 添加节点
    for (const file of result.files) {
      const nodeId = this.sanitizeId(file.path);
      nodeMap.set(file.path, nodes.length);
      nodes.push({
        id: nodeId,
        label: this.getFileName(file.path),
        size: file.size,
        type: file.type,
      });
    }

    // 添加边（依赖关系）
    for (const file of result.files) {
      const fromId = this.sanitizeId(file.path);
      for (const importPath of file.imports) {
        const toIndex = nodeMap.get(importPath);
        if (toIndex !== undefined) {
          const toFile = result.files[toIndex];
          const toId = this.sanitizeId(toFile.path);
          edges.push({ from: fromId, to: toId });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * 生成 HTML 内容
   */
  private generateHTMLContent(
    result: AnalysisResult,
    graphData: {
      nodes: Array<{ id: string; label: string; size: number; type: string }>;
      edges: Array<{ from: string; to: string }>;
    },
    suggestions: OptimizationSuggestion[],
    performance?: { stages: Record<string, number>; total: number },
  ): string {
    const totalSizeMB = (result.totalSize / (1024 * 1024)).toFixed(2);
    const buildTime = performance
      ? (performance.total / 1000).toFixed(2)
      : "N/A";

    return `<!DOCTYPE html>
<html lang="${this.lang === "zh-CN" ? "zh-CN" : "en-US"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${$tr("log.esbuild.analyzer.reportPageTitle")}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2em; margin-bottom: 10px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      color: #666;
      margin-top: 5px;
    }
    .section {
      background: white;
      padding: 25px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h2 {
      color: #667eea;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #eee;
    }
    .file-list {
      max-height: 400px;
      overflow-y: auto;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      padding: 10px;
      border-bottom: 1px solid #eee;
    }
    .file-item:hover {
      background: #f9f9f9;
    }
    .file-name {
      flex: 1;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
    }
    .file-size {
      color: #666;
      font-weight: bold;
    }
    .file-type {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      margin-left: 10px;
    }
    .file-type.js { background: #f0db4f; color: #323330; }
    .file-type.css { background: #264de4; color: white; }
    .file-type.other { background: #ccc; color: #333; }
    #dependency-graph {
      width: 100%;
      height: 600px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
    }
    .suggestion {
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 6px;
      border-left: 4px solid;
    }
    .suggestion.warning {
      background: #fff3cd;
      border-color: #ffc107;
    }
    .suggestion.info {
      background: #d1ecf1;
      border-color: #17a2b8;
    }
    .suggestion.error {
      background: #f8d7da;
      border-color: #dc3545;
    }
    .suggestion-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .suggestion-fix {
      margin-top: 8px;
      font-style: italic;
      color: #666;
    }
    .performance-stages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
    }
    .stage-item {
      text-align: center;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
    }
    .stage-time {
      font-size: 1.5em;
      font-weight: bold;
      color: #667eea;
    }
    .stage-label {
      color: #666;
      margin-top: 5px;
      font-size: 0.9em;
    }
  </style>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 ${$tr("log.esbuild.analyzer.reportPageTitle")}</h1>
      <p>${$tr("log.esbuild.analyzer.reportGeneratedAt")}: ${
      new Date().toLocaleString(this.lang === "zh-CN" ? "zh-CN" : "en-US")
    }</p>
    </header>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-value">${totalSizeMB} MB</div>
        <div class="stat-label">${$tr("log.esbuild.analyzer.totalSize")}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${result.files.length}</div>
        <div class="stat-label">${
      $tr("log.esbuild.analyzer.statFileCount")
    }</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${buildTime}s</div>
        <div class="stat-label">${
      $tr("log.esbuild.analyzer.statBuildTime")
    }</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${result.duplicates.length}</div>
        <div class="stat-label">${
      $tr("log.esbuild.analyzer.statDuplicates")
    }</div>
      </div>
    </div>

    ${
      performance
        ? `
    <div class="section">
      <h2>⏱️ ${$tr("log.esbuild.analyzer.sectionBuildPerf")}</h2>
      <div class="performance-stages">
        ${
          Object.entries(performance.stages).map(([stage, time]) => `
          <div class="stage-item">
            <div class="stage-time">${(time / 1000).toFixed(2)}s</div>
            <div class="stage-label">${this.getStageName(stage)}</div>
          </div>
        `).join("")
        }
      </div>
    </div>
    `
        : ""
    }

    <div class="section">
      <h2>📁 ${$tr("log.esbuild.analyzer.sectionFileList")}</h2>
      <div class="file-list">
        ${
      result.files.sort((a, b) => b.size - a.size).map((file) => `
          <div class="file-item">
            <span class="file-name">${this.escapeHtml(file.path)}</span>
            <span class="file-size">${this.formatSize(file.size)}</span>
            <span class="file-type ${file.type}">${file.type.toUpperCase()}</span>
          </div>
        `).join("")
    }
      </div>
    </div>

    <div class="section">
      <h2>🔗 ${$tr("log.esbuild.analyzer.sectionDependencyGraph")}</h2>
      <div id="dependency-graph"></div>
    </div>

    ${
      suggestions.length > 0
        ? `
    <div class="section">
      <h2>💡 ${$tr("log.esbuild.analyzer.sectionSuggestions")}</h2>
      ${
          suggestions.map((suggestion) => `
        <div class="suggestion ${suggestion.type}">
          <div class="suggestion-title">${
            this.escapeHtml(suggestion.title)
          }</div>
          <div>${this.escapeHtml(suggestion.description)}</div>
          ${
            suggestion.fix
              ? `<div class="suggestion-fix">${
                $tr("log.esbuild.analyzer.suggestionFixLabel")
              } ${this.escapeHtml(suggestion.fix)}</div>`
              : ""
          }
        </div>
      `).join("")
        }
    </div>
    `
        : ""
    }

    ${
      result.duplicates.length > 0
        ? `
    <div class="section">
      <h2>🔄 ${$tr("log.esbuild.analyzer.sectionDuplicates")}</h2>
      <div class="file-list">
        ${
          result.duplicates.map((dup) => `
          <div class="file-item">
            <span class="file-name">${this.escapeHtml(dup.code)}</span>
            <span class="file-size">${
            $tr("log.esbuild.analyzer.dupInFiles", {
              count: String(dup.count),
            })
          }</span>
          </div>
        `).join("")
        }
      </div>
    </div>
    `
        : ""
    }

    ${
      result.unused.length > 0
        ? `
    <div class="section">
      <h2>🗑️ ${$tr("log.esbuild.analyzer.sectionUnused")}</h2>
      <div class="file-list">
        ${
          result.unused.map((file) => `
          <div class="file-item">
            <span class="file-name">${this.escapeHtml(file)}</span>
          </div>
        `).join("")
        }
      </div>
    </div>
    `
        : ""
    }
  </div>

  <script>
    // 初始化依赖关系图
    const nodes = new vis.DataSet(${JSON.stringify(graphData.nodes)});
    const edges = new vis.DataSet(${JSON.stringify(graphData.edges)});

    const data = { nodes, edges };
    const options = {
      nodes: {
        shape: 'dot',
        size: 20,
        font: { size: 12 },
        borderWidth: 2,
        color: {
          border: '#667eea',
          background: '#fff',
          highlight: { border: '#764ba2', background: '#f0f0f0' }
        }
      },
      edges: {
        width: 1,
        color: { color: '#ccc', highlight: '#667eea' },
        smooth: { type: 'continuous' }
      },
      physics: {
        stabilization: { iterations: 200 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 200
      }
    };

    const container = document.getElementById('dependency-graph');
    const network = new vis.Network(container, data, options);

    // 根据文件类型设置节点颜色
    nodes.forEach(node => {
      const colorMap = {
        'js': { border: '#f0db4f', background: '#fff9e6' },
        'css': { border: '#264de4', background: '#e6edff' },
        'other': { border: '#ccc', background: '#f5f5f5' }
      };
      const colors = colorMap[node.type] || colorMap.other;
      nodes.update({ id: node.id, color: colors });
    });
  </script>
</body>
</html>`;
  }

  /**
   * 获取阶段名称（中文）
   */
  private getStageName(stage: string): string {
    const stageMap: Record<string, string> = {
      clean: $tr("log.esbuild.builder.stageNameClean"),
      cacheCheck: $tr("log.esbuild.builder.stageNameCacheCheck"),
      build: $tr("log.esbuild.builder.stageNameBuild"),
      moduleCache: $tr("log.esbuild.builder.stageNameModuleCache"),
      bundle: $tr("log.esbuild.builder.stageNameBundle"),
      assets: $tr("log.esbuild.builder.stageNameAssets"),
      html: $tr("log.esbuild.builder.stageNameHtml"),
      css: $tr("log.esbuild.builder.stageNameCss"),
    };
    return stageMap[stage] || stage;
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * 获取文件名（从路径中提取）
   */
  private getFileName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  /**
   * 清理 ID（用于 HTML 元素）
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, "_");
  }
}
