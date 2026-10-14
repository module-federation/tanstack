export const tanstackStartSharedPackages = [
  "react",
  "react-dom",
  "@tanstack/react-router",
  "@tanstack/router-core",
] as const;

export const defaultShared = {
  react: { singleton: true },
  "react-dom": { singleton: true },
  "@tanstack/react-router": { singleton: true },
  "@tanstack/router-core": { singleton: true },
} as const;

export const eagerShared = {
  react: { eager: true, singleton: true },
  "react-dom": { eager: true, singleton: true },
  "@tanstack/react-router": { eager: true, singleton: true },
  "@tanstack/router-core": { eager: true, singleton: true },
} as const;

export function resolveShared(
  shared: unknown,
  defaults: Record<string, unknown> = defaultShared,
): Record<string, unknown> {
  if (Array.isArray(shared)) {
    return {
      ...defaults,
      ...Object.fromEntries(
        shared
          .filter((packageName): packageName is string => typeof packageName === "string")
          .filter((packageName) => !Object.hasOwn(defaults, packageName))
          .map((packageName) => [packageName, {}]),
      ),
    };
  }

  return {
    ...defaults,
    ...(shared && typeof shared === "object" ? shared : {}),
  };
}
