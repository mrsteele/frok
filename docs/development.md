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

Use focused tests for the area you changed. The full `npm test` suite includes synthetic runner and FFmpeg integration work, so install external FFmpeg/FFprobe first (with libx264 and AAC support). The suite uses PATH detection or explicit `FFMPEG_BIN` and `FFPROBE_BIN` paths; it does not use your saved library preferences. CI installs its test tools separately. These tests do not prove real-model output quality. UI-only edits do not need model inference or downloads. Test against disposable storage and synthetic assets, not a contributor's private library.

## Build boundaries

`npm run build` builds the web application. `npm run build:desktop` builds its standalone desktop payload; `npm run package` creates local installers without publishing. See [Desktop](./desktop.md) for runtime and signing details.

Documentation has its own package and lockfile. Inside `docs`, run `npm ci`, then `npm run dev` or `npm run build`. Updating docs does not require compiling Frok. [Documentation hosting →](./hosting.md)

Run `npm run check:source` before committing. It uses Git's ignore rules to inspect the candidate source tree, including already-tracked files that would otherwise be ignored, without reading ignored library content.

## Adding another generation service

Keep runner-specific API calls, workflow binding and cancellation inside a runner adapter. The worker should own the queue, prompt preparation, progress, output validation and publication into the library. Pipeline snapshots preserve what a queued job will run even if the source workflow is edited later.

Vpipe and ComfyUI currently share the `RenderInput` contract exported from `src/lib/vpipe.ts`. When adding a third runner, move that contract into a neutral module and replace the worker's two-way dispatch with a small registry. Add connection checks, pipeline capability checks and synthetic adapter tests together. Keep credentials on the server and preserve the existing request, path and process protections. Imported pipelines and their preparation steps are trusted local code, not sandboxed plugins.

## Before proposing a change

Describe the user-visible behavior and relevant validation. Keep generated media, model weights, databases, local environment files, credentials and build output out of source control. Preserve shared group favorites, queued workflow snapshots and local API checks when changing those paths. See [release versions](./releasing.md) for the separate, explicit publishing process.
