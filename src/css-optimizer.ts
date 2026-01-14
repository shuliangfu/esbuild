/**
 * @module @dreamer/esbuild/css-optimizer
 *
 * CSS 优化器
 *
 * 负责 CSS 文件的压缩和优化
 */

import { readTextFile, writeTextFile } from "@dreamer/runtime-adapter";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import postcss from "postcss";
import type { CSSOptions } from "./types.ts";

/**
 * CSS 优化器
 */
export class CSSOptimizer {
  private config: CSSOptions;

  constructor(config: CSSOptions) {
    this.config = config;
  }

  /**
   * 优化 CSS 文件
   */
  async optimizeCSS(filePath: string): Promise<void> {
    const content = await readTextFile(filePath);

    let optimized = content;

    // 如果配置了自动前缀或压缩，使用 postcss
    if (this.config.autoprefix || this.config.minify) {
      optimized = await this.processWithPostCSS(optimized, filePath);
    } else if (this.config.minify) {
      // 只压缩，不使用 postcss
      optimized = this.minifyCSS(optimized);
    }

    // 如果内容有变化，写回文件
    if (optimized !== content) {
      await writeTextFile(filePath, optimized);
    }
  }

  /**
   * 使用 postcss 处理 CSS
   */
  private async processWithPostCSS(
    css: string,
    filePath: string,
  ): Promise<string> {
    const plugins: any[] = [];

    // 添加 autoprefixer（如果配置了）
    if (this.config.autoprefix) {
      plugins.push(autoprefixer());
    }

    // 添加 cssnano（如果配置了压缩）
    if (this.config.minify) {
      plugins.push(cssnano());
    }

    // 如果没有插件，直接返回原内容
    if (plugins.length === 0) {
      return css;
    }

    // 使用 postcss 处理
    const result = await postcss(plugins).process(css, {
      from: filePath,
      to: filePath,
    });

    return result.css;
  }

  /**
   * 压缩 CSS（简单实现，作为回退方案）
   *
   * 简单的 CSS 压缩实现：
   * - 移除注释
   * - 移除空白字符
   * - 移除不必要的分号
   */
  private minifyCSS(css: string): string {
    let result = css;

    // 移除单行注释（/* ... */）
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");

    // 移除多余的空白字符
    result = result.replace(/\s+/g, " ");

    // 移除选择器和属性之间的空白
    result = result.replace(/\s*{\s*/g, "{");
    result = result.replace(/\s*}\s*/g, "}");
    result = result.replace(/\s*:\s*/g, ":");
    result = result.replace(/\s*;\s*/g, ";");
    result = result.replace(/\s*,\s*/g, ",");

    // 移除最后一个分号（如果存在）
    result = result.replace(/;\s*}/g, "}");

    // 移除字符串前后的空白
    result = result.trim();

    return result;
  }
}
