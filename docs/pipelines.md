# Pipelines

Frok uses files to define how images and videos are generated. Connections choose the available services; **Settings → Pipelines** chooses the studio defaults. Ollama’s address and installed-model selector are together in **Settings → Generate → Ollama**.

## Location and reset

Working files live in `~/frok/pipelines`, outside the application and repository. Both desktop and web-development startup install the bundled defaults there. Desktop development keeps its media/database in the development workspace while sharing this pipeline folder; an explicit `FROK_HOME` can isolate the entire desktop workspace when needed.

At the top of **Settings → Pipelines**, leave **Pipeline location** empty for the default or enter another existing folder and choose **Save & scan**. Refresh rescans files without running a generator. Counts include valid Vpipe workflows, ComfyUI API workflows, and registered local upscalers regardless of which connections are enabled. Invalid files and missing preparation/download instructions are listed separately. Model readiness appears on each selected pipeline below.

**Reset default pipelines** requires confirmation. It replaces every file in the default `~/frok/pipelines` directory with bundled defaults, including removing personal files placed there. A custom location selected in the input is never deleted or switched by reset. Models, generated content, service settings and queued workflow snapshots are retained. Back up edited definitions before resetting.

The version-controlled factory copy lives in `resources/pipelines`; personal changes belong in the external working folder. Startup preserves edits and stages updated factory bundles in `~/frok/pipeline-updates` for review. The installer uses an explicit manifest, so local working files cannot enter a distribution.

## Folder convention

```text
~/frok/pipelines/
  image/
    krea-2-turbo/
      run.vpipeline
      prepare.vpipeline
      meta.json
    z-image-turbo/
      run.json
      meta.json
  video/
  reference/
  upscale/
```

Each pipeline has its own folder. Vpipe uses `run.vpipeline` and optional `prepare.vpipeline`; ComfyUI uses `run.json` and optional `prepare.json`. Every folder has `meta.json`. Copy the complete folder to install a workflow. Missing metadata and invalid definitions appear in Settings.

Existing flat custom workflows remain readable during the transition. Desktop startup moves bundled flat companions into their matching folders, preserves local edits, and keeps pipeline IDs stable so saved selections still work.

The `upscale` folder registers the existing local SeedVR2 and Real-ESRGAN integrations. These are AI upscalers with their own runtime installers, not native ComfyUI/Vpipe graphs. Arbitrary video-input upscaling graphs are not supported yet.

Add or edit these files directly in your pipeline directory. Generation controls select registered IDs. **Utilities** downloads bundles and drafts; it cannot publish files into this pipeline directory or run uploaded code.

## Personal pipelines excluded from Git

Name a personal pipeline folder with a `.local` suffix:

```text
~/frok/pipelines/image/my-test.local/
  run.vpipeline
  prepare.vpipeline
  meta.json
```

For ComfyUI, use `run.json`, `meta.json`, and optional `prepare.json`. Frok discovers `.local` folders normally. Working files outside the source repository are not tracked by it; its ignore rules also exclude personal copies under `resources/pipelines`. Older flat `*.local.*` files remain ignored too. Refresh Settings → Pipelines after adding a folder.

Give copies a unique metadata `id` and recognizable `name`. The folder name does not determine the ID. Desktop installers include only explicitly listed bundled folders, never personal workflows.

The ignore rule applies to untracked files. If a personal pipeline was already committed, ignoring it does not remove it from Git tracking or past commits.

## What belongs in a pipeline

Put model paths, LoRAs and strengths, step counts, schedulers, shifts and attention settings directly in the native workflow. Frok supplies the prompt, seed, dimensions, duration/frame count, private inputs and private output location through explicit bindings. It does not replace a selected workflow’s sampling or adapter settings. Image live-preview output is attached when the graph exposes a compatible intermediate stream.

The composer’s Generation settings and the image/video viewer offer a pipeline override. Choices are remembered for each generation mode. Only pipelines for enabled connections appear. A missing dependency blocks generation and links to preparation. Duration, aspect and resolution controls follow the selected metadata; changing quality changes resolution, not the pipeline’s sampling schedule.

New jobs store the complete workflow, metadata and prepare companion. Retrying uses that snapshot. New submissions use the current file. Changing defaults or editing a file cannot change a job already in the queue. Renaming a pipeline’s stable `id` is a new pipeline; existing default selections need to be updated.

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

`node` identifies a Vpipe stage or a ComfyUI node. `field` names a direct configuration/input property. The other supported bindings are `frames`, `duration` and `pixels` (width × height). Bind every file output. Loaders for browser media must use source/reference bindings, not hard-coded file paths. Vpipe input producers must precede consumers.

Optional `controls` declares `durations` (6, 8, 10), `qualities` (`preview`, `standard`), `aspects`, `fps`, `frameStride` and `frameOffset`. Defaults match the bundled 24 fps MiniMax workflow, with frame counts on its 17n+5 grid. Keep this metadata consistent with the native graph. See the bundled files for starting-frame and multiple-reference bindings.

Dependencies have a trusted relative `reference`, `kind` (`model`, `lora`, `file`) and optional required `files`, `size` and `sha256`. Vpipe model layouts can be `krea`, `minimax` or a bare `transformer`; custom layouts must list their required files. Known Vpipe downloads use `fetch: {model, variant?, key?}`. ComfyUI files use an explicit HTTPS `url` and a path relative to its models directory. Frok also checks model and LoRA inputs in supported native loaders, so leaving one out of metadata does not make a missing file Ready.

## Preparation and verification

Frok checks the files used by a pipeline, including bounded safetensor headers and payload lengths. ComfyUI workflows additionally require their node classes on the connected backend. Declared download checksums are verified during installation. Readiness is a file/dependency check, not proof that an arbitrary graph will infer successfully or fit available memory.

Known downloads can be prepared directly from dependency declarations. Vpipe fusion, quantization and custom transforms belong in `prepare.vpipeline`. A ComfyUI `prepare.json` is a download manifest containing a `dependencies` array; Frok does not execute it as a ComfyUI graph. Dependencies can also be declared entirely in `meta.json`.

Missing origins and unsupported/custom preparation cannot be guessed from filenames. Settings reports them for administrator review. It does not download arbitrary look-alike models. Existing conflicting ComfyUI files are preserved; move them aside manually before repairing. A CLI exit code or old setup receipt alone cannot mark preparation complete.

Preparation uses the serial queue, with logs, cancellation and retry. Repeated requests for the same pipeline revision reuse an active setup job in the queue. Before a queued setup starts, it checks whether another job has already installed the shared dependencies. A missing known adapter can be fetched without re-quantizing a verified base model. All jobs and logs belong to the same local library.

Frok uses the exact model paths declared by a pipeline, so models prepared directly in Vpipe are recognized. `generated: true` identifies an artifact that requires processing, such as fusion or quantization; it does not rename the model directory. When changing a model’s preparation, use a new output name and update its run file and metadata. This preserves variants used by older jobs. Stop Frok before running direct GPU work in that workspace.

## Krea defaults and Utilities

The bundled workflow uses **krea/Krea-2-Turbo** with its original transformer, encoder and VAE. Its preparation file downloads the base model. Both native files also work directly in a Vpipe workspace. Startup updates untouched bundled copies in `~/frok/pipelines`; edited copies are preserved and incoming defaults are staged in `~/frok/pipeline-updates`.

**Utilities → Create a pipeline folder** accepts a native Vpipe run workflow or ComfyUI API export. Give it a name and choose Images, Videos or Reference videos. The ZIP contains:

```text
image/my-pipeline-<id>.local/
  run.vpipeline
  prepare.vpipeline
  meta.json
  REVIEW.txt
```

The parent folder follows the chosen service; ComfyUI files use `.json`. Extract the archive into your configured pipeline location (default `~/frok/pipelines`), review the files, then refresh **Settings → Pipelines** and select the new pipeline. The `.local` suffix marks a personal workflow.

Supported prompt, seed, size, output and MiniMax image/reference inputs are mapped into metadata. Negative prompts, sampler settings and adapter strengths are retained. Known download instructions come from bundled/detected definitions; a bundled preparation companion can be reused when its dependencies match. ComfyUI preparation is a download manifest, not an executable workflow.

Unknown downloads, custom fusion/quantization and unsupported input bindings appear in `REVIEW.txt` and on the download result. Fill in those gaps before use; malformed or unsupported definitions will be flagged by the pipeline catalog. This is a draft utility, not proof that an arbitrary workflow will run. It never executes uploads, downloads models or installs files.

## Pipeline selections and queued jobs

Choose a registered pipeline for each service in **Settings → Pipelines**. Every generation and preparation job saves a copy of its selected pipeline, including adapter strengths and dependency requirements. Changing a pipeline file or selection applies to new jobs; retries retain the original job's saved definition.

The catalog reads the folders in your configured pipeline directory. It does not create extra hidden workflows from other settings. Edit the pipeline files to customize LoRAs and sampling, then refresh the catalog.

**Delete all my stuff** resets the entire library, queued snapshots and selections. Downloaded models and pipeline folders are preserved.

## Complete examples

Try the [Krea / Vpipe](examples/krea.md), [ComfyUI image](examples/comfyui.md), or [MiniMax video](examples/minimax.md) examples. Each guide includes downloadable native files and matching metadata.
