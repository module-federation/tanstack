import { createElement, lazy, type ComponentProps, type ComponentType } from "react";
import { fetchRemoteJson, type RemoteFetchOptions } from "./remote-fetch";

export type { RemoteFetchOptions } from "./remote-fetch";

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
};

type CssAssets = { async?: string[]; sync?: string[] };

type RemoteManifest = {
  exposes?: Array<{ assets?: { css?: CssAssets }; name?: string; path?: string }>;
  metaData?: { publicPath?: string };
};

const manifests = new Map<string, ManifestCacheEntry>();

/**
 * Lists the stylesheets a remote's manifest declares for an exposed module, as absolute
 * URLs. Return them from a route loader and render them in the route's `head`, so markup
 * a remote rendered on the server is styled before the remote's JavaScript loads.
 *
 * Rejects when the manifest cannot be fetched or does not list `expose`.
 */
export async function getRemoteStylesheets(
  manifestUrl: string,
  expose: string,
  { maxAgeMs = 30_000, fetchTimeoutMs, fetchMaxBytes }: RemoteStylesheetOptions = {},
): Promise<string[]> {
  const manifest = await fetchManifest(manifestUrl, {
    maxAgeMs,
    fetchTimeoutMs,
    fetchMaxBytes,
  });
  const name = expose.replace(/^\.\//, "");
  const exposed = manifest.exposes?.find(
    (candidate) => candidate.path === expose || candidate.name === name,
  );
  if (!exposed) throw new Error(`${manifestUrl} does not expose "${expose}".`);

  // "auto" means the assets sit next to the manifest.
  const publicPath = manifest.metaData?.publicPath;
  const base = new URL(publicPath && publicPath !== "auto" ? publicPath : ".", manifestUrl);
  const { async = [], sync = [] } = exposed.assets?.css ?? {};
  return [...new Set([...sync, ...async])].map((asset) => new URL(asset, base).href);
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
