# Troubleshooting

Start with the warning beside the action you want to use, then open its setup or queue link. Frok checks each capability independently: images can be ready while video preparation is still incomplete.

## I cannot generate anything

Open **Settings → Services**. A fresh library starts with all connections disabled. Connect a compatible runner, then choose a workflow in Generation in **Pipelines**. Wait for required preparation jobs to complete.

If the queue worker is offline or requests a restart, let any active work finish and restart Frok. Reloading the page does not restart the background worker. In development, stop the server with Ctrl+C and run the same startup command again.

## My models are already installed, but a pipeline says missing

Check the **model workspace**, not just the pipeline folder. Vpipe's workspace must be the parent of `models`. ComfyUI's folder must match the running service. Refresh the connection, then refresh Pipelines.

A model with a similar name or different quantization may not satisfy the workflow's exact file requirements. Compare the reported missing path with `run` and `meta.json`. Preparation can require an encoder, VAE or LoRA in addition to a transformer. Old setup receipts alone do not make a pipeline Ready.

If a custom graph has no known source for a missing file, add the correct dependency/preparation instructions. Do not substitute an arbitrary same-named file. [Pipeline preparation →](../pipelines.md#preparation-and-verification)

## Ollama connects, but enhancement is unavailable

Refresh its model list and select an **installed text-generation model**. A running service is not enough. The Default option can refer to a model you have not installed; choose one of your own or install the intended model through Ollama.

Changing the selection forces a readiness check. Also enable Prompt enhancement in generation settings if you want it applied. It can remain disabled even with a ready model.

## A ComfyUI workflow will not load

Use an API-format export, with node IDs and `class_type`/`inputs`. A visual editor graph is not equivalent. Check that the connected backend has every required node class, and that metadata bindings name real input fields. The configured folder must belong to that backend.

## Video generation works, but upscaling needs attention

Check **Settings → Generation → Video upscaling**. Disabled workflows name the service they require. Connect it in **Services**, select the workflow, then follow its readiness action for missing nodes or models. Preparation logs are available in Queue. See [upscaling setup](../tutorials/upscaling.md) for the bundled workflows' requirements.

## Vpipe says a stage is unknown or forward-declared

Vpipe producers must appear before stages consuming their outputs. Review stage IDs and input ports in the run file. First-frame encoders must precede the generator. A copied custom pipeline may also require a newer compatible Vpipe version. Utilities generates a draft, not a guarantee of runnable inference.

## Video reaches the end of denoising and still runs

It still needs VAE decoding and file export. Frok's combined percentage reserves the final portion for those stages. See [queue progress](./queue.md). A busy GPU graph does not establish how much time remains.

## A job is slow or runs out of memory

Try a shorter 480p video, fewer images per batch, a lighter compatible pipeline, or close other GPU-heavy applications. Fewer images reduce total queue work; they do not reduce the memory needed to render one image. Models do not all fit on every machine that can launch Frok.

## A render link is unavailable

The asset or numbered take may have been deleted. Render numbers are never reassigned to new takes. Use **View starting asset** if the root still exists, or return to History. Old image/video links are still recognized.

## I see an imported pipeline and a bundled one

Older saved configurations are preserved as private Imported entries. The file-based pipeline in your current folder is a separate definition. Select the new file-based default when you are ready; the imported entry does not imply there are two folders on disk.

## Report a problem

Include Frok's version, OS, runner/version, pipeline name, the failing stage, and relevant queue log lines. Remove tokens, private prompts and personal file paths before sharing. Use the repository's issue tracker when available, or contact [@Matt_R_Steele](https://x.com/Matt_R_Steele). A synthetic prompt that reproduces the issue is more useful than sending your whole library.
