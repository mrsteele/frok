# Install workflow dependencies

Frok uses runners installed on your computer. Open a workflow selector in **Settings → Generation** to compare workflows for Vpipe and ComfyUI, choose a flavor, and review its requirements. Each model choice shows speed and adherence ratings, download size, and setup status. Install the runners yourself; models stay in their workspaces.

## Choose a model and flavor

Filter by provider or search a model family. The catalog includes Krea, FLUX Klein, Qwen Image, MiniMax, Wan 2.2 and LTX workflows, alongside the upscalers. Availability differs by runner. A flavor fixes the model, LoRAs, sampler and step count together; switching flavors can change motion and appearance even with the same seed.

Each entry shows its purpose, precision, required files, setup instructions and access requirements. **Full download** is the total for that workflow, including shared files; preparation reuses matching installed files. Installed size, temporary preparation space and runtime memory are separate estimates when a source provides them. An unknown value is shown as **Not specified**. Speed and prompt adherence remain **Unrated** unless metadata includes a rating with a source and testing basis. They are not universal performance promises.

Access icons describe **remaining downloads**, not whether a model was originally gated:

- **No icon:** no gated download is needed, including models already installed.
- **Orange closed lock:** a required download needs a token, or Hugging Face has denied access.
- **Green open lock:** Hugging Face confirmed this token can read the required model repositories. Files still need to be downloaded.

An unchecked token or unknown requirement stays neutral, without a lock. Open the model details and use **Check download access** to verify permission without downloading weights. Frok only contacts Hugging Face for this check when you request it; the result expires after five minutes. A failed connection is an error, not proof of denied access. Disconnected runners and custom or prepared models whose download sources cannot be verified also remain neutral.

For gated downloads, the token's account must have model access: accept any required terms on the model page and wait for publisher approval if required. Save a token with read access to that repository in **Settings → Advanced → API tokens**, then restart Frok. Token permissions and model approval are separate requirements; a saved token alone does not prove access. Already installed models run without a token, and their license still applies. See Hugging Face's [gated-model guide](https://huggingface.co/docs/hub/models-gated) and [token permissions](https://huggingface.co/docs/hub/security-tokens).

**Experimental** entries are adapted from upstream examples and have not been inference-tested in Frok. Check their requirements before downloading: some video workflows need tens of gigabytes of model storage and substantial working memory. Choosing a workflow never starts a download. Use **Prepare models** explicitly after reviewing its details.

You can always manage the native run file and `meta.json` yourself under **Advanced → Workflow files**. Custom workflows remain first-class choices in the same catalog; see [pipeline configuration](../pipelines.md).

## Vpipe workflows

Install Vpipe and use the workspace configured in **Settings → Services → Vpipe**. Select a bundled workflow in **Generation**. If models or LoRAs are missing, **Prepare models** queues its shipped starter. It runs once in your Vpipe workspace, using the ordinary Queue for logs, cancellation and retry. Frok checks readiness when it finishes.

Gated downloads also require model access and credentials. In Frok Desktop, save a Hugging Face token under **Settings → Advanced → API tokens**, then quit and reopen Frok before preparing. For browser mode, supply `HF_TOKEN` when starting Frok. The [Krea guide](../examples/krea.md#if-models-are-missing) explains its access requirement. The queue log reports whether the token is available to Vpipe, without recording its value.

Vpipe preparation uses a bundled native pipeline for downloads and any required quantization. It does not install runtimes or plugins, repair arbitrary installations, or execute custom preparation files. When a flavor shares an already prepared base, its starter can fetch just the additional LoRA. If preparation fails, review the log and finish setup manually. The original example files are available to copy or download:

- [Krea images](../examples/krea.md#if-models-are-missing)
- [MiniMax videos](../examples/minimax.md#video-preparation)
- [MiniMax reference videos](../examples/minimax.md#reference-video-preparation)
- [FlashVSR and VOSR upscaling](../tutorials/upscaling.md#prepare-native-upscalers-manually)

The example guides include the full preparation pipelines with Copy buttons, download links and exact commands. The displayed code comes directly from the source-controlled files. These files are optional manual helpers, available on request; startup and reset install only generation files and metadata in your pipeline directory. If the workflow is ready, no preparation file is needed. Only the unchanged built-in workflows offer queued preparation. Frok ignores preparation files in your editable workflow folder. For a custom workflow, follow its author's model installation instructions. Complete any fusion or quantization in Vpipe before selecting the workflow in Frok. Use the exact output paths required by the generation graph.

The native LTX-2.5 option requires the compatible [Vpipe LTX-2.5 plugin](https://github.com/tgo-app-dev/vpipe-ltx-2.5). Install it as `plugins/vpipe-ltx-2.5.so` in the configured Vpipe workspace. Frok passes that plugin explicitly to Vpipe; it does not build or download plugin code.

## ComfyUI workflows

Choose the matching local ComfyUI folder under **Settings → Services**. For unchanged bundled workflows with verified file manifests, **Prepare models** queues sequential downloads into that installation's `models` folder. Files are pinned to source revisions and checked against expected byte counts, SHA-256 checksums and safetensors headers before publication. Logs show file progress. Existing matching files are reused; conflicting files are preserved for you to review. Cancelling removes the current temporary download and keeps files that already finished.

Install required custom nodes yourself. Preparation never installs Python packages or custom-node code. Real-ESRGAN currently uses manual setup because its upstream release does not provide a pinned checksum in this catalog.

You can also install the required models manually in your connected ComfyUI installation's `models` folder. The paths below are relative to that folder. Download sources and sizes come from the bundled workflow metadata, so they stay aligned with the generation definitions. Use the listed SHA-256 checksum to verify each download with your chosen download tool.

For SeedVR2, first follow the [extension installation instructions](../tutorials/upscaling.md#choose-an-ai-upscaler). Other missing node classes are listed by Frok; install them in ComfyUI. Restart ComfyUI after installing nodes or models, then refresh workflows in Frok.

<script setup>
import { data as workflows } from '../.vitepress/model-requirements.data.mjs'
</script>

<section v-for="workflow in workflows" :key="workflow.id">
  <h3>{{ workflow.name }}</h3>
  <ul>
    <li v-for="dependency in workflow.dependencies" :key="dependency.reference">
      <a v-if="dependency.url" :href="dependency.url">{{ dependency.reference }}</a>
      <code v-else>{{ dependency.reference }}</code>
      <p v-if="dependency.size">Expected size: {{ dependency.size.toLocaleString('en-US') }} bytes.</p>
      <p v-if="dependency.sha256">SHA-256: <code style="overflow-wrap: anywhere">{{ dependency.sha256 }}</code></p>
    </li>
  </ul>
</section>

For a custom workflow, use its `meta.json` dependency list and the author's instructions. Frok also checks supported model-loader inputs. If an old custom workflow lists extra requirements only in `prepare.json`, move those declarations into `meta.json` under `dependencies`; preparation companions are ignored.

## Ollama prompt models

Install a compatible text-generation model using Ollama's app or CLI, for example `ollama pull <model-name>`. In **Settings → Services → Ollama**, choose **Refresh installed models**, then select the installed model. If you do not want a prompt model, choose **None · Enhancement off**.

## Existing installations and old jobs

Startup does not change your runner model folders; running a starter writes its declared models there. Previously completed installation-job logs remain available until normal job retention removes them. Older installation jobs are cancelled when the updated worker starts and cannot be retried. Queue a new built-in starter if needed. Any partial model files left by an earlier installation should be completed or cleaned up through the runner; Frok does not delete shared runner files.

On the next startup, Frok removes unchanged preparation files recorded by older installers from bundled workflow folders, including their older flat filenames. Edited or manually added copies are preserved and no longer managed by Frok.
