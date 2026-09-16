# Generation providers

Frok shares workflow discovery, selection, snapshots and queue behavior across providers. A provider owns validation, readiness inspection, rendering, and optional preparation. Vpipe uses native pipeline files; ComfyUI uses API graphs. Model files stay in the runner's workspace.

## Ownership

- `definitions.ts`: browser-safe provider names, location and setup capabilities. `ProviderId` is the source of the runner type.
- `types.ts` and `registry.ts`: adapter contract and explicit registration. Rendering receives private paths, an abort signal, log reporting and a saved workflow snapshot.
- `vpipe.ts` and `comfyui.ts`: native inspection and setup. Existing rendering implementations remain in their respective library files.
- `graph-validation.ts`: supported native graph and private input/output constraints.
- `model-download.ts`: verified ComfyUI file installation. It streams sequentially, checks hashes and sizes, preserves conflicts, and removes interrupted partial files. Tokens only reach Hugging Face's authenticated origin.
- `../pipelines`: metadata, dependency declarations, discovery, bindings, request selection and setup admission.

## Adding a workflow

Keep `run.vpipeline` or `run.json` beside `meta.json` under `resources/pipelines/<kind>/<name>`. Bind every private input and output; model loaders remain authoritative for dependencies. Use a distinct ID for each flavor and retain step counts, LoRA weights and scheduling in the graph. `source.required` distinguishes image-only video workflows. A required prompt trigger belongs in `promptSuffix`, so snapshots and saved output details retain it.

Supply catalog descriptions, source links, access requirements and a setup plan. Publish sizes from verified metadata. Ratings need a testing basis and source; unknown ratings stay absent. Mark adaptations that have not been inference-tested as experimental. Update `desktop/pipelines.json`, notices, and `desktop/preparations.json` where appropriate.

Native preparations use `prepare.vpipeline`. ComfyUI uses a version-1 `prepare.json` file manifest containing the exact metadata dependencies, immutable download URLs, byte sizes and SHA-256 hashes. These setup files stay in the application bundle. Only an unchanged bundled run/metadata pair can resolve a preparation. Setup jobs save its revision and refuse a changed setup after an upgrade. Preparation files in editable user folders are never executed. A manual setup guide is required where no verified automatic plan exists.

## Adding a provider

Register its definition and adapter explicitly, then add its connection and credential configuration, dependency resolution, and native input binding. Implement cancellation and private input/output ownership in its renderer. Do not assume that a remote API supports local preparation, filesystem inspection, seed determinism or every generation mode. A cloud provider also needs explicit UI for external uploads and any costs; the current UI and connections support the two local providers only.

The registry is an extension boundary, not an executable plugin loader. Adding a definition alone does not supply the rest of a service integration. Keep unsupported capabilities explicit instead of presenting them as ready.

## Validation

Run `npm run typecheck`, `npm test`, `npm run smoke:ui` and `npm run build:desktop`. The gallery uses synthetic data and never starts inference or model downloads. Catalog tests validate graph bindings, provenance and file manifests; downloader tests use tiny mocked streams. Passing these checks does not certify model quality, runtime support or available memory. Record actual inference validation separately before removing experimental labels.
