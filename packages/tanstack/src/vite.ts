import { federation, type ModuleFederationOptions } from "@module-federation/vite";
import { defaultShared, eagerShared, resolveShared } from "./shared";

export type TanStackStartModuleFederationOptions = Omit<ModuleFederationOptions, "target">;

/** Creates one Vite federation plugin set for TanStack Start's client and SSR environments. */
export function tanstackStartModuleFederation(options: TanStackStartModuleFederationOptions) {
  const {
    shared,
    target: _environmentSpecificTarget,
    ...configured
  } = options as ModuleFederationOptions;

  // A host renders with its own React before any remote registers a provider. Eager host
  // shares keep that instance in the share scope, so remotes from other bundlers cannot
  // replace it. Remote-only builds stay lazy and defer to the host.
  const isHost = Object.keys(configured.remotes ?? {}).length > 0;

  return federation({
    ...configured,
    filename: configured.filename ?? "remoteEntry.js",
    manifest: configured.manifest ?? true,
    hostInitInjectLocation: configured.hostInitInjectLocation ?? "entry",
    shared: resolveShared(
      shared,
      isHost ? eagerShared : defaultShared,
    ) as ModuleFederationOptions["shared"],
  });
}
