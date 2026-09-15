# Krea 2 Turbo with Vpipe

The bundled Krea workflow uses **`krea/Krea-2-Turbo`** with its original transformer, encoder and VAE.

## Copy the generation files

Create `~/frok/pipelines/image/my-krea.local/` and place these public example files inside it:

- [run.vpipeline](/examples/krea/run.vpipeline)
- [meta.json](/examples/krea/meta.json)
- [VPIPE-LICENSE](/examples/krea/VPIPE-LICENSE.txt) and [NOTICE.txt](/examples/krea/NOTICE.txt) — keep these with redistributed copies.

If installing beside the bundled Krea workflow, change the copied metadata `id` to `vpipe:my-krea`, give it a distinct name, and set `default` to `false`. Refresh Settings → Generation after saving.

## If models are missing

Krea requires access to its [gated Hugging Face repository](https://huggingface.co/krea/Krea-2-Turbo). Sign in there and complete the access request first. Use a [Hugging Face token](https://huggingface.co/settings/tokens) from that account with permission to read the model.

In **Frok Desktop → Settings → Advanced → API tokens**, save the Hugging Face token, then quit and reopen Frok before using **Prepare models**. For browser mode or direct Vpipe commands, supply `HF_TOKEN` in the launch environment. Vpipe reads this variable when the starter's `hf_token` field is empty; leave secrets out of pipeline files. An HTTP 401 or 403 means the download was denied: check the token, model access, and token permissions before retrying.

If Frok reports missing models for this workflow, copy the preparation pipeline below into a file named `prepare.vpipeline`, or [download it](/examples/krea/prepare.vpipeline). This is the source-controlled preparation file supplied with Frok:

<<< ../../resources/pipelines/image/krea-2-turbo/prepare.vpipeline{json}

Keep the file in a location of your choice and run it from your configured Vpipe workspace:

```sh
cd ~/vpipe
vpipe --launch /absolute/path/to/prepare.vpipeline
```

Use your configured workspace if it differs from `~/vpipe`. After preparation finishes, choose **Settings → Generation → Refresh workflows**. Ready workflows do not need this file. For the unchanged bundled workflow, **Prepare models** in Frok queues this same script. It is kept with the app, outside the editable pipeline directory.

Preparation fetches the base model into the Vpipe workspace's `models/krea/Krea-2-Turbo` layout, reusing existing files. Generation selects that model, encodes the prompt, runs diffusion, decodes the final latent and saves an image. The supplied native example starts at 1024 × 1024, eight steps and seed 42; Frok overrides bound dimensions, prompt, seed and output location for each job.

These download files are snapshots of the included factory pipeline, not an experimental custom fusion profile.

## Run directly in Vpipe

Once the model is installed, you can also run the generation file directly from the same Vpipe workspace without Frok:

```sh
vpipe --launch /absolute/path/to/run.vpipeline
```

Edit the native text-prompt stage and output filename before subsequent direct runs; the example output may be overwritten.

Provider access may require accepting a model license or supplying credentials through your runner configuration. Do not put tokens in a distributable pipeline file. Direct Vpipe jobs are outside Frok's queue, so avoid running them alongside Frok's GPU work.

## Change a workflow, not a global model

To adjust sampling, edit the scheduler/generator settings in your copy. To add a compatible LoRA, configure it in the native graph and declare its required files in metadata. A fused variant needs a preparation graph that produces a separate model artifact; simply adding a metadata entry does not fuse anything.

[Preparation and verification](../pipelines.md#preparation-and-verification) explains the difference between downloads and generated artifacts.
