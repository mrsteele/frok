# Frok

**A local creative studio for images and short videos.**

Turn a prompt into a batch of images, animate a frame you like, and keep every take together. Frok brings Vpipe, ComfyUI and Ollama into a small, focused interface with a persistent queue and a library that lives on your machine.

**Version 0.1.0 · Early development · GPL-3.0-only**

[Quick setup](docs/guide/getting-started.md) · [First-creation tutorial](docs/tutorials/first-creation.md) · [Pipeline guide](docs/pipelines.md) · [Troubleshooting](docs/guide/troubleshooting.md)

## What you can do

| Capability | How it works |
| --- | --- |
| Text-to-image | Generate batches with distinct seeds; request another batch with Load more. |
| Live image previews | Watch compatible Vpipe workflows as they denoise; other tiles remain queued. |
| Text-to-video | Describe a scene and generate a short video. |
| Image-to-video | Animate an uploaded or generated image, preserving its proportions. |
| Reference-to-video | Supply multiple references to a compatible reference pipeline. |
| Prompt enhancement | Optionally use an installed Ollama text model to add detail while preserving the original brief. |
| Motion recipes | Save reusable directions and apply them to different images in one click. |
| AI video enhancement | Enhance a finished 480p take to 720p with SeedVR2 or Real-ESRGAN. |
| Grouped library | One card and one heart per creation, with all its video takes and SD/HD versions. |
| Persistent queue | Inspect progress, elapsed time and logs; cancel, delete job details or retry work. |

No Frok login, subscription or generation credits. Inference runs through your configured local tools. Model downloads require provider access; generation speed and capacity depend on your hardware. Work runs **one job at a time**, including images within a batch.

## System requirements

Frok is a desktop interface and queue for **other local AI services**. It does not contain an image/video model or run inference by itself. Install at least one generation runner and its compatible models before generating.

| Requirement | What to install |
| --- | --- |
| Image/video generation — choose one or both | [Vpipe](https://vpipe.ai/) on a supported Apple Silicon Mac, or [ComfyUI](https://www.comfy.org/download) on a device it supports. |
| Video processing | FFmpeg and FFprobe are included in Frok. No separate installation needed. |
| Prompt enhancement — optional | [Ollama](https://ollama.com/download), running locally with an installed text-generation model. |
| Hardware and storage | Enough memory and free disk space for your chosen runner and models. Requirements vary significantly; check the upstream instructions before downloading model packs. |
| Running from source — developers | Node.js **24 or newer**, npm, and a C build toolchain for the first media-tools build. See [development setup](docs/development.md#bundled-video-tools). Desktop users need none of these. |

Frok does **not host or redistribute Vpipe, ComfyUI, Ollama, or model weights**. Connections point to your installations; preparation workflows can download dependencies directly from their providers. Each service and model has its own license and requirements. You can use different runners for images and video. Ollama alone enables prompt enhancement, not media generation.

Frok bundles its interface, workflow definitions, documentation, application runtime, and FFmpeg/FFprobe for video finishing. Once services and models are ready, local generation does not require a Frok account or a network connection.

## Get running

Until public installers are available, run the source build. Install **Node.js 24 or newer**, open a terminal in this repository, then:

```sh
npm ci
npm --prefix docs ci
npm run dev
```

Open **http://127.0.0.1:3000**. To use the Electron window with the same live development interface:

```sh
npm run dev:desktop
```

UI changes refresh without rebuilding an installer. Native-process or worker changes require restarting the corresponding development command.

For a built web app:

```sh
npm run build
npm start
```

Closing a browser tab does not stop the queue while its server keeps running. In the desktop app, closing the window leaves Frok in the tray/menu bar; explicit Quit is separate. Keep the machine awake while rendering. [Desktop behavior and packaging](docs/desktop.md)

## First-time setup

A new library starts with connections off and pipelines unselected. Frok installs default **workflow definitions**, not every model, on first launch.

1. **Connect a runner in Settings → Generate.** Choose Vpipe, ComfyUI, or both. Empty fields use their displayed defaults. Point to an existing installation when you have one.
2. **Accept the setup offer or choose your pipelines.** A successful connection can select starter workflows and queue preparation. Skip keeps the connection without changing existing choices. Select defaults manually in Settings → Pipelines at any time.
3. **Wait for readiness.** Missing models, encoders, VAEs and adapters appear on the selected pipeline. Open its preparation job to follow downloads and logs. Already installed files are checked and reused.
4. **Optionally connect Ollama.** Choose an installed text-generation model in its connection card. Enable enhancement by default, or turn it on in generation settings.
5. **Make a small first batch.** On Envision, choose Image, an aspect ratio and four images. Enter a prompt and generate.

Each capability becomes ready independently. You can start with images and add video, references or enhancement later. Warnings link to the missing setup item.

### Connection defaults

| Tool | Empty input uses | Purpose |
| --- | --- | --- |
| Vpipe | `~/vpipe` | Model workspace containing `models/` |
| ComfyUI | `http://127.0.0.1:8000` | Running local API service |
| ComfyUI folder | `Documents/ComfyUI` on macOS/Windows; `~/ComfyUI` on Linux | Base folder containing models, input and output |
| Ollama | `http://127.0.0.1:11434` | Existing local text-model service |

Manual ComfyUI installations may use port 8188; enter the address your service actually uses. Changing a connection checks it and refreshes readiness without moving model files. Finish or cancel queued work before changing runner locations.

Ollama's selector lists compatible **installed** text models. Default only works when the configured default model is installed; None disables enhancement. Frok normally does not start another Ollama instance or copy its models.

[Detailed connection guide](docs/guide/connections.md)

### Hardware and models

The native Vpipe profile targets Apple Silicon Macs with a compatible macOS/Vpipe installation. ComfyUI and optional upscalers have their own device, driver and node requirements. The initial desktop target is Apple Silicon macOS; Windows/Linux and Intel packaging configurations need platform validation before public distribution.

A machine that runs the interface may not fit every generation model. Video and reference packs can require substantial memory, disk space and preparation time. On a smaller machine, start with an image pipeline and short 480p clips. A Ready file check does not guarantee inference will fit in memory.

Gated model downloads may require accepting the provider's license and supplying a token. Save Hugging Face and ComfyUI tokens in **Settings → Generate → API tokens** in Frok Desktop, then quit and reopen the app. Tokens use the operating system's encrypted storage and stay outside library backups. Normal setup needs no environment file. Never put credentials into shared pipeline files.

## A simple creative workflow

**Envision** is your permanent creative workspace. New prompt sections appear at the top. **Load more** appends another batch to the bottom of its section using its saved settings and fresh seeds. Collapse sections or use **Jump to prompt** to navigate; **Show older prompts** reveals earlier work. Refreshing keeps your creations, and **New idea** clears only the composer.

Open a result to **Save**, **Download**, inspect **Generation details**, or describe motion. Empty Custom and the image's quick video button use your **default recipe**; selecting any recipe immediately queues its direction and ignores the editor's draft. New libraries include editable **Normal**, **Silly** and **Dance** recipes, with Normal selected as the default. Dance picks movement that fits the mood and atmosphere of the image. Edit recipes or choose **Make default** in Settings → Recipes.

Video settings include pipeline, duration, resolution, seed and enhancement. Default clips target 480p; 6, 8 and 10 seconds are available where supported. The prompt begins with the actual image-generation prompt, then your motion direction. Optional enhancement enriches that direction while preserving the source brief.

Image-based video takes always use the original root image. Text-to-video and reference-to-video use the generated video as their root, without extracting a placeholder image. Text videos offer Redo; reference videos also allow prompt edits while keeping their saved, downloadable references.

Envision and **Favorites** show one card per root. **Favorites** saves the entire group. Hover videos play muted and return to the first frame when the pointer leaves. Open a creation to browse all takes and compare SD/HD with both players kept available.

### Stable creation links

```text
/asset/:rootId       Starting asset
/asset/:rootId/2     First video take
/asset/:rootId/3     Second video take
```

The viewer updates the address when you move between takes. Numbers remain stable: deleting take 3 never allows a later take to reuse 3. Enhanced copies share their original take's number. Existing image/video URLs resolve to these new paths. Links refer to this local library, not a public sharing service.

[Library, favorites and deletion](docs/guide/library.md) · [Video guide](docs/guide/videos.md)

## Pipelines are yours

Working pipelines live **outside the app**, at `~/frok/pipelines` by default:

```text
~/frok/pipelines/
  image/
    krea-2-turbo/
      run.vpipeline
      prepare.vpipeline
      meta.json
  video/
  reference/
  upscale/
```

Each workflow has its own folder. Vpipe uses `.vpipeline`; ComfyUI uses API-format `.json`. Metadata names the workflow, binds Frok's controls and describes dependencies. Preparation downloads or produces files needed by the run workflow. Known downloads can be declared in metadata without a separate preparation file.

The native workflow owns models, LoRAs, strengths and sampling. Settings → Pipelines chooses defaults; generation settings can override them. Only workflows with an enabled compatible runner are selectable. Jobs retain pipeline snapshots, so editing a workflow affects new submissions instead of changing work already queued.

The green folder panel in Settings shows the active location, detected workflows and preparation warnings. Leave the path blank for the default, or enter another existing directory. Refresh picks up edits. Reset default pipelines asks before replacing the default folder, including custom files inside it; it preserves models and other locations.

Startup installs factory files from `resources/pipelines`. Untouched bundled files can update; locally edited groups are preserved and new factory versions are staged in `~/frok/pipeline-updates`. Personal folders may use a `.local` suffix. External working files are outside repository tracking, and matching personal copies under `resources/pipelines` are ignored.

The included Krea workflow uses **original Krea 2 Turbo weights**. To bring your own graph, Utilities creates a ZIP containing run, prepare, metadata and review notes. Unknown requirements need manual review before use.

[Pipeline reference](docs/pipelines.md) · [Krea example](docs/examples/krea.md) · [ComfyUI example](docs/examples/comfyui.md) · [Custom workflow tutorial](docs/tutorials/custom-pipeline.md)

## Queue and AI enhancement

The sidebar queue stays visible across views. Open it for active/pending jobs, completed and cancelled entries, timing and diagnostic logs. Cancelled jobs stay available for review without being counted as failures. Deleting a finished job removes its record, logs and working files while keeping saved output.

Video progress combines **denoising** and **VAE decode**, reserving the last portion for decoding and saving. It does not reset from 100% to zero between phases. GPU telemetry, when available, shows device utilization rather than free VRAM. Elapsed time excludes waiting in the queue.

For HD, select and prepare **SeedVR2** or **Real-ESRGAN** in Pipelines, then choose Upscale on a finished SD video. Both use AI enhancement. SeedVR2 processes groups of frames with temporal context; Real-ESRGAN works frame by frame and has a lighter setup. Frok retains the original, preserves audio and duration, and offers SD/HD comparison and downloads. Results can introduce artifacts; compare your take before exporting.

[Queue guide](docs/guide/queue.md) · [SD/HD tutorial](docs/tutorials/upscaling.md)

## Storage, privacy and reset

One workspace is **one local studio**: the same library, favorites, queue and service settings across its windows. There are no accounts or browser transfer keys.

| Mode | Library and preferences | Default working pipelines |
| --- | --- | --- |
| Packaged desktop | `~/frok/data` and `~/frok/desktop-profile` | `~/frok/pipelines` |
| Desktop development | `.data/desktop-dev` in the repository | `~/frok/pipelines` |
| Web development | `.data` in the repository; local-origin UI preferences | `~/frok/pipelines` |

Desktop startup creates the user workspace. Models belong to the configured runner workspace or the relevant managed runtime. Back up the library and profile with Frok stopped; back up custom pipelines and model folders separately.

Deleting media also deletes its associated job records, logs and working files. Deleting a finished job keeps its saved media. Cancelled jobs remain available for review. Finished job details are automatically deleted after **3 hours** by default; change or disable this in **Settings → Generate → Generation preferences**. Cleanup runs while Frok is open and catches up after reopening. [Job retention](docs/guide/queue.md#automatic-job-cleanup)

**Export all my data** in Settings downloads a backup before you clear the library. It includes media, prompts, favorites, jobs/logs, settings, recipes, interface preferences and pipeline definitions, with manual recovery instructions. Models and runners are separate. Wait for the download to finish and verify the archive before deleting anything. [Export details](docs/storage.md#export-before-deleting)

Manual deletion requires confirmation. Deleting a root removes its attached takes; deleting one video keeps sibling takes. Clear unsaved and prompt-section deletion protect favorites. **Delete all my stuff** in Settings resets the whole library, settings, recipes and local preferences, while retaining models, runners, pipeline files, encrypted API tokens and optional environment files.

Frok binds locally and checks local API requests. Electron adds a per-launch token and a sandboxed native bridge. These protections are not authentication for a public server; do not expose the app as a remote multi-user service. No media or model weights belong in the repository.

[Storage and backups](docs/storage.md)

## Documentation website

A complete **VitePress site** lives in `docs`, with its own package and lockfile. It builds separately from Frok and includes setup, tutorials, pipeline downloads, troubleshooting, desktop development and release instructions.

```sh
cd docs
npm ci
npm run dev
```

Build with `npm run build`; preview with `npm run preview`. Publish the contents of `docs/.vitepress/dist` when a host/domain is chosen. Local search requires no external service.

The desktop app bundles these guides and opens them offline through **Documentation** in the left sidebar, **Help → Documentation** (F1), or Settings. Before desktop development or packaging, install the separate build dependencies once with `npm --prefix docs ci`. Both desktop commands build the local copy automatically. To refresh it while Frok is open, run `npm run build:docs:desktop`, then reopen Documentation.

No public docs site is configured. Set `websiteUrl` in `desktop/product.mjs` when the site is published to enable **View online** in future desktop builds. Offline help remains the default.

In the browser app, **Documentation** in the sidebar opens the local guides in a new tab. `npm run dev` and `npm run build` build this copy automatically; install its dependencies first with `npm --prefix docs ci`. Use `npm run build:docs:web` to refresh the guides while the app is running.

The homepage walkthrough uses `docs/public/demo/sailboat.webp` and `sailboat.mp4`, generated in Frok for this demo. Typing, mouse movement, clicks and render progress are staged; the image and video are actual outputs. The walkthrough has no interactive controls, pauses when hidden, and shows a still image for reduced-motion preferences. Keep replacement clips silent, short, and under 2 MB, then rebuild both docs copies. Only this named demo MP4 is included in source; personal video renders remain ignored.

[Build and hosting guide](docs/hosting.md)

The shared Frok logo is the rounded, branching F in `public/brand/mark.svg`. Edit that source, then run `npm run build:brand` to refresh the app favicon and light/dark documentation marks. App and docs builds refresh these automatically; desktop builds also regenerate the app and monochrome tray icons. The primary green is `#267449`, with `#92d6a9` for the mark on dark backgrounds.

## Develop and contribute

```text
src/app/              Pages, API routes and styles
src/components/       Shared interface components
src/lib/              Storage, pipelines, runners and prompt logic
src/worker/           Background queue worker
desktop/              Electron and packaging
resources/pipelines/  Factory pipeline definitions
scripts/              Development and build commands
tests/                Focused tests and synthetic fixtures
docs/                 Independent documentation app
```

Useful commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Web development with Fast Refresh |
| `npm run dev:desktop` | Electron development with the live UI |
| `npm run typecheck` | Next route types and TypeScript checks |
| `npm test` | Full suite using isolated synthetic data |
| `npm run check:source` | Audit files Git would include for local data, credentials and unexpected binaries |
| `npm run build:desktop` | Build the standalone desktop payload |
| `npm run package:dir` | Package an already-built payload into an unpacked app |
| `npm run package` | Build installers locally; never publishes |

Use focused tests for small changes. UI edits do not require real image/video generation or model downloads. Keep app/library storage out of source control. Read the repository's `AGENTS.md` and bundled Next.js documentation before changing framework behavior.

The first release remains **0.1.0**. A GitHub Actions workflow can build tagged versions into draft releases when the repository is published. Versions advance only when maintainers choose to bump them; there is no automatic move to 1.0.0. In-app update checking remains unwired.

[Contributing](CONTRIBUTING.md) · [Desktop packaging](docs/desktop.md) · [Releasing Frok](docs/releasing.md)

## License and support

Copyright © 2026 Matt Steele. Frok is licensed under [GPL-3.0-only](LICENSE): you may use, modify and share it under those terms, and distributed derivative versions must retain the same freedoms. Contributors retain copyright in their own work; see [COPYRIGHT](COPYRIGHT). Models, runners and bundled tools have separate terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

You are responsible for your inputs, generated content and how you use or share it, including required permissions and model licenses. Frok is provided “as is,” without warranty to the extent permitted by law; the GPL's warranty and liability provisions apply. Read [Legal & responsible use](docs/legal.md), also available in the app and its offline documentation.

For support, contact [@Matt_R_Steele on X](https://x.com/Matt_R_Steele). When reporting a bug, include the app/runner versions, pipeline and relevant log excerpt, with personal prompts, paths and credentials removed.
