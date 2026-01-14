/**
 * @module @dreamer/esbuild/html-generator
 *
 * HTML 生成器
 *
 * 自动生成 HTML 文件，并注入打包后的 JS/CSS 文件
 */

import {
  join,
  readTextFile,
  resolve,
  writeTextFile,
} from "@dreamer/runtime-adapter";
import type { HTMLConfig, HTMLEntry } from "./types.ts";

/**
 * HTML 生成器类
 */
export class HTMLGenerator {
  private config: HTMLConfig;
  private outputDir: string;

  constructor(config: HTMLConfig, outputDir: string) {
    this.config = config;
    this.outputDir = outputDir;
  }

  /**
   * 生成 HTML 文件
   */
  async generate(
    jsFiles: string[],
    cssFiles: string[],
    outputPath: string = "index.html",
  ): Promise<string> {
    // 读取自定义模板（如果提供）
    let htmlTemplate = this.getDefaultTemplate();

    if (this.config.template) {
      try {
        const templatePath = await resolve(this.config.template);
        htmlTemplate = await readTextFile(templatePath);
      } catch (_error) {
        console.warn(
          `无法读取 HTML 模板: ${this.config.template}，使用默认模板`,
        );
      }
    }

    // 生成 CSS 标签
    const cssTags = cssFiles
      .map((file) => {
        const relativePath = this.getRelativePath(file);
        return `    <link rel="stylesheet" href="${relativePath}">`;
      })
      .join("\n");

    // 生成 JS 标签
    const jsTags = jsFiles
      .map((file) => {
        const relativePath = this.getRelativePath(file);
        return `    <script src="${relativePath}"></script>`;
      })
      .join("\n");

    // 生成预加载标签
    const preloadTags = this.generatePreloadTags(jsFiles, cssFiles);

    // 替换标题
    const title = this.config.title || "App";
    htmlTemplate = htmlTemplate.replace(
      /<title>.*?<\/title>/i,
      `<title>${title}</title>`,
    );

    // 注入预加载标签（在 </head> 之前，CSS 之前）
    if (preloadTags) {
      htmlTemplate = htmlTemplate.replace(
        /<\/head>/i,
        `${preloadTags}\n${cssTags ? cssTags + "\n" : ""}  </head>`,
      );
    } else if (cssTags) {
      // 如果没有预加载标签，只注入 CSS
      htmlTemplate = htmlTemplate.replace(
        /<\/head>/i,
        `${cssTags}\n  </head>`,
      );
    }

    // 注入 JS（在 </body> 之前）
    if (jsTags) {
      htmlTemplate = htmlTemplate.replace(
        /<\/body>/i,
        `${jsTags}\n  </body>`,
      );
    }

    // 写入文件
    const outputFilePath = join(this.outputDir, outputPath);
    await writeTextFile(outputFilePath, htmlTemplate);

    return outputFilePath;
  }

  /**
   * 生成多个 HTML 文件（多入口）
   */
  async generateMultiple(
    entries: { [name: string]: HTMLEntry },
    jsFilesMap: { [name: string]: string[] },
    cssFilesMap: { [name: string]: string[] },
  ): Promise<string[]> {
    const outputFiles: string[] = [];

    for (const [name, entry] of Object.entries(entries)) {
      const jsFiles = jsFilesMap[name] || [];
      const cssFiles = cssFilesMap[name] || [];

      // 使用自定义模板（如果提供）
      const htmlConfig: HTMLConfig = {
        template: entry.template || this.config.template,
        title: entry.title || this.config.title || "App",
        preload: this.config.preload, // 继承预加载配置
      };

      const generator = new HTMLGenerator(htmlConfig, this.outputDir);
      const outputPath = name === "index" ? "index.html" : `${name}.html`;
      const filePath = await generator.generate(jsFiles, cssFiles, outputPath);
      outputFiles.push(filePath);
    }

    return outputFiles;
  }

  /**
   * 获取相对路径
   */
  private getRelativePath(filePath: string): string {
    // 如果已经是相对路径，直接返回
    if (!filePath.startsWith("/") && !filePath.match(/^[A-Z]:/)) {
      return filePath;
    }

    // 计算相对于输出目录的路径
    // 简化处理：如果文件路径包含输出目录，则提取相对部分
    if (filePath.startsWith(this.outputDir)) {
      const relativePath = filePath.slice(this.outputDir.length);
      return relativePath.startsWith("/")
        ? relativePath.slice(1)
        : relativePath;
    }

    // 否则返回文件名
    const fileName = filePath.split("/").pop() || filePath.split("\\").pop() ||
      filePath;
    return fileName;
  }

  /**
   * 生成预加载标签
   */
  private generatePreloadTags(
    jsFiles: string[],
    cssFiles: string[],
  ): string {
    const preloadConfig = this.config.preload;
    if (!preloadConfig || preloadConfig.enabled === false) {
      return "";
    }

    const strategy = preloadConfig.strategy || "immediate";
    const types = preloadConfig.types || ["js", "css"];
    const match = preloadConfig.match;

    const preloadTags: string[] = [];

    // 处理 JS 文件
    if (types.includes("js")) {
      for (const file of jsFiles) {
        if (this.shouldPreload(file, match)) {
          const relativePath = this.getRelativePath(file);
          const as = "script";
          const crossorigin = strategy === "async" ? " crossorigin" : "";
          const rel = strategy === "defer" ? "prefetch" : "preload";
          preloadTags.push(
            `    <link rel="${rel}" href="${relativePath}" as="${as}"${crossorigin}>`,
          );
        }
      }
    }

    // 处理 CSS 文件
    if (types.includes("css")) {
      for (const file of cssFiles) {
        if (this.shouldPreload(file, match)) {
          const relativePath = this.getRelativePath(file);
          const as = "style";
          const rel = strategy === "defer" ? "prefetch" : "preload";
          preloadTags.push(
            `    <link rel="${rel}" href="${relativePath}" as="${as}">`,
          );
        }
      }
    }

    return preloadTags.join("\n");
  }

  /**
   * 判断是否应该预加载该文件
   */
  private shouldPreload(
    filePath: string,
    match?: RegExp | ((path: string) => boolean),
  ): boolean {
    if (!match) {
      return true; // 如果没有匹配规则，默认预加载所有文件
    }

    if (match instanceof RegExp) {
      return match.test(filePath);
    }

    if (typeof match === "function") {
      return match(filePath);
    }

    return false;
  }

  /**
   * 获取默认 HTML 模板
   */
  private getDefaultTemplate(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
  }
}
