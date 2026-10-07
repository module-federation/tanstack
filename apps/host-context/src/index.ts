import { createContext, useContext } from "react";

/**
 * Provided by each host and read by every remote card. Shared as a Module Federation
 * singleton, so a remote only sees the host's value if both resolve one module instance.
 */
export const HostContext = createContext("standalone");

export function useHostName() {
  return useContext(HostContext);
}
