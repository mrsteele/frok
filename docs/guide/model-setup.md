# Install workflow dependencies

Frok uses runners installed on your computer. It checks their models and offers a small starter for the bundled Vpipe workflows. Install Vpipe, ComfyUI and Ollama yourself; other model and custom-node setup stays in the runner.

## Vpipe workflows

Install Vpipe and use the workspace configured in **Settings → Services → Vpipe**. Select a bundled workflow in **Generation**. If models or LoRAs are missing, **Prepare models** queues its shipped starter. It runs once in your Vpipe workspace, using the ordinary Queue for logs, cancellation and retry. Frok checks readiness when it finishes.

Gated downloads also require model access and credentials. In Frok Desktop, save a Hugging Face token under **Settings → Advanced → API tokens**, then quit and reopen Frok before preparing. For browser mode, supply `HF_TOKEN` when starting Frok. The [Krea guide](../examples/krea.md#if-models-are-missing) explains its access requirement. The queue log reports whether the token is available to Vpipe, without recording its value.

This is a basic starting point: no runtime installation, automatic repair, per-file progress or custom preparation execution. If it fails, review the log and finish setup manually. The same source files are available to copy or download:

- [Krea images](../examples/krea.md#if-models-are-missing)
- [MiniMax videos](../examples/minimax.md#video-preparation)
- [MiniMax reference videos](../examples/minimax.md#reference-video-preparation)

The example guides include the full preparation pipelines with Copy buttons, download links and exact commands. The displayed code comes directly from the source-controlled files. These files are optional manual helpers, available on request; startup and reset install only generation files and metadata in your pipeline directory. If the workflow is ready, no preparation file is needed. Only the unchanged built-in workflows offer queued preparation. Frok ignores preparation files in your editable workflow folder. For a custom workflow, follow its author's model installation instructions. Complete any fusion or quantization in Vpipe before selecting the workflow in Frok. Use the exact output paths required by the generation graph.

## ComfyUI workflows

Install the required models in your connected ComfyUI installation's `models` folder. The paths below are relative to that folder. Download sources and sizes come from the bundled workflow metadata, so they stay aligned with the generation definitions. Use the listed SHA-256 checksum to verify each download with your chosen download tool.

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
