declare module "tanstack_vite_remote/StatusCard" {
  import type { ComponentType } from "react";

  const StatusCard: ComponentType;
  export default StatusCard;
}

declare module "tanstack_vite_remote/RouterCard" {
  import type { ComponentType } from "react";

  const RouterCard: ComponentType;
  export default RouterCard;
}

declare module "tanstack_rsbuild_remote/StatusCard" {
  import type { ComponentType } from "react";

  const StatusCard: ComponentType;
  export default StatusCard;
}

declare module "tanstack_rsbuild_ssr_remote/StatusCard" {
  import type { ComponentType } from "react";

  const StatusCard: ComponentType;
  export default StatusCard;
}

declare module "tanstack_rsbuild_ssr_remote/serverFunctions" {
  export const getRemoteGreeting: () => Promise<{ message: string }>;
  export const greetHost: (options: { data: { host: string } }) => Promise<{ message: string }>;
}
