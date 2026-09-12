# Releasing Frok

The repository includes a GitHub Actions workflow (`.github/workflows/release.yml`) for versioned desktop releases. Nothing runs until the project is hosted on GitHub and a matching tag is pushed.

## Before publishing installers

Publishing source and distributing desktop binaries have different prerequisites. The first version remains **0.1.0**.

- Run `npm ci` and `npm --prefix docs ci`, then the source checks, synthetic tests, and documentation build. CI audits both dependency trees; Dependabot checks the application, docs, and Actions weekly.
- Build and test an unpacked app against a disposable workspace using `npm run build:desktop`, `npm run package:dir`, and `npm run smoke:desktop`. These checks do not generate media. Test installation and startup on a clean machine for every platform you intend to advertise; Apple Silicon is the initial generation target.
- Run `node scripts/check-media-tools.mjs` after the desktop build. Packaging also checks that the backend contains no standalone FFmpeg/FFprobe commands or installer dependencies. Users install these tools separately; do not copy a local installation into a release.
- Review `.desktop/licenses/dependencies.json` and the supplied notices copied into `.desktop/licenses`. Preserve Electron/Chromium and Node notices too. Native package license identifiers alone do not supply every component's notices or corresponding source; check the Sharp/libvips component inventory for each platform before distributing installers.
- Configure a Developer ID certificate and Apple notarization for public macOS installers. Local packaging is unsigned by default. The opt-in signing configuration enables hardened runtime and notarization and refuses unsigned fallback when credentials are missing. Verify the signed result on a Mac that has never run Frok. Follow the [electron-builder v26 signing and notarization guide](https://www.electron.build/v26/docs/notarization/). Windows signing also needs its own credentials.
- Once the repository exists, enable private vulnerability reporting, secret scanning/push protection, and branch protection requiring Source checks. These are GitHub repository settings and cannot be enabled by committing configuration alone.

Do not publish the generated draft until these checks are complete. Local builds do not upload releases or configure an in-app update feed.

### Enable macOS release signing

In GitHub repository settings, add the secrets `MAC_CSC_LINK` (the base64-encoded Developer ID `.p12` certificate), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Then set the Actions variable `FROK_SIGN_MACOS` to `true`. Keep credentials out of source files and release notes.

The workflow passes them only to macOS packaging steps. For a local signed build, export the equivalent `CSC_LINK`, `CSC_KEY_PASSWORD`, and `APPLE_*` variables in your shell and set `FROK_SIGN_RELEASE=1` before `npm run package`. Actual signing and notarization require your Apple credentials; synthetic tests verify the configuration but cannot certify a signed installer.

## First release: 0.1.0

Both `package.json` and `package-lock.json` already declare **0.1.0**. Keep that version for the first release; do not run a version-bump command first.

Once the GitHub repository exists and your release-ready code is committed and pushed, tag that commit and push only that tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

This starts the workflow below and creates a draft **Frok 0.1.0** release when its checks pass. Creating the GitHub repository or pushing ordinary commits does not increment the version.

## Later releases

Stay on `0.x` for as long as development needs: `npm version patch` moves `0.1.0` to `0.1.1`, while `npm version minor` moves it to `0.2.0`. Minor releases can continue through `0.10.0` and beyond without becoming `1.0.0`. Choose `npm version 1.0.0` only when you are ready for that milestone; `npm version major` would also advance a `0.x` version to `1.0.0`.

Before the first push, run `npm run check:source`, `npm run typecheck`, `npm test`, and the documentation build. Review the staged diff and file list; the scanner is a guard against common mistakes, not a guarantee that every secret is detectable. Keep the initial package version at **0.1.0** and tag that reviewed commit `v0.1.0`.

1. Update the version with `npm version patch`, `npm version minor`, or `npm version major` in a clean Git checkout. npm updates both package files, commits them and creates the matching `v` tag.
2. Push the version commit and its tag. For example, after preparing `0.2.0`, push `v0.2.0` explicitly.
3. GitHub validates that the tag, `package.json`, and `package-lock.json` agree, then builds on macOS ARM64, macOS Intel, Windows x64 and Linux x64.
4. When all builds and smoke checks pass, the workflow creates a **draft release** containing the installers, generated release notes, and `SHA256SUMS.txt`.
5. Review and test the installers, then publish the draft on GitHub. Configure signing and macOS notarization before distributing public builds.

Prereleases such as `v0.3.0-beta.1` are supported and marked accordingly. A failed platform build prevents creation of the release. Rerunning can update an existing draft, but refuses to overwrite a published release. The manual workflow trigger must also be run against a version tag, not a branch.

This is explicit semantic versioning: maintainers choose patch/minor/major rather than having commit messages determine the version automatically. No release is uploaded from a local build. `release/` is ignored temporary output used by both local packaging and GitHub runners; do not commit its contents.

Build jobs have read-only repository permissions. Only the final draft-release job receives `contents: write`, using GitHub's built-in token. The workflow uses the current repository name, so no hard-coded GitHub repository or personal access token is required.

Before accepting contributions, enable GitHub private vulnerability reporting and secret scanning/push protection where available. Protect `main` with pull-request review and the Source checks workflow. Set the repository license to the included GPL-3.0-only terms; do not replace it with GitHub's default template.

The in-app updater remains disabled. Publishing releases and having the installed app discover/apply them are separate features.

References: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create), [electron-builder packaging](https://www.electron.build/v26/docs/cli/).
