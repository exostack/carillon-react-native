import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const {
  resolvePluginForModule,
} = require("@expo/config-plugins/build/utils/plugin-resolver.js");
const root = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(new URL("../app.plugin.js", import.meta.url));

test("exports the Expo plugin entry point", () => {
  assert.equal(
    require.resolve("@exostack/carillon-react-native/app.plugin.js"),
    entry,
  );
  assert.equal(
    typeof require("@exostack/carillon-react-native/app.plugin.js"),
    "function",
  );
});

test("Expo resolves the plugin by package name", () => {
  const resolved = resolvePluginForModule(
    root,
    "@exostack/carillon-react-native",
  );
  assert.equal(resolved.filePath, entry);
  assert.equal(resolved.isPluginFile, true);
});
