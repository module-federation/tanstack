// The root entrypoint remains Vite-compatible. Rsbuild users should import
// `@module-federation/tanstack/rsbuild` so their installation never resolves
// the Vite adapter.
export { tanstackStartModuleFederation, type TanStackStartModuleFederationOptions } from "./vite";
