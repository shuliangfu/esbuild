# @dreamer/esbuild 测试报告

## 测试概览

- **测试库版本**：@dreamer/test@^1.0.0
- **运行时适配器版本**：@dreamer/runtime-adapter@^1.0.3
- **测试框架**：@dreamer/test（兼容 Deno 与 Bun）
- **测试日期**：2026-02-11
- **测试环境**：
  - Deno >= 2.0.0
  - Bun >= 1.0.0
  - esbuild >= 0.27.2

## 测试结果

### 总体统计

| 环境     | 总用例数 | 通过   | 失败 | 通过率  |
| -------- | -------- | ------ | ---- | ------- |
| **Deno** | 570      | 570 ✅ | 0    | 100% ✅ |
| **Bun**  | 509      | 509 ✅ | 0    | 100% ✅ |

- **执行时间**：约 53s（Deno `deno test -A`），约 4s（Bun `bun test`）

> **说明**：Bun 用例数较少，因 builder-server-bun.test.ts（2 个用例）仅在 Bun
> 下运行；部分测试使用 Deno 特性（jsr:、deno.json）仅在 Deno 下运行。

### 测试文件统计

| 测试文件                            | 用例数 | 状态        | 说明                                             |
| ----------------------------------- | ------ | ----------- | ------------------------------------------------ |
| `assets-processor-advanced.test.ts` | 15     | ✅ 全部通过 | 资源处理器高级功能                               |
| `assets-processor.test.ts`          | 13     | ✅ 全部通过 | 资源处理器基础功能                               |
| `browser-compile-socket-io.test.ts` | 5      | ✅ 全部通过 | 浏览器编译 Socket.IO 等                          |
| `browser-resolver.test.ts`          | 4      | ✅ 全部通过 | 浏览器解析器相对路径等                           |
| `build-analyzer-internal.test.ts`   | 9      | ✅ 全部通过 | 构建分析器内部方法                               |
| `build-analyzer.test.ts`            | 17     | ✅ 全部通过 | 构建分析器功能                                   |
| `build-client-resolver.test.ts`     | 6      | ✅ 全部通过 | 客户端构建路径解析                               |
| `builder-build-validation.test.ts`  | 6      | ✅ 全部通过 | 构建产物验证                                     |
| `builder-bundle.test.ts`            | 28     | ✅ 全部通过 | 简单打包器功能                                   |
| `builder-config-validation.test.ts` | 9      | ✅ 全部通过 | 构建配置验证                                     |
| `builder-error-handling.test.ts`    | 6      | ✅ 全部通过 | 构建错误处理                                     |
| `builder-internal-methods.test.ts`  | 11     | ✅ 全部通过 | Builder 内部方法                                 |
| `builder-multi-entry.test.ts`       | 5      | ✅ 全部通过 | 多入口构建                                       |
| `builder-performance.test.ts`       | 7      | ✅ 全部通过 | 构建性能监控                                     |
| `builder-watch.test.ts`             | 9      | ✅ 全部通过 | Watch 模式                                       |
| `builder.test.ts`                   | 17     | ✅ 全部通过 | Builder 基础功能                                 |
| `cache-manager-advanced.test.ts`    | 5      | ✅ 全部通过 | 缓存管理器高级功能                               |
| `cache-manager-cleanup.test.ts`     | 8      | ✅ 全部通过 | 缓存清理功能                                     |
| `cache-manager.test.ts`             | 16     | ✅ 全部通过 | 缓存管理器基础功能                               |
| `entry-exports.test.ts`             | 19     | ✅ 全部通过 | 子路径导出                                       |
| `builder-client-advanced.test.ts`   | 14     | ✅ 全部通过 | 客户端构建器高级功能                             |
| `builder-client-context.test.ts`    | 8      | ✅ 全部通过 | 客户端构建上下文                                 |
| `builder-client.test.ts`            | 32     | ✅ 全部通过 | 客户端构建器功能（含 preact/react/solid 多引擎） |
| `client-server-separation.test.ts`  | 14     | ✅ 全部通过 | 客户端-服务端代码分离                            |
| `css-import-handler.test.ts`        | 16     | ✅ 全部通过 | CSS 导入处理插件                                 |
| `css-injector.test.ts`              | 28     | ✅ 全部通过 | CSS 注入工具                                     |
| `css-integration.test.ts`           | 10     | ✅ 全部通过 | CSS 集成测试                                     |
| `css-optimizer-advanced.test.ts`    | 7      | ✅ 全部通过 | CSS 优化器高级功能                               |
| `css-optimizer.test.ts`             | 11     | ✅ 全部通过 | CSS 优化器基础功能                               |
| `edge-cases.test.ts`                | 11     | ✅ 全部通过 | 边界与异常场景                                   |
| `html-generator-advanced.test.ts`   | 8      | ✅ 全部通过 | HTML 生成器高级功能                              |
| `html-generator-internal.test.ts`   | 8      | ✅ 全部通过 | HTML 生成器内部方法                              |
| `html-generator.test.ts`            | 14     | ✅ 全部通过 | HTML 生成器功能                                  |
| `integration.test.ts`               | 8      | ✅ 全部通过 | 集成测试                                         |
| `plugin-advanced.test.ts`           | 5      | ✅ 全部通过 | 插件管理器高级功能                               |
| `plugin.test.ts`                    | 14     | ✅ 全部通过 | 插件管理器基础功能                               |
| `builder-server-advanced.test.ts`   | 19     | ✅ 全部通过 | 服务端构建器高级功能                             |
| `builder-server.test.ts`            | 16     | ✅ 全部通过 | 服务端构建器功能                                 |
| `server-module-detector.test.ts`    | 24     | ✅ 全部通过 | 服务端模块检测插件                               |
| `resolver-advanced.test.ts`         | 11     | ✅ 全部通过 | 解析器插件高级测试                               |
| `resolver.test.ts`                  | 18     | ✅ 全部通过 | 解析器插件                                       |
| `builder-server-resolver.test.ts`   | 5      | ✅ 全部通过 | 服务端构建器路径解析                             |
| `builder-server-solid-ssr.test.ts`  | 4      | ✅ 全部通过 | Solid 路由 SSR 编译（compileSolidRouteForSSR）   |
| `builder-server-bun.test.ts`        | 2      | ✅ 全部通过 | Bun buildWithBun 服务端构建                      |
| `builder-client-resolver.test.ts`   | 6      | ✅ 全部通过 | 客户端构建器路径解析                             |

## 功能测试摘要

- **资源处理**：AssetsProcessor 基础与高级（图片
  hash、压缩、pathUpdateDirs、字体等）
- **构建分析**：BuildAnalyzer 与内部方法（metafile 分析、报告、优化建议）
- **构建验证与错误**：构建产物验证、配置验证、错误统计与记录
- **Builder / BuilderClient /
  BuilderServer**：基础构建、多入口、Watch、清理、缓存、模式（dev/prod）、write
  参数、多引擎（preact/react/solid）
- **BuilderBundle**：ESM/IIFE/CJS、platform（browser/node/neutral）、globalName、minify、external
- **缓存**：CacheManager 与清理、过期、统计
- **客户端-服务端分离**：服务端模块检测、条件编译、.server. 文件
- **CSS**：导入处理、注入、优化、PostCSS/autoprefixer/cssnano、集成
- **HTML**：生成、预加载策略、多入口
- **插件**：PluginManager、onResolve/onLoad、链式与错误处理
- **解析器**：Deno/Bun 解析器、JSR/npm 子路径、路径别名、相对路径
- **Solid SSR**：Solid 路由单文件 SSR
  编译（compileSolidRouteForSSR）、contentHash 缓存
- **边界与集成**：空配置、无效路径、并发、大文件、错误恢复

## 测试覆盖要点

- **API**：Builder.build / buildClient / buildServer、BuilderClient.build /
  createContext / rebuild /
  dispose、BuilderServer.build、BuilderBundle.build、CacheManager、BuildAnalyzer、HTMLGenerator、CSSOptimizer、AssetsProcessor、PluginManager、解析器插件
- **边界**：空配置、不存在入口、无效输出目录、空入口、并发构建、大量入口、特殊字符路径、长路径、大文件
- **错误**：构建失败、配置校验失败、入口不存在、插件错误、缓存失效、模板不存在
- **特性**：多引擎（preact/react/solid）、write/mode、external、useNativeCompile、路径解析（deno.json、tsconfig）

## 优势

1. ✅ **完整构建链**：客户端与服务端编译、打包、优化
2. ✅ **插件体系**：灵活插件架构，支持自定义构建逻辑
3. ✅ **缓存**：智能缓存管理，提升构建速度
4. ✅ **增量构建**：Watch 与增量编译
5. ✅ **代码分割**：多种代码分割策略
6. ✅ **CSS 处理**：CSS 优化与注入
7. ✅ **HTML 生成**：自动生成 HTML 并注入资源
8. ✅ **构建分析**：产物分析与优化建议
9. ✅ **服务端模块检测**：自动排除服务端代码
10. ✅ **内存模式**：支持不写盘仅返回编译结果
11. ✅ **多平台**：Linux、macOS、Windows 编译
12. ✅ **运行时适配**：按 Deno/Bun 环境选择解析与构建
13. ✅ **路径解析**：相对路径、npm、JSR、路径别名（Deno/Bun）
14. ✅ **多引擎**：客户端构建支持 preact、react、solid

## 结论

@dreamer/esbuild 已完成全面测试，**全部通过**，通过率 **100%**。

**总用例数**：

- **570** 个用例（Deno `deno test -A`，全部通过）
- **509** 个用例（Bun `bun test`，全部通过）

**测试类型**：单元测试、集成测试、边界与错误处理。

**执行环境**：Deno 2.x、Bun 1.x、esbuild 0.27.x、PostCSS / Autoprefixer /
cssnano。

**可用于生产环境。**
