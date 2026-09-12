# Compare SD and HD

AI enhancement is a separate step after video generation. It keeps the original video and adds an enhanced version to the same take, rather than creating another library card.

## Choose an AI upscaler

In **Settings → Pipelines → HD enhancement**, select a pipeline and prepare its runtime and models:

| Upscaler | Approach | Useful tradeoff |
| --- | --- | --- |
| Real-ESRGAN | Enhances frames independently | Lighter local setup |
| SeedVR2 | Restores batches of frames with temporal context | Heavier runtime and memory requirements |

These are local integrations with their own setup. Choosing a ComfyUI generation pipeline does not require using ComfyUI for enhancement. Frok's SeedVR2 profile uses its standalone CLI with a 3B Q4 model, tiled VAE processing and a 720p target.

## Enhance one take

1. Open a finished **480p** video.
2. Choose **Upscale** in the shared action row below the video prompt. This action is available for SD videos, whether generated from an image, text, or references.
3. Follow the upscaling job in Queue. It may take longer than expected on a small GPU.
4. When finished, use **SD / HD** over the video to compare versions.

Frok uses the chosen AI workflow, not just an FFmpeg resize. The improvement is model-dependent: enhancement may sharpen texture or restore detail, but can also introduce artifacts. Compare faces, fine patterns and temporal consistency before keeping the result.

## Compare and export

The viewer keeps both video elements available and switches visibility, carrying playback position across. The HD version shares the SD take's URL and render number. Download offers both versions. Original audio and duration are preserved by the export path.

Changing the selected upscaler allows another enhancement from the original SD video; it does not feed an already enhanced result back through a different model. The viewer shows the latest enhanced copy for that take.

If setup fails, open the preparation log and check model downloads, runtime compatibility and available disk space. If rendering runs out of memory, stop other GPU work and try a lighter upscaler. There is no silent switch to a different enhancement model.
