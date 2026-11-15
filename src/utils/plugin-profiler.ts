/**
 * 插件 onResolve/onLoad 耗时剖析。仅当 DREAMER_ESBUILD_PROFILE=1 时启用。
 */
import { getEnv, writeTextFile } from "@dreamer/runtime-adapter";
import type * as esbuild from "esbuild";

export function isEsbuildProfileEnabled(): boolean {
  return getEnv("DREAMER_ESBUILD_PROFILE") === "1";
}

interface HookStats {
  resolve: number;
  resolveMs: number;
  load: number;
  loadMs: number;
}

function isPromise<T>(value: unknown): value is Promise<T> {
  return value instanceof Promise;
}

const PROFILE_LOG = "/tmp/esbuild-profile.txt";
const profileLines: string[] = [];

function emitProfile(log: (message: string) => void, message: string): void {
  log(message);
  console.log(message);
  profileLines.push(message);
}

export function wrapPluginsForProfile(
  plugins: esbuild.Plugin[],
  log: (message: string) => void,
): esbuild.Plugin[] {
  const all: { name: string; stats: HookStats }[] = [];
  emitProfile(
    log,
    `[profile] wrapping ${plugins.length} plugins: ${
      plugins.map((plugin) => plugin.name).join(", ")
    }`,
  );

  const wrapped = plugins.map((plugin) => {
    const stats: HookStats = {
      resolve: 0,
      resolveMs: 0,
      load: 0,
      loadMs: 0,
    };
    all.push({ name: plugin.name, stats });
    return {
      name: plugin.name,
      setup(build: esbuild.PluginBuild) {
        const onResolve = build.onResolve.bind(build);
        const onLoad = build.onLoad.bind(build);
        build.onResolve = (options, callback) =>
          onResolve(options, (args) => {
            const t0 = performance.now();
            try {
              const out = callback(args);
              if (isPromise(out)) {
                return out.then((result) => {
                  stats.resolve++;
                  stats.resolveMs += performance.now() - t0;
                  return result;
                }, (err) => {
                  stats.resolve++;
                  stats.resolveMs += performance.now() - t0;
                  throw err;
                });
              }
              stats.resolve++;
              stats.resolveMs += performance.now() - t0;
              return out;
            } catch (err) {
              stats.resolve++;
              stats.resolveMs += performance.now() - t0;
              throw err;
            }
          });
        build.onLoad = (options, callback) =>
          onLoad(options, (args) => {
            const t0 = performance.now();
            try {
              const out = callback(args);
              if (isPromise(out)) {
                return out.then((result) => {
                  stats.load++;
                  stats.loadMs += performance.now() - t0;
                  return result;
                }, (err) => {
                  stats.load++;
                  stats.loadMs += performance.now() - t0;
                  throw err;
                });
              }
              stats.load++;
              stats.loadMs += performance.now() - t0;
              return out;
            } catch (err) {
              stats.load++;
              stats.loadMs += performance.now() - t0;
              throw err;
            }
          });
        return plugin.setup(build);
      },
    } satisfies esbuild.Plugin;
  });

  wrapped.push({
    name: "dreamer-esbuild-profile",
    setup(build) {
      build.onEnd(() => {
        const rows = all
          .map(({ name, stats }) => ({
            name,
            ...stats,
            totalMs: stats.resolveMs + stats.loadMs,
          }))
          .filter((row) => row.resolve > 0 || row.load > 0)
          .sort((a, b) => b.totalMs - a.totalMs);
        const total = rows.reduce((sum, row) => sum + row.totalMs, 0);
        emitProfile(log, `[profile] plugin hooks ${total.toFixed(0)}ms`);
        for (const row of rows) {
          emitProfile(
            log,
            `[profile]   ${row.name}: resolve ${row.resolve}× ${
              row.resolveMs.toFixed(0)
            }ms, load ${row.load}× ${row.loadMs.toFixed(0)}ms`,
          );
        }
        void writeTextFile(PROFILE_LOG, profileLines.join("\n") + "\n");
      });
    },
  });
  return wrapped;
}
