# Krea 2 Turbo with Vpipe

The bundled Krea workflow uses **`krea/Krea-2-Turbo`** with its original transformer, encoder and VAE.

## Copy the complete folder

Create `~/frok/pipelines/image/my-krea.local/` and place these public example files inside it:

- [run.vpipeline](/examples/krea/run.vpipeline)
- [prepare.vpipeline](/examples/krea/prepare.vpipeline)
- [meta.json](/examples/krea/meta.json)
- [VPIPE-LICENSE](/examples/krea/VPIPE-LICENSE.txt) and [NOTICE.txt](/examples/krea/NOTICE.txt) — keep these with redistributed copies.

If installing beside the bundled Krea workflow, change the copied metadata `id` to `vpipe:my-krea`, give it a distinct name, and set `default` to `false`. Refresh Settings → Pipelines after saving.

## What happens at each step

Preparation fetches the base model into the Vpipe workspace's `models/krea/Krea-2-Turbo` layout, reusing existing files. Generation selects that model, encodes the prompt, runs diffusion, decodes the final latent and saves an image. The supplied native example starts at 1024 × 1024, eight steps and seed 42; Frok overrides bound dimensions, prompt, seed and output location for each job.

These download files are snapshots of the included factory pipeline, not an experimental custom fusion profile.

## Run directly in Vpipe

You can copy the two `.vpipeline` files into a Vpipe work directory and use them without Frok:

```sh
vpipe --launch prepare.vpipeline
vpipe --launch run.vpipeline
```

Wait for preparation to finish successfully before launching the run file. Use the same work directory for both. Edit the native text-prompt stage and output filename before subsequent direct runs; the example output may be overwritten.

Provider access may require accepting a model license or supplying credentials through your runner configuration. Do not put tokens in a distributable pipeline file. Direct Vpipe jobs are outside Frok's queue, so avoid running them alongside Frok's GPU work.

## Change a workflow, not a global model

To adjust sampling, edit the scheduler/generator settings in your copy. To add a compatible LoRA, configure it in the native graph and declare its required files in metadata. A fused variant needs a preparation graph that produces a separate model artifact; simply adding a metadata entry does not fuse anything.

[Preparation and verification](../pipelines.md#preparation-and-verification) explains the difference between downloads and generated artifacts.
