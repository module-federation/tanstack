import { createElement, lazy, type ComponentProps, type ComponentType } from "react";

export type LazyRemoteOptions = {
  /** How long a failed load stays failed before a render tries again, in milliseconds. Defaults to 5 seconds. */
  retryAfterMs?: number;
};

/**
 * `React.lazy` for remote modules. A component from `React.lazy` that fails to load stays
 * failed: on a server, every later request renders the same error, even once the remote
 * is back. This one loads again on the first render after `retryAfterMs`.
 *
 * ```tsx
 * const StatusCard = lazyRemote(() => import("remote/StatusCard"));
 * ```
 */
export function lazyRemote<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  { retryAfterMs = 5_000 }: LazyRemoteOptions = {},
): ComponentType<ComponentProps<T>> {
  let failedAt: number | undefined;
  const create = () =>
    lazy(() =>
      load().catch((error: unknown) => {
        failedAt = Date.now();
        throw error;
      }),
    );
  let current = create();

  return function RemoteComponent(props: ComponentProps<T>) {
    // React renders again right after a load fails, to report the error. Waiting before a
    // new attempt keeps that render from starting another load.
    if (failedAt !== undefined && Date.now() - failedAt >= retryAfterMs) {
      failedAt = undefined;
      current = create();
    }
    return createElement(current as ComponentType<ComponentProps<T>>, props);
  };
}

export type RemoteStylesheetOptions = {
  /** How long a fetched manifest is reused, in milliseconds. Defaults to 30 seconds. */
  maxAgeMs?: number;
};

type CssAssets = { async?: string[]; sync?: string[] };

type RemoteManifest = {
  exposes?: Array<{ assets?: { css?: CssAssets }; name?: string; path?: string }>;
  metaData?: { publicPath?: string };
};

const manifests = new Map<string, { fetchedAt: number; manifest: Promise<RemoteManifest> }>();

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
  { maxAgeMs = 30_000 }: RemoteStylesheetOptions = {},
): Promise<string[]> {
  const manifest = await fetchManifest(manifestUrl, maxAgeMs);
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

function fetchManifest(url: string, maxAgeMs: number) {
  const cached = manifests.get(url);
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached.manifest;

  const manifest = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}.`);
    return (await response.json()) as RemoteManifest;
  });
  manifests.set(url, { fetchedAt: Date.now(), manifest });
  // A failed fetch is not reused: the next call retries.
  manifest.catch(() => {
    if (manifests.get(url)?.manifest === manifest) manifests.delete(url);
  });
  return manifest;
}
