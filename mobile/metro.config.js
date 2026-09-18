// Metro config. Expo's defaults, plus one escape hatch.
//
// WATCHMAN. Metro prefers Watchman for file watching and falls back to node's
// own fs watching when the binary is absent. But when the binary *exists* and
// its daemon is unreachable, Metro does not fall back — it blocks forever on
// `watch-project`, printing "Waiting for Watchman (10s)… (30s)…" and never
// bundling. That is a machine-level problem (a stale or unmanaged Watchman
// install), not a project one, so the default stays on.
//
// If you hit it, export with Watchman off:
//
//   EXPO_USE_WATCHMAN=0 npm run web
//   EXPO_USE_WATCHMAN=0 npm run export:web
//
// Slightly slower cold start, no watching. CI and Vercel are unaffected —
// there is no Watchman binary there, so Metro takes the fallback on its own.

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_USE_WATCHMAN === "0") {
  config.resolver.useWatchman = false;
}

module.exports = config;
