<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/public/mark-light.svg">
  <img src="public/brand/mark.svg" alt="Frok logo" width="64" height="64">
</picture>

# Frok

[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE) [![Downloads: GitHub Releases](https://img.shields.io/badge/downloads-GitHub_Releases-267449)](https://github.com/mrsteele/frok/releases) [![Source checks](https://github.com/mrsteele/frok/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/mrsteele/frok/actions/workflows/ci.yml)

A local creative studio for images and short videos. Generate image batches, animate a frame, make videos from text or references, and keep every take together in your library.

Frok connects to your installations of [Vpipe](https://vpipe.ai/), [ComfyUI](https://www.comfy.org/) and, optionally, [Ollama](https://ollama.com/) for prompt enhancement. Your library and queue live on your machine. Generation uses your chosen runners, models and hardware.

**[Documentation](https://mrsteele.github.io/frok/) · [Download Frok](https://github.com/mrsteele/frok/releases) · [Source code](https://github.com/mrsteele/frok)**

## Download

**[Download Frok from GitHub Releases](https://github.com/mrsteele/frok/releases).** Open a published release and choose your installer under **Assets**:

- **macOS:** `.dmg` — choose `arm64` for Apple Silicon or `x64` for Intel.
- **Windows (x64):** `.exe` installer.
- **Linux (x64):** `.AppImage` — make the file executable before opening it.

Install and open Frok, then follow [Quick setup](https://mrsteele.github.io/frok/guide/getting-started.html) to connect your generation tools. For macOS first-launch permissions, see the [installation notes](https://mrsteele.github.io/frok/releasing.html#macos-releases-without-apple-signing).

If no published release is listed yet, use [Run from source](#run-from-source) below.

## Run from source

Use the Node.js version in [.node-version](.node-version) and install the [media build prerequisites](docs/development.md#bundled-video-tools). From the repository root:

```sh
npm ci
npm --prefix docs ci
npm run dev
```

Open the local address printed in the terminal. For the Electron window, use `npm run dev:desktop` instead. See the [development guide](docs/development.md) for configuration, testing and builds.

User data lives in `~/frok`: assets, job files/logs, recipes, generation settings and editable pipelines. Encrypted credentials, app diagnostics, window placement and Electron’s internal browser profile use the OS application-data folder. AI runners and their models are installed and managed separately; Frok has no model store. Source development and the installed app share the user workspace by default; stop one before starting the other.

On first launch, **Quick setup** helps you connect services and choose optional generation workflows. Settings keeps **Services**, **Generation**, **Recipes**, and **Advanced** separate; exports and library deletion live in Advanced.

## Learn the workflow

- [Quick setup](https://mrsteele.github.io/frok/guide/getting-started.html) and [your first creation](https://mrsteele.github.io/frok/tutorials/first-creation.html)
- [Images](https://mrsteele.github.io/frok/guide/images.html), [videos and references](https://mrsteele.github.io/frok/guide/videos.html), and [upscaling](https://mrsteele.github.io/frok/tutorials/upscaling.html)
- [Library and asset links](https://mrsteele.github.io/frok/guide/library.html), [queue and logs](https://mrsteele.github.io/frok/guide/queue.html), and [storage and backups](https://mrsteele.github.io/frok/storage.html)
- [Custom pipelines](https://mrsteele.github.io/frok/pipelines.html) and [troubleshooting](https://mrsteele.github.io/frok/guide/troubleshooting.html)

The same guides are available through **Documentation** in the app. To work on the documentation site, see [docs development and hosting](docs/hosting.md).

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, [SECURITY.md](SECURITY.md) for vulnerability reports, and the [release guide](docs/releasing.md) for publishing installers.

Licensing and attribution are in [LICENSE](LICENSE), [COPYRIGHT](COPYRIGHT) and [third-party notices](THIRD_PARTY_NOTICES.md).
