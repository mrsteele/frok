# Storage, privacy and backups

<script setup>
import { retentionDefaults } from '../desktop/preferences.mjs'
</script>

Frok is a single-user local studio. Every window or browser connected to the same workspace sees the same assets, favorites, jobs and service settings. There are no browser accounts, access keys or transfer IDs.

Everything Frok stores for your studio—including prompts, media, library history, settings, job logs and local performance readings—is kept on your device. Its developers collect none of this information, and the app has no built-in reporting channel or developer remote access to retrieve it. See [Legal & responsible use](./legal.md#no-collection-of-your-studio-data) for details about connected tools and information you choose to share.

Installed Frok, Electron development and browser development all store user data under `~/frok`, outside the source checkout. The library is in `~/frok/data/library/`, with uploaded/generated assets, job details/logs, recipes, generation settings, export archives and temporary job files. Job logs stay with their jobs in `~/frok/data/library/jobs/`, and editable pipeline definitions are in `~/frok/pipelines/`. Service settings, recipes, reusable generation controls and playback preferences are stored in `data/library/frok.sqlite`; a separate `configs.json` is not needed.

Electron’s internal browser profile—caches, cookies, network state and partitions—lives in the OS application-data folder with encrypted API tokens, window placement, pipeline installation records and application diagnostics, outside the workspace. On macOS that is `~/Library/Application Support/Frok`. App diagnostics are in its `logs/` subfolder; **Help → Open App Logs Folder** opens it. Saved tokens use the OS keychain and must be entered again on another machine. The installed application contains shipped code, bundled tools, icons, documentation and licenses; studio data is never saved inside it. Vpipe, ComfyUI and Ollama own their installations and model storage; Frok has no separate AI runtime or model store. See [Desktop configuration](./desktop.md#workspace-and-first-launch).

**Delete all my stuff** requires confirmation, cancels queued/active work, waits for file operations to settle and removes library media, job files, records and local export archives. It resets app settings, recipes and local interface preferences. Other open windows clear their stale preferences when they receive the new reset marker. Downloaded models, runner installations, pipeline definitions, saved API tokens and administrator environment files are kept. Remove saved tokens separately in **Settings → Advanced → API tokens**.

Frok accepts only loopback app origins. It validates Host, Origin, fetch-site metadata and a mutation-request header. Desktop builds additionally require a per-launch token supplied by Electron; that token is not an account or a browser identity. Native APIs remain sandboxed and constrained to fixed actions. These protections prevent unrelated websites from using the local app; they are not authentication for a public server.

Keep runner services appropriately protected. Frok continues to constrain files to the library, pin model paths to trusted model directories, namespace ComfyUI jobs, and retain receipts until cleanup can be verified. A library reset keeps its data if ComfyUI cleanup is still pending.

Never commit a workspace, models, credentials or generated media. Existing `.gitignore` rules cover local data and builds; personal pipeline folders should end in `.local`.


## What deletion removes

Frok deletes the selected library media files from your device and removes their library records when cleanup completes. Files shared with a retained asset stay in place. Frok's developers hold no copy of your library, retain no copy after deletion and cannot recover it for you.

The scope of the action matters:

| Action | What happens to local data |
| --- | --- |
| Delete an asset | Removes selected media and library records, plus associated job records, logs and working files. Other saved media stays. |
| Delete job and logs / Delete finished jobs | Removes the finished job records, logs and working files; generated media stays. |
| Cancel a job | Stops work; keeps the job, log and any saved media for review. |
| Automatic job cleanup | Removes finished job records, logs and working files after the configured period; saved media stays. |
| Delete all my stuff | Removes library media, job history, logs, working files and local export archives, and resets library settings and preferences. The tools and credentials listed above are kept. |

A batch's job record and log can be shared by several images. Deleting one of those images also deletes the shared job details, while other saved images remain. Queued jobs, running jobs and runners still stopping are protected from job deletion. If runner cleanup cannot finish, Frok keeps the required records and files so cleanup can be retried.

Reference images uploaded as attachments are removed with the last asset or job that uses them. Shared references stay, including inputs needed to retry failed or cancelled jobs. Ordinary uploaded root images and generated images used as references remain independent library assets.

If reference uploads finish but the generation is never queued, unused attachments are cleaned up after {{ retentionDefaults.referenceUploadHours }} hours while Frok is open, even when automatic job cleanup is off. A draft still open in the browser can upload its local file again on retry. Fresh uploads and references used by any asset or job are protected.

Failed or interrupted video conversion and upscaling files stay with their job's working files until job cleanup. Finished media is registered using a recovery journal so a failed save or interrupted registration does not leave an untracked library file.

Configure automatic cleanup in **Settings → Advanced → Background tasks & tools**. The period starts when a job finishes and includes completed, failed and cancelled jobs. Turn it off to keep details until you delete them. Cleanup runs about once a minute while Frok is open and catches up at startup.

Downloads, exports, backups and synced copies you keep outside the library are independent. Manage or delete those copies where you saved them. Separately configured tools may also keep their own data.

An interrupted deletion may leave temporary local recovery files until cleanup is retried. Frok uses ordinary file and database deletion; it does not guarantee that storage recovery tools cannot recover remnants. There is no developer-hosted recovery service.

Developers can run `npm run audit:library` to inspect the configured library, or `npm run audit:library -- /path/to/library` for another workspace. The report identifies unused references, untracked media and job folders, missing files or input records, and pending recovery journals. It opens SQLite read-only and does not migrate or delete anything. Old untracked files are reported for review rather than automatically removed. Run with Frok stopped for a stable snapshot; an active generation can change files during the audit.

## Export before deleting

In **Settings → Advanced**, choose **Export all my data** above Delete all my stuff. Frok prepares a `.tar.gz` archive and starts a normal download; the desktop app lets you choose where to save it.

The archive includes all uploaded/generated media, prompts, favorites and render groupings, all remaining job records and job files/logs (including older hidden records that have not been deleted or expired), service settings, saved recipes, generation/audio preferences, and pipeline definitions. It contains a consistent SQLite snapshot, readable `library.json`, `preferences.json`, and recovery instructions. Any retained pre-release content covered by a whole-library reset is also included when present.

Models, installed runners, cache directories, environment/credential files, and symbolic-link targets are excluded. `manifest.json` lists skipped files. Missing media causes export to fail instead of silently producing an incomplete library backup.

Finish or cancel a running job before exporting. Queued jobs pause during preparation and resume afterward. Other library changes and deletion are blocked while the snapshot is being prepared; deletion is also blocked while the backup is being transferred. Cancel stops export without changing the library.

Large libraries need temporary disk space for the prepared archive, plus space at the download destination. The archive is streamed from disk rather than loaded into page memory. When you request an export, Frok keeps a local archive so **Download again** is available for {{ retentionDefaults.exportHours }} hours. Expired archives are removed on the next export, so they may remain on disk longer if you do not export again. **Delete all my stuff** removes these archives immediately as part of a successful reset. Your downloaded archive is independent of that reset; no archive is uploaded to Frok's developers.

**Verify the download has finished and the archive opens before deleting anything.** Automatic import is not available yet. The included README explains manual recovery with Frok fully stopped; do not merge SQLite database/WAL files. Media files can also be opened directly without Frok. Recipes and interface preferences restore with the library database.

## Copy a complete workspace

Quit Frok before copying the workspace so SQLite and media files are consistent. Copy `~/frok/data` to preserve the library and saved preferences; Electron’s internal profile is not required. Also keep `~/frok/pipelines` and any custom pipeline location. Back up runner model folders separately if you want to avoid downloading them again. Restoring the studio does not require Electron’s profile, diagnostics or window state. Reconfigure API tokens on a new machine.

Browser development uses that same library and saved preferences. Older browser preferences migrate into the library on first use. An explicit `FROK_HOME` chooses a different workspace. Build output, dependency caches and disposable test fixtures are separate from studio data.

Older source checkouts may still contain a browser library at `.data/library` or an Electron workspace at `.data/desktop-dev`. Stop all Frok processes before relocating those files. Keep each complete library together, including its database and media/job folders. Preserve a second workspace separately instead of overwriting or merging it into an existing library; changing the default path does not automatically merge older libraries.

Restore into the corresponding location with Frok stopped, then check runner paths after launching on a different machine. Do not merge two database files by copying one over the other. Whole-library reset is destructive; ordinary app upgrades preserve user data.

If Frok closes unexpectedly during an export, restarting releases its abandoned lock and keeps your library. If a confirmed **Delete all my stuff** operation is interrupted, Frok finishes that reset on restart before opening the library. Models and pipeline definitions remain outside the reset.

## Asset numbers

Each root has a persistent render counter. The root uses number 1, and new video takes use increasing numbers from 2. Enhanced copies share their original take's number. Deleting a take does not reset the counter. Existing libraries receive stable numbers when upgraded; their underlying asset IDs and media files stay unchanged.
