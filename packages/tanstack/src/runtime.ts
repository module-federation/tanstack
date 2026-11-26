import { createElement, lazy, type ComponentProps, type ComponentType } from "react";
import { fetchRemoteJson, type RemoteFetchOptions } from "./remote-fetch";
import type { RemoteErrorCode } from "./remote-errors";

export { RemoteFetchError } from "./remote-fetch";
export { REMOTE_ERROR_CODES, REMOTE_ERROR_DESCRIPTIONS } from "./remote-errors";
export type { RemoteFetchOptions, RemoteErrorCode };

export type LazyRemoteOptions = {
  /** How long a failed load stays failed before a render tries again, in milliseconds. Defaults to 5 seconds. */
  retryAfterMs?: number;
};

export type LazyRemoteComponent<T extends ComponentType<any>> = ComponentType<ComponentProps<T>> & {
  /**
   * Loads the remote now and resolves with its module. Shares attempts, failures, and
   * `retryAfterMs` with rendering, so a loader and a render never load the remote twice.
   */
  preload(): Promise<{ default: T }>;
};

/**
 * `React.lazy` for remote modules. A component from `React.lazy` that fails to load stays
 * failed: on a server, every later request renders the same error, even once the remote
 * is back. This one loads again on the first render or `preload()` after `retryAfterMs`.
 *
 * Await `preload()` in the route loader of a server-rendered page. A component that has not
 * loaded yet suspends on its first render, and a streaming server then sends the remote's
 * markup in a hidden segment that only JavaScript reveals.
 *
 * ```tsx
 * const StatusCard = lazyRemote(() => import("remote/StatusCard"));
 *
 * export const Route = createFileRoute("/")({
 *   // An unavailable remote must not fail the route: an error boundary handles it.
 *   loader: () => StatusCard.preload().catch(() => null),
 *   component: () => <StatusCard />,
 * });
 * ```
 */
export function lazyRemote<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  { retryAfterMs = 5_000 }: LazyRemoteOptions = {},
): LazyRemoteComponent<T> {
  let loaded: { default: T } | undefined;
  let failedAt: number | undefined;
  let current: { Lazy: ComponentType<any>; promise: Promise<{ default: T }> } | undefined;

  const attempt = () => {
    // React renders again right after a load fails, to report the error. Waiting before a
    // new attempt keeps that render from starting another load.
    if (current && (failedAt === undefined || Date.now() - failedAt < retryAfterMs)) {
      return current;
    }
    failedAt = undefined;
    const promise = load().then(
      (module) => (loaded = module),
      (error: unknown) => {
        failedAt = Date.now();
        throw error;
      },
    );
    current = { Lazy: lazy(() => promise), promise };
    return current;
  };

  function RemoteComponent(props: ComponentProps<T>) {
    // Once loaded, render the module itself: a new React.lazy would suspend once more.
    return createElement(loaded ? loaded.default : attempt().Lazy, props);
  }
  RemoteComponent.preload = () => (loaded ? Promise.resolve(loaded) : attempt().promise);
  return RemoteComponent;
}

export type RemoteStylesheetOptions = RemoteFetchOptions & {
  /** How long a fetched manifest is reused, in milliseconds. Defaults to 30 seconds. */
  maxAgeMs?: number;
  /** Resolves a `remote/Expose` specifier to the manifest that declares its assets. */
  resolveRemote?: RemoteStylesheetResolver;
  /** Observes failures without converting a rejected stylesheet lookup into a success. */
  onError?: (error: unknown) => void | Promise<void>;
};

export type RemoteStylesheetTarget = {
  manifestUrl: string;
  expose: string;
};

export type RemoteStylesheetResolver = (
  specifier: string,
) => RemoteStylesheetTarget | Promise<RemoteStylesheetTarget>;

export type RemoteStylesheetRemoteConfig = {
  entry?: string;
  name?: string;
  alias?: string;
  external?: string | readonly string[];
  type?: string;
  internalName?: string;
  entryGlobalName?: string;
  shareScope?: string | string[];
  [key: string]: unknown;
};

type RemoteStylesheetRemoteValue = string | readonly string[] | RemoteStylesheetRemoteConfig;

export type RemoteStylesheetRemotes =
  | Record<string, RemoteStylesheetRemoteValue>
  | readonly (
      | string
      | RemoteStylesheetRemoteConfig
      | Record<string, RemoteStylesheetRemoteValue>
    )[];

export type RemoteStylesheetRemoteInfo = {
  entry: string;
  name: string;
  alias?: string;
};

export type RemoteStylesheetResolverOptions = {
  /**
   * Converts the configured remote entry into the manifest URL used for CSS metadata.
   * The default replaces the entry filename with `mf-manifest.json` unless the entry is
   * already a JSON manifest.
   */
  resolveManifestUrl?: (remote: RemoteStylesheetRemoteInfo) => string | Promise<string>;
};

export class RemoteStylesheetResolutionError extends Error {
  readonly specifier: string;

  constructor(message: string, specifier: string) {
    super(message);
    this.name = "RemoteStylesheetResolutionError";
    this.specifier = specifier;
  }
}

type CssAssets = { async?: string[]; sync?: string[] };

type RemoteManifest = {
  exposes?: Array<{ assets?: { css?: CssAssets }; name?: string; path?: string }>;
  metaData?: { publicPath?: string };
};

const manifests = new Map<string, ManifestCacheEntry>();
let adapterResolver: Promise<RemoteStylesheetResolver> | undefined;

/**
 * Creates the adapter-owned part of stylesheet lookup. It accepts the object form used by
 * Vite and the `name@entry` string form used by Rsbuild, but does not inspect a global
 * federation singleton. The caller can provide the adapter's manifest policy when a direct
 * entry is not normalized to a sibling manifest by convention.
 */
export function createRemoteStylesheetResolver(
  remotes: RemoteStylesheetRemotes = {},
  { resolveManifestUrl = defaultManifestUrl }: RemoteStylesheetResolverOptions = {},
): RemoteStylesheetResolver {
  const configured = normalizeRemotes(remotes);

  return async (specifier) => {
    const { remoteName, expose } = splitRemoteSpecifier(specifier);
    const remote = configured.find(({ aliases }) => aliases.includes(remoteName));
    if (!remote) {
      throw new RemoteStylesheetResolutionError(
        `No configured remote matches "${remoteName}" in "${specifier}".`,
        specifier,
      );
    }

    const manifestUrl = await resolveManifestUrl(remote.info);
    if (!manifestUrl) {
      throw new RemoteStylesheetResolutionError(
        `Could not resolve a manifest URL for remote "${remote.info.name}".`,
        specifier,
      );
    }
    return { expose, manifestUrl };
  };
}

/** Deduplicates absolute stylesheet URLs while preserving their first declaration order. */
export function dedupeRemoteStylesheets(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())];
}

/**
 * Lists the stylesheets a remote's manifest declares for an exposed module, as absolute
 * URLs. Return them from a route loader and render them in the route's `head`, so markup
 * a remote rendered on the server is styled before the remote's JavaScript loads.
 *
 * The `remote/Expose` form uses the active Vite or Rsbuild adapter resolver automatically.
 * Pass `resolveRemote` to override it, or use the explicit `(manifestUrl, expose)` form.
 *
 * Rejects when the manifest cannot be fetched or does not list `expose`.
 */
export async function getRemoteStylesheets(
  manifestUrl: string,
  expose: string,
  options?: RemoteStylesheetOptions,
): Promise<string[]>;
export async function getRemoteStylesheets(
  specifier: string,
  options?: RemoteStylesheetOptions,
): Promise<string[]>;
export async function getRemoteStylesheets(
  target: string,
  exposeOrOptions?: string | RemoteStylesheetOptions,
  explicitOptions?: RemoteStylesheetOptions,
): Promise<string[]> {
  const options =
    typeof exposeOrOptions === "string" ? (explicitOptions ?? {}) : (exposeOrOptions ?? {});

  try {
    const resolved =
      typeof exposeOrOptions === "string"
        ? { expose: exposeOrOptions, manifestUrl: target }
        : await (options.resolveRemote ?? (await loadAdapterResolver()))(target);

    if (!resolved) {
      throw new RemoteStylesheetResolutionError(
        `Resolving "${target}" requires the resolveRemote option.`,
        target,
      );
    }

    const manifest = await fetchManifest(resolved.manifestUrl, options);
    const name = resolved.expose.replace(/^\.\//, "");
    const exposed = manifest.exposes?.find(
      (candidate) => candidate.path === resolved.expose || candidate.name === name,
    );
    if (!exposed) {
      throw new Error(`${resolved.manifestUrl} does not expose "${resolved.expose}".`);
    }

    // "auto" means the assets sit next to the manifest.
    const publicPath = manifest.metaData?.publicPath;
    const base = new URL(
      publicPath && publicPath !== "auto" ? publicPath : ".",
      resolved.manifestUrl,
    );
    const { async = [], sync = [] } = exposed.assets?.css ?? {};
    return dedupeRemoteStylesheets(sync, async).map((asset) => new URL(asset, base).href);
  } catch (error) {
    try {
      const report = options.onError?.(error);
      if (report) void Promise.resolve(report).catch(() => undefined);
    } catch {
      // Reporting must never replace the original stylesheet failure.
    }
    throw error;
  }
}

type NormalizedRemote = {
  aliases: string[];
  info: RemoteStylesheetRemoteInfo;
};

function normalizeRemotes(remotes: RemoteStylesheetRemotes): NormalizedRemote[] {
  if (Array.isArray(remotes)) {
    return remotes.flatMap((remote) => {
      if (typeof remote === "string" || isRemoteConfig(remote)) {
        return [normalizeRemote(undefined, remote)];
      }
      return Object.entries(remote as Record<string, RemoteStylesheetRemoteValue>).map(
        ([key, value]) => normalizeRemote(key, value),
      );
    });
  }
  return Object.entries(remotes).map(([key, remote]) => normalizeRemote(key, remote));
}

function normalizeRemote(
  key: string | undefined,
  remote: RemoteStylesheetRemoteValue,
): NormalizedRemote {
  if (typeof remote === "string") {
    const named = parseNamedRemote(remote);
    const entry = named?.entry ?? remote;
    const name = named?.name ?? key;
    if (!name) {
      throw new TypeError(`A remote string must include a name when used in an array: ${remote}`);
    }
    return {
      aliases: uniqueStrings([key, name]),
      info: { entry, name },
    };
  }

  if (isRemoteEntryList(remote)) {
    const first = remote[0];
    if (!first) {
      throw new TypeError(`Remote "${key ?? "unknown"}" must define an entry.`);
    }
    return normalizeRemote(key, first);
  }

  const external = firstString(remote.external);
  const source = remote.entry ?? external;
  const parsed = source ? parseNamedRemote(source) : undefined;
  const name = remote.name ?? parsed?.name ?? key;
  if (!name) throw new TypeError("A configured remote must have a name.");
  const entry = parsed?.entry ?? source;
  if (!entry) {
    throw new TypeError(`Remote "${name}" must define an entry or external URL.`);
  }
  return {
    aliases: uniqueStrings([key, name, parsed?.name, remote.alias]),
    info: { alias: remote.alias ?? (key !== name ? key : undefined), entry, name },
  };
}

function isRemoteConfig(value: unknown): value is RemoteStylesheetRemoteConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const remote = value as Record<string, unknown>;
  return (
    typeof remote.entry === "string" ||
    typeof remote.external === "string" ||
    Array.isArray(remote.external) ||
    typeof remote.name === "string" ||
    typeof remote.alias === "string"
  );
}

function isRemoteEntryList(value: unknown): value is readonly string[] {
  return Array.isArray(value);
}

function firstString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.find((item): item is string => Boolean(item));
}

async function loadAdapterResolver(): Promise<RemoteStylesheetResolver> {
  adapterResolver ??= import("@module-federation/tanstack/remote-stylesheet-resolver").then(
    ({ resolveRemoteStylesheet }) => resolveRemoteStylesheet,
  );
  return adapterResolver;
}

function parseNamedRemote(remote: string): { entry: string; name: string } | undefined {
  const match = /^([^/@]+)@(.+)$/.exec(remote);
  const name = match?.[1];
  const entry = match?.[2];
  if (!name || !entry || (!entry.includes("://") && !entry.startsWith("/"))) return undefined;
  return { entry, name };
}

function splitRemoteSpecifier(specifier: string): { expose: string; remoteName: string } {
  const separator = specifier.indexOf("/");
  if (separator <= 0 || separator === specifier.length - 1) {
    throw new RemoteStylesheetResolutionError(
      `Expected a remote specifier in the form "remote/Expose", received "${specifier}".`,
      specifier,
    );
  }
  const remoteName = specifier.slice(0, separator);
  const rawExpose = specifier.slice(separator + 1);
  return {
    expose: rawExpose.startsWith(".") ? rawExpose : `./${rawExpose}`,
    remoteName,
  };
}

function defaultManifestUrl(remote: RemoteStylesheetRemoteInfo): string {
  if (/\.json(?:[?#]|$)/i.test(remote.entry)) return remote.entry;

  try {
    const url = new URL(remote.entry);
    url.pathname = url.pathname.replace(/[^/]*$/, "mf-manifest.json");
    return url.href;
  } catch {
    const hashIndex = remote.entry.indexOf("#");
    const hash = hashIndex >= 0 ? remote.entry.slice(hashIndex) : "";
    const withoutHash = hashIndex >= 0 ? remote.entry.slice(0, hashIndex) : remote.entry;
    const queryIndex = withoutHash.indexOf("?");
    const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
    const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
    return `${pathname.replace(/[^/]*$/, "mf-manifest.json")}${query}${hash}`;
  }
}

function uniqueStrings(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

interface ManifestCacheEntry {
  fetchedAt?: number;
  manifest: Promise<RemoteManifest>;
}

function fetchManifest(
  url: string,
  { maxAgeMs = 30_000, fetchTimeoutMs, fetchMaxBytes }: RemoteStylesheetOptions,
) {
  const cached = manifests.get(url);
  if (cached && (cached.fetchedAt === undefined || Date.now() - cached.fetchedAt < maxAgeMs)) {
    return cached.manifest;
  }

  const manifest = fetchRemoteJson<RemoteManifest>(url, { fetchTimeoutMs, fetchMaxBytes });
  const entry: ManifestCacheEntry = { manifest };
  manifests.set(url, entry);
  // A failed fetch is not reused: the next call retries.
  manifest.catch(() => {
    if (manifests.get(url) === entry) manifests.delete(url);
  });
  manifest.then(
    () => {
      if (manifests.get(url) === entry) entry.fetchedAt = Date.now();
    },
    () => undefined,
  );
  return manifest;
}
