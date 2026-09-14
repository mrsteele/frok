# Frok

A local creative studio for images and short videos. Generate image batches, animate a frame, make videos from text or references, and keep every take together in your library.

Frok connects to your installations of [Vpipe](https://vpipe.ai/), [ComfyUI](https://www.comfy.org/) and, optionally, [Ollama](https://ollama.com/) for prompt enhancement. Your library and queue live on your machine. Generation uses your chosen runners, models and hardware.

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

- [Quick setup](docs/guide/getting-started.md) and [your first creation](docs/tutorials/first-creation.md)
- [Images](docs/guide/images.md), [videos and references](docs/guide/videos.md), and [upscaling](docs/tutorials/upscaling.md)
- [Library and asset links](docs/guide/library.md), [queue and logs](docs/guide/queue.md), and [storage and backups](docs/storage.md)
- [Custom pipelines](docs/pipelines.md) and [troubleshooting](docs/guide/troubleshooting.md)

The same guides are available through **Documentation** in the app. To work on the documentation site, see [docs development and hosting](docs/hosting.md).

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow, [SECURITY.md](SECURITY.md) for vulnerability reports, and the [release guide](docs/releasing.md) for publishing installers.

Licensing and attribution are in [LICENSE](LICENSE), [COPYRIGHT](COPYRIGHT) and [third-party notices](THIRD_PARTY_NOTICES.md).
