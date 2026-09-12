# Set up your studio

Install [Vpipe](https://vpipe.ai/) or [ComfyUI](https://www.comfy.org/download) before connecting a generation runner. Install [Ollama](https://ollama.com/download) only if you want prompt enhancement. Frok wraps these separately installed services; it does not host or redistribute them or include model weights. Each runner and model has its own hardware and licensing requirements. Frok alone cannot generate media.

You are responsible for your inputs, generated content and how you use or share it, including required permissions and model licenses. Frok is provided “as is,” without warranty to the extent permitted by law. Read [Legal & responsible use](../legal.md) before getting started.

## 1. Start Frok

If you have a packaged desktop build, launch it normally. Startup creates `~/frok` and installs the default pipeline definitions. On Windows, `~` means your user profile directory.

For the source build, install Node.js 24 or newer, open a terminal in the repository, and run:

```sh
npm ci
npm --prefix docs ci
npm run dev
```

Open `http://127.0.0.1:3000`. For the Electron development window instead, run `npm --prefix docs ci` once to install the offline documentation build tools, then `npm run dev:desktop`. UI edits refresh without rebuilding an installer. See [desktop development](../desktop.md) for storage differences.

## 2. Connect a service

![Frok sidebar with Envision, History, Favorites, Settings and Documentation links](/screenshots/navigation.png)

*Use Settings to connect your tools. Documentation returns to these guides.*

Open **Settings → Generate**, or use the welcome guide. Connect only the tools you want to use:

| Connection | Used for | Default when the input is empty |
| --- | --- | --- |
| Vpipe | Native image and video workflows | Workspace `~/vpipe` |
| ComfyUI | API image and video workflows | `http://127.0.0.1:8000` and the suggested local folder |
| Ollama | Optional prompt enhancement | `http://127.0.0.1:11434` |

Vpipe's workspace is the folder **containing** `models`, not `models` itself. ComfyUI and Ollama must already be running at the address you enter. Manual ComfyUI installations may use another port, such as 8188.

![Settings Generate tab showing the Vpipe model workspace, Connected status and Check connection button](/screenshots/connect-vpipe.png)

*Example of a connected Vpipe installation. Enter your workspace here, then check the connection.*

After the connection check succeeds, accept the suggested setup to select starter pipelines and queue missing preparation. You can skip this offer and choose pipelines yourself. [Connection details →](./connections.md)

## 3. Prepare a pipeline

In **Settings → Pipelines**, choose a workflow for Images, Videos or Reference videos. Only enabled compatible runners can be selected. Each capability has its own readiness state.

- **Ready:** the required model files and supported runner requirements were detected.
- **Missing dependencies:** use the preparation/download action and follow its job in Queue.
- **Needs attention:** review the message; a path, node, metadata field or preparation instruction may need fixing.

![Image and video pipeline selectors, each with a Ready status in the top-right corner](/screenshots/pipelines-ready.png)

*Readiness is separate for Images and Video. Your available pipelines may differ.*

Models can require substantial disk space and memory. Start with one image pipeline, especially on a smaller machine. Preparation can be much slower than installing Frok itself. A successful file check does not guarantee that a model will fit your GPU memory.

## 4. Optionally enhance prompts

Connect Ollama in **Generate**, then choose one of its installed text-generation models. Check **Use Prompt Enhancement**, or enable **Prompt enhancement** in generation settings; both controls share the same saved preference. Choosing an absent default model will not show Ready. There is no need for a second Ollama installation.

## 5. Make a first batch

Return to **Envision**, choose Image, open generation settings and try four images. Enter a short, specific prompt and generate. Settings remember your choices. The queue and image placeholders show what is happening.

Continue with [your first creation](../tutorials/first-creation.md). If the generate button is disabled, follow the warning to the exact missing setup item; [troubleshooting](./troubleshooting.md) covers the common cases.
