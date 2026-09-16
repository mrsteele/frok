# Pipelines

Frok uses files to define how images and videos are generated and how videos are upscaled. Connections choose the available services; **Settings → Generation** chooses the studio defaults. Ollama’s address and installed-model selector are together in **Settings → Services → Ollama**.

## Location and reset

Working files live in `~/frok/pipelines`, outside the application and repository. Both desktop and web-development startup install the bundled defaults there. Desktop and browser development share the installed app’s workspace by default; an explicit `FROK_HOME` can isolate development when needed.

In **Settings → Advanced → Workflow files**, leave **Workflow folder** empty for the default or enter another existing folder and choose **Save & scan**. Refresh rescans files without running a generator. Choose what to use in **Settings → Generation**. Counts include valid Vpipe workflows and ComfyUI API workflows, including video upscaling graphs, regardless of which connections are enabled. Invalid workflow files are listed for review. Model readiness appears on each selected workflow in **Generation**.

**Reset default pipelines** requires confirmation. It replaces every file in the default `~/frok/pipelines` directory with bundled defaults, including removing personal files placed there. A custom location selected in the input is never deleted or switched by reset. Models, generated content, service settings and queued workflow snapshots are retained. Back up edited definitions before resetting.

The version-controlled factory copy lives in `resources/pipelines`; personal changes belong in the external working folder. Startup preserves edits and creates `~/frok/pipeline-updates` only when changed factory bundles need review. Installation hashes and locks live in OS application data. The installer uses an explicit manifest, so local working files cannot enter a distribution.

## Folder convention

```text
~/frok/pipelines/
  image/
    krea-2-turbo/
      run.vpipeline
      meta.json
    z-image-turbo/
      run.json
      meta.json
  video/
  reference/
  upscale/
    seedvr2/
      run.json
      meta.json
    realesrgan/
      run.json
      meta.json
```

Each pipeline has its own folder. Vpipe uses `run.vpipeline`; ComfyUI uses `run.json`. Every folder has `meta.json`. Startup and reset install only these generation files, with license notices. If a selected workflow needs models, its setup instructions offer manual downloads separately. Copy the generation graph and metadata to install a workflow. Missing metadata and invalid definitions appear in Settings.

Existing flat custom workflows remain readable during the transition. Desktop startup moves bundled flat companions into their matching folders, preserves local edits, and keeps pipeline IDs stable so saved selections still work.

The bundled `resources/pipelines/upscale/seedvr2/` and `resources/pipelines/upscale/realesrgan/` folders contain ComfyUI API workflows. Each has a `run.json` graph, `meta.json` registration with dependency declarations. Their working copies follow the same convention under your configured pipeline folder.

Both graphs use `LoadVideo → GetVideoComponents → AI upscale → CreateVideo → SaveVideo`. The AI stage processes the source frames; `CreateVideo` receives the original frame rate and audio from `GetVideoComponents`. Keep those connections when adapting a workflow so the output retains the source timing and sound. SeedVR2 requires the [ComfyUI-SeedVR2_VideoUpscaler extension](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) on the connected service.

The `upscale/flashvsr/` and `upscale/vosr-2/` folders provide native Vpipe workflows for Vpipe 0.1.51+ on Apple Silicon, alongside the ComfyUI options. Their queued starters fetch FlashVSR (including its companion prompt tensor) or VOSR plus DINOv2. Frok does not install separate SeedVR2 or Real-ESRGAN runtimes, Python environments or NCNN binaries. [Set up video upscaling →](tutorials/upscaling.md)

Add or edit these files directly in your pipeline directory. Generation controls select registered IDs. **Utilities** downloads bundles and drafts; it cannot publish files into this pipeline directory or run uploaded code.

Native upscalers bind `videoSource` to `load-video.input_url` and `fps` to their video-producing stages. Frok supplies a private video resized to the HD target, with the original frame count and rate. The optional `upscale` metadata declares spatial and temporal alignment: `spatialMultiple`, `frameStride`, `frameOffset`, `minimumFrames` and `extraFrames`. Frok pads the right/bottom edges and clones the final frame as needed, then crops and trims the result back to the requested dimensions and original frame count. FlashVSR uses 128-pixel alignment and an 8k+1 input with four extra context frames; VOSR uses 16-pixel alignment. These native run graphs rely on Frok’s input preparation.

### Bundled upscaling settings

SeedVR2 uses the 3B Q4 model with `batch_size: 5`, `temporal_overlap: 1` and tiled VAE encoding and decoding at `512` pixels. Its `meta.json` binds `device` on both the DiT and VAE loaders; Frok selects an available MPS or CUDA GPU reported by the connected ComfyUI service. The standalone `run.json` selects `mps` in both loaders. CPU offloading is disabled (`offload_device: none`); keep it disabled on MPS.

Real-ESRGAN uses the core `UpscaleModelLoader → ImageUpscaleWithModel → ImageScale` nodes. Frok binds `ImageScale` width and height to the job's HD target after neural enhancement. For standalone use, `ImageScale` defaults to height `720`, width `0` and no cropping, preserving the source aspect ratio.

Both ComfyUI workflows declare `videoSource` in `meta.json` for the `LoadVideo` node's `file` input. Frok supplies the selected take through this binding. When importing `run.json` directly into ComfyUI, select your source video and, for SeedVR2, your GPU in both loaders. [Standalone import steps →](tutorials/upscaling.md#run-directly-in-comfyui)

## Personal pipelines excluded from Git

Name a personal pipeline folder with a `.local` suffix:

```text
~/frok/pipelines/image/my-test.local/
  run.vpipeline
  meta.json
```

For ComfyUI, use `run.json` and `meta.json`. Frok discovers `.local` folders normally. Working files outside the source repository are not tracked by it; its ignore rules also exclude personal copies under `resources/pipelines`. Older flat `*.local.*` files remain ignored too. Refresh Settings → Generation after adding a folder.

Give copies a unique metadata `id` and recognizable `name`. The folder name does not determine the ID. Desktop installers include only explicitly listed bundled folders, never personal workflows.

The ignore rule applies to untracked files. If a personal pipeline was already committed, ignoring it does not remove it from Git tracking or past commits.

## What belongs in a pipeline

Put model paths, LoRAs and strengths, step counts, schedulers, shifts and attention settings directly in the native workflow. Frok supplies the prompt, seed, dimensions, duration/frame count, private inputs and private output location through explicit bindings. It does not replace a selected workflow’s sampling or adapter settings. Image live-preview output is attached when the graph exposes a compatible intermediate stream.

The composer’s Generation settings and the image/video viewer offer a pipeline override. Choices are remembered for each generation mode. Workflows for disconnected providers remain visible, with a connection requirement; connect the provider before selecting one. A missing dependency blocks generation and links to setup instructions. Duration, aspect and resolution controls follow the selected metadata; changing quality changes resolution, not the pipeline’s sampling schedule.

New jobs store the generation workflow and metadata. Retrying uses that snapshot. New submissions use the current file. Changing defaults or editing a file cannot change a job already in the queue. Renaming a pipeline’s stable `id` is a new pipeline; existing default selections need to be updated.

## Metadata example

A minimal image pipeline registration:

```json
{
  "version": 1,
  "id": "vpipe:my-image",
  "name": "My image workflow",
  "runner": "vpipe",
  "default": false,
  "bindings": {
    "prompt": [{ "node": "text-prompt", "field": "text" }],
    "seed": [{ "node": "generate-image", "field": "seed" }],
    "width": [{ "node": "generate-image", "field": "width" }],
    "height": [{ "node": "generate-image", "field": "height" }],
    "output": [{ "node": "save-image", "field": "path" }]
  },
  "dependencies": [{
    "kind": "model",
    "reference": "krea/Krea-2-Turbo",
    "layout": "krea",
    "fetch": { "model": "krea/Krea-2-Turbo" }
  }]
}
```

`node` identifies a Vpipe stage or a ComfyUI node. `field` names a direct configuration/input property. The other supported bindings are `frames`, `fps`, `duration`, `pixels` (width × height), `frameBufferMB` (RGB clip buffer size) and `device` (ComfyUI GPU selection). Bind every file output. Media loaders must use source/reference bindings, or a `videoSource` binding for an upscaling workflow. Frok replaces the video loader’s example filename with the selected video’s private upload path. Vpipe input producers must precede consumers.

Optional `controls` declares `durations` (6, 8, 10), `qualities` (`preview`, `standard`), `aspects`, `fps`, `frameStride` and `frameOffset`. Defaults match the bundled 24 fps MiniMax workflow, with frame counts on its 17n+5 grid. Keep this metadata consistent with the native graph. See the bundled files for starting-frame and multiple-reference bindings. `source.required: true` marks an image-to-video workflow that cannot run without a starting image. `promptSuffix` adds a fixed, visible flavor requirement such as M87’s `--preview`; it is included in saved generation details. `plugins: ["ltx-2.5"]` opts a Vpipe workflow into the known, manually installed LTX plugin.

Dependencies have a trusted relative `reference`, `kind` (`model`, `lora`, `file`) and optional required `files`, `size` and `sha256`. Vpipe model layouts can be `krea`, `diffusers`, `minimax`, `ltx` or a bare `transformer`; custom layouts must list their required files. Known Vpipe downloads use `fetch: {model, variant?, key?}`. ComfyUI files use an explicit HTTPS `url` and a path relative to its models directory. Frok also checks model and LoRA inputs in supported native loaders, so leaving one out of metadata does not make a missing file Ready.

## Catalog details

Optional `catalog` metadata powers the rich workflow selectors in **Settings → Generation**. It groups entries by `family`, identifies their `model` and `flavor`, and supplies `uses`, `precision`, `requirements`, `documentation` and `setup`. Every link must use HTTPS. Older and custom metadata without these fields still works.

Use `access: [{name, url, gated: true}]` for repositories requiring access approval. This displays a lock and access instructions; it does not prevent generation with already installed models. The dependency file sizes supply full download totals. Optional `estimates` separates `downloadGB`, `installedGB`, `preparationGB` and `memoryGB`, with required `basis` and `source` fields. Do not substitute storage size for required memory.

Optional `ratings.speed` and `ratings.adherence` each contain a `score` from 0 to 5, a testing `basis` and a `source` link. Leave these absent when there is no evidence; the UI displays **Unrated**. Mark untested adaptations with `experimental: true`. Model and LoRA licenses and gated-access terms still apply.

Catalog metadata describes the workflow. Sampling settings and LoRA strengths remain in the native run file. Changing either file creates a custom revision and removes automatic bundled preparation until the original pair is restored. Frok never runs `prepare.json` or `prepare.vpipeline` found in an editable workflow folder.

## Preparation and verification

Install runners and custom nodes outside Frok. For unchanged bundled workflows, **Prepare models** queues either a native Vpipe preparation pipeline or a verified ComfyUI file manifest. The worker retains its log and checks readiness afterward. ComfyUI downloads are streamed and verified before publishing each file, without overwriting conflicting existing files. Preparation does not generate custom setup graphs or repair arbitrary installations. Real-ESRGAN uses manual installation. The [setup guide](guide/model-setup.md) includes manual alternatives. Preparation files in editable workflow folders are ignored.

Frok checks the files used by a pipeline, including declared sizes, bounded safetensor headers and payload lengths. ComfyUI workflows additionally require their node classes on the connected backend. Download URLs, SHA-256 checksums and Vpipe `fetch` metadata describe installation sources used by bundled preparation and manual tools; Frok does not download or hash entire model files during readiness checks. Readiness does not prove that an arbitrary graph will infer successfully or fit available memory.

Declare requirements in `meta.json`. For an older custom ComfyUI workflow, move any dependencies that exist only in `prepare.json` into the metadata. Supported loader inputs remain authoritative, so omitting their declarations does not make a missing model ready.

Frok uses the exact model paths declared by a pipeline, so externally prepared models are recognized without a Frok receipt. `generated: true` can describe an artifact produced by fusion or quantization, but does not invoke processing. Use distinct output names when creating model variants and update the run file and metadata together; older queued generation jobs retain their original requirements.

## Krea defaults and Utilities

The bundled workflow uses **krea/Krea-2-Turbo** with its original transformer, encoder and VAE. If models are missing, the [example guide](examples/krea.md#if-models-are-missing) offers a manual preparation download. Both native files also work directly in a Vpipe workspace. Startup updates untouched generation files in `~/frok/pipelines`; edited copies are preserved and incoming defaults are staged in `~/frok/pipeline-updates`.

**Utilities → Create a pipeline folder** accepts a native Vpipe run workflow or ComfyUI API export. Give it a name and choose Images, Videos, Reference videos or Video upscaling. The ZIP contains:

```text
image/my-pipeline-<id>.local/
  run.vpipeline
  meta.json
  REVIEW.txt
```

The parent folder follows the chosen service; ComfyUI files use `.json`. Extract the archive into your configured pipeline location (default `~/frok/pipelines`), review the files, then refresh **Settings → Generation** and select the new pipeline. The `.local` suffix marks a personal workflow.

Supported prompt, seed, size, output and MiniMax image/reference inputs are mapped into metadata. Negative prompts, sampler settings and adapter strengths are retained. Known dependency metadata is copied from bundled/detected definitions. The export contains only the run graph, metadata and REVIEW.txt; no preparation scripts are generated.

Unknown dependencies and unsupported input bindings appear in `REVIEW.txt` and on the download result. Fill in those gaps before use; malformed or unsupported definitions will be flagged by the pipeline catalog. This is a draft utility, not proof that an arbitrary workflow will run. It never executes uploads, downloads models or installs files.

## Pipeline selections and queued jobs

Choose a registered pipeline for each service in **Settings → Generation**. Every generation and upscaling job saves a copy of its selected pipeline, including adapter strengths and dependency requirements. Changing a pipeline file or selection applies to new jobs; retries retain the original job's saved definition.

The catalog reads the folders in your configured pipeline directory. It does not create extra hidden workflows from other settings. Edit the pipeline files to customize LoRAs and sampling, then refresh the catalog.

**Delete all my stuff** resets the entire library, queued snapshots and selections. Downloaded models and pipeline folders are preserved.

## Complete examples

Try the [Krea / Vpipe](examples/krea.md), [ComfyUI image](examples/comfyui.md), or [MiniMax video](examples/minimax.md) examples. Each guide includes downloadable native files and matching metadata.
