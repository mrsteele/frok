# Import a custom workflow

This tutorial makes a new pipeline folder without replacing a working default. You need a native Vpipe generation graph or a ComfyUI API export under 1 MB.

## 1. Create a draft

Open **Utilities → Create a pipeline folder** from the sidebar footer. Enter a recognizable name, choose Images, Videos or Reference videos, select the runner format, and upload the run workflow. Download the ZIP.

For an image workflow, the archive looks like this:

```text
image/my-workflow-<id>.local/
  run.vpipeline
  meta.json
  REVIEW.txt
```

ComfyUI companions use `.json`. The utility does not execute the workflow, install it or download models. It identifies supported bindings and lists required dependencies in the review file.

## 2. Review the folder

Read **REVIEW.txt** first. Resolve unknown model origins, unsupported input bindings and any preparation that needs custom fusion or quantization.

Check the following together:

- `run`: correct model paths, adapters, strengths and sampling; no private hard-coded input or output paths.
- `meta.json`: a unique stable `id`, accurate runner and bindings for prompt, seed, dimensions and outputs.
- Runner installation: the exact model files and custom nodes must already be installed.

Metadata does not replace the native graph. It tells Frok how to pass user controls into it and how to check its requirements. [Full metadata reference →](../pipelines.md#metadata-example)

## 3. Install and scan

Extract the archive into the pipeline location shown in **Settings → Advanced → Workflow files**, normally `~/frok/pipelines`. Keep the `image`, `video` or `reference` parent directory. Choose **Refresh workflows** and resolve any catalog warnings.

Select the new workflow for its capability, or use it as a generation-settings override. Install missing dependencies in your runner, then refresh workflows in Frok. Your old default can remain available while you compare the new workflow.

## 4. Keep changes reproducible

Use a fixed prompt, seed and size when comparing pipeline variants. Give a copied workflow a different metadata ID; changing only the folder name is insufficient. Change LoRA strength in the native workflow. If an adapter is fused during preparation, rebuild into a distinct output path and update both run and metadata references.

Queued jobs keep snapshots; edits affect new submissions. Retrying an older job reuses its older snapshot. Keep personal workflows in the external library, and use `.local` folders if you also maintain copies inside a source checkout covered by Frok's ignore rules.
