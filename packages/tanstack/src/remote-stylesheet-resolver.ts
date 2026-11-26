import { RemoteStylesheetResolutionError, type RemoteStylesheetResolver } from "./runtime";

/**
 * Resolves a `remote/Expose` specifier through the active federation adapter.
 *
 * Vite and Rsbuild replace this module at build time with a resolver created from the
 * adapter's configured remotes. The fallback keeps the package import type-safe and fails
 * explicitly when the federation adapter is not installed in the bundler configuration.
 */
export const resolveRemoteStylesheet: RemoteStylesheetResolver = async (specifier) => {
  throw new RemoteStylesheetResolutionError(
    `No Module Federation adapter resolver is available for "${specifier}".`,
    specifier,
  );
};

export default resolveRemoteStylesheet;
