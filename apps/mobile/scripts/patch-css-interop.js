/**
 * Patch react-native-css-interop to handle undefined bundler during EAS Build.
 * Ref: "Cannot read properties of undefined (reading 'transformFile')"
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Try finding the files using find command (works on macOS and Linux)
try {
  const result = execSync(
    'find node_modules -path "*/react-native-css-interop/dist/metro/index.js" 2>/dev/null || true',
    { encoding: "utf8", cwd: path.resolve(__dirname, "..") }
  );
  const files = result.trim().split("\n").filter(Boolean);

  // Also search in monorepo root if applicable
  const monorepoRoot = path.resolve(__dirname, "..", "..", "..");
  const result2 = execSync(
    'find node_modules -path "*/react-native-css-interop/dist/metro/index.js" 2>/dev/null || true',
    { encoding: "utf8", cwd: monorepoRoot }
  );
  files.push(...result2.trim().split("\n").filter(Boolean));

  const OLD = "if (bundler.transformFile.__css_interop__patched)";
  const NEW = "if (!bundler || bundler.transformFile.__css_interop__patched)";

  const unique = [...new Set(files)];
  if (unique.length === 0) {
    console.log("[patch-css-interop] No react-native-css-interop files found");
    process.exit(0);
  }

  for (const file of unique) {
    const absPath = file.startsWith("/") ? file : path.resolve(monorepoRoot, file);
    try {
      let content = fs.readFileSync(absPath, "utf8");
      if (content.includes("!bundler ||")) {
        console.log("[patch-css-interop] Already patched:", absPath);
        continue;
      }
      if (content.includes(OLD)) {
        content = content.replace(new RegExp(OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), NEW);
        fs.writeFileSync(absPath, content, "utf8");
        console.log("[patch-css-interop] PATCHED:", absPath);
      }
    } catch (e) {
      console.warn("[patch-css-interop] Failed:", absPath, e.message);
    }
  }
} catch (e) {
  console.warn("[patch-css-interop] Script error:", e.message);
}
