/**
 * Patch react-native-css-interop AND @expo/cli to handle undefined bundler
 * during EAS Build. Fixes "Cannot read properties of undefined (reading
 * 'transformFile')" error during Xcode "Run fastlane" phase.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const patches = [
  {
    // react-native-css-interop: ensureBundlerPatched accesses bundler.transformFile
    pattern: "*/react-native-css-interop/dist/metro/index.js",
    find: "if (bundler.transformFile.__css_interop__patched)",
    replace: "if (!bundler || bundler.transformFile.__css_interop__patched)",
  },
  {
    // @expo/cli metroVirtualModules: patches bundler.transformFile without null check
    pattern: "*/@expo/cli/build/src/start/server/metro/metroVirtualModules.js",
    find: "if (!bundler.transformFile.__patched)",
    replace: "if (bundler && bundler.transformFile && !bundler.transformFile.__patched)",
  },
];

const searchRoots = [
  path.resolve(__dirname, "..", "node_modules"),
  path.resolve(__dirname, "..", "..", "..", "node_modules"), // monorepo root
];

for (const root of searchRoots) {
  for (const { pattern, find, replace } of patches) {
    try {
      const result = execSync(
        `find "${root}" -path "${pattern}" 2>/dev/null || true`,
        { encoding: "utf8" }
      );
      const files = result.trim().split("\n").filter(Boolean);
      for (const file of files) {
        try {
          let content = fs.readFileSync(file, "utf8");
          if (content.includes(replace)) {
            console.log("[patch] Already patched:", path.basename(file));
            continue;
          }
          if (content.includes(find)) {
            const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(escaped, "g"), replace);
            fs.writeFileSync(file, content, "utf8");
            console.log("[patch] PATCHED:", file);
          }
        } catch (e) {
          console.warn("[patch] Failed:", file, e.message);
        }
      }
    } catch {
      // find command failed, skip
    }
  }
}
