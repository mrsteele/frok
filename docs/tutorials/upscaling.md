# Compare SD and HD

AI enhancement is a separate step after video generation. It keeps the original video and adds an enhanced version to the same take, rather than creating another library card.

## Choose an AI upscaler

Bundled upscalers run through Vpipe or ComfyUI. Connect the service you want to use in **Settings → Services**; it can differ from the service that generated the original video.

In **Settings → Generation → Video upscaling**, select a workflow:

| Upscaler | Approach | Requirements |
| --- | --- | --- |
| Real-ESRGAN | Enhances frames independently | ComfyUI built-in model upscaling and video nodes |
| SeedVR2 | Restores batches of frames with temporal context | ComfyUI video nodes and the SeedVR2 extension |
| FlashVSR v1.1 | Restores a clip with temporal context | Vpipe 0.1.51+ on Apple Silicon |
| VOSR 2.0 | Restores frames independently | Vpipe 0.1.51+ on Apple Silicon |

For the native options, select the workflow and use its **Prepare models** action if models are missing, or install the declared models in Vpipe yourself. FlashVSR needs its source projection, Wan VAE and companion prompt tensor; VOSR also needs DINOv2. The starters fetch those dependencies through the ordinary queue. Update Vpipe first: older versions do not support these models. FlashVSR buffers the clip and can use substantial memory; VOSR can vary between frames.

For SeedVR2, install [ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler#-installation) in the ComfyUI installation you connected, following its ComfyUI extension instructions, then restart ComfyUI.

Install the workflow's models in ComfyUI using the [model setup guide](../guide/model-setup.md), then choose **Refresh workflows** in Frok. Frok does not install separate upscaler runtimes, Python environments or NCNN binaries.

If required nodes are missing, follow the workflow's **Needs attention** action, install or update the required nodes in ComfyUI, then restart ComfyUI and refresh readiness in Frok. Frok does not install ComfyUI models or custom nodes. Wait for the selected workflow to be ready before upscaling.

Frok supplies the source video and uses the SeedVR2 workflow's device bindings to select an available MPS or CUDA GPU reported by the connected ComfyUI service.

## Enhance one take

1. Open a finished **480p** video.
2. Choose **Upscale** in the shared action row below the video prompt. This action is available for SD videos, whether generated from an image, text, or references.
3. Follow the upscaling job in Queue. It may take longer than expected on a small GPU.
4. When finished, use **SD / HD** over the video to compare versions.

The selected workflow enhances the frames and rebuilds the video with its source frame rate and audio. The improvement is model-dependent: enhancement may sharpen texture or restore detail, but can also introduce artifacts. Compare faces, fine patterns and temporal consistency before keeping the result.

## Compare and export

The viewer keeps both video elements available and switches visibility, carrying playback position across. The HD version shares the SD take's URL and render number. Download offers both versions. The bundled workflows preserve the original frame rate, audio and duration.

Changing the selected upscaler allows another enhancement from the original SD video; it does not feed an already enhanced result back through a different model. The viewer shows the latest enhanced copy for that take.

If rendering fails, check the job log and the selected service’s model or node requirements. For memory errors, stop other GPU work or select a compatible workflow with lower memory requirements. There is no silent switch to a different enhancement model.

## Run directly in ComfyUI

1. Import `run.json` from the `upscale/seedvr2/` or `upscale/realesrgan/` folder into ComfyUI, with its required nodes and models installed. `meta.json` registers the workflow with Frok; import only the run graph.
2. Upload your source video or copy it into that ComfyUI installation's `input` folder, then select it in `LoadVideo`, replacing the `input.mp4` placeholder.
3. For SeedVR2, select your GPU in both the DiT and VAE model loaders. The bundled file selects `mps` for Apple Silicon; CUDA users must choose their CUDA GPU in both loaders. Keep `offload_device` set to `none`; the bundled workflow has no CPU offloading.

Real-ESRGAN's final `ImageScale` defaults to height `720` and width `0`, preserving the source aspect ratio. When run through Frok, width and height come from the job's bindings. Keep the source audio and frame-rate connections to `CreateVideo` intact. See [bundled workflow settings](../pipelines.md#bundled-upscaling-settings).

## Prepare native upscalers manually

Update to Vpipe 0.1.51 or newer first. These are the same starters queued by **Prepare models**. Copy the appropriate pipeline into a file of your choice, then run it from the Vpipe workspace configured in Frok:

```sh
cd ~/vpipe
vpipe --launch /absolute/path/to/prepare.vpipeline
```

Use your configured workspace if it differs from `~/vpipe`. After it finishes, choose **Refresh workflows** in Frok.

### FlashVSR v1.1

<<< ../../resources/pipelines/upscale/flashvsr/prepare.vpipeline{json}

### VOSR 2.0

<<< ../../resources/pipelines/upscale/vosr-2/prepare.vpipeline{json}
