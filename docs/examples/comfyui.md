# A ComfyUI image pipeline

The SDXL Turbo example is a ComfyUI **API graph** plus metadata. It uses the same folder convention as a Vpipe pipeline, with `run.json` instead of `run.vpipeline`.

## Install the example

Create `~/frok/pipelines/image/my-sdxl.local/` and copy:

- [run.json](/examples/comfyui/run.json)
- [meta.json](/examples/comfyui/meta.json)

When keeping the bundled workflow alongside it, change the copied metadata ID to `comfyui:my-sdxl`, give it a distinct name, and set `default` to `false`.

Start ComfyUI and connect it in Settings → Services. Refresh Pipelines, select the new image workflow and prepare any missing dependencies. The metadata declares the checkpoint location and its download source, so a separate preparation file is not required for this known download.

## API format matters

An API graph maps node IDs to their class and inputs:

```json
{
  "10": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "A quiet mountain lake", "clip": ["4", 1] }
  }
}
```

This is a structural excerpt, not a complete generation graph. A Frok binding such as `{"node":"10","field":"text"}` targets that node's input. Visual editor coordinates, links and UI state are not an API graph. Export in API format or use the complete downloadable example above.

## Add another checkpoint or sampler

Edit your native graph, then align the model reference and download requirements in `meta.json`. Keep negative prompt bindings separate from the main user prompt. Bind every output so Frok can collect job-specific files. Required custom node classes must exist on the connected ComfyUI service before the workflow becomes ready.

The bundled Z-Image-Turbo workflow follows the same structure. Use its own model and encoder requirements; swapping a checkpoint filename in an unrelated graph is not a complete conversion.

[Import a workflow with Utilities →](../tutorials/custom-pipeline.md)
