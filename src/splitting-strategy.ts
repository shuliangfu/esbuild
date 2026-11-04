/**
 * @module @dreamer/esbuild/splitting-strategy
 *
 * Resolve SplittingStrategy into extra esbuild entry points so byRoute /
 * byComponent / bySize / custom actually change the chunk graph (not just
 * chunkNames). Esbuild has no manualChunks; additional entry points +
 * splitting:true is the supported lever.
 */

import {
  dirname,
  exists,
  isFile,
  join,
  readTextFile,
  resolve,
  stat,
} from "@dreamer/runtime-adapter";
import type { SplittingStrategy } from "./types.ts";

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;

/** Static `from "..."` / `import "..."` / side-effect imports */
const STATIC_SPEC_RE =
  /(?:import|export)(?:\s+type)?\s+(?:[^'"\n;]*?\s+from\s+)?["'](\.[^"']+)["']/g;

/** Dynamic `import("...")` */
const DYNAMIC_SPEC_RE = /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

/**
 * Route-like path conventions (Dreamer / common app routers).
 * Matched against normalized absolute paths.
 */
export function isRouteSplitPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/");
  if (/\/(routes|pages)\//i.test(n)) return true;
  if (/\/(?:_?(?:layout|page|route)|route-page)(?:\.[^/]+)?$/i.test(n)) {
    return true;
  }
  if (/\/\+(?:page|layout|error|loading)(?:\.[^/]+)?$/i.test(n)) return true;
  if (/\/[^/]*route[^/]*\.(?:tsx?|jsx?|mts|mjs)$/i.test(n)) return true;
  return false;
}

/**
 * Component-like path conventions.
 */
export function isComponentSplitPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/");
  return /\/components\//i.test(n);
}

/**
 * Whether this strategy object asks for any real split-point collection.
 * Boolean `splitting: true` / empty object → false (compat: name-only / native).
 */
export function strategyRequestsSplitEntries(
  strategy: SplittingStrategy,
): boolean {
  return !!(
    strategy.byRoute ||
    strategy.byComponent ||
    (typeof strategy.bySize === "number" && strategy.bySize > 0) ||
    typeof strategy.custom === "function"
  );
}

async function resolveLocalSpecifier(
  fromFile: string,
  spec: string,
): Promise<string | null> {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates: string[] = [base];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(base + ext);
    candidates.push(join(base, "index" + ext));
  }
  for (const candidate of candidates) {
    try {
      if (await exists(candidate) && await isFile(candidate)) {
        return resolve(candidate);
      }
    } catch {
      // ignore missing / permission
    }
  }
  return null;
}

function collectRelativeSpecs(source: string): string[] {
  const specs = new Set<string>();
  STATIC_SPEC_RE.lastIndex = 0;
  DYNAMIC_SPEC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_SPEC_RE.exec(source)) !== null) {
    if (m[1]) specs.add(m[1]);
  }
  while ((m = DYNAMIC_SPEC_RE.exec(source)) !== null) {
    if (m[1]) specs.add(m[1]);
  }
  return [...specs];
}

async function shouldSplitFile(
  absPath: string,
  strategy: SplittingStrategy,
  primaryEntry: string,
): Promise<boolean> {
  const normalized = resolve(absPath);
  if (normalized === resolve(primaryEntry)) return false;

  if (strategy.byRoute && isRouteSplitPath(normalized)) return true;
  if (strategy.byComponent && isComponentSplitPath(normalized)) return true;

  if (typeof strategy.custom === "function") {
    try {
      if (strategy.custom(normalized)) return true;
    } catch {
      // ignore custom predicate errors
    }
  }

  if (typeof strategy.bySize === "number" && strategy.bySize > 0) {
    try {
      const info = await stat(normalized);
      if (typeof info.size === "number" && info.size >= strategy.bySize) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * Walk the local relative-import graph from `entryPoint` and return absolute
 * paths that should be passed as **additional** esbuild entry points so that
 * `splitting: true` emits separate chunks for those modules.
 *
 * Skips remote / package specs (`npm:`, `jsr:`, bare, http). Does not modify
 * source. Primary entry is never returned (caller already has it).
 */
export async function collectSplitEntryPoints(
  entryPoint: string,
  strategy: SplittingStrategy,
): Promise<string[]> {
  if (!strategyRequestsSplitEntries(strategy)) return [];

  const primary = resolve(entryPoint);
  const visited = new Set<string>();
  const splitEntries: string[] = [];
  const queue: string[] = [primary];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (await shouldSplitFile(current, strategy, primary)) {
      splitEntries.push(current);
    }

    let source: string;
    try {
      source = await readTextFile(current);
    } catch {
      continue;
    }

    for (const spec of collectRelativeSpecs(source)) {
      const resolved = await resolveLocalSpecifier(current, spec);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return splitEntries;
}

/**
 * Build the full entryPoints list for a client build.
 */
export async function resolveClientEntryPoints(
  entryPoint: string,
  splitting: boolean | SplittingStrategy | undefined,
  splittingEnabled: boolean,
): Promise<string[]> {
  const primary = resolve(entryPoint);
  if (!splittingEnabled || typeof splitting !== "object" || !splitting) {
    return [primary];
  }
  const extras = await collectSplitEntryPoints(primary, splitting);
  const seen = new Set<string>([primary]);
  const out = [primary];
  for (const extra of extras) {
    const abs = resolve(extra);
    if (!seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}
