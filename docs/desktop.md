# Frok Desktop

Frok Desktop wraps the same Next.js interface and local queue worker used by the browser app. The initial packaged target is Apple Silicon macOS. Windows NSIS and Linux AppImage packaging configurations are included, but require builds and runner testing on those platforms before distribution.

## Development

Install Node.js 24 or newer and run `npm ci` and `npm --prefix docs ci` in the project directory. The second command installs the separate documentation build tools.

| Command | Use |
| --- | --- |
| `npm run dev` | Browser development at `http://127.0.0.1:3000`, with Next.js Fast Refresh. |
| `npm run dev:desktop` | Electron with the same live Next.js UI, normally on port 3441. |
| `npm run build:desktop` | Compile the standalone backend and worker, prepare the desktop payload and portable Node runtime. |
| `npm run package:dir` | Package the already-built payload into an unpacked application under `release/`. |
| `npm run package` | Build the payload and produce the platform installer/archive. Never publishes. |
| `npm run test:desktop` | Fast workspace, native-access policy and worker-control checks. |
| `npm run smoke:desktop` | Start the built backend in disposable storage and verify startup, authentication and shutdown without generating media. |
| `npm run build:docs:desktop` | Rebuild only the bundled offline help. |
| `npm run smoke:docs` | Check the built help in an isolated Electron window: navigation, search, downloads and blocked network access. Requires a graphical session. |

UI edits refresh in the browser or Electron without packaging. Restart desktop development after changing the Electron main process, preload bridge, supervisor or queue worker. Reloading the UI does not restart the worker or interrupt generation. Use the native View menu to open development tools.

Desktop development uses `.data/desktop-dev/` for media, settings and the app profile, and `.data/desktop-next/` for Next.js development output. Working pipelines are shared with the installed app and web development at `~/frok/pipelines` unless an explicit `FROK_HOME` selects another workspace. It does not adopt the browser app's existing `.data` library. You can run the browser and desktop development interfaces independently. An authenticated desktop backend is intentionally accessible only through its Electron window; use `npm run dev` for ordinary browser testing.

## Offline documentation

Open **Help → Documentation** (F1), **Quick Setup**, or **Pipeline Guide** in the desktop menu. Settings also includes a Documentation button. Guides, local search, illustrations and downloadable pipeline examples ship inside the application and open in a separate window without an internet connection. This copy matches the installed Frok version and updates when you install a newer app.

The documentation window is separate from the studio session and cannot access its API, workspace bridge or credentials. HTTPS links to external resources open in your system browser; those destinations still need internet access.

The public website address belongs to release metadata in `desktop/product.mjs`. Once `websiteUrl` is configured and a new desktop build is made, **View online** opens the current guide and section in the system browser. No public address is configured by default; offline help remains the default.

Desktop development and packaging build the static docs into `.desktop/docs`, independently of the public site output. After editing docs with the desktop app open, run `npm run build:docs:desktop` and reopen Documentation. For rapid docs editing, use the separate `npm --prefix docs run dev` server with live reload. Public hosting builds remain unchanged.

## Workspace and first launch

The packaged app creates `~/frok` during startup, using the current OS user's home directory. On Windows this means the `frok` folder inside the user's profile. Every launch checks for missing directories; no privileged installation script is needed.

```text
~/frok/
  pipelines/
    image/
    video/
    reference/
    upscale/
  data/                   # Single local library, queue and managed model runtimes
  desktop-profile/        # Persistent Electron cookies and localStorage
  logs/
  pipeline-updates/       # New bundled definitions that conflict with local edits
  .pipeline-state.json    # Hashes of the last installed bundled pipeline files
  credentials.json        # OS-encrypted API tokens; excluded from backups
  .env                    # Optional legacy/developer overrides
  window.json             # Last window size
```

Use **Settings → Generate → Frok Desktop** or **Frok → Open Pipelines Folder** to open the pipeline directory. The Help menu also opens logs and pending pipeline updates. Add custom workflows and their matching metadata/prepare companions as a named folder within the relevant service folder, then refresh Settings → Pipelines.

Only the explicit groups in `desktop/pipelines.json` are included in installers. Personal `*.local/` folders and older `*.local.*` files and other unlisted workflows are excluded. The first launch copies the defaults; subsequent launches update untouched bundled groups. If any companion was edited, the entire group is preserved and the new version is placed under `pipeline-updates` for manual review. Normal startup never overwrites or removes custom workflows; the explicit factory-reset action does remove custom files inside the default pipeline folder. No pipeline is executed or model downloaded by workspace initialization.

For a different workspace, set an absolute `FROK_HOME` **before launching** the app. For example, during development:

```sh
FROK_HOME="$PWD/.data/my-desktop-workspace" npm run dev:desktop
```

The workspace must be a dedicated directory, not the entire home directory or filesystem root. Files in the workspace belong to the current OS user. Administrator pipelines are available to this installation; all content and settings belong to one local studio.

Configure runner locations directly in **Settings → Generate**. The Vpipe workspace defaults to `~/vpipe`; older managed workspaces are retained. ComfyUI Desktop defaults to the operating system’s Documents/ComfyUI folder and port 8000. Both can be changed and checked without restarting. Finish queued work before changing a location. Frok rechecks model availability after saving, and never moves model files.

Configure connection addresses, model workspaces, pipelines and generation preferences in Settings. Live image previews and job timeout are under **Settings → Generate → Generation preferences**. Timeout changes apply to the next render; model downloads keep their separate timeout.

On the first launch after upgrading, Frok imports non-secret environment defaults into the library once. Saved connection and pipeline choices take priority, including explicit blanks that select device defaults. Old workflow model names and directory mappings remain available for compatible queued jobs. Later `.env` edits do not replace these saved preferences. A library reset clears them without importing the old environment values again.

The repository's `.env.local` is not copied into the desktop workspace. Optional workspace `.env` files still support developer binary and startup overrides; users do not need to create one.

Ollama normally runs independently. In **Settings → Generate → Ollama**, connect its local address and choose an installed text model. The default is `http://127.0.0.1:11434`. Frok does not stop your existing Ollama service, copy its models, or automatically download a starter model.

To use a separate Frok-managed runtime, turn on **Let Frok start Ollama** under **Generation preferences**, save, and quit and reopen Frok. Its default address is `http://127.0.0.1:11435`; a custom Ollama address saved in Settings also controls the managed launcher. The runtime and its model store remain in the workspace data directory. Install-runtime and starter-model controls appear when this option is enabled. Startup changes require the queue to be idle. Existing model directories are kept when switching modes.

### API tokens

In Frok Desktop, save a Hugging Face token or ComfyUI bearer token in **Settings → Generate → API tokens**. Frok encrypts tokens through Electron's `safeStorage` using the operating system's keychain. Secure storage must be available; Linux's insecure `basic_text` fallback is not accepted. Token values are never returned to the page or included in library backups. Quit and reopen Frok after saving or removing one; running jobs retain their startup credentials.

Existing tokens in the desktop launch environment or workspace `.env` are imported into encrypted storage when it is available. The original environment file is left intact; once the token shows **Configured**, you can remove the old plaintext entry. Saved tokens take priority, and removing a saved token prevents an old environment entry from restoring it. Library resets keep API tokens; remove them explicitly in Settings if desired.

## Background behavior

- Closing the window hides it and leaves the queue running in the menu bar/system tray.
- Opening Frok again brings back the same instance and library.
- The tray shows whether rendering is active and the number of queued jobs.
- Quit during rendering offers **Keep Running**, **Finish This Job, Then Quit**, or **Stop Rendering and Quit**. Finishing the current job stops additional jobs from starting; queued jobs remain saved for the next launch.
- Reloading the window preserves the backend. The app requests protection from idle app suspension while rendering; lid closure, forced sleep, power loss and OS shutdown can still interrupt a job.
- Explicit Quit stops the app and its owned services. Running after Quit, login autostart and a standalone OS background daemon are not included.

The desktop origin is stable: port 3440 for packaged builds and 3441 for desktop development. If occupied, startup reports the conflict instead of silently opening another service or changing ports. `FROK_DESKTOP_PORT` can override this through the launch environment or workspace `.env`; changing it creates a different browser origin and can reset window preferences such as volume.

## Packaging and future releases

The payload includes Electron, the built UI/backend/worker, an official Node.js 24 runtime verified against the provider's SHA-256 checksums, and FFmpeg/FFprobe built from pinned sources. It does not require end users to install Git, npm, Node, FFmpeg or a compiler. AI runners and models remain separate setup-time dependencies. Media tools include their source archives, build recipe and license texts inside the backend resources.

Build on the target platform/architecture with Node.js 24+. Build artifacts are ignored by Git. Native binaries and supporting libraries must be tested on a clean machine. Local unsigned Mac builds are useful for development; public distribution needs signing, notarization and license/source-distribution review, including Electron and Sharp dependencies. No signing credentials are committed.

**In-app updates remain unwired.** The native menu and Settings show an inactive update placeholder. The app does not poll GitHub or download updates. Local packaging still uses `--publish never`.

The new release workflow (`.github/workflows/release.yml`) builds tagged versions on GitHub, with macOS ARM64/x64, Windows x64 and Linux x64 runners. It attaches installers and SHA-256 checksums to a draft GitHub release. See [Releasing Frok](releasing.md). `release/` is ignored temporary build output, including on the CI runner; binaries belong in GitHub Releases, not the source repository.

Signing/notarization and the in-app updater still need configuration before public distribution. A future updater must drain the queue before restarting and preserve the workspace.

## Desktop boundary

The renderer uses context isolation and sandboxing, with Node integration disabled. Its preload bridge exposes only version/workspace information, three fixed folder-opening actions and documentation page navigation. IPC validates the exact window, main frame and origin. Documentation uses a separate session and a dedicated static-file protocol confined to its bundled site. External HTTPS links open in the system browser; executable and filesystem URL schemes are rejected. Browser permissions are denied by default.

The backend binds only to loopback and requires a random, per-launch desktop token, attached by Electron outside page JavaScript. Host, Origin and mutation-request checks protect the local API; no browser account is required. The UI cannot invoke the supervisor's privileged queue-control messages. Do not remove those checks when adding desktop features.

**Delete all my stuff** resets the entire library and app preferences. Models, runners, pipeline files, encrypted API tokens and optional environment files are kept. Replacing or uninstalling the application leaves the workspace intact.

## Pipeline location and factory reset

The editable pipeline location and directory audit live at the top of **Settings → Pipelines**. Blank uses `~/frok/pipelines`; **Save & scan** selects an existing custom folder. Native **Open Pipelines Folder** follows the saved choice. Reset always targets the default folder, asks for confirmation, stages a complete factory replacement first and leaves custom locations and model workspaces alone. App installers carry an explicit factory copy from `resources/pipelines`; editable user files are never packaged.
