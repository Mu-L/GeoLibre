# F-Droid

[F-Droid](https://f-droid.org/) is the main catalog of free and open-source
Android apps. GeoLibre is MIT-licensed and already ships signed Android APKs on
every GitHub release, so the distribution side is mostly in place. What was
missing is the store metadata, which now lives in this repository under
`fastlane/metadata/android/`.

This page covers what is in the repo, the two routes into the F-Droid ecosystem,
and the one thing that decides which route is realistic.

See [Android](android.md) for the build itself.

## Two routes, and why the choice matters

**f-droid.org (the main repository).** F-Droid does not accept your APK. Their
buildserver compiles the app from source on their own infrastructure and signs
it with their key, which is the whole point of the trust model. Every binary in
the finished APK has to be produced from source during that build.

**IzzyOnDroid.** A well-known third-party repository that is F-Droid-compatible:
users add it inside the F-Droid client and it then behaves like any other
source. IzzyOnDroid does *not* rebuild the app. It picks up the
developer-signed APK from the GitHub release, scans it for trackers and
proprietary blobs, and publishes it. Many projects that cannot be built on the
F-Droid buildserver are distributed this way, and a fair number use it as the
staging step before applying to the main repository.

The deciding factor for GeoLibre is that the web bundle pulls **prebuilt
WebAssembly binaries** from npm:

| Package | What it is |
| --- | --- |
| `@duckdb/duckdb-wasm` | DuckDB compiled to WASM (the Add Data / SQL Workspace engine) |
| `geolibre-wasm` | the Rust geoprocessing tools compiled to WASM |
| `whitebox-wasm` | the WhiteboxTools suite compiled to WASM |
| Pyodide | CPython plus scientific packages compiled to WASM |

These are binaries as far as F-Droid's inclusion policy is concerned, and
rebuilding them from source inside the F-Droid buildserver (each needs its own
Emscripten or Rust toolchain, and Pyodide is a multi-hour build on its own) is
not something to promise lightly. Until that is solved, **IzzyOnDroid is the
realistic route** and the main repository is a longer-term goal.

## What is in this repository

```text
fastlane/metadata/android/en-US/
├── title.txt                       # app name, ≤ 50 characters
├── short_description.txt           # one line, ≤ 80 characters
├── full_description.txt            # listing body, ≤ 4000 characters
├── changelogs/
│   └── 2003000.txt                 # keyed by versionCode, ≤ 500 characters
└── images/
    ├── icon.png                    # 512×512
    └── phoneScreenshots/
        ├── 01_map.png
        ├── 02_layers.png
        ├── 03_attribute_table.png
        └── 04_globe.png
```

Both F-Droid and IzzyOnDroid read this layout directly from the repository, so
the listing is versioned alongside the code instead of living in a web console.

### The versionCode trap

Changelogs are keyed by **versionCode**, not by version name. Tauri derives the
Android versionCode from `apps/geolibre-desktop/src-tauri/tauri.conf.json`:

```text
versionCode = major * 1000000 + minor * 1000 + patch
```

So `2.3.0` builds as `2003000` (confirmed against the manifest of the shipped
v2.3.0 APK). Bump the version without adding the matching changelog file and
the release ships with no release notes at all, silently — nothing in the
Android build fails.

`scripts/check-fdroid-metadata.mjs` guards exactly that, plus the length limits.
It runs in CI as the **Validate F-Droid metadata** job and locally as part of
`npm run ci`:

```bash
npm run check:fdroid
```

### Refreshing the screenshots

The current screenshots were captured from the web build at a 412×915 phone
viewport, which is the same responsive layout the Android webview renders. They
are honest but not device captures; replace them from an emulator or a real
phone when convenient:

```bash
adb exec-out screencap -p > fastlane/metadata/android/en-US/images/phoneScreenshots/01_map.png
```

If you re-capture on a device, avoid screenshots of Processing → Whitebox,
Raster, Conversion, or AI Segmentation. Those toolboxes are hidden on Android by
the `isMobile()` gate (they need the Python sidecar), so a browser screenshot
showing them would misrepresent the app.

## Submitting to IzzyOnDroid

Prerequisites, all of which hold today:

- [x] MIT license, source in a public repository
- [x] Signed release APKs attached to each GitHub release
      (`geolibre-android-*.apk`, produced by `.github/workflows/android.yml`)
- [x] `fastlane/metadata/android/en-US/` in the repository
- [x] No advertising or analytics SDKs to trip the tracker scan

Open a **request packaging** issue on their tracker
(<https://gitlab.com/IzzyOnDroid/repo>) with the repository URL and the
applicationId `org.geolibre.app`.

One thing to settle with them: the release carries **four per-ABI APKs**
(`arm`, `arm64`, `x86`, `x86_64`) rather than a single universal one, because a
universal APK is roughly 150 MB against ~40 MB per ABI. Confirm whether their
tooling should take the per-ABI set or whether a universal APK should be added
to the release. If it needs one, `npx tauri android build --apk` without
`--split-per-abi` produces it, and the workflow can attach it alongside the
others.

Expect to be asked about **anti-features**. The likely one is `NonFreeNet`:
GeoLibre fetches basemap tiles and remote datasets from third-party services,
and the optional AI assistant talks to a model provider the user configures.
None of it is required to open and analyze local files, and free sources such as
OpenFreeMap are available, so the label is arguable rather than automatic. The
listing text in `full_description.txt` already describes the network use
plainly, which is the part reviewers care about.

## The main F-Droid repository

Only worth attempting once the prebuilt-WASM question above has an answer. When
it does, the shape of the submission is:

1. A build recipe at `metadata/org.geolibre.app.yml` in
   [fdroiddata](https://gitlab.com/fdroid/fdroiddata), submitted as a merge
   request. It points at this repository, pins a release tag, and lists the
   build steps (Node install, `npm ci`, the web build, then the Gradle/Rust
   Android build).
2. `sudo` steps to install Node 22 and the Rust Android targets on the
   buildserver, since neither is present by default.
3. The descriptions and screenshots are read from the `fastlane/` tree here, so
   nothing has to be duplicated into the recipe.
4. `AllowedAPKSigningKeys` is *not* used: F-Droid signs its own build, which
   means the F-Droid copy and the GitHub-release copy are not upgrade-compatible
   with each other. Users switching between them have to uninstall first.

The realistic blockers to resolve first, in order:

- **Prebuilt WASM.** Either build DuckDB-WASM, `geolibre-wasm`, `whitebox-wasm`,
  and Pyodide from source in the recipe, or ship an Android build that omits the
  features depending on them. Neither is small.
- **Build resources.** The full web build plus a four-ABI Rust cross-compile is
  heavy for the F-Droid buildserver's limits.
- **npm dependency footprint.** The tree is large and reviewers scan it for
  binaries; expect questions about anything under `node_modules` that is not
  plain source.

## Related

- [Android](android.md) — toolchain, build, signing, CI, Google Play
- [Downloads](downloads.md) — where the releases live
- [Privacy policy](privacy.md) — referenced by the store listings
