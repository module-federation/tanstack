/**
 * Type declaration for the package self-reference used as the adapter replacement point.
 * The bundler replaces this module with the resolver generated from its remote configuration.
 */
declare module "@module-federation/tanstack/remote-stylesheet-resolver" {
  export const resolveRemoteStylesheet: import("./runtime").RemoteStylesheetResolver;
  const defaultResolver: import("./runtime").RemoteStylesheetResolver;
  export default defaultResolver;
}
