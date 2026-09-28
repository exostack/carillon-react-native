import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export function nativeVersions(gradle, podspec) {
  const kotlin = gradle.match(/\bsdkVersion:\s*"(\d+\.\d+\.\d+)"/)?.[1];
  const swift = podspec.match(/\bminimumVersion:\s*"(\d+\.\d+\.\d+)"/)?.[1];
  if (!kotlin || !swift)
    throw new Error(
      "Cannot read native SDK versions from the Gradle build and podspec.",
    );
  return { kotlin, swift };
}

export async function checkNativeReleases(
  { kotlin, swift },
  {
    request = fetch,
    listTags = (url, ref) =>
      promisify(execFile)(
        "git",
        ["ls-remote", "--exit-code", "--tags", url, ref],
        { timeout: 30_000 },
      ),
  } = {},
) {
  const ref = `refs/tags/${swift}`;
  let tags;
  try {
    tags = await listTags(
      "https://github.com/exostack/carillon-swift.git",
      ref,
    );
  } catch (cause) {
    throw new Error(
      `Swift SDK ${swift} is not available. Publish its tag before releasing React Native.`,
      { cause },
    );
  }
  if (!tags.stdout.split("\n").some((line) => line.split("\t")[1] === ref)) {
    throw new Error(
      `Swift SDK ${swift} tag is missing. Publish it before releasing React Native.`,
    );
  }
  // A successful publishing workflow is not enough: consumers need both artifacts on Central.
  for (const extension of ["pom", "aar"]) {
    const url = `https://repo.maven.apache.org/maven2/com/exostack/carillon/${kotlin}/carillon-${kotlin}.${extension}`;
    const response = await request(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(
        `Kotlin SDK ${kotlin} ${extension} is not available on Maven Central (HTTP ${response.status}). Publish it and wait for availability before releasing React Native.`,
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const versions = nativeVersions(
      await readFile(
        new URL("../android/build.gradle", import.meta.url),
        "utf8",
      ),
      await readFile(
        new URL("../CarillonReactNative.podspec", import.meta.url),
        "utf8",
      ),
    );
    await checkNativeReleases(versions);
    console.log(
      `Native dependencies are published: Swift ${versions.swift}, Kotlin ${versions.kotlin}.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
