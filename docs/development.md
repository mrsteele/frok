# Contribute to Frok

Frok is an Electron desktop app around a Next.js interface, a local API and a separate queue worker. Browser development uses the same interface, so normal UI work does not require rebuilding an installer.

## Run the app

Use Node.js 24 or newer. From the repository root:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. For Electron with hot reload, install its documentation build tools once with `npm --prefix docs ci`, then use `npm run dev:desktop`. Restart after worker or native-process changes; page reloads only refresh the UI.

## Configuration

Use Settings for service addresses, model folders, pipelines, live image previews, job timeout and managed Ollama startup. Legacy environment preferences migrate once per library; editing `.env.local` afterwards does not change saved Settings.

An environment file is optional. `.env.example` lists development overrides for workspace, ports and executable paths. Browser development can supply `HF_TOKEN` and `COMFYUI_API_KEY` in `.env.local`; Electron provides encrypted token controls in Settings. Internal `FROK_*` variables still connect the desktop launcher, backend and worker. Keep those internal startup variables out of user setup instructions.

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

## Bundled video tools

Desktop installers already include FFmpeg and FFprobe. Source development builds them once with `npm run build:media`; `npm run dev`, `npm run dev:desktop` and desktop packaging also prepare them automatically and reuse a verified cache. Internet access is needed for the first source download, not for subsequent launches.

Build prerequisites: Xcode Command Line Tools on macOS; a C compiler, make, bash and tar on Linux; MSYS2 with MinGW64 GCC, make, tar and diffutils on Windows (run the first build in a MinGW64 shell). NASM is recommended on x64; builds fall back to C implementations when it is absent. These are developer prerequisites only. Frok never installs them on the user's system.

The build uses pinned SHA-256 source archives for FFmpeg, x264, zlib and the pkgconf build tool. It disables automatic detection of optional libraries, network protocols and nonfree components. Outputs stay in ignored `.media-tools/<platform>-<arch>/`; source downloads are cached under `.data/desktop-build-cache`. No system installation is modified. `FROK_MEDIA_BUILD_JOBS` optionally controls parallel compilation (default 4).

Source archives, the recipe and component licenses accompany the binaries in every installer. To update a dependency, review and update `scripts/media-sources.json`, rebuild, run synthetic media checks, and verify every release platform. Do not replace these binaries with an arbitrary prebuilt download. Runtime folder overrides and `FFMPEG_BIN`/`FFPROBE_BIN` remain available for advanced use.

## Build boundaries

`npm run build` builds the web application. `npm run build:desktop` builds its standalone desktop payload; `npm run package` creates local installers without publishing. See [Desktop](./desktop.md) for runtime and signing details.

Documentation has its own package and lockfile. Inside `docs`, run `npm ci`, then `npm run dev` or `npm run build`. Updating docs does not require compiling Frok. [Documentation hosting →](./hosting.md)

Run `npm run check:source` before committing. It uses Git's ignore rules to inspect the candidate source tree, including already-tracked files that would otherwise be ignored, without reading ignored library content.

## Adding another generation service

Keep runner-specific API calls, workflow binding and cancellation inside a runner adapter. The worker should own the queue, prompt preparation, progress, output validation and publication into the library. Pipeline snapshots preserve what a queued job will run even if the source workflow is edited later.

Vpipe and ComfyUI currently share the `RenderInput` contract exported from `src/lib/vpipe.ts`. When adding a third runner, move that contract into a neutral module and replace the worker's two-way dispatch with a small registry. Add connection checks, pipeline capability checks and synthetic adapter tests together. Keep credentials on the server and preserve the existing request, path and process protections. Imported pipelines and their preparation steps are trusted local code, not sandboxed plugins.

## Before proposing a change

Describe the user-visible behavior and relevant validation. Keep generated media, model weights, databases, local environment files, credentials and build output out of source control. Preserve shared group favorites, queued workflow snapshots and local API checks when changing those paths. See [release versions](./releasing.md) for the separate, explicit publishing process.
