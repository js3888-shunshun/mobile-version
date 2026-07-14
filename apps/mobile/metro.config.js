const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// better-auth compatibility — its package exports resolve to .mjs files
config.resolver.sourceExts = [...config.resolver.sourceExts, "mjs", "cjs"];

// pnpm workspace compatibility
config.watchFolders = [
  path.resolve(monorepoRoot, "packages"),
  path.resolve(monorepoRoot, "node_modules/.pnpm"),
];

config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Singleton pinning — prevents "Invalid hook call" errors
const singletons = ["react", "react-native", "expo", "expo-router"];
config.resolver.extraNodeModules = singletons.reduce((acc, name) => {
  acc[name] = path.resolve(projectRoot, "node_modules", name);
  return acc;
}, {});

module.exports = withNativeWind(config, { input: "./app/globals.css" });
