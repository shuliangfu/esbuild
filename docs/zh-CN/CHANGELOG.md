# 变更日志

@dreamer/esbuild 的所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)， 版本遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.0.32] - 2026-02-22

### 变更

- Chore: JSR 发布 1.0.32。

---

## [1.0.31] - 2026-02-20

### 修复

- **服务端（Bun）**：使用 Bun 构建服务端时，输出的 `server.js`
  现已自动在文件头部注入 `globalThis.__DWEB_PROD__ = true;`，使 @dreamer/dweb
  在运行编译产物时以生产模式运行（不启用 HMR、不请求 `hmr-browser.ts`）。与
  esbuild 构建路径行为一致，修复 Bun 构建后执行 `bun run start` 时出现「ENOENT:
  hmr-browser.ts」的问题。

---

## [1.0.30] - 2026-02-19

### 变更

- **i18n**：i18n 在模块加载时自动初始化。`initEsbuildI18n`
  不再对外导出；调用方及
  各入口（mod、builder、bundle、client、server、css-injector）无需再调用。翻译函数
  `$tr` 在首次使用时若尚未初始化会自动初始化。需设置构建消息语言时请使用
  `setEsbuildLocale`。
- **依赖**：`@dreamer/console` 升级至 ^1.0.12，`@dreamer/runtime-adapter` 升级至
  ^1.0.15，`@dreamer/image` 升级至 ^1.0.2，`@dreamer/test` 升级至 ^1.0.10。

---

## [1.0.29] - 2026-02-19

### 变更

- **i18n**：翻译方法由 `$t` 重命名为 `$tr`，避免与全局 `$t`
  冲突。请将现有代码中本包消息改为使用 `$tr`。

---

## [1.0.28] - 2026-02-18

### 变更

- **配置**：从 `BuilderConfig`、`ClientConfig`、`ServerConfig`
  中移除可选翻译函数 `t`，新增可选
  `lang?: "en-US" | "zh-CN"`，用于控制错误信息、日志与报告的语言（默认由环境变量自动检测）。
- **文档**：在 README 中补充 `lang` 说明与「国际化（i18n）」章节；删除
  `docs/en-US/README.md`（根目录 README 即英文版）；中文 README
  的英文链接改为指向根目录。

### 新增

- **i18n**：补全 builder、server、analyzer（报告 HTML）、html-generator 的
  locale 键，替换 build-analyzer HTML 与 builder-server
  调试日志中的硬编码文案；服务端错误信息支持 `{stderr}` / `{entry}` 占位符。

---

## [1.0.27] - 2026-02-17

### 变更

- **Resolver（Deno）**：无扩展名 JSR 说明符改为用单一正则在 cache key 上匹配
  `.ts`/`.tsx`/`.jsx`/`.js`/`.mts`/`.mjs`，不再使用四个独立 `get` 分支。子路径与
  `pathForProtocol` 的正则限定为仅脚本扩展名，避免匹配 `.json`、`.d.ts`。统一
  脚本扩展名模式 `(tsx?|jsx?|mts|mjs)` 于 cache 查找与路径处理。

### 修复

- **测试（客户端解析器）**：路径别名与代码分割用例不再依赖 `Button.tsx`
  （react/jsx-runtime），改用仅 `.ts` 的 fixture，使 Deno 测试环境下无需 module
  cache 中的 `npm:react` 即可通过。去掉 try/catch，构建失败时用例失败而非
  静默通过。

---

## [1.0.26] - 2026-02-16

### 修复

- **测试（客户端解析器）**：在「应该能够解析路径别名（通过
  deno.json）」与「应该能够处理代码分割和相对路径导入」中为测试项目 `deno.json`
  增加 `react` 与 `react/jsx-runtime`，使 JSX
  用例（`Button.tsx`）能解析且构建成功，消除
  `builder-client-resolver.test.ts`、`build-client-resolver.test.ts` 的
  post-test 中 "Could not resolve react/jsx-runtime" 报错。

---

## [1.0.25] - 2026-02-16

### 修复

- **Builder**：在 `validateBuildResult` 中，对每个产出文件路径先执行
  `resolve(file)` 再调用 `exists`/`stat`，使相对路径按当前工作目录解析，修复
  Windows CI 下 `result.outputFiles`
  为相对或规范化不一致路径时的「构建产物验证失败」。

---

## [1.0.24] - 2026-02-15

### 修复

- **Resolver（Deno）**：在 Windows CI 上为 `deno info` 使用相对入口路径与原生
  `cwd`，使 `@dreamer/socket-io/client` 等 JSR
  子路径能正确解析。`buildModuleCache` 现向 `deno info` 传入
  `relative(workDir, entryPoint)` 作为入口（入口在 workDir
  外时退回绝对路径），子进程的 `cwd` 直接使用 `workDir`（不做正斜杠规范化），
  以便在 Windows 上子进程获得正确工作目录。

---

## [1.0.23] - 2026-02-15

### 新增

- **Resolver（Deno）**：完整支持 `.jsx` 视图文件。无扩展名的 JSR
  说明符在解析时会额外尝试 `.jsx` 与 `.js`（此前仅有
  `.ts`/`.tsx`），并返回带正确扩展名的 cache key，使 `onLoad` 获得正确
  loader，JSX 得以正确编译。
- **Resolver（Deno）**：JSR 子路径回退的 `buildCandidates` 现包含 `.jsx`、`.js`
  及 index 变体（`index.js`、`index.jsx` 及带这些扩展名的 `src/`），以便 JSR
  包下的 JSX 视图模块能解析并使用正确 loader 编译。
- **测试**：在 `resolver-advanced.test.ts` 中新增编译测试「本地 .jsx
  入口应被正确编译为 JSX（loader jsx）」—— 构建一个导入 `.jsx`
  组件的入口，断言产物包含 JSX 编译后的 marker，并验证 `.jsx` 使用 `jsx`
  loader（若被误当 TypeScript 解析会报 “Expected '>' but found”）。TSX
  编译测试已存在；`.tsx` 与 `.jsx` 现均有显式编译测试覆盖。

### 变更

- **Resolver（Deno）**：`getLoaderFromPath()` 对 `.jsx` 文件改为返回 loader
  `"jsx"`（JavaScript + JSX），仅对 `.tsx` 返回 `"tsx"`（TypeScript +
  JSX）。此前两者均用 `"tsx"`，可能错误处理纯 JSX；`.jsx` 视图文件现按预期使用
  esbuild 的 `jsx` loader 编译。
- **文档**：TEST_REPORT（中/英）与 README 测试章节已更新：Deno 用例数 568 →
  569、测试日期 2026-02-15、执行时间约 34s、resolver-advanced 用例数 16 →
  17，并补充 TSX/JSX 编译覆盖说明。

---

## [1.0.22] - 2026-02-13

### 修复

- **Resolver**：统一规范 `npm:/`、`jsr:/` 说明符（去掉协议后的前导斜杠），使
  `npm:/react-dom@19.2.4/client` 正确解析为 `npm:react-dom@19.2.4/client`。在
  getPackageImport、jsr/npm onResolve 与 onLoad 中应用。
- **Resolver**：对无扩展名的 JSR 相对路径先尝试 cache 中带 `.ts`/`.tsx` 的 key
  （如 `jsr:.../src/types` → `jsr:.../src/types.ts`），修复打包
  @dreamer/socket-io 客户端时的 “No matching export ... EnginePacketType” 报错。

### 变更

- **Resolver**：在 getPackageImport 中从右往左解析裸子路径（如
  `@dreamer/render/client/react` → base `@dreamer/render`、subpath
  `client/react`），使多级子路径正确命中项目 imports。
- **Resolver**：解析 `@scope/name` 与 `@scope/name/subpath` 时优先使用
  projectDir，确保始终使用项目的 deno.json。
- **Resolver**：JSR 子路径回退仅使用通用路径候选（不再写死 adapters）；npm/JSR
  子路径仅用缓存 + 路径拼接（不起子进程）。

---

## [1.0.21] - 2026-02-13

### 变更

- **Resolver**：所有 JSR/npm 依赖均以项目 `deno.json` 的 imports 为准（不再仅限
  `@dreamer/view`）。解析顶层 `jsr:` 或 `npm:`
  说明符时，若项目声明了同名包，则使用项目中的版本进行缓存查找，使项目依赖版本优先于传递依赖版本（例如
  render 锁定 view@1.0.2 而项目使用 view@1.0.5 时，以 1.0.5 为准）。

---

## [1.0.20] - 2026-02-14

### 变更

- **Resolver**：重写 Deno
  解析器（`resolver-deno.ts`）：客户端运行时（preact/react/@dreamer/view）强制打包，避免
  CDN external 导致水合时 `_H` 未定义；支持 npm 子路径相对路径解析（如
  `preact/jsx-runtime`）；deno-protocol 支持 `npm:` 与相对路径
  filter；裸说明符与裸子路径解析与项目配置一致。
- **BuilderClient**：移除临时调试日志（`[builder-client]` 与
  `[builder-client createContext]`）。

---

## [1.0.19] - 2026-02-14

### 变更

- **测试**：解析器高级测试改为在 `tests/data/resolver-advanced` 下生成文件（通过
  beforeAll + getTestOutputDir），测试结束后自动清理，不再在包根目录产生文件。
- **文档**：TEST_REPORT 与 README 测试报告章节已更新（Deno 568、Bun
  509；解析器高级 16 个、BuilderBundle 29
  个；补充解析器输出路径与自动清理说明）。

---

## [1.0.18] - 2026-02-13

### 修复

- **Resolver**：仅当 `@` 前为 `/` 时视为版本分隔符（如 `@scope/name@version`），
  避免 `jsr:@dreamer/runtime` 被解析成 version=dreamer、subpath=runtime，修复
  @dreamer/types、@dreamer/signal 等包的 fetch 与缓存查找。
- **Resolver**：本地路径无扩展名（Deno 缓存 hash）时用 cache key 决定 loader，
  使 .tsx 得到 loader tsx，修复 "Expected '>' but found 'className'"。
- **Resolver**：无版本 jsr 按 import 路径匹配缓存，主入口仅匹配「版本后无路径」
  的 key，不再假定 mod.ts。

### 变更

- **Resolver**：无版本 specifier（如
  `jsr:@dreamer/signal`）按包前缀匹配预构建缓存， 命中则不再走 fetch。

---

## [1.0.17] - 2026-02-13

### 变更

- **Resolver**：在 `getLocalPathFromCache` 中优先使用预构建模块缓存：对 `jsr:`
  specifier 先按与 `buildModuleCache` 相同的 key 格式
  （`jsr:scope@version/src/path.ext`）查找，命中则 onLoad 直接读缓存，不再走
  import.meta.resolve、子进程和 fetch，提升已有缓存时的编译效率。

### 修复

- **Resolver**：pathVariants 增加 `.tsx`、模糊匹配时统一去掉 `.tsx`，使
  route-page.tsx 等 JSR 子路径能从缓存命中。

---

## [1.0.16] - 2026-02-13

### 修复

- **Resolver**：当从 deno-protocol 的 importer 解析相对导入时（如
  `dom/element.ts` 引用 `./shared`），若 importer 的 resolveDir
  尚未进入缓存，插件现通过 `getLocalPathFromCache(protocolPath)` 查找 importer
  的本地路径，并基于该目录解析相对路径，使 JSR 包（如 @dreamer/view）可在不于
  deno.json 中导出这些子路径的情况下使用内部相对导入（如 `./dom/shared`）。

---

## [1.0.15] - 2026-02-13

### 修复

- **Resolver**：当 JSR 的 importer 带子路径（如
  `jsr:@dreamer/view@1.0.0-beta.27/router`）时，相对导入的 base
  改为包根而非子路径，使 `./meta` 解析为 `.../meta`（对应 JSR 的
  `"./meta"`）而非 `.../router/meta`，修复
  router/meta、router/route-page、context/signal 等 fetchJsrSourceViaMeta 返回
  null 的问题。

---

## [1.0.14] - 2026-02-13

### 修复

- **Resolver**：拼 JSR 相对导入的协议路径时（如从 `jsr:@dreamer/view/router` 的
  `./meta.ts`），子路径改为无扩展名（如 `.../meta`）以匹配 JSR exports（如
  `"./meta"`），并统一去掉路径中的版本前缀 `^`/`~`，使 `jsr:...@^1.0.0/...` 与
  `jsr:...@1.0.0/...` 解析为同一模块 key，修复 importer 带 ^ 时 meta
  等子路径未被打包或变成 `(void 0)` 的问题。

---

## [1.0.13] - 2026-02-13

### 修复

- **Resolver**：从 JSR 子路径解析相对导入时（如 `jsr:@dreamer/view/router` 引用
  `./meta.ts`），插件上下文的 `import.meta.resolve`
  无法得到项目缓存路径。相对路径 onResolve 现通过项目 `deno.json`
  起子进程将引用方解析为项目缓存中的 `file://`，再在磁盘上解析 相对路径，使 view
  项目使用本地缓存而非 fetch。

### 移除

- **Resolver**：移除 `resolveJsrRelativeFromMeta()` 及其基于 fetch 的
  fallback（通过 HTTP 拉取 JSR meta.json）；解析现仅依赖子进程 + 项目缓存。
- **测试**：移除 `resolver-view-subpath.test.ts`（仅覆盖已移除的 API）。

---

## [1.0.12] - 2026-02-13

### 修复

- **Resolver**：JSR 的 TSX 子路径（如
  `@dreamer/view/route-page`）因协议路径无扩展名 被按 TypeScript 解析而非
  TSX。`fetchJsrSourceViaMeta` 现返回 `resolvedPath` （如
  `src/route-page.tsx`），onLoad 用其调用 `getLoaderFromPath`，使 JSX （如
  `className`）被正确编译，解决 "Expected '>' but found 'className'" 报错。

---

## [1.0.11] - 2026-02-13

### 修复

- **Resolver**：从 JSR 子路径解析相对导入时（如 `@dreamer/view/store` 引用
  `./signal.ts`），按包 exports 解析为正确子路径（如 `.../signal`），避免错误
  解析为 `store/signal.ts` 导致打包得到 `(void 0)`。新增
  `resolveJsrRelativeFromMeta()`，并在相对路径 onResolve 的 fallback 中对 `jsr:`
  引用方调用。

### 新增

- **测试**：`resolver-view-subpath.test.ts` — 覆盖 store 相对导入（signal、
  effect、scheduler、proxy、types）经 JSR exports 解析；VIEW_LIKE_EXPORTS 与
  view 包 exports 对齐。

---

## [1.0.10] - 2026-02-10

### 修复

- **BuilderClient**：当 `config.output` 存在时始终设置 `outdir`，使在
  `splitting: false` 时构建仍能产出 `outputContents` / `outputFiles`，修复
  关闭代码分割时 dev 服务访问 `/main.js` 返回 HTML 的问题（如 @dreamer/view）。

---

## [1.0.9] - 2026-02-12

### 新增

- **BuilderClient**：为引擎 `"view"` 配置 JSX。当 `engine: "view"` 时，构建使用
  `jsx: "automatic"` 与 `jsxImportSource: "@dreamer/view"`，@dreamer/view
  项目打包后不再出现运行时报错 "React is not defined"。已在 `build()` 与
  `createContext()` 两处生效。

---

## [1.0.8] - 2026-02-11

### 新增

- **BuilderServer**：新增 `compileSolidRouteForSSR()`，用于 Solid 路由单文件 SSR
  编译（基于 esbuild-plugin-solid，`generate: "ssr"`）。从主入口及 `/server`
  子路径导出，供框架（如 @dreamer/dweb）使用。
- **测试**：新增 `builder-server-solid-ssr.test.ts`，覆盖 SSR 编译
  fixture、产物含服务端运行时（escape/ssrElement）、contentHash 缓存。

### 变更

- **文档**：更新 TEST_REPORT 与 README 测试统计（Deno 570、Bun 509 通过）。

---

## [1.0.7] - 2026-02-11

### 新增

- **BuilderClient**：客户端构建支持 Solid.js。`engine` 可选值增加 `"solid"`，与
  `preact`、`react` 并列；配置 `engine: "solid"` 时使用
  `jsxImportSource: "solid-js"`，并将 `solid-js` / `solid-js/` 作为 runtime
  external 处理。
- **测试**：在 `builder-client.test.ts` 中新增「多引擎 (preact / react /
  solid)」用例，覆盖 preact、react、solid 三种引擎的客户端构建。

### 变更

- **文档**：按语言拆分文档目录为 `docs/en-US/` 与 `docs/zh-CN/`，移除根目录
  `CHANGELOG.md`、`README-zh.md`、`CHANGELOG-zh.md`，统一文档链接（英文 →
  docs/en-US，中文 → docs/zh-CN），新增中文测试报告
  `docs/zh-CN/TEST_REPORT.md`。

---

## [1.0.6] - 2026-02-09

### 修复

- **Resolver**：新增 `fileUrlToPath` 辅助函数，规范化 Windows `file://`
  URL。解析 `file:///C:/Users/...` 时去掉开头的 `/`，使 `existsSync`
  能正确工作（如 `C:/Users/...` 而非 `/C:/Users/...`）。
- **Resolver**：当 `import.meta.resolve` 返回的 `file://` 路径不存在时（如
  Windows monorepo 缓存路径不一致），为 `npm:`
  包增加子进程回退，在项目目录下解析以获取正确的缓存路径。

---

## [1.0.5] - 2026-02-09

### 变更

- **Resolver**：重构 npm 子路径解析逻辑。不再解析 package.json exports（Deno
  工程不使用 package.json），改为通过子进程调用 Deno 的 `import.meta.resolve`
  解析子路径（如 `preact/jsx-runtime`）。新增 `runtimeResolveCache`
  避免同模块重复调用子进程。

### 新增

- **测试**：在 `resolver-advanced.test.ts` 中新增 npm 子路径解析测试（lodash/map
  通过 Deno import.meta.resolve 解析）。

---

## [1.0.4] - 2026-02-09

### 修复

- **Resolver**：在 `getLocalPathFromCache` 中增加 npm 子路径回退解析。当
  `npm:preact@x.x.x/jsx-runtime`（或类似子路径）无法直接解析时，从主包路径推导包根，并尝试常见子路径文件（如
  `jsx-runtime.mjs`、`jsx-runtime.js`、`jsx-runtime/index.mjs`）。修复 Preact
  混合应用 hydration 报错 `(void 0) is not a function`（因 esbuild 打包
  `preact/jsx-runtime` 时得到空 stub 模块导致）。

---

## [1.0.3] - 2026-02-08

### 新增

- **Resolver**：在传入 `debug: true` 时，为 React/Preact
  主包及子路径解析输出调试日志（projectDir、startDir、denoJson、import、importer），便于构建时排查问题（如
  dweb CSR/SSR 客户端构建）。

---

## [1.0.2] - 2026-02-08

### 新增

- **BuilderServer**：新增 `builder-server-bun.test.ts`，用于 Bun `buildWithBun`
  服务端构建测试（2 个用例，仅 Bun）

### 修复

- **BuilderServer**：`buildWithBun`
  解析入口时使用绝对路径，避免构建到错误文件（如 cwd 中存在 `main.ts` 时）

### 变更

- **文档**：更新 TEST_REPORT.md，补充 Deno/Bun 测试统计（Deno 518、Bun 503）
- **文档**：更新 README 与 README-zh 的测试徽章和统计表格

---

## [1.0.1] - 2026-02-08

### 修复

- **Resolver**：当 JSR 包中 `exports["./xxx.ts"]` 不存在时，回退尝试
  `exports["./xxx"]`。修复打包导入 `@dreamer/socket-io/client`
  的客户端代码时，无法解析 `EnginePacketType`、`SocketIOPacketType`
  的问题（client 模块内相对导入 `../types.ts` 导致）。
- **测试**：为 edge-cases 中「应该清理测试输出目录」测试禁用 leak 检测，避免 CI
  因异步 `readTextFile` 在测试期间完成而失败。

---

## [1.0.0] - 2026-02-06

### 新增

- **稳定版发布**：首个稳定版本，API 稳定
- **服务端编译**：基于 @dreamer/runtime-adapter 的服务端代码编译与打包
- **客户端打包**：基于 esbuild 的高性能打包
- **HTML 生成**：自动生成 HTML 入口、注入 JS/CSS
- **CSS 处理**：提取、优化、autoprefixer、cssnano
- **构建优化**：缓存、增量编译、Watch 模式
- **插件系统**：灵活插件架构
- **路径解析**：相对路径、npm 包、JSR 包自动解析
- **AssetsProcessor**：资源复制、图片压缩、格式转换
- **子路径导出**：`/builder`、`/client`、`/server`、`/bundle`、`/css-injector`
  按需导入
