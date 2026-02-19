# Changelog

All notable changes to @dreamer/esbuild are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.29] - 2026-02-19

### Changed

- **i18n**: Renamed translation method from `$t` to `$tr` to avoid conflict with
  global `$t`. Update existing code to use `$tr` for package messages.

---

## [1.0.28] - 2026-02-18

### Changed

- **Config**: Removed optional translation function `t` from `BuilderConfig`,
  `ClientConfig`, and `ServerConfig`. Added optional `lang?: "en-US" | "zh-CN"`
  to control language for error messages, logs, and reports (default:
  auto-detected from env).
- **Docs**: Documented `lang` and added "Internationalization (i18n)" section in
  README. Removed `docs/en-US/README.md` (root README is the English version).
  Updated `docs/zh-CN/README.md` to link to root for English.

### Added

- **i18n**: Completed locale keys for builder, server, analyzer (report HTML),
  and html-generator; replaced hardcoded strings in build-analyzer HTML and
  builder-server debug logs. Server error messages support `{stderr}` /
  `{entry}` placeholders.

---

## [1.0.27] - 2026-02-17

### Changed

- **Resolver (Deno)**: Use a single regex to match extensionless JSR specifiers
  against cache keys (`.ts`/`.tsx`/`.jsx`/`.js`/`.mts`/`.mjs`) instead of four
  separate `get` branches. Restrict subpath and `pathForProtocol` patterns to
  script extensions only so `.json` and `.d.ts` are not matched. Unify script
  extension pattern `(tsx?|jsx?|mts|mjs)` across cache lookup and path handling.

### Fixed

- **Tests (client resolver)**: Path-alias and code-splitting tests no longer
  depend on `Button.tsx` (react/jsx-runtime). Use `.ts`-only fixtures so tests
  pass in Deno test env without `npm:react` in the module cache. Remove
  try/catch so build failures fail the test instead of passing silently.

---

## [1.0.26] - 2026-02-16

### Fixed

- **Tests (client resolver)**: Add `react` and `react/jsx-runtime` to test
  project `deno.json` in "路径别名（通过 deno.json）" and
  "应该能够处理代码分割和相对路径导入" so that JSX fixtures (`Button.tsx`)
  resolve and the build succeeds. Removes "Could not resolve react/jsx-runtime"
  from post-test output in `builder-client-resolver.test.ts` and
  `build-client-resolver.test.ts`.

---

## [1.0.25] - 2026-02-16

### Fixed

- **Builder**: In `validateBuildResult`, resolve each output file path with
  `resolve(file)` before `exists`/`stat` so that relative paths are resolved
  against the current working directory. Fixes "构建产物验证失败" (build output
  validation failed) on Windows CI when `result.outputFiles` contain relative or
  differently normalized paths.

---

## [1.0.24] - 2026-02-15

### Fixed

- **Resolver (Deno)**: Use relative entry path and native `cwd` for `deno info`
  on Windows CI so that `@dreamer/socket-io/client` and other JSR subpaths
  resolve correctly. `buildModuleCache` now passes
  `relative(workDir, entryPoint)` as the entry to `deno info` (fallback to
  absolute path when entry is outside workDir) and uses `workDir` as-is for
  subprocess `cwd` (no forward-slash normalization) so the child process gets
  the correct working directory on Windows.

---

## [1.0.23] - 2026-02-15

### Added

- **Resolver (Deno)**: Full support for `.jsx` view files. JSR specifiers
  without extension now try `.jsx` and `.js` in addition to `.ts` and `.tsx`
  when resolving; the returned cache key includes the correct extension so that
  `onLoad` receives the right loader and JSX is compiled correctly.
- **Resolver (Deno)**: JSR subpath fallback `buildCandidates` now includes
  `.jsx`, `.js`, and index variants (`index.js`, `index.jsx`, and `src/` with
  these extensions) so that JSX view modules under JSR packages resolve and
  compile with the correct loader.
- **Tests**: New compilation test in `resolver-advanced.test.ts` — "local .jsx
  entry should be compiled as JSX (loader jsx)" — which builds an entry that
  imports a `.jsx` component, asserts the bundle output contains the
  JSX-compiled marker, and verifies that `.jsx` files use the `jsx` loader
  (failure would show "Expected '>' but found" if mis-parsed as TypeScript). TSX
  compilation test was already present; both `.tsx` and `.jsx` are now covered
  by explicit compile tests.

### Changed

- **Resolver (Deno)**: `getLoaderFromPath()` now returns loader `"jsx"` for
  `.jsx` files (JavaScript + JSX) and `"tsx"` only for `.tsx` files
  (TypeScript + JSX). Previously both used `"tsx"`, which could mis-handle plain
  JSX; `.jsx` view files are now compiled with esbuild’s `jsx` loader as
  intended.
- **Docs**: TEST_REPORT (en/zh) and README test sections updated: Deno test
  count 568 → 569, test date 2026-02-15, execution time ~34s, resolver-advanced
  test count 16 → 17, and descriptions updated to mention TSX/JSX compile
  coverage.

---

## [1.0.22] - 2026-02-13

### Fixed

- **Resolver**: Normalize `npm:/` and `jsr:/` specifiers (strip leading slash
  after protocol) so that `npm:/react-dom@19.2.4/client` is resolved as
  `npm:react-dom@19.2.4/client`. Applied in `getPackageImport`, jsr/npm
  onResolve, and onLoad.
- **Resolver**: Resolve JSR relative paths without extension by trying cache
  keys with `.ts`/`.tsx` (e.g. `jsr:.../src/types` → `jsr:.../src/types.ts`),
  fixing "No matching export ... EnginePacketType" when bundling
  @dreamer/socket-io client.

### Changed

- **Resolver**: Resolve bare subpaths from right to left in `getPackageImport`
  (e.g. `@dreamer/render/client/react` → base `@dreamer/render`, subpath
  `client/react`) so multi-level subpaths match project imports correctly.
- **Resolver**: Prefer `projectDir` when resolving `@scope/name` and
  `@scope/name/subpath` so that the project's `deno.json` is always used.
- **Resolver**: JSR subpath fallback uses only generic path candidates (no
  hardcoded `adapters`); npm/JSR subpaths use cache + path concatenation only
  (no subprocess).

---

## [1.0.21] - 2026-02-13

### Changed

- **Resolver**: Prefer project `deno.json` imports for all JSR/npm dependencies
  (no longer limited to `@dreamer/view`). When resolving top-level `jsr:` or
  `npm:` specifiers, if the project declares the same package, the resolver uses
  the project's version for cache lookup so that the project's dependency
  versions take precedence over transitive dependency versions (e.g. render pins
  view@1.0.2 but project uses view@1.0.5 → 1.0.5 is used).

---

## [1.0.20] - 2026-02-14

### Changed

- **Resolver**: Rewrote Deno resolver (`resolver-deno.ts`): client runtime
  (preact/react/@dreamer/view) forced bundle to avoid CDN external and hydration
  `_H` undefined; npm relative path resolution for subpaths (e.g.
  `preact/jsx-runtime`); deno-protocol support for `npm:` and relative path
  filter; bare specifier and bare subpath resolution aligned with project
  config.
- **BuilderClient**: Removed temporary debug logging (`[builder-client]` and
  `[builder-client createContext]`).

---

## [1.0.19] - 2026-02-14

### Changed

- **Tests**: Resolver advanced tests now write output under
  `tests/data/resolver-advanced` (via `beforeAll` + `getTestOutputDir`) and
  clean up automatically after run; no generated files in package root.
- **Docs**: TEST_REPORT and README test report sections updated (Deno 568, Bun
  509; resolver-advanced 16 tests, BuilderBundle 29 tests; resolver output path
  and auto-cleanup noted).

---

## [1.0.18] - 2026-02-13

### Fixed

- **Resolver**: Only treat `@` as version separator when it is preceded by `/`
  (e.g. `@scope/name@version`), so `jsr:@dreamer/runtime` is parsed as
  scope/name `@dreamer/runtime` instead of version=dreamer, subpath=runtime.
  Fixes fetch and cache lookup for packages like @dreamer/types,
  @dreamer/signal.
- **Resolver**: Use cache key (with extension) for loader when the local path is
  extension-less (Deno cache hash), so `.tsx` files get loader `tsx` and
  "Expected '>' but found 'className'" is resolved.
- **Resolver**: Match cache by import path only for no-version jsr specifiers;
  main entry is the key with no path after version, no hardcoded `mod.ts`.

### Changed

- **Resolver**: No-version specifiers (e.g. `jsr:@dreamer/signal`) now match
  pre-built cache by package prefix; cache hit avoids fetch.

---

## [1.0.17] - 2026-02-13

### Changed

- **Resolver**: Prefer the pre-built module cache in `getLocalPathFromCache`:
  for `jsr:` specifiers, try the same key format as `buildModuleCache`
  (`jsr:scope@version/src/path.ext`) first so onLoad hits cache immediately and
  skips `import.meta.resolve`, subprocess, and fetch, improving compile
  performance when the cache is already populated.

### Fixed

- **Resolver**: Add `.tsx` to pathVariants and normalize `.tsx` in fuzzy match
  so JSR subpaths like `route-page.tsx` are found from cache.

---

## [1.0.16] - 2026-02-13

### Fixed

- **Resolver**: When resolving relative imports from a deno-protocol importer
  (e.g. `dom/element.ts` importing `./shared`), if the importer's resolveDir was
  not yet in the cache, the plugin now looks up the importer's local path via
  `getLocalPathFromCache(protocolPath)` and resolves the relative path against
  that directory. This allows JSR packages (e.g. @dreamer/view) to use internal
  relative imports (e.g. `./dom/shared`) without exporting those subpaths in
  deno.json.

---

## [1.0.15] - 2026-02-13

### Fixed

- **Resolver**: For JSR importers with a subpath (e.g.
  `jsr:@dreamer/view@1.0.0-beta.27/router`), the base for relative imports is
  now the package root instead of the subpath. This makes `./meta` resolve to
  `.../meta` (matching JSR exports like `"./meta"`) instead of
  `.../router/meta`, fixing `fetchJsrSourceViaMeta` returning null for
  router/meta, router/route-page, context/signal, etc.

---

## [1.0.14] - 2026-02-13

### Fixed

- **Resolver**: When building the protocol path for JSR relative imports (e.g.
  `./meta.ts` from `jsr:@dreamer/view/router`), use subpath without extension
  (e.g. `.../meta`) to match JSR exports (e.g. `"./meta"`), and normalize the
  version in the path (strip `^`/`~`) so that `jsr:...@^1.0.0/...` and
  `jsr:...@1.0.0/...` resolve to the same module key. This fixes meta (and other
  subpaths) not being bundled or appearing as `(void 0)` when the importer had a
  caret version.

---

## [1.0.13] - 2026-02-13

### Fixed

- **Resolver**: When resolving relative imports from a JSR subpath (e.g.
  `jsr:@dreamer/view/router` importing `./meta.ts`), the plugin context’s
  `import.meta.resolve` did not yield a project cache path. The relative-path
  onResolve now runs a subprocess with the project’s `deno.json` to resolve the
  importer to a `file://` URL in the project cache, then resolves the relative
  path on disk, so view projects use local cache instead of fetch.

### Removed

- **Resolver**: Removed `resolveJsrRelativeFromMeta()` and its fetch-based
  fallback (JSR meta.json over HTTP); resolution now relies on subprocess +
  project cache only.
- **Tests**: Removed `resolver-view-subpath.test.ts` (it only tested the removed
  API).

---

## [1.0.12] - 2026-02-13

### Fixed

- **Resolver**: JSR TSX subpaths (e.g. `@dreamer/view/route-page`) were parsed
  as TypeScript instead of TSX because the protocol path had no file extension.
  `fetchJsrSourceViaMeta` now returns `resolvedPath` (e.g.
  `src/route-page.tsx`); onLoad uses it for `getLoaderFromPath` so JSX (e.g.
  `className`) is compiled correctly and the "Expected '>' but found
  'className'" error is resolved.

---

## [1.0.11] - 2026-02-13

### Fixed

- **Resolver**: When resolving relative imports from a JSR subpath (e.g.
  `@dreamer/view/store` importing `./signal.ts`), use package exports to resolve
  to the correct subpath (e.g. `.../signal`) instead of incorrectly resolving to
  `store/signal.ts`, which caused bundled code to get `(void 0)`. Added
  `resolveJsrRelativeFromMeta()` and use it in the relative-path onResolve
  fallback for `jsr:` importers.

### Added

- **Tests**: `resolver-view-subpath.test.ts` — tests for resolving store’s
  relative imports (signal, effect, scheduler, proxy, types) via JSR exports;
  VIEW_LIKE_EXPORTS aligned with view package exports.

---

## [1.0.10] - 2026-02-10

### Fixed

- **BuilderClient**: Always set `outdir` when `config.output` is set, so that
  with `splitting: false` the build still produces `outputContents` /
  `outputFiles`. This fixes dev serve returning HTML for `/main.js` when
  code-splitting is disabled (e.g. in @dreamer/view).

---

## [1.0.9] - 2026-02-12

### Added

- **BuilderClient**: JSX config for engine `"view"`. When `engine: "view"`,
  build now sets `jsx: "automatic"` and `jsxImportSource: "@dreamer/view"` so
  that @dreamer/view projects bundle correctly without "React is not defined" at
  runtime. Applied in both `build()` and `createContext()` paths.

---

## [1.0.8] - 2026-02-11

### Added

- **BuilderServer**: `compileSolidRouteForSSR()` for Solid route single-file SSR
  compile using esbuild-plugin-solid with `generate: "ssr"`. Exported from main
  entry and `/server` subpath for use by frameworks (e.g. @dreamer/dweb).
- **Tests**: `builder-server-solid-ssr.test.ts` — SSR compile fixture, output
  contains server runtime (escape/ssrElement), contentHash cache.

### Changed

- **Docs**: TEST_REPORT and README test statistics updated (Deno 570, Bun 509
  passed).

---

## [1.0.7] - 2026-02-11

### Added

- **BuilderClient**: Client build support for Solid.js. `engine` option now
  accepts `"solid"` alongside `"preact"` and `"react"`. When `engine: "solid"`,
  JSX uses `jsxImportSource: "solid-js"` and `solid-js` / `solid-js/` are
  treated as runtime externals.
- **Tests**: Add "Multi-engine (preact / react / solid)" cases in
  `builder-client.test.ts` for client builds with preact, react, and solid.

### Changed

- **Docs**: Restructure docs into `docs/en-US/` and `docs/zh-CN/` by locale;
  remove root CHANGELOG and Chinese docs; update all doc links; add Chinese test
  report at `docs/zh-CN/TEST_REPORT.md`.

---

## [1.0.6] - 2026-02-09

### Fixed

- **Resolver**: Add `fileUrlToPath` helper to normalize Windows `file://` URLs.
  When `file:///C:/Users/...` is parsed, remove the leading slash so
  `existsSync` works correctly (e.g. `C:/Users/...` instead of `/C:/Users/...`).
- **Resolver**: When `import.meta.resolve` returns a `file://` path that does
  not exist (e.g. Windows monorepo cache mismatch), add subprocess fallback for
  `npm:` packages to resolve in project directory and get the correct cache
  path.

---

## [1.0.5] - 2026-02-09

### Changed

- **Resolver**: Refactor npm subpath resolution. Instead of parsing package.json
  exports (Deno projects do not use package.json), use Deno's
  `import.meta.resolve` via subprocess to resolve subpaths like
  `preact/jsx-runtime`. Add `runtimeResolveCache` to avoid repeated subprocess
  calls for the same module.

### Added

- **Tests**: Add npm subpath resolution test in `resolver-advanced.test.ts`
  (lodash/map via Deno import.meta.resolve).

---

## [1.0.4] - 2026-02-09

### Fixed

- **Resolver**: Add npm subpath fallback resolution in `getLocalPathFromCache`.
  When `npm:preact@x.x.x/jsx-runtime` (or similar subpaths) cannot be resolved
  directly, derive package root from main package path and try common subpath
  file patterns (e.g. `jsx-runtime.mjs`, `jsx-runtime.js`,
  `jsx-runtime/index.mjs`). Fixes Preact hybrid hydration error
  `(void 0) is not a function` caused by empty stub modules when esbuild bundles
  `preact/jsx-runtime`.

---

## [1.0.3] - 2026-02-08

### Added

- **Resolver**: Debug logging for React/Preact main package and subpath
  resolution when `debug: true` is passed (projectDir, startDir, denoJson,
  import, importer) to aid build-time debugging (e.g. dweb CSR/SSR client
  builds).

---

## [1.0.2] - 2026-02-08

### Added

- **BuilderServer**: Add `builder-server-bun.test.ts` for Bun `buildWithBun`
  server build tests (2 tests, Bun only)

### Fixed

- **BuilderServer**: Use absolute path for entry when `buildWithBun` resolves to
  avoid wrong file being built (e.g. when `main.ts` exists in cwd)

### Changed

- **Docs**: Update TEST_REPORT.md with Deno/Bun test statistics (518 Deno, 503
  Bun)
- **Docs**: Update README and README-zh test badges and statistics tables

---

## [1.0.1] - 2026-02-08

### Fixed

- **Resolver**: Add fallback for `xxx.ts` subpath when `exports["./xxx.ts"]`
  does not exist in JSR package; try `exports["./xxx"]` instead. Fixes esbuild
  resolver failing to resolve `EnginePacketType` and `SocketIOPacketType` when
  bundling client code that imports `@dreamer/socket-io/client` (e.g. relative
  import `../types.ts` from client modules).
- **Tests**: Disable leak detection for "应该清理测试输出目录" in edge-cases
  test to avoid CI failure caused by async `readTextFile` completing during
  test.

---

## [1.0.0] - 2026-02-06

### Added

- **Stable release**: First stable version with stable API
- **Server compilation**:
  - Server code compilation and bundling (based on @dreamer/runtime-adapter)
  - TypeScript compilation, code minification, standalone bundling
  - Multi-platform compilation (Linux, macOS, Windows)
  - Memory mode (`write: false`) to return compiled code without writing to file
  - External dependencies (`external` config)
  - Native compilation (`useNativeCompile`) for deno compile / bun build
    --compile
- **Client bundling**:
  - High-performance bundling based on esbuild
  - Code splitting (route-level, component-level), Tree-shaking
  - Multiple output formats (ESM, CJS, IIFE)
  - Memory mode (`write: false`)
- **HTML generation**:
  - Auto-generate HTML entry files, auto-inject bundled JS/CSS
  - Custom HTML templates, preload strategies, multi-entry HTML (MPA)
- **CSS processing**:
  - CSS extraction and optimization, autoprefixer, cssnano
  - Auto-inject CSS into HTML
- **Build optimization**:
  - Build cache management, incremental compilation, Watch mode
  - Build output analysis, performance monitoring
- **Plugin system**:
  - Flexible plugin architecture
  - Server module auto-detection and exclusion
  - Conditional compilation support
- **Path resolution**:
  - Auto-resolve relative paths, npm packages, JSR packages
  - Path aliases (`@/`, `~/`), deno.json imports, tsconfig paths
- **AssetsProcessor**:
  - Copy public/ to output, image compression, format conversion (webp/avif)
  - Content hash, quality parameter, asset-manifest.json for SSR
- **Subpath exports**: `/builder`, `/client`, `/server`, `/bundle`,
  `/css-injector` for on-demand imports

### Compatibility

- Deno 2.5.0+
- Bun 1.3.0+
- esbuild 0.27.2+
