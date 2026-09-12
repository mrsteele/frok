# Generate images

On **Envision**, type a prompt, choose Image and select an aspect ratio. Open the sliders button for batch size, pipeline, quality, seed and prompt enhancement. The number beside the button shows how many generations are requested.

## Give the model a clear brief

Describe the subject, count, action and setting before adding style. For example:

> Exactly two ceramic cups sit on a blue kitchen table. One cup is white and one is yellow. Soft light comes through a window on the left. Product photography.

Prompt enhancement keeps the original brief and adds compatible details. Each image can receive different additions. It should not replace subject counts, colors or actions. Open **Generation details** to see the original prompt when changed and the actual image prompt sent to the runner. Models can still miss instructions; prompt preservation is not a guarantee of visual adherence.

## Batches and seeds

Every image in a batch receives a different seed. An explicit seed anchors the sequence; an automatic seed gives a fresh sequence. Repeating a fixed seed, prompt and pipeline is useful for comparisons. Similar images can still result when a brief tightly constrains the composition.

The batch has a tile for every requested image. Rendering is sequential: one active image, then the next. Vpipe can show intermediate decoded images in the active tile. Model loading and prompt encoding happen before those previews appear. ComfyUI currently shows progress without these live frames.

## Prompt sections

Every time you choose **Generate**, Envision starts a new section labeled with your prompt, even if you use the same prompt and settings again. New sections appear at the top, and new image requests scroll toward the queued batch. Sections can be collapsed to keep the workspace tidy. **Jump to prompt** moves between sections. Only **Load more** appends another image batch to the bottom of its existing section, using that section's saved settings and fresh seeds. It keeps the section in place and does not run automatically as you scroll.

Your sections remain after refreshing or restarting Frok, even if you delete their queue logs. **New idea** clears the composer without hiding earlier work. **Show older prompts** reveals earlier sections without generating anything.

## What to do with a result

Open a tile to inspect the image. Save adds the entire creation to Favorites; Download exports the image. Use the play action to animate it naturally, or enter motion directions in its viewer. [Video generation →](./videos.md)

Deleting a prompt section reviews the unsaved creations it will remove. Favorites and their associated videos are kept. Individual asset deletion is different: deleting a root can remove its whole family, including favorites, after confirmation. [Library and deletion →](./library.md)
