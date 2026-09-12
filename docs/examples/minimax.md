# MiniMax video pipelines

Frok includes separate ordinary-video and reference-video workflows. They share a runner connection, but use different model and adapter requirements. Prepare the capability you actually want to use.

## Vpipe video

Copy a complete example into `~/frok/pipelines/video/my-minimax.local/`:

- [run.vpipeline](/examples/minimax/run.vpipeline)
- [prepare.vpipeline](/examples/minimax/prepare.vpipeline)
- [meta.json](/examples/minimax/meta.json)
- [VPIPE-LICENSE](/examples/minimax/VPIPE-LICENSE.txt) and [NOTICE.txt](/examples/minimax/NOTICE.txt)

Give the metadata a new ID and name if the stock pipeline is also installed. The native workflow owns Turbo adapter and sampling settings and uses SOL. Frok binds prompt, seed, frame count, dimensions and output paths. Its declared first-frame input lets the same workflow support image-to-video.

For Vpipe, any stage producing an input must come before its consumer. Frok's first-frame injection respects that ordering; keep it intact when adapting a custom graph.

## Vpipe reference video

Install the dedicated reference example under `reference/my-reference.local/`:

- [run.vpipeline](/examples/reference/run.vpipeline)
- [prepare.vpipeline](/examples/reference/prepare.vpipeline)
- [meta.json](/examples/reference/meta.json)
- [VPIPE-LICENSE](/examples/reference/VPIPE-LICENSE.txt) and [NOTICE.txt](/examples/reference/NOTICE.txt)

Keep the license and notices with redistributed copies of either Vpipe example.

The reference metadata declares the target and maximum number of uploaded references. This workflow uses its dedicated Turbo adapter; an adapter for an ordinary video checkpoint is not interchangeable by name alone.

## Duration and dimensions

The metadata declares supported durations, qualities, aspect ratios, FPS and the frame-count stride/offset. The bundled profile uses 24 fps and model-compatible frame counts. Frok aligns inputs to that grid, so the exported duration may differ slightly from a nominal six, eight or ten seconds.

Quality controls resolution; they do not silently replace the graph's scheduler or LoRA settings. To compare a different sampling strategy, make another pipeline with a distinct ID and hold the input frame, prompt, seed, duration and resolution constant.

## ComfyUI variants and limits

The factory library also includes MiniMax ComfyUI API workflows. They require their specified node classes, checkpoints and encoders on the connected service. A ready Vpipe model folder does not automatically satisfy ComfyUI's model layout.

Video and reference model packs can require substantial disk space and memory. Preparation readiness verifies required files, not inference speed or GPU fit. Start with a short 480p take and inspect its queue log if memory allocation fails.
