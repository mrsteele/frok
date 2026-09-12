# Meet Frok

Frok is a local studio for turning ideas into images and short videos. Start with words, an image, or a set of references. Explore a batch, pick a frame, and build a small collection of takes around it.

The interface stays focused on the creative work: a prompt, a handful of generation options, a library, and a queue you can inspect at any time. There are no Frok accounts, subscriptions or generation credits. Your hardware, chosen runners and models determine what you can generate and how quickly.

## A studio that fits your tools

Connections and creative workflows are separate. You can use ComfyUI for images, Vpipe for video, and an installed Ollama model to enrich prompts. You can also start with a single image pipeline and add the rest later.

Pipelines are ordinary files in your home directory. You can copy a workflow, change its model or sampling settings, give it a new name, and choose it for the next generation. Updating Frok preserves edited workflows and stages conflicting stock updates for review.

## Make, compare, keep

Image batches use different seeds. Video takes stay with their starting asset. A single heart saves the whole creation, including its videos and enhanced versions. Open the asset to move between takes, inspect the actual prompts, compare SD and HD, or download a version.

The queue runs one job at a time. You can follow progress and logs, cancel work, or retry a failed job. The desktop app keeps processing when its window is closed; quitting the app is a separate action.

## Open source, early days

Frok is open-source software under [GPL-3.0-only](./license.md) and is currently version **0.1.0**. You can inspect, modify and share its source code under that license. Models and bundled tools retain their own licenses. Desktop packaging is included; signing, public distribution and in-app update delivery are separate release work.

Everything Frok stores for your studio—including prompts, media, settings, logs and local performance readings—stays on your device. Its developers collect none of this information, and the app has no built-in reporting channel or developer remote access to retrieve it. Read [how Frok keeps your studio data local](./legal.md#no-collection-of-your-studio-data), including the distinction for third-party tools and content you choose to share.

Start with [quick setup](./guide/getting-started.md), try the [first-creation tutorial](./tutorials/first-creation.md), or learn how to [contribute](./development.md). For support, find [Matt R. Steele on X](https://x.com/Matt_R_Steele).
