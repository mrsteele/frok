---
description: Frok's open-source license, local studio data, no developer data collection, content responsibility, warranties and liability.
---

# Legal & responsible use

Last updated: September 11, 2026

Frok is **open-source software**, licensed under [GPL-3.0-only](./license.md). You can inspect, modify and share its source code under that license.

**You are responsible for the prompts, files and references you provide, the content you generate, and how you use or share it.** Frok is a tool for working with models and runners you choose. Making content with Frok does not establish that you have permission to use it.

## No collection of your studio data

**Everything Frok stores for your studio—including prompts, uploaded and generated images and videos, library history, settings, job logs and local performance readings—is kept on your device. Frok's authors and contributors collect none of this information.**

The app has no built-in analytics, automatic crash reporting or other reporting channel that sends this data to its developers, and it gives them no remote access to your studio. They have no means through the app to retrieve or inspect it. Local performance readings and logs are there for your progress display and troubleshooting.

This describes the Frok app itself. Separate runners, custom pipelines, download hosts and websites you visit have their own data practices. Content or logs you voluntarily share in a support request are visible to the recipients you choose. See [Your setup and data](#your-setup-and-data) for how connected tools use your inputs.

## Local storage and deletion

**Your Frok library lives on your device. Frok's developers hold no hosted copy or backup of it, retain no copy when you delete it, and cannot restore it for you.**

Deleting an asset removes the selected library records and their media files from your device when cleanup completes. Files still used by another retained asset are kept. Asset deletion also removes associated job records, logs and working files. A batch's job details can be shared by several images; deleting one image removes those shared details while keeping the other saved images. Deleting a job or log directly keeps its saved media.

Cancelling a job keeps its details and logs for review. By default, completed, failed and cancelled job records, logs and working files are automatically deleted **3 hours after the job finishes**. You can change that period or disable automatic cleanup in **Settings → Generate → Generation preferences**. Saved media and its generation settings are kept. Cleanup runs while Frok is open and catches up after reopening; it waits for runners to stop and retries pending cleanup.

To remove the library's media, job history, working files, logs, settings and local export archives, use **Settings → Generate → Delete all my stuff**. Downloaded models, installed runners, pipeline files and saved API tokens are kept. Tokens can be removed separately in **Settings → Generate → API tokens**.

Copies you download, export, back up or sync separately remain under your control. Deleting the Frok library does not delete those copies or data held by separately configured tools. If deletion is interrupted, temporary local recovery files may remain until cleanup is retried. Frok uses ordinary file and database deletion and does not guarantee that storage recovery tools cannot recover remnants.

See [storage, deletion and backups](./storage.md#what-deletion-removes) for details, including how user-requested export copies are retained locally.

## Your content and how you use it

You are responsible for complying with applicable law and obtaining the rights, permissions and consent required for your inputs and your use of outputs. This includes copyright, trademark, privacy and likeness rights, and any applicable disclosure requirements for AI-generated content.

Frok does not send your prompts, inputs or outputs to its authors or contributors, or give them remote access to your library. They cannot inspect your local content through the app and do not monitor, moderate, review or approve it. Services you choose to connect may receive content as explained under [Your setup and data](#your-setup-and-data).

**Reviewing generated content before using, publishing or selling it is your responsibility.** Outputs may be inaccurate, offensive, misleading or similar to someone else's work. A successful generation does not establish that the result is lawful, accurate or suitable for your intended use.

Frok does not claim ownership of your inputs or outputs merely because you use the app. This is not a promise that an output is copyrightable, exclusive or free of third-party rights.

## Models, runners and other tools

Models, model weights, runners, custom nodes and other third-party tools have their own licenses and terms. You are responsible for checking and complying with the terms that apply to the versions you choose, including any restrictions on commercial use or redistribution.

A model appearing in Frok, being downloadable, or passing a readiness check does not grant permission to use it for every purpose. Frok's software license does not replace a model provider's terms or obtain any required acceptance on your behalf.

## Your setup and data

Frok stores your library and settings on your device. Generation and prompt enhancement use the runners and services you configure; those services receive the inputs needed to do their work. If you configure a remote service, relevant data leaves your device. Downloads also contact third-party hosts. Review the tools you connect and their data practices before providing sensitive content.

You are responsible for choosing trusted pipelines and tools, securing your configured services and credentials, and keeping backups of files you need. Generation can consume substantial memory, storage, processing time and electricity. Interrupted or failed work may not be recoverable. See [storage and backups](./storage.md).

## No warranty

Frok is provided **"as is," without warranty to the extent permitted by applicable law**, except where a copyright holder or other party expressly provides a warranty in writing. This includes the disclaimers of implied warranties of merchantability and fitness for a particular purpose in section 15 of the [GNU GPL version 3](./license.md).

There is no promise that Frok or a selected model will be error-free, uninterrupted, secure, compatible with your setup, or suitable for a particular purpose. The allocation of risk for the software's quality, performance and necessary repairs is governed by section 15 of that license.

## Limitation of liability

As set out in sections 16 and 17 of the [GNU GPL version 3](./license.md), and unless required by applicable law or agreed to in writing, copyright holders and parties who modify or distribute Frok under that license are not liable to you for damages arising from using or being unable to use the software. The license addresses, among other things, loss of data, inaccurate data, losses suffered by you or third parties, and failures to work with other software.

**Nothing in this notice excludes liability or limits consumer protections or other rights that cannot lawfully be excluded or limited.** The full license and applicable law govern the scope and effect of these disclaimers.

## Your software license remains the same

Frok is licensed under **GPL-3.0-only**. You may use, study, modify and share the software under that license. This page explains responsibilities under applicable law and third-party terms, and summarizes the existing warranty and liability provisions. It does not impose additional restrictions on your GPL rights or require a separate agreement to use Frok. If a summary here differs from the GPL, the GPL controls the software license.

Read the [full software license](./license.md), which is also available in the app's offline documentation.
