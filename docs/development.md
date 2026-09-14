# Contribute to Frok

Frok is an Electron desktop app around a Next.js interface, a local API and a separate queue worker. Browser development uses the same interface, so normal UI work does not require rebuilding an installer.

## Run the app

Use the Node.js version pinned in `.node-version`. From the repository root:

```sh
npm ci
npm --prefix docs ci
npm run dev
```

Open `http://127.0.0.1:3000`. For Electron with hot reload, install its documentation build tools once with `npm --prefix docs ci`, then use `npm run dev:desktop`. Restart after worker or native-process changes; page reloads only refresh the UI.

Both modes use the installed app's `~/frok` workspace by default, including its media, jobs and settings. Stop the current app before switching modes. Use `FROK_HOME="$HOME/frok/development" npm run dev` for an isolated development workspace. Builds use disposable storage and do not open the live library; compiler output and dependency caches remain in the checkout.

## Configuration

No environment file is required. Use Settings for service addresses, model folders, pipelines, live image previews, job timeout and retention. In Electron, save credentials under **Settings → Advanced → API tokens**.

Environment variables remain in use for desktop process startup, build tooling and development overrides such as ports and executable paths. Browser development can supply `HF_TOKEN` and `COMFYUI_API_KEY` through the launch environment when needed. Existing environment files remain supported; legacy preferences migrate once per library, and later file edits do not override saved Settings. See [Desktop configuration](./desktop.md#workspace-and-first-launch) for migration and workspace details. Keep local environment files out of source control.

## Source map

| Directory | Responsibility |
| --- | --- |
| `src/app` | Next route entry points, API dispatch and styles |
| `src/components` | Shared studio, settings, gallery and viewer UI |
| `src/lib` | Storage, prompt assembly, runner adapters and pipeline catalog |
| `src/worker` | Persistent serial job worker |
| `desktop` | Electron, process supervision and packaging policy |
| `resources/pipelines` | Factory workflow bundles |
| `scripts` | Development, setup and packaging commands |
| `tests` | Isolated fixtures and focused checks |
| `docs` | This independently built VitePress site |

Read `AGENTS.md` and the bundled Next.js guides before changing framework behavior. Pipeline metadata lives beside each native workflow. Changing a factory file must not overwrite a user's edited working copy.

## Verify the relevant behavior

```sh
npm run typecheck
node --import tsx --test tests/asset-navigation.test.ts tests/media-family.test.ts
```

Use focused tests for the area you changed. Before the full `npm test` suite, run `npm run build:media` once to prepare the bundled FFmpeg/FFprobe tools. Tests use synthetic media and disposable storage, not your saved library preferences. They do not prove real-model output quality. UI-only edits do not need model inference or downloads.

## Component library

Components are grouped by feature, with shared controls under `ui/primitives` and reusable arrangements under `ui/patterns`. Settings, onboarding and shared dialogs use these foundations first. Reuse existing controls before adding styling; keep service and job logic in feature components. See `src/components/README.md` for ownership, examples and style conventions.

Run `npm run dev:ui` to inspect the standalone component gallery at `http://127.0.0.1:4178`. Its Settings and onboarding screens use synthetic data and cannot reach the app or model runners. `npm run smoke:ui` checks responsive layouts and keyboard interaction in a disposable Electron profile.

## Bundled video tools

Desktop installers already include FFmpeg and FFprobe. Source development builds them once with `npm run build:media`; `npm run dev`, `npm run dev:desktop` and desktop packaging also prepare them automatically and reuse a verified cache. Internet access is needed for the first source download, not for subsequent launches.

Build prerequisites: Xcode Command Line Tools on macOS; a C compiler, make, bash and tar on Linux; MSYS2 with MinGW64 GCC, make, tar and diffutils on Windows (run the first build in a MinGW64 shell). NASM is recommended on x64; builds fall back to C implementations when it is absent. These are developer prerequisites only. Frok never installs them on the user's system.

The build uses pinned SHA-256 source archives for FFmpeg, x264, zlib and the pkgconf build tool. It disables automatic detection of optional libraries, network protocols and nonfree components. Outputs stay in ignored `.media-tools/<platform>-<arch>/`; source downloads are cached under `.data/desktop-build-cache`. No system installation is modified. `FROK_MEDIA_BUILD_JOBS` optionally controls parallel compilation (default 4).

Source archives, the recipe and component licenses accompany the binaries in every installer. To update a dependency, review and update `scripts/media-sources.json`, rebuild, run synthetic media checks, and verify every release platform. Do not replace these binaries with an arbitrary prebuilt download. Runtime folder overrides and `FFMPEG_BIN`/`FFPROBE_BIN` remain available for advanced use.

## Build boundaries

`npm run build` builds the web application. `npm run build:desktop` builds its standalone desktop payload; `npm run package` creates local installers without publishing. See [Desktop](./desktop.md) for runtime and signing details.

Documentation has its own package and lockfile. Inside `docs`, run `npm ci`, then `npm run dev` or `npm run build`. Updating docs does not require compiling Frok. [Documentation hosting →](./hosting.md)

Run `npm run check:source` before committing. It uses Git's ignore rules to inspect the candidate source tree, including already-tracked files that would otherwise be ignored, without reading ignored library content.

## Shared sources

Keep frequently changing facts at their owning source. Link to that source from Markdown, or import its value where the interface or built docs need to display it.

| Detail | Source | Consumers |
| --- | --- | --- |
| Application version, package license and author | Root `package.json` | Packaging, About/version information and exports; npm maintains the lockfile |
| Tested and bundled Node release | `.node-version` | CI and portable desktop runtime |
| Supported Node range | `package.json` → `engines.node` | Development guard and worker compilation target |
| Repository, support and public website links | `desktop/product.mjs` | App, desktop shell and documentation navigation |
| Runtime and retention defaults | `desktop/preferences.mjs` | Launchers, backend and relevant docs pages |
| License text and attribution | Root `LICENSE` and `COPYRIGHT` | Included directly in the documentation license page |
| Bundled video-tool versions and checksums | `scripts/media-sources.json` | Media build, verification and generated distribution notices |
| Downloadable workflow examples | `resources/pipelines` | Refreshed automatically when the documentation starts or builds |

The private docs package has its own dependency lockfile, but no application version or duplicate author/license metadata. Keep release numbers out of narrative guides. Dependency pins, schema versions, migration markers and synthetic test versions serve different purposes and remain explicit.

### Brand assets

Edit `public/brand/mark.svg`, then run `npm run build:brand` to regenerate the favicon and documentation marks. App and docs builds do this automatically; desktop packaging also generates the app and tray icons. Edit theme colors in the application and documentation styles when changing the palette.

## Adding another generation service

Keep runner-specific API calls, workflow binding and cancellation inside a runner adapter. The worker should own the queue, prompt preparation, progress, output validation and publication into the library. Pipeline snapshots preserve what a queued job will run even if the source workflow is edited later.

Vpipe and ComfyUI currently share the `RenderInput` contract exported from `src/lib/vpipe.ts`. When adding a third runner, move that contract into a neutral module and replace the worker's two-way dispatch with a small registry. Add connection checks, pipeline capability checks and synthetic adapter tests together. Keep credentials on the server and preserve the existing request, path and process protections. Imported pipelines and their preparation steps are trusted local code, not sandboxed plugins.

## Before proposing a change

Describe the user-visible behavior and relevant validation. Keep generated media, model weights, databases, local environment files, credentials and build output out of source control. Preserve shared group favorites, queued workflow snapshots and local API checks when changing those paths. See [release versions](./releasing.md) for the separate, explicit publishing process.
