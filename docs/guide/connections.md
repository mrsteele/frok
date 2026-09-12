# Connect your runners

**Settings → Generate** establishes connections. **Settings → Pipelines** chooses what each connection will generate. You can mix runners: an image pipeline and a video pipeline do not have to use the same service.

Connection fields stay blank at their defaults, with the effective default shown as a placeholder. Enter an override only when your installation differs. Saving and checking a location refreshes readiness; it does not move models.

## Vpipe

Use the same model workspace as Vpipe Manager or your Vpipe CLI. For models under `/Volumes/AI/vpipe/models`, enter `/Volumes/AI/vpipe`. Leave the input empty for `~/vpipe`.

The check verifies Frok can use the runner and its workspace. It can then recognize files already prepared there. Accepting the first-connection setup offer selects the starter Krea and MiniMax workflows and queues any missing preparation. Existing selections are retained.

Vpipe's bundled native profile targets Apple Silicon Macs. Check the runner's own OS and hardware requirements before installing models. Frok does not make an incompatible backend portable merely by packaging the interface for another OS.

## ComfyUI

Start ComfyUI, then enter its local service address and base folder. The folder should contain `models`, `input` and `output`. Empty inputs use the displayed device defaults; the service address defaults to port 8000. A manual installation may instead listen on port 8188.

Frok checks the service and the input/output folder mapping. A reachable address with the wrong base directory is not a working file connection. It also checks whether the nodes required by a selected workflow are installed on that service.

Use an **API-format workflow** for Frok pipelines, not a visual editor export. See the [ComfyUI example](../examples/comfyui.md).

## Ollama

Install [Ollama](https://ollama.com/download) and run its local service, connect its local address, and refresh the installed-model list. Frok lists models compatible with text generation. Select one in the same card.

**Default** resolves to Frok's configured default model, which must actually be installed and compatible. **None** disables enhancement. Selecting another model triggers a fresh check; having a different model installed is insufficient. Frok normally neither starts a second service nor copies your Ollama model library.

Turn **Use Prompt Enhancement** on or off with the checkbox. It shares the saved preference used by **Prompt enhancement** in generation settings, so changing either control updates the other. Ollama improves prompts; it does not generate the image or video pixels.

## Changing a connection later

Finish or cancel queued work before changing runner locations. Use **Save & check** to validate a new location, or refresh to check an unchanged one. Failed checks retain the previous saved location. Clearing an override restores the displayed default after saving.

The active library owns these settings. Browser development and desktop development use different libraries by default, so a connection saved in one does not automatically configure the other. [Workspace details →](../desktop.md)

## Generation preferences and API tokens

Below the connection cards, **Generation preferences** controls live image previews, render timeout, finished-job retention and whether Frok starts its separate Ollama runtime. Finished job records, logs and working files are automatically deleted after 3 hours by default; change the number of hours or turn off automatic deletion to keep them. Saved media is kept. Turning previews off reduces extra decoding and memory use. Timeout changes apply when the next render starts. Save your changes; Ollama startup changes also need a full quit and reopen.

In the desktop app, **API tokens** stores Hugging Face and ComfyUI credentials securely. Accept a gated model's license before downloading it, save the token, and quit and reopen Frok. Tokens stay outside library backups and are kept when you reset your library. No environment file is needed.

## Video tools

Frok uses an external **FFmpeg and FFprobe** installation to finish videos, preserve audio, inspect metadata and prepare frames for AI upscaling. Frok does not include or download these commands. Image generation and prompt enhancement work without them.

Install a build from [FFmpeg’s download page](https://ffmpeg.org/download.html) with `libx264` and AAC encoding support. Frok detects commands on your PATH and common installation locations, including Homebrew’s standard Mac directories. Vpipe’s bundled FFmpeg libraries are not a substitute for these two standalone commands.

If automatic detection misses your installation, enter the folder containing both commands in **Settings → Generate → Generation preferences → Video tools folder**. Leave it blank for automatic detection. Save and refresh connections; no restart is needed. Finish or cancel queued work before changing the folder.
