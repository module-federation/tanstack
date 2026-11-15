// Build-time checks shared by the Rsbuild and Vite adapters for a remote's published server
// container, which ships with the browser assets and so must not contain server function
// handlers.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { remoteServerFunctionBase } from "./server-functions";

export const SERVER_CONTAINER_RPC = "@module-federation/tanstack/server-container-rpc";
export const SERVER_FN_BASE_DEFINE = "process.env.TSS_SERVER_FN_BASE";

const SERVER_FN_DEFINITION = /\bcreateServerFn\b/;
const SERVER_FN_CALLER = /\bcreateSsrRpc\b/;
// A compiled caller passes its function ID as a string literal.
const SERVER_FN_CALLER_CALL = /\bcreateSsrRpc\(\s*["'`]/;
const TANSTACK_PACKAGE = /[\\/]node_modules[\\/]@tanstack[\\/]/;

/**
 * Returns the directory of the `@tanstack/start-plugin-core` used by the app's TanStack
 * Start. Its compiler hosts are not exported, so the adapters load them from there.
 */
export function resolveStartPluginCore(root: string): string {
  const appRequire = createRequire(join(root, "package.json"));
  const startRequire = createRequire(appRequire.resolve("@tanstack/react-start/package.json"));
  return dirname(startRequire.resolve("@tanstack/start-plugin-core/package.json"));
}

/**
 * Returns a check for each module compiled into a remote's server container. It throws when
 * the module still defines a server function, which would publish its handler, or when the
 * module calls server functions and the remote's server function base is not the one hosts
 * route to the remote.
 */
export function createServerContainerCheck({
  compilerLoaded,
  container,
  getServerFunctionBase,
  remoteName,
}: {
  compilerLoaded: boolean;
  container: string;
  getServerFunctionBase: () => unknown;
  remoteName: string;
}): (code: string, id: string) => void {
  const expectedBase = remoteServerFunctionBase(remoteName);
  let checkedBase = false;
  const checkServerFunctionBase = () => {
    if (checkedBase) return;
    const base = getServerFunctionBase();
    if (base !== JSON.stringify(expectedBase)) {
      throw new Error(
        `Remote "${remoteName}" exposes modules that call server functions, so hosts must ` +
          "be able to route those calls to its server. Set " +
          `tanstackStart({ serverFns: { base: "${expectedBase.slice(0, -1)}" } }) ` +
          `in the remote (its server function base is ${String(base)}).`,
      );
    }
    checkedBase = true;
  };

  return (code, id) => {
    if (TANSTACK_PACKAGE.test(id)) return;
    if (SERVER_FN_CALLER_CALL.test(code)) checkServerFunctionBase();
    if (!SERVER_FN_DEFINITION.test(code) || SERVER_FN_CALLER.test(code)) return;
    throw new Error(
      `${id} defines a server function that was not compiled for the remote's ` +
        `server container (${container}), which would publish its ` +
        "handler with the browser assets." +
        (compilerLoaded
          ? ""
          : " @module-federation/tanstack could not load TanStack Start's compiler " +
            "from @tanstack/start-plugin-core; this TanStack Start version is not " +
            "supported."),
    );
  };
}
