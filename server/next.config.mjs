import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Trace dependencies from server/, not from the repo root.
  //
  // This is a two-package repo with no workspace hoisting, so there are two
  // lockfiles. Next picks one to use as the tracing root and guesses the repo
  // root, which is wrong: this app's dependencies live in server/node_modules.
  // Left alone it logs "inferred your workspace root, but it may not be
  // correct" and can ship serverless functions missing files they need — a
  // failure that only shows up at runtime, as a module-not-found on a cold
  // start rather than as a build error.
  outputFileTracingRoot: here,

  // Serve the exported Expo web app (public/index.html) at the site root.
  // /api/*, /join/*, /invite/*, /g/*, /privacy and /terms stay real Next
  // routes and take precedence over this rewrite.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
