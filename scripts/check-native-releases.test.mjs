import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkNativeReleases,
  nativeVersions,
} from "./check-native-releases.mjs";

const versions = { kotlin: "0.4.0", swift: "0.4.0" };
const listTags = async () => ({ stdout: "abcdef\trefs/tags/0.4.0\n" });

test("reads each version from its consumer declaration", () => {
  assert.deepEqual(
    nativeVersions('sdkVersion: "0.4.0"', 'minimumVersion: "0.5.0"'),
    { kotlin: "0.4.0", swift: "0.5.0" },
  );
  assert.throws(() => nativeVersions("", ""), /Cannot read/);
});

test("requires both Maven artifacts and the Swift tag", async () => {
  const urls = [];
  await checkNativeReleases(versions, {
    listTags,
    request: async (url) => {
      urls.push(url);
      return { ok: true };
    },
  });
  assert.deepEqual(
    urls.map((url) => url.split(".").at(-1)),
    ["pom", "aar"],
  );
});

for (const missing of ["pom", "aar"]) {
  test(`blocks publication when the Maven ${missing} is missing`, async () => {
    await assert.rejects(
      checkNativeReleases(versions, {
        listTags,
        request: async (url) => ({ ok: !url.endsWith(missing), status: 404 }),
      }),
      /not available on Maven Central/,
    );
  });
}

test("blocks publication when the Swift tag is missing", async () => {
  await assert.rejects(
    checkNativeReleases(versions, { listTags: async () => ({ stdout: "" }) }),
    /tag is missing/,
  );
});

test("fails closed on network errors", async () => {
  await assert.rejects(
    checkNativeReleases(versions, {
      listTags: async () => {
        throw new Error("network");
      },
    }),
    /Swift SDK/,
  );
  await assert.rejects(
    checkNativeReleases(versions, {
      listTags,
      request: async () => {
        throw new Error("network");
      },
    }),
    /network/,
  );
});
