// Development servers: Vite and Rsbuild dev servers with in-memory builds.
import { test } from "node:test";
import { describeExamples } from "./support/examples.mjs";

describeExamples("start", {
  // In development, @module-federation/vite's ModuleRunner transport leaves a rejected
  // fetch unhandled once a server-rendered Vite remote goes away, which exits the Vite
  // host's dev server. Production builds survive the same outage.
  outageRemotes: ["rsbuildRemote", "rsbuildSsrRemote"],
});

test.todo("Vite host dev server survives its server-rendered Vite remote going offline");
