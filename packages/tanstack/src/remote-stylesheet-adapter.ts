export const REMOTE_STYLESHEET_RESOLVER_MODULE =
  "@module-federation/tanstack/remote-stylesheet-resolver";

export const RESOLVED_REMOTE_STYLESHEET_RESOLVER_MODULE = `\0${REMOTE_STYLESHEET_RESOLVER_MODULE}`;

type SerializedRemote = {
  entry: string;
  name: string;
  alias?: string;
};

/**
 * Generates the adapter-owned resolver module. The remote configuration is serialized at
 * build time so server and browser bundles use the same manifest identity policy without a
 * process-global federation runtime singleton.
 */
export function createRemoteStylesheetResolverModule(remotes: unknown): string {
  const serializedRemotes = JSON.stringify(normalizeAdapterRemotes(remotes));
  if (serializedRemotes === undefined) {
    throw new TypeError("Remote stylesheet remotes must be JSON serializable.");
  }

  return `import { createRemoteStylesheetResolver } from "@module-federation/tanstack/runtime";

export const resolveRemoteStylesheet = createRemoteStylesheetResolver(${serializedRemotes});
export default resolveRemoteStylesheet;
`;
}

function normalizeAdapterRemotes(remotes: unknown): SerializedRemote[] {
  if (remotes == null) return [];
  if (Array.isArray(remotes)) {
    return remotes.flatMap((remote) => {
      if (typeof remote === "string" || isDirectRemoteConfig(remote)) {
        return [normalizeAdapterRemote(undefined, remote)];
      }
      if (isRecord(remote)) {
        return Object.entries(remote).map(([key, value]) => normalizeAdapterRemote(key, value));
      }
      throw new TypeError(
        "Remote stylesheet remotes must use a supported Module Federation shape.",
      );
    });
  }
  if (!isRecord(remotes)) {
    throw new TypeError("Remote stylesheet remotes must use a supported Module Federation shape.");
  }
  return Object.entries(remotes).map(([key, value]) => normalizeAdapterRemote(key, value));
}

function normalizeAdapterRemote(key: string | undefined, remote: unknown): SerializedRemote {
  if (typeof remote === "string") {
    const parsed = parseNamedRemote(remote);
    const name = parsed?.name ?? key;
    if (!name) throw new TypeError(`A remote string must include a name: ${remote}`);
    return { alias: key !== name ? key : undefined, entry: parsed?.entry ?? remote, name };
  }

  if (Array.isArray(remote)) {
    const first = remote.find((value) => typeof value === "string");
    if (!first) throw new TypeError(`Remote "${key ?? "unknown"}" must define an entry.`);
    return normalizeAdapterRemote(key, first);
  }

  if (!isRecord(remote)) {
    throw new TypeError("A configured remote must use a supported Module Federation shape.");
  }

  const external = firstString(remote.external);
  const source = typeof remote.entry === "string" ? remote.entry : external;
  const parsed = source ? parseNamedRemote(source) : undefined;
  const name = (typeof remote.name === "string" ? remote.name : parsed?.name) ?? key;
  if (!name) throw new TypeError("A configured remote must have a name.");
  const entry = parsed?.entry ?? source;
  if (!entry) throw new TypeError(`Remote "${name}" must define an entry or external URL.`);
  const alias = typeof remote.alias === "string" ? remote.alias : key !== name ? key : undefined;
  return { alias, entry, name };
}

function isDirectRemoteConfig(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.entry === "string" ||
    typeof value.external === "string" ||
    Array.isArray(value.external) ||
    typeof value.name === "string" ||
    typeof value.alias === "string"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  return undefined;
}

function parseNamedRemote(remote: string): { entry: string; name: string } | undefined {
  const match = /^([^/@]+)@(.+)$/.exec(remote);
  const name = match?.[1];
  const entry = match?.[2];
  if (!name || !entry || (!entry.includes("://") && !entry.startsWith("/"))) return undefined;
  return { entry, name };
}
