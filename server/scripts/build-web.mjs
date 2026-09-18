// Exports the Expo app for web and drops it into server/public, so one Vercel
// deployment serves both the API and the whole application UI.
//
// THIS SCRIPT IS THE "NO DOWNLOAD REQUIRED" PROMISE (CONTEXT.md §6). Without
// it there is no web app — only an API and an App Store listing.
//
// Runs as part of `vercel-build`, before `next build`.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..");
const rootDir = join(serverDir, "..");
const mobileDir = join(rootDir, "mobile");
const distDir = join(mobileDir, "dist");
const publicDir = join(serverDir, "public");
const pwaDir = join(serverDir, "pwa");

/**
 * On a preview deployment, point the web bundle at *its own* branch URL.
 *
 * EXPO_PUBLIC_API_BASE is inlined by Metro at build time, so without this the
 * dev branch would ship a UI that calls production — you'd think you were
 * testing and you'd be mutating live data.
 *
 * VERCEL_BRANCH_URL is stable per branch; VERCEL_URL changes every deployment.
 */
function previewApiBase() {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

const apiBase = previewApiBase();
if (apiBase) console.log(`[build-web] preview build → API base ${apiBase}`);

const run = (cmd, cwd) =>
  execSync(cmd, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
      // Set as a real process env var so it wins over mobile/.env — dotenv
      // does not override variables already present in the environment.
      ...(apiBase ? { EXPO_PUBLIC_API_BASE: apiBase } : {}),
    },
  });

const onCI = Boolean(process.env.VERCEL || process.env.CI);
if (onCI || !existsSync(join(mobileDir, "node_modules"))) {
  // `npm install --omit=dev`, not `npm ci`: the web export needs runtime deps
  // only, and the two packages install independently (no workspace hoisting).
  run("npm install --omit=dev --no-audit --no-fund", mobileDir);
}

run("npx expo export -p web --output-dir dist", mobileDir);

// public/ is generated and gitignored — always rebuild it from scratch so a
// deleted asset doesn't linger from a previous build.
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(distDir, publicDir, { recursive: true });
cpSync(pwaDir, publicDir, { recursive: true });

// Expo's exported index.html knows nothing about PWA installability, so the
// head tags are injected here rather than maintained in a custom template.
const PWA_HEAD = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#1D6FE0" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Ski House" />
    <meta property="og:title" content="Ski House — run the lease, not the group text" />
    <meta property="og:description" content="Expenses, votes, guest fees and who's skiing what. No download required." />
    <meta property="og:type" content="website" />
  `;

const indexPath = join(publicDir, "index.html");
let html = readFileSync(indexPath, "utf8");
if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", `${PWA_HEAD}</head>`);
  writeFileSync(indexPath, html);
}

console.log("[build-web] web app exported into server/public");
