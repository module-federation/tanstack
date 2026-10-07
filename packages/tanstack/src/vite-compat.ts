import type { Plugin } from "vite";

/**
 * Fails fast on Vite 7 and older. `@module-federation/vite` loads remotes on the server
 * only through Vite 8's module runner and Rolldown output, so federated SSR breaks
 * silently on older versions.
 */
export function viteVersionPlugin(): Plugin {
  return {
    name: "tanstack-start-federation:vite-version",
    enforce: "pre",
    config() {
      const version = this.meta.viteVersion;
      const major = Number(version?.split(".")[0]);
      if (major < 8) {
        throw new Error(
          `@module-federation/tanstack requires Vite 8; this project runs Vite ${version}.`,
        );
      }
    },
  };
}
