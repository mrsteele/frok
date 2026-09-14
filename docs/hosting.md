# Build and host the documentation

This is a standalone VitePress project inside `docs`. It has its own dependencies, lockfile, configuration, search index and static build. No Frok server or model runner is required to view it.

## Develop locally

From the repository root:

```sh
cd docs
npm ci
npm run dev
```

Open the local URL printed by VitePress, normally `http://127.0.0.1:5173`. Markdown and theme changes reload while you work. Search runs locally with a generated index, without an external search account.

## Build and preview

```sh
npm run build
npm run preview
```

The static site is written to **`docs/.vitepress/dist`**. Preview serves that built output, normally on port 4173. The build checks internal page links; keep failures visible rather than disabling dead-link checks.

The site uses `.html` links so it can run on a basic static host without extensionless-route rewrites. Upload the contents of the output directory, including assets, downloadable examples and `404.html`.

## Choose a domain or subdirectory later

The desktop app builds this same source into `.desktop/docs` with a root base path and bundles it in the installer. **Help → Documentation** opens that local copy, including search and examples. Run `npm run build:docs:desktop` from the repository root to refresh it independently. This does not replace the public build in `.vitepress/dist`.

After hosting the public site, set `websiteUrl` in `desktop/product.mjs` and rebuild the desktop app to enable **View online**. Include any public base path. This is release metadata, so users do not need an environment variable. Documentation continues opening locally first.

The default base path is `/`, suitable for a dedicated domain. For a subdirectory such as `/frok/`, set **`DOCS_BASE=/frok/`** in the build environment. It must begin and end with a slash. Rebuild after changing it.

Set **`DOCS_SITE_URL`** to the real public site URL when one exists to emit a sitemap. A domain is intentionally not hard-coded. No analytics, deployment credentials, deployment workflow or in-app documentation URL is configured yet.

On a static host, use these project settings:

| Setting | Value |
| --- | --- |
| Project/build root | `docs` |
| Install | `npm ci` |
| Build | `npm run build` |
| Output relative to build root | `.vitepress/dist` |
| Node | Version pinned in `.node-version` at the repository root |

## Maintain the example downloads

Example downloads are refreshed from `resources/pipelines` whenever VitePress starts or builds, including the copies bundled with the app. Edit the factory workflow rather than its generated copy in `docs/public/examples`. `npm run examples` inside `docs` also refreshes them without building. Only the named factory examples are copied; the script never reads the user's pipeline directory or generated library.

Review the changed examples and their guide pages together. Do not place real prompts, private workflows or credentials under `public`: every file there is published verbatim.

VitePress references: [static deployment](https://vuejs.github.io/vitepress/v1/guide/deploy) and [local search](https://vuejs.github.io/vitepress/v1/reference/default-theme-search).

## Homepage demonstration

The homepage uses `docs/public/demo/sailboat.webp` and `sailboat.mp4`. Its typing, mouse movement and render progress are staged; the media are example Frok outputs. Replacement clips should remain silent, short and within the source audit's size limit. The walkthrough pauses while hidden and shows a still image for reduced-motion preferences. Rebuild the docs after replacing the media.

Only the explicitly allowed demonstration video belongs in source control; personal renders remain ignored.
