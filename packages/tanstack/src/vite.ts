import { federation, type ModuleFederationOptions } from "@module-federation/vite";
import { resolveShared } from "./shared";

export type TanStackStartModuleFederationOptions = Omit<ModuleFederationOptions, "target">;

/** Creates one Vite federation plugin set for TanStack Start's client and SSR environments. */
export function tanstackStartModuleFederation(options: TanStackStartModuleFederationOptions) {
  const {
    shared,
    target: _environmentSpecificTarget,
    ...configured
  } = options as ModuleFederationOptions;

  return federation({
    ...configured,
    filename: configured.filename ?? "remoteEntry.js",
    manifest: configured.manifest ?? true,
    hostInitInjectLocation: configured.hostInitInjectLocation ?? "entry",
    shared: resolveShared(shared) as ModuleFederationOptions["shared"],
  });
}
