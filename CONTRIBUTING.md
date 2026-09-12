# Contributing to Frok

Bug reports, documentation, workflow examples, accessibility improvements and code contributions are welcome. Frok is maintained by Matt Steele.

For a substantial feature or architectural change, open an issue first so we can agree on the intended behavior. Keep pull requests focused and explain what changed, why, and how you checked it.

## Develop locally

Use Node.js 24 or newer. Run `npm ci` and `npm --prefix docs ci`, then `npm run dev` for the web interface or `npm run dev:desktop` for Electron. Both modes build the bundled documentation before starting. External generation services are only needed when you actually want to generate media.

See [the development guide](docs/development.md) for the source layout and commands. Read `AGENTS.md` and the installed Next.js documentation before changing framework behavior.

## Validate a change

- Run `npm run typecheck` and the focused tests relevant to the change.
- Run `npm run check:source` before committing. It checks candidate source files without reading ignored library content and never prints matched secret values.
- For documentation, run `npm --prefix docs run build`.
- Use synthetic fixtures and disposable test storage. UI changes do not need real image/video inference or model downloads.
- Keep generated assets, models, personal pipelines, credentials, local configuration and build output out of the repository.

Include reproduction steps and useful, redacted logs in bug reports. Do not upload your library database or private prompts. Report security issues through the process in [SECURITY.md](SECURITY.md).

The docs pin a patched Vite 6 release through `overrides` while VitePress 1.x still depends on Vite 5. Its Vue plugin supports Vite 6. When updating VitePress, reassess this override and verify the docs build and development server as well as `npm --prefix docs audit`.

## Licensing

Contributions are accepted under **GPL-3.0-only**, the same license as Frok. You retain copyright in your contribution; there is no copyright assignment. Only submit work you have permission to share under these terms. Identify third-party material and preserve its notices.

Models and external services have independent licenses. Do not add model weights, service binaries or credentials to a pull request. See [COPYRIGHT](COPYRIGHT), [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
