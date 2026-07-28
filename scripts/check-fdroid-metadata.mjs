#!/usr/bin/env node
// Validate the F-Droid / IzzyOnDroid store metadata under
// `fastlane/metadata/android/`.
//
// The listing text and the per-release changelog live in the repository rather
// than in a store console, so nothing outside CI notices when they go stale.
// The one that actually breaks is the changelog: F-Droid picks it up by
// *versionCode*, so bumping the app version silently orphans the previous
// changelog and the new release ships with none. This check ties the two
// together and enforces the store length limits while it is there.
//
// Run with `npm run check:fdroid`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataRoot = join(repoRoot, "fastlane", "metadata", "android");
const tauriConfigPath = join(repoRoot, "apps", "geolibre-desktop", "src-tauri", "tauri.conf.json");

// Store limits. `title` and `short_description` are F-Droid's; the 500-character
// changelog limit is what F-Droid truncates a changelog entry at.
const LIMITS = {
  "full_description.txt": 4000,
  "short_description.txt": 80,
  "title.txt": 50,
};
const CHANGELOG_LIMIT = 500;

const errors = [];

/**
 * Tauri's default Android versionCode for a semver `x.y.z`, as produced by the
 * Tauri v2 CLI: major * 1000000 + minor * 1000 + patch. Verified against the
 * shipped v2.3.0 APK, whose manifest carries versionCode 2003000.
 */
function versionCodeFor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    errors.push(`Could not parse a semver version out of "${version}".`);
    return null;
  }
  const [, major, minor, patch] = match.map(Number);
  return major * 1000000 + minor * 1000 + patch;
}

function readTextFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const version = tauriConfig.version;
const versionCode = versionCodeFor(version);

const locales = readdirSync(metadataRoot).filter((entry) =>
  statSync(join(metadataRoot, entry)).isDirectory(),
);
if (locales.length === 0) {
  errors.push(`No locale directories under ${metadataRoot}.`);
}

for (const locale of locales) {
  const localeDir = join(metadataRoot, locale);

  for (const [name, limit] of Object.entries(LIMITS)) {
    const contents = readTextFile(join(localeDir, name));
    if (contents === null) {
      errors.push(`${locale}/${name} is missing.`);
      continue;
    }
    const trimmed = contents.trim();
    if (trimmed.length === 0) {
      errors.push(`${locale}/${name} is empty.`);
    } else if (trimmed.length > limit) {
      errors.push(`${locale}/${name} is ${trimmed.length} characters; the limit is ${limit}.`);
    }
    // A short description that wraps renders with a stray newline in the app
    // listing, so keep it to a single line.
    if (name === "short_description.txt" && trimmed.includes("\n")) {
      errors.push(`${locale}/${name} must be a single line.`);
    }
  }

  if (versionCode === null) continue;

  const changelogPath = join(localeDir, "changelogs", `${versionCode}.txt`);
  const changelog = readTextFile(changelogPath);
  if (changelog === null) {
    errors.push(
      `${locale}/changelogs/${versionCode}.txt is missing. tauri.conf.json is at ` +
        `version ${version}, which Tauri builds as versionCode ${versionCode}; ` +
        `add the changelog for this release.`,
    );
  } else if (changelog.trim().length === 0) {
    errors.push(`${locale}/changelogs/${versionCode}.txt is empty.`);
  } else if (changelog.trim().length > CHANGELOG_LIMIT) {
    errors.push(
      `${locale}/changelogs/${versionCode}.txt is ${changelog.trim().length} ` +
        `characters; F-Droid truncates at ${CHANGELOG_LIMIT}.`,
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`::error file=fastlane/metadata/android::${error}`);
  }
  console.error(`\n${errors.length} F-Droid metadata problem(s). See docs/fdroid.md.`);
  process.exit(1);
}

console.log(
  `F-Droid metadata OK for version ${version} (versionCode ${versionCode}), ` +
    `locales: ${locales.join(", ")}.`,
);
