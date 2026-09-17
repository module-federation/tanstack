import { federation, type ModuleFederationOptions } from "@module-federation/vite";

export type TanStackStartModuleFederationOptions = Omit<ModuleFederationOptions, "target">;

const defaultShared = {
  react: { singleton: true },
  "react-dom": { singleton: true },
} as const;

type SharedOptions = NonNullable<ModuleFederationOptions["shared"]>;
type SharedRecord = Exclude<SharedOptions, string[]>;

function resolveShared(shared: SharedOptions | undefined): SharedRecord {
  if (!Array.isArray(shared)) {
    return {
      ...defaultShared,
      ...shared,
    };
  }

  const additionalShared = Object.fromEntries(
    shared
      .filter((packageName) => !Object.hasOwn(defaultShared, packageName))
      .map((packageName) => [packageName, {}]),
  );

  return {
    ...defaultShared,
    ...additionalShared,
  };
}

/** Creates one Module Federation plugin set for TanStack Start's client and SSR environments. */
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
    shared: resolveShared(shared),
  });
}
