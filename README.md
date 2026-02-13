# @dreamer/esbuild

> High-performance build tool library compatible with Deno and Bun, providing
> full-stack compilation, bundling, resource processing, optimization, and more,
> with subpath on-demand imports

This library is the core build engine of the
[@dreamer/dweb](https://jsr.io/@dreamer/dweb) framework, and can also be used
independently for any Deno/Bun project builds.

English | [中文 (Chinese)](./docs/zh-CN/README.md)

[![JSR](https://jsr.io/badges/@dreamer/esbuild)](https://jsr.io/@dreamer/esbuild)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE.md)
[![Tests](https://img.shields.io/badge/tests-Deno%20570%20%7C%20Bun%20509%20passed-brightgreen)](./docs/en-US/TEST_REPORT.md)

---

## 📑 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Characteristics](#-characteristics)
- [Use Cases](#-use-cases)
- [Quick Start](#-quick-start)
- [Usage Examples](#-usage-examples)
- [API Documentation](#-api-documentation)
- [Advanced Configuration](#-advanced-configuration)
- [Compilation Methods](#️-compilation-methods)
- [Test Report](#-test-report)
- [Notes](#-notes)

---

## 🎯 Features

Build tool library providing a unified build interface, supporting compilation,
bundling, and optimization of server and client code. High-performance bundling
based on esbuild, supporting modern build features such as TypeScript, JSX, code
splitting, Tree-shaking, etc.

**Architecture optimizations**:

- **Subpath exports**: `/builder`, `/client`, `/server`, `/bundle`,
  `/css-injector` on-demand imports to reduce bundle size
- **Lazy initialization**: BuildAnalyzer, CacheManager created on first
  `build()`, avoiding extra loading during dev/build
- **Tree-shaking friendly**: Subpath exports enable on-demand loading

---

## 📦 Installation

### Deno

```bash
deno add jsr:@dreamer/esbuild
```

### Bun

```bash
bunx jsr add -D @dreamer/esbuild
```

### On-Demand Import (Subpaths)

To reduce bundle size and improve Tree-shaking, import from subpaths as needed:

| Subpath                             | Exports                                                                                           | Use Case                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `jsr:@dreamer/esbuild/builder`      | Builder, AssetsProcessor, createBuilder, BuilderConfig                                            | Full-stack build, resource processing      |
| `jsr:@dreamer/esbuild/client`       | BuilderClient, ClientBuildOptions                                                                 | Client-only bundling                       |
| `jsr:@dreamer/esbuild/server`       | BuilderServer, ServerBuildOptions                                                                 | Server-only compilation                    |
| `jsr:@dreamer/esbuild/bundle`       | buildBundle, BuilderBundle, BundleOptions, BundleResult                                           | Quick bundling, testing, SSR               |
| `jsr:@dreamer/esbuild/css-injector` | generateCSSTag, generateCSSTags, injectCSSIntoHTML, injectCSSFromDependencies, getCSSRelativePath | Inject CSS paths into HTML in extract mode |

```typescript
// When only Builder, AssetsProcessor needed
import {
  AssetsProcessor,
  Builder,
  createBuilder,
} from "jsr:@dreamer/esbuild/builder";

// When only client build needed
import { BuilderClient } from "jsr:@dreamer/esbuild/client";

// When only server build needed
import { BuilderServer } from "jsr:@dreamer/esbuild/server";

// When only buildBundle needed (testing, SSR, etc.)
import { buildBundle } from "jsr:@dreamer/esbuild/bundle";

// When only CSS injector needed (extract mode + manual HTML injection)
import { injectCSSIntoHTML } from "jsr:@dreamer/esbuild/css-injector";
```

---

## 🌍 Environment Compatibility

| Environment | Version Requirement | Status                                               |
| ----------- | ------------------- | ---------------------------------------------------- |
| **Deno**    | 2.5.0+              | ✅ Fully supported                                   |
| **Bun**     | 1.3.0+              | ✅ Fully supported                                   |
| **Server**  | -                   | ✅ Supported (compatible with Deno and Bun runtimes) |
| **Client**  | -                   | ❌ Not supported (build tool, runs on server only)   |

---

## ✨ Characteristics

- **Server compilation**:
  - Server code compilation and bundling (based on `@dreamer/runtime-adapter`)
  - TypeScript compilation (Deno/Bun built-in)
  - Code minification and optimization
  - Single-file bundling (standalone)
  - Multi-platform compilation (Linux, macOS, Windows)
  - **Memory mode**: Supports `write: false` to return compiled code directly
    without writing to file
  - **External dependencies**: Supports `external` config to exclude specified
    dependencies from bundling
  - **Native compilation**: Supports `useNativeCompile` to use `deno compile` or
    `bun build --compile` to generate executable
- **Client bundling**:
  - High-performance bundling based on esbuild
  - Entry file bundling (entry point → bundle.js)
  - Code splitting (route-level, component-level)
  - Tree-shaking (remove unused code)
  - Multiple output formats (ESM, CJS, IIFE)
  - **Memory mode**: Supports `write: false` to return compiled code directly
    without writing to file
- **HTML generation**:
  - Auto-generate HTML entry files
  - Auto-inject bundled JS/CSS files
  - Support custom HTML templates
  - Support preload strategy configuration
  - Support multi-entry HTML (MPA multi-page apps)
- **CSS processing**:
  - CSS extraction and optimization
  - Auto-add browser prefixes (autoprefixer)
  - CSS minification (cssnano)
  - Auto-inject CSS into HTML
- **Build optimization**:
  - Build cache management
  - Incremental compilation
  - Watch mode
  - Build output analysis
  - Performance monitoring and reporting
- **Plugin system**:
  - Flexible plugin architecture
  - Server module auto-detection and exclusion
  - Conditional compilation support
  - Custom build logic
- **Path resolution**:
  - Auto-resolve relative paths, npm packages, JSR packages
  - Support path aliases (`@/`, `~/`, etc.)
  - Deno environment: Supports `deno.json` `imports` config
  - Bun environment: Supports `package.json` `imports` and `tsconfig.json`
    `paths` config
- **Static resource processing (AssetsProcessor)**:
  - Copy `public/` to output directory, supports `exclude`
  - Image compression, format conversion (webp/avif/original), content hash
  - Image quality parameter `quality` (0-100)
  - Auto-update resource reference paths in HTML/CSS/JS
  - Generate `asset-manifest.json` for SSR runtime path replacement
  - `pathUpdateDirs` supports updating paths in server bundle for SSR scenarios

---

## 🎯 Use Cases

- **Full-stack project build**: Build server and client code simultaneously
- **Frontend project build**: React, Preact app bundling
- **SPA single-page app**: Client-side rendering (CSR) project build
- **SSR/Hybrid/SSG**: Integration with @dreamer/dweb, asset-manifest supports
  production mode resource path replacement
- **Multi-platform app packaging**: Supports Linux, macOS, Windows
- **Server-side rendering**: Use memory mode to get compiled code for SSR
- **CI/CD build pipeline**: Automated build and deployment

### Integration with @dreamer/dweb

This library is the core build engine of
[@dreamer/dweb](https://jsr.io/@dreamer/dweb). dweb's `deno task build`
internally calls `Builder.build()` to complete server + client + resource
processing. In production mode, dweb uses `asset-manifest.json` to replace
resource paths before outputting HTML in SSR/Hybrid/SSG.

---

## 🚀 Quick Start

### Basic Usage

```typescript
import { createBuilder } from "@dreamer/esbuild";

// Create builder
const builder = createBuilder({
  // Client build configuration
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
    bundle: {
      minify: true,
      sourcemap: true,
      splitting: true,
    },
    html: {
      title: "My App",
    },
  },
});

// Build client
await builder.buildClient();
```

### Full-Stack Project Build

```typescript
import { createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  // Server build configuration
  server: {
    entry: "./src/server.ts",
    output: "./dist/server",
    target: "deno",
    compile: {
      minify: true,
      platform: ["linux", "darwin"],
    },
  },
  // Client build configuration
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
    bundle: {
      minify: true,
      sourcemap: true,
    },
  },
});

// Build server and client simultaneously
await builder.build();
```

---

## 🎨 Usage Examples

### Example 1: Client Build (Memory Mode)

Using `write: false` parameter, you can get compiled code directly without
writing to file, suitable for server-side rendering and similar scenarios.

```typescript
import { BuilderClient } from "@dreamer/esbuild";

const builder = new BuilderClient({
  entry: "./src/client/mod.ts",
  output: "./dist",
  engine: "react",
});

// Memory mode: Do not write to file, return compiled code directly
const result = await builder.build({ mode: "prod", write: false });

// Get compiled code
const code = result.outputContents?.[0]?.text;
console.log(code);
```

### Example 2: Server Build (Memory Mode)

```typescript
import { BuilderServer } from "@dreamer/esbuild";

const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
});

// Memory mode: Return compiled code
const result = await builder.build({ mode: "prod", write: false });

// Get compiled code
const code = result.outputContents?.[0]?.text;
console.log(code);
```

### Example 3: Incremental Build (Watch Mode)

```typescript
import { createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  build: {
    watch: {
      enabled: true,
      debounce: 300,
      onFileChange: (path, kind) => {
        console.log(`File changed: ${path} (${kind})`);
      },
    },
  },
});

// Start Watch mode
await builder.watch();

// Stop Watch mode
builder.stopWatch();
```

### Example 4: Build Output Analysis

```typescript
import { BuildAnalyzer, createBuilder } from "@dreamer/esbuild";

const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
});

const result = await builder.buildClient();

// Analyze build output
const analyzer = new BuildAnalyzer();
const analysis = await analyzer.analyze(result.metafile);

// Generate analysis report
const report = analyzer.generateReport(analysis);
console.log(report);

// Generate HTML report
await analyzer.generateHTMLReport(analysis, "./dist/build-report.html");
```

### Example 5: Using Plugins

```typescript
import {
  BuilderClient,
  createServerModuleDetectorPlugin,
} from "@dreamer/esbuild";

const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  plugins: [
    // Auto-exclude server modules
    createServerModuleDetectorPlugin({
      patterns: ["@dreamer/database", "express"],
    }),
  ],
});

await builder.build("prod");
```

### Example 6: Path Alias Configuration

#### Deno Environment (deno.json)

```json
{
  "imports": {
    "@/": "./src/",
    "~/": "./",
    "@dreamer/logger": "jsr:@dreamer/logger@^1.0.0-beta.7"
  }
}
```

```typescript
// src/client/index.tsx
import { logger } from "@/utils/logger.ts";
import { config } from "~/config.ts";
import { log } from "@dreamer/logger/client";
```

#### Bun Environment (package.json or tsconfig.json)

**Method 1: Using package.json**

```json
{
  "imports": {
    "@/": "./src/",
    "~/": "./"
  }
}
```

**Method 2: Using tsconfig.json**

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "~/*": ["./*"]
    }
  }
}
```

```typescript
// src/client/index.tsx
import { logger } from "@/utils/logger.ts";
import { config } from "~/config.ts";
```

Path resolution automatically handles these aliases, no extra configuration
needed.

---

## 📚 API Documentation

### Builder

Unified builder supporting simultaneous server and client code builds.

```typescript
import { Builder, createBuilder } from "@dreamer/esbuild";

const builder = createBuilder(config);
```

#### Methods

| Method                  | Description                            |
| ----------------------- | -------------------------------------- |
| `build(options?)`       | Build server and client simultaneously |
| `buildServer(options?)` | Build server code only                 |
| `buildClient(options?)` | Build client code only                 |
| `clean()`               | Clean build output                     |
| `watch(options?)`       | Start Watch mode                       |
| `stopWatch()`           | Stop Watch mode                        |

### BuilderClient

Client builder for bundling client code.

```typescript
import { BuilderClient } from "@dreamer/esbuild";

const builder = new BuilderClient(config);
```

#### Constructor

```typescript
new BuilderClient(config: ClientConfig)
```

**ClientConfig debugging and logging**:

- `debug?: boolean`: Whether to enable debug logging (default: false), outputs
  detailed resolver/build debug info when enabled.
- `logger?: BuildLogger`: Logger instance (uses library default logger when not
  provided), info/debug output through logger, not console.

**ClientConfig.cssImport** (CSS import handling):

- `enabled?: boolean`: Whether to enable (default: true)
- `extract?: boolean`: Whether to extract to separate file (default: false,
  inline into JS). When true, use css-injector to manually inject HTML
- `cssOnly?: boolean`: Inline mode only process .css (scss/sass/less need
  preprocessor, default: true)

#### Methods

| Method                   | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `build(options?)`        | Build client code, supports `{ mode, write }` parameters |
| `createContext(mode?)`   | Create incremental build context                         |
| `rebuild()`              | Incremental rebuild                                      |
| `dispose()`              | Clean build context                                      |
| `registerPlugin(plugin)` | Register plugin                                          |
| `getPluginManager()`     | Get plugin manager                                       |
| `getConfig()`            | Get configuration                                        |

#### ClientBuildOptions

```typescript
interface ClientBuildOptions {
  /** Build mode (default: prod) */
  mode?: "dev" | "prod";
  /** Whether to write to file (default: true), set false to return compiled code */
  write?: boolean;
}
```

### BuilderServer

Server builder for compiling server code.

```typescript
import { BuilderServer } from "@dreamer/esbuild";

const builder = new BuilderServer(config);
```

#### Constructor

```typescript
new BuilderServer(config: ServerConfig)
```

#### Methods

| Method            | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `build(options?)` | Build server code, supports `{ mode, write }` parameters or string mode |
| `getConfig()`     | Get configuration                                                       |

#### ServerBuildOptions

```typescript
interface ServerBuildOptions {
  /** Build mode (default: prod) */
  mode?: "dev" | "prod";
  /** Whether to write to file (default: true), set false to return compiled code */
  write?: boolean;
}
```

#### ServerConfig Advanced Options

```typescript
interface ServerConfig {
  /** Entry file path */
  entry: string;
  /** Output directory */
  output: string;
  /** Target runtime (default: deno) */
  target?: "deno" | "bun";
  /** External dependencies (not bundled), supports wildcards */
  external?: string[];
  /** Use native compiler to generate executable (Deno: deno compile, Bun: bun build --compile) */
  useNativeCompile?: boolean;
  /** Whether to enable debug logging (default: false), outputs detailed resolver/build debug info when enabled for troubleshooting */
  debug?: boolean;
  /** Logger instance (uses library default logger when not provided), info/debug output through logger, not console */
  logger?: BuildLogger;
  // ... other config
}
```

**Example: Exclude external dependencies**

```typescript
const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
  external: [
    "better-sqlite3", // Exclude native module
    "@prisma/*", // Wildcard exclude
    "node:*", // Exclude all Node.js built-in modules
  ],
});
```

**Example: Generate executable**

```typescript
const builder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist/server",
  target: "deno",
  useNativeCompile: true, // Use deno compile or bun build --compile
});

await builder.build("prod");
// Deno environment: Generates ./dist/server (executable)
// Bun environment: Generates ./dist/server (executable)
```

### BuilderBundle

Simple bundler for quickly bundling code into browser-ready format. Suitable for
browser testing, server-side rendering, etc.

```typescript
import { buildBundle, BuilderBundle } from "@dreamer/esbuild";

// Using class
const bundler = new BuilderBundle();
const result = await bundler.build({
  entryPoint: "./src/client/mod.ts",
  globalName: "MyClient",
});

// Using function
const result = await buildBundle({
  entryPoint: "./src/client/mod.ts",
  format: "esm",
  minify: true,
});
```

#### Methods

| Method           | Description                        |
| ---------------- | ---------------------------------- |
| `build(options)` | Bundle code, returns bundle result |

#### BundleOptions

```typescript
interface BundleOptions {
  /** Entry file path */
  entryPoint: string;
  /** Global variable name (used with IIFE format) */
  globalName?: string;
  /** Target platform (default: browser) */
  platform?: "browser" | "node" | "neutral";
  /** Target ES version (default: es2020) */
  target?: string | string[];
  /** Whether to minify (default: false) */
  minify?: boolean;
  /** Output format (default: iife) */
  format?: "iife" | "esm" | "cjs";
  /** Whether to generate sourcemap (default: false) */
  sourcemap?: boolean;
  /** External dependencies (not bundled) */
  external?: string[];
  /** Define replacement */
  define?: Record<string, string>;
  /** Whether to bundle dependencies (default: true) */
  bundle?: boolean;
  /** Whether to enable debug logging (default: false), outputs detailed resolver/build debug info when enabled */
  debug?: boolean;
  /** Logger instance (uses library default logger when not provided), info/debug output through logger, not console */
  logger?: BuildLogger;
}
```

#### BundleResult

```typescript
interface BundleResult {
  /** Bundled code */
  code: string;
  /** Source Map (if enabled) */
  map?: string;
}
```

### AssetsProcessor

Static resource processor, responsible for copying, image processing, path
updates, generating asset-manifest.

```typescript
import { AssetsProcessor } from "jsr:@dreamer/esbuild/builder";

const config = {
  publicDir: "./public",
  assetsDir: "assets",
  images: { compress: true, format: "webp", hash: true, quality: 80 },
};
const processor = new AssetsProcessor(
  config,
  "./dist/client",
  ["./dist/server"], // Optional, additional directories to update in SSR scenario
);
await processor.processAssets();
```

#### AssetsConfig

```typescript
interface AssetsConfig {
  /** Static resource directory */
  publicDir?: string;
  /** Resource output directory (default: assets) */
  assetsDir?: string;
  /** Files to exclude when copying, e.g. ["tailwind.css", "uno.css"] */
  exclude?: string[];
  /** Image processing (requires @dreamer/image) */
  images?: {
    compress?: boolean;
    format?: "webp" | "avif" | "original";
    hash?: boolean;
    quality?: number; // 0-100, default 80 (lossy) or 100 (PNG/GIF lossless)
  };
}
```

**Output**: `outputDir/asset-manifest.json`, format
`{ "/assets/original-path": "/assets/hash-new-path" }`, for SSR framework to
replace resource paths in HTML.

### BuildResult

Build result type.

```typescript
interface BuildResult {
  /** Output file list (file paths) */
  outputFiles: string[];
  /** Output file content list (has value when write is false) */
  outputContents?: OutputFileContent[];
  /** Build metadata */
  metafile?: unknown;
  /** Build duration (milliseconds) */
  duration: number;
}

interface OutputFileContent {
  /** File path */
  path: string;
  /** File content (string format) */
  text: string;
  /** File content (binary format) */
  contents: Uint8Array;
}
```

---

## 🔧 Debugging and Logging

Server/client build and simple bundling all support **debug** and **logger**
parameters for troubleshooting build and resolution issues:

- **debug** (`boolean`, default `false`): When set to `true`, outputs detailed
  resolver, build debug info.
- **logger** (`BuildLogger`, optional): Logger instance; uses library default
  logger when not provided. All info/debug output goes through logger, not
  `console`.

**Example**:

```typescript
import { createLogger } from "@dreamer/logger";
import { buildBundle, BuilderClient, BuilderServer } from "@dreamer/esbuild";

const logger = createLogger({ level: "debug", format: "text" });

// Server build: Enable debug and pass custom logger
const serverBuilder = new BuilderServer({
  entry: "./src/server.ts",
  output: "./dist",
  debug: true,
  logger,
});

// Client build: Same as above
const clientBuilder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  debug: true,
  logger,
});

// Simple bundling: BundleOptions also supports debug, logger
const result = await buildBundle({
  entryPoint: "./src/client/mod.ts",
  format: "esm",
  debug: true,
  logger,
});
```

---

## 🔧 Advanced Configuration

### Code Splitting Strategy

```typescript
const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  bundle: {
    splitting: {
      enabled: true,
      byRoute: true, // Split by route
      byComponent: true, // Split by component
      bySize: 50000, // Split by size (50KB)
    },
  },
});
```

### Source Map Configuration

```typescript
const builder = new BuilderClient({
  entry: "./src/client/index.tsx",
  output: "./dist/client",
  engine: "react",
  sourcemap: {
    enabled: true,
    mode: "external", // "inline" | "external" | "both"
  },
});
```

### Cache Configuration

```typescript
const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  build: {
    cache: true, // Or specify cache directory: "./cache"
  },
});
```

### Static Resources and asset-manifest

When `assets` is configured, Builder will call `AssetsProcessor` to process
static resources during build and generate `asset-manifest.json`.

```typescript
const builder = createBuilder({
  client: {
    entry: "./src/client/index.tsx",
    output: "./dist/client",
    engine: "react",
  },
  server: {
    entry: "./src/server.ts",
    output: "./dist/server",
  },
  assets: {
    publicDir: "./public",
    assetsDir: "assets",
    exclude: ["tailwind.css", "uno.css"], // Exclude source files that will be compiled by other plugins
    images: {
      compress: true,
      format: "webp", // "webp" | "avif" | "original"
      hash: true, // Add content hash to filename for cache invalidation
      quality: 80, // 0-100, JPEG/WebP/AVIF default 80, PNG/GIF default 100
    },
  },
});

await builder.build();
```

**Flow**:

1. Copy `public/` to `outputDir/assets/` (excluding files in `exclude` config)
2. Image compression, format conversion, content hash
3. Update resource reference paths in HTML/CSS/JS
4. Generate `outputDir/asset-manifest.json`, format:
   `{ "/assets/logo.png": "/assets/logo.abc12345.webp" }`

**SSR scenario**: When `server` is also configured, `pathUpdateDirs`
automatically includes server output directory, ensuring resource paths in
server bundle are also updated. SSR frameworks (e.g. dweb) can replace paths
with manifest before outputting HTML.

### css-injector Use Case

`css-injector` is for **extract mode**: Extract CSS to separate files, then
manually inject `<link>` paths into HTML.

```typescript
import { injectCSSIntoHTML } from "jsr:@dreamer/esbuild/css-injector";

// Get CSS file path list after build (e.g. createCSSImportHandlerPlugin extract mode)
const cssFiles = ["dist/main.css", "dist/chunk-1.css"];

const html = `<!DOCTYPE html><html><head></head><body></body></html>`;
const htmlWithCss = injectCSSIntoHTML(html, cssFiles, {
  outputDir: "./dist",
  publicPath: "/assets/",
  dedupe: true,
});
```

**Exported functions**: `generateCSSTag`, `generateCSSTags`,
`injectCSSIntoHTML`, `injectCSSFromDependencies`, `getCSSRelativePath`.

**Note**: dweb framework uses inline mode (`extract: false`), CSS directly
injected as `<style>`, no need for css-injector.

---

## ⚙️ Compilation Methods

This library automatically selects the optimal compilation method based on
runtime environment:

| Builder                              | Deno Environment                  | Bun Environment                          |
| ------------------------------------ | --------------------------------- | ---------------------------------------- |
| **BuilderClient**                    | esbuild + Deno resolver plugin    | esbuild + Bun resolver plugin            |
| **BuilderServer**                    | esbuild + Deno resolver plugin    | esbuild + Bun resolver plugin            |
| **BuilderServer** (useNativeCompile) | `deno compile` native compilation | `bun build --compile` native compilation |
| **BuilderBundle**                    | esbuild + Deno resolver plugin    | `bun build` native bundling              |

### Deno Resolver Plugin

In Deno environment, Deno resolver plugin (`denoResolverPlugin`) is
automatically enabled for:

- Resolving `deno.json` `imports` config (path aliases)
- Supporting JSR package imports (`jsr:` protocol)
- Supporting npm package imports (`npm:` protocol)
- Supporting relative path resolution (`./`, `../`)
- Supporting JSR package subpath exports (e.g. `@dreamer/logger/client`)

### Bun Resolver Plugin

In Bun environment, Bun resolver plugin (`bunResolverPlugin`) is automatically
enabled for:

- Resolving `package.json` `imports` config (path aliases)
- Resolving `tsconfig.json` `paths` config (path aliases)
- Supporting npm package imports (`npm:` protocol)
- Supporting JSR package imports (`jsr:` protocol, Bun native support)
- Supporting relative path resolution (`./`, `../`)
- **Does not read** `deno.json` config (Bun environment only)

### Bun Native Bundling

`BuilderBundle` uses `bun build` native command for bundling in Bun environment,
with faster compilation speed. `BuilderClient` and `BuilderServer` uniformly use
esbuild + resolver plugin to ensure cross-platform consistency and feature
completeness.

### Native Compiler (Generate Executable)

When `useNativeCompile` option is enabled, `BuilderServer` uses platform native
compiler to generate standalone executable:

| Runtime  | Compile Command                                      | Output                |
| -------- | ---------------------------------------------------- | --------------------- |
| **Deno** | `deno compile --allow-all --output <output> <entry>` | Standalone executable |
| **Bun**  | `bun build --compile --outfile <output> <entry>`     | Standalone executable |

**Notes**:

- Native compilation bundles all dependencies into executable
- Deno's `deno compile` does not support `external` option, will output warning
- Bun's `bun build --compile` supports `--external` option to exclude
  dependencies

---

## 📊 Test Report

This library has been thoroughly tested, all test cases passed, with 100% test
coverage. See [TEST_REPORT.md](./docs/en-US/TEST_REPORT.md) for detailed test
report.

**Test statistics**:

| Runtime               | Tests | Passed | Failed | Pass Rate |
| --------------------- | ----- | ------ | ------ | --------- |
| Deno (`deno test -A`) | 570   | 570    | 0      | 100% ✅   |
| Bun (`bun test`)      | 509   | 509    | 0      | 100% ✅   |

- **Test coverage**: All public APIs, subpath exports, edge cases, error
  handling
- **Test environment**: Deno 2.x, Bun 1.3.5
- **Note**: Bun has fewer tests because `builder-server-bun.test.ts` (2 tests)
  runs only in Bun; some tests use Deno-specific features and run only in Deno

**Test types**:

- ✅ Unit tests (~440)
- ✅ Integration tests (~30)
- ✅ Edge case and error handling tests (~48)

**Test highlights**:

- ✅ Subpath export tests (entry-builder, entry-client, entry-server,
  entry-bundle, css-injector)
- ✅ AssetsProcessor advanced features (asset-manifest, quality, pathUpdateDirs)
- ✅ Complete test coverage for all features, edge cases, error handling
- ✅ Integration tests verify end-to-end full flow
- ✅ Memory mode (write: false) complete feature tests
- ✅ BuilderBundle simple bundler complete tests (28)
  - ESM and IIFE format tests
  - Global variable setting tests (window/global/globalThis)
  - Platform-specific behavior tests (browser/node/neutral)
- ✅ Path resolution feature tests (Deno and Bun environments)
  - Resolver plugin tests (18) + resolver advanced tests (11)
  - Server builder path resolution tests (5)
  - Builder server Bun tests (2, Bun only)
  - Client builder path resolution tests (6)
  - Client build path resolution tests (6)
- ✅ Server builder advanced feature tests (19)
  - External dependency config (external) tests
  - Native compiler (useNativeCompile) tests
  - Multi-platform compilation tests (Linux, macOS, Windows)

View full test report: [TEST_REPORT.md](./docs/en-US/TEST_REPORT.md)

---

## 📝 Notes

- **Dependency requirements**: Requires `npm:esbuild`,
  `@dreamer/runtime-adapter`; image processing requires `@dreamer/image`
- **Runtime environment**: Build tool runs on server only, cannot be used in
  browser
- **Memory mode**: When using `write: false`, memory mode does not support code
  splitting (splitting)
- **Platform compilation**: Server multi-platform compilation requires
  corresponding platform's compilation toolchain
- **Cache management**: Production environment recommends enabling build cache
  for better performance
- **Path resolution**:
  - Deno environment: Need `deno.json` to configure `imports` field for path
    aliases
  - Bun environment: Can use `package.json` `imports` or `tsconfig.json` `paths`
    for path aliases
  - Bun environment does not read `deno.json` config

---

## 📦 Dependencies

| Dependency                           | Purpose                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `npm:esbuild`                        | Core bundling engine                                                        |
| `@dreamer/runtime-adapter`           | Cross-runtime API (Deno/Bun)                                                |
| `@dreamer/image`                     | Image compression, format conversion (only when `assets.images` configured) |
| `postcss`, `autoprefixer`, `cssnano` | CSS optimization (only when CSS processing configured)                      |

---

## 📋 Changelog

**v1.0.12** (2026-02-13)

- **Fixed**: JSR TSX subpaths (e.g. `@dreamer/view/route-page`) are now compiled
  as TSX using `resolvedPath` from `fetchJsrSourceViaMeta`, fixing the "Expected
  '>' but found 'className'" JSX parse error.

Full history in [CHANGELOG.md](./docs/en-US/CHANGELOG.md).

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

---

## 📄 License

MIT License - See [LICENSE.md](./LICENSE.md)

---

<div align="center">

**Made with ❤️ by Dreamer Team**

</div>
