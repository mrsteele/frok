# Releasing Frok

The repository includes a GitHub Actions workflow (`.github/workflows/release.yml`) for versioned desktop releases. Nothing runs until the project is hosted on GitHub and a matching tag is pushed.

## Before publishing installers

Publishing source and distributing desktop binaries have different prerequisites.

- Run `npm ci` and `npm --prefix docs ci`, then the source checks, synthetic tests, and documentation build. CI audits both dependency trees; Dependabot checks the application, docs, and Actions weekly.
- Build and test an unpacked app against a disposable workspace using `npm run build:desktop`, `npm run package:dir`, and `npm run smoke:desktop`. These checks do not generate media. Test installation and startup on a clean machine for every platform you intend to advertise; Apple Silicon is the initial generation target.
- Run `node scripts/check-media-tools.mjs` after the desktop build. Packaging verifies the pinned FFmpeg/FFprobe build, H.264/AAC encoders, source checksums, build recipe and license files. It rejects nonfree builds. The source archives and recipe ship alongside the commands; preserve them in every installer. Do not substitute a local system binary.
- Review `.desktop/licenses/dependencies.json` and the supplied notices copied into `.desktop/licenses`. Preserve Electron/Chromium and Node notices too. Native package license identifiers alone do not supply every component's notices or corresponding source; check the Sharp/libvips component inventory for each platform before distributing installers.
- macOS releases are unsigned and not notarized. No Apple account, certificate or signing secrets are required. Test a downloaded installer on a clean Mac, including the first-launch approval described below.
- Once the repository exists, enable private vulnerability reporting, secret scanning/push protection, and branch protection requiring Source checks. These are GitHub repository settings and cannot be enabled by committing configuration alone.

Do not publish the generated draft until these checks are complete. Local builds generate update metadata but never upload releases.

### Unsigned macOS releases

The GitHub workflow explicitly disables signing. macOS may block the first launch because the developer cannot be verified. After attempting to open Frok, users who trust the download can use **System Settings → Privacy & Security → Open Anyway** when available. See [Apple’s instructions](https://support.apple.com/en-us/102445).

Unsigned macOS builds do not use the current in-app updater. To update, quit Frok, download the new release, and replace the app in Applications. The library and settings remain in the user workspace. Windows and Linux retain their existing update support.

The packaging code still supports optional signed local builds through `FROK_SIGN_RELEASE=1`, with `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. These are not needed by the unsigned release workflow.

## Choose and tag a version

`package.json` is the source of the application version. npm maintains its matching lockfile entries. The private documentation package has no release version, and the guides do not repeat the current application version.

1. Run the checks in [Contributing](./development.md), review the staged changes, and commit the release-ready code.
2. To advance the version, run `npm version patch`, `npm version minor`, or `npm version major` in a clean checkout. npm updates both package files, commits them and creates the matching tag. Stay on a pre-major version for as long as development needs; a major bump is an explicit maintainer decision.
3. To release the version already in `package.json` without a bump, create its tag instead. In a POSIX shell (including Git Bash on Windows):

   ```sh
   git tag -a "v$(node -p 'require("./package.json").version')" -m "Release"
   ```

4. Push the commit and that version's tag:

   ```sh
   git push origin HEAD
   git push origin "v$(node -p 'require("./package.json").version')"
   ```

GitHub verifies that the tag, `package.json`, and `package-lock.json` agree before building the platform matrix defined in `.github/workflows/release.yml`. Successful builds and smoke checks produce a **draft release** with installers, update manifests, blockmaps, generated release notes and `SHA256SUMS.txt`. The release collector merges the Apple Silicon and Intel downloads into one macOS manifest and verifies download hashes. Review and test the installers, then publish the draft.

Prereleases are supported and marked accordingly. A failed platform build prevents creation of the release. Rerunning can update an existing draft, but refuses to overwrite a published release. The manual workflow trigger must also be run against a version tag, not a branch.

This is explicit semantic versioning: maintainers choose patch/minor/major rather than having commit messages determine the version automatically. No release is uploaded from a local build. `release/` is ignored temporary output used by both local packaging and GitHub runners; do not commit its contents.

Build jobs have read-only repository permissions. Only the final draft-release job receives `contents: write`, using GitHub's built-in token. The workflow uses the current repository name, so no hard-coded GitHub repository or personal access token is required.

Before accepting contributions, enable GitHub private vulnerability reporting and secret scanning/push protection where available. Protect `main` with pull-request review and the Source checks workflow. Keep the repository's existing `LICENSE` and `COPYRIGHT` files when publishing.

## In-app updates

Installed Windows and Linux releases, and optionally signed macOS builds, check GitHub for stable updates on launch and periodically while open, then download them in the background. **Restart to update** installs the downloaded release and reopens Frok. If a job is running, the user can finish that job before restarting or postpone the update. Remaining queued jobs, the library and settings stay in the workspace. Models stay with their configured runners. Updates never force a restart while rendering.

The update feed uses the CI repository automatically; local packaging uses the repository link in `desktop/product.mjs`. Keep the ZIP downloads, update manifests and blockmaps attached when publishing a draft. A draft or prerelease is not offered to stable installations. Public downloads need no user GitHub token; private repositories are not supported as a public update feed.

macOS updates require Developer ID signing with the same identity across versions. The unsigned macOS releases produced by this workflow and `npm run dev:desktop` leave updates disabled. Windows uses the NSIS installer; Linux uses the AppImage. The updater is bundled into the desktop shell, and packaging still uses `--publish never`—only the release workflow uploads files.

For platforms with in-app updates enabled, verify an actual upgrade between two releases on a disposable workspace (using the same signing identity for signed macOS builds): download progress, postponing a restart, finishing an active job, relaunching, and retained library/queue data. Synthetic tests cover update state, packaging, manifest integrity and restart ordering; they do not replace an installed upgrade test. See the [electron-builder update guide](https://www.electron.build/v26/docs/features/auto-update/).

References: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create), [electron-builder packaging](https://www.electron.build/v26/docs/cli/).
