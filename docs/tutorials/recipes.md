# Build a reusable motion recipe

A recipe is a named motion instruction you can apply to many starting images. It is text, not code, and it does not replace the image's existing prompt.

## Create a product-shot recipe

1. Open **Settings → Recipes**.
2. Add a recipe named **Showroom**.
3. Use the instruction below and save it.

> Slowly move the camera in a shallow arc around the main product. Keep its shape, color and branding unchanged. Use soft studio reflections and a calm, deliberate pace. Keep the background stable.

Open an image of a product. In the motion dropdown, choose **Showroom**. Selecting a recipe **immediately queues a video** using its saved text. Any draft in the Custom text box is ignored.

## How recipes combine with the image

Frok starts with the actual image prompt, then adds the recipe. If prompt enhancement is enabled, Ollama may enrich the motion direction with compatible details while preserving the original instructions. A product-shot recipe can therefore apply to a car, a mug or a watch without needing separate copies for every subject.

Be explicit about what must remain unchanged. A recipe cannot guarantee perfect identity or text preservation in the generated video, but concrete directions make the intent clear.

## Custom and your default recipe

**Custom** is the default editor: type directions and press Enter to render. Choosing Custom in the dropdown only returns focus to the editor.

An empty Custom prompt and the quick video button on an image use your **default recipe**. In **Settings → Recipes**, click **Make default** beside any recipe. The selection is saved, marked **Default** in the recipe menus, and applies to future quick videos and empty prompts. Selecting a recipe immediately renders with that recipe, regardless of which one is the default, and ignores the editor's draft.

New libraries start with **Normal**, **Silly** and **Dance** as editable examples. **Normal** is the first default and asks for simple movement that continues the image's action. It is an ordinary recipe: you can edit its prompt, rename it, replace it or delete it. Dance asks for movement that matches the mood and atmosphere of the image, from relaxed swaying to lively footwork.

Deleting the default makes the next remaining recipe the default; the confirmation tells you which one. If you delete every recipe, type a video prompt or add a recipe before using quick video actions. The Reset action shows a warning before restoring all starter recipes and making Normal the default again. Existing recipe lists gain a Normal default on upgrade without replacing their custom prompts.

## Repeating an older take

Queued jobs and saved videos keep the recipe they used. Editing Showroom later does not change those records. **Redo** repeats the saved direction of that take; selecting Showroom again uses today's version. Generation details shows the raw recipe when it was enhanced and the full final video prompt.
